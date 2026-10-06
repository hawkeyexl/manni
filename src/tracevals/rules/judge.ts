/**
 * The turn judge (proposal 0079, "The judge, decisions first" and "The block
 * bar"). It checks one turn against the rules that governed it.
 *
 * Each rule is judged on its own, against the rendered turn. Which path runs
 * is detected from the provider, never configured. A decision-only provider
 * gets one `decide` call, one question per rule, branching from the turn.
 * Every provider that generates gets `runs` calls of `completeJSONShared`, one
 * item per rule, each answered with three independent scores.
 *
 * Only a confident violation blocks. Everything short of that is
 * `needs-review`, and an errored rule can only go there, never to a silent
 * pass and never to a fail.
 */
import {
  JsonCache,
  buildCacheKey,
  canDecide,
  completeJSONShared,
  sha256,
  type DecideAnswer,
  type DecisionProvider,
  type InferenceProvider,
  type ZoneThresholds,
} from "@hawkeyexl/inference";
import { DECISION_ONLY_PROVIDERS } from "../../shared/providers.js";
import type { TraceWindow } from "../graders/util.js";
import { evaluateWhen } from "../graders/when.js";
import { makeRedactor } from "../judge/redact.js";
import { renderTrace } from "../judge/render.js";
import type { Trace } from "../trace/types.js";
import type { Rule } from "./extract.js";
import {
  TURN_JUDGE_PROMPT_VERSION,
  TURN_JUDGE_SYSTEM_PROMPT,
  TURN_SCORES,
  buildDecisionState,
  buildRuleItem,
  buildTurnShared,
  questionFor,
  turnSchema,
  type TurnScore,
} from "./judge-prompt.js";
import type { RuleSource } from "./sources.js";
import type { TurnSlice } from "./turn.js";

/** Default location, under the tool's per-project cache directory. */
export const DEFAULT_TURN_CACHE_DIR = ".manni/tracevals/cache/turns";

/**
 * Set to `1`, the judge also asks for a sentence of reasoning per rule. A
 * development aid: it changes the schema, the findings and the cache key.
 */
export const REASONING_ENV = "MANNI_TRACEVALS_REASONING";

/**
 * Characters per token when fitting a provider's state limit. Prose and code
 * run near 4 characters a token in common tokenizers, and dense text such as
 * JSON, paths and hashes runs lower. 3 errs toward a smaller render, which
 * costs evidence; erring the other way costs the request.
 */
export const CHARS_PER_TOKEN = 3;

export interface TurnRule {
  source: Pick<RuleSource, "displayPath">;
  rule: Rule;
}

export interface TurnJudgeInput {
  trace: Trace;
  turn: TurnSlice;
  /** Every in-scope rule, sources ordered farthest to nearest. */
  rules: TurnRule[];
  provider: InferenceProvider;
  /** Scored runs. A decision-only provider makes one call and reports 1. */
  runs: number;
  temperature: number;
  zones: ZoneThresholds;
  render: { maxBlockChars: number; maxTotalChars: number; redact: string[] };
  /** The Stop payload's `last_assistant_message`, appended when the transcript lags. */
  lastAssistantMessage?: string;
  /** Ask for `reasoning` with the scores. Ignored by a decision-only provider. */
  reasoning?: boolean;
  cache?: TurnCache;
}

export interface TurnFinding {
  source: string;
  rule: string;
  text: string;
  outcome: "fail" | "needs-review";
  observed: string;
  confidence: number;
  /** Only when reasoning was asked for. */
  reasoning?: string;
}

export interface TurnJudgement {
  mode: "decision" | "generative";
  runs: number;
  /** Only `fail` and `needs-review`; a rule left out passed or did not apply. */
  findings: TurnFinding[];
  /** Rules sent to the judge. */
  judged: number;
  /** Rules whose `when` failed over the turn, plus those scored not applicable. */
  notApplicable: number;
  /** Every rule's verdict came from the cache. */
  cached: boolean;
  warnings: string[];
}

type Scores = Record<TurnScore, number> & { reasoning?: string };

/** One rule's answers: a score set per run that answered. */
interface Verdict {
  runs: Scores[];
  error?: string;
}

type Outcome = "fail" | "not-applicable" | "followed" | "needs-review";

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function isScores(v: unknown): v is Scores {
  return isRecord(v) && TURN_SCORES.every((s) => typeof v[s] === "number");
}

/**
 * Raw scores per rule and turn, before the block bar is applied, so a change
 * of `zones` reuses them. A rule with an errored run is never written.
 */
export class TurnCache {
  private readonly store: JsonCache<unknown>;

  constructor(dir: string = DEFAULT_TURN_CACHE_DIR, enabled = true) {
    this.store = new JsonCache<unknown>(dir, enabled, "manni-tracevals");
  }

  /** An entry of any other shape, from an older version, is a miss. */
  get(key: string): Scores[] | undefined {
    const v = this.store.get(key);
    if (!isRecord(v) || !Array.isArray(v.runs) || v.runs.length === 0) return undefined;
    const runs: unknown[] = v.runs;
    return runs.every(isScores) ? runs : undefined;
  }

  set(key: string, runs: Scores[]): void {
    this.store.set(key, { runs });
  }
}

/** Gate 6: a rule whose `when` fails over the turn is skipped, never passed. */
export function applicableRules(
  rules: TurnRule[],
  window: TraceWindow,
): { applicable: TurnRule[]; notApplicable: number } {
  const applicable = rules.filter(
    (r) => evaluateWhen({ when: r.rule.when }, window).armed,
  );
  return { applicable, notApplicable: rules.length - applicable.length };
}

interface Planned {
  /** Decision question id: source index among every input source, then rule id. */
  qid: string;
  source: string;
  id: string;
  text: string;
  /** The scored path's item for this rule. */
  item: string;
}

const round = (n: number): number => Math.round(n * 100) / 100;

/** Decision-only providers decide; every provider that generates is scored. */
function decisionOnly(provider: InferenceProvider): DecisionProvider | undefined {
  return DECISION_ONLY_PROVIDERS.has(provider.provider()) && canDecide(provider)
    ? provider
    : undefined;
}

export async function judgeTurn(input: TurnJudgeInput): Promise<TurnJudgement> {
  const { provider, zones } = input;
  const decider = decisionOnly(provider);
  const mode = decider !== undefined ? "decision" : "generative";
  const runs = decider !== undefined ? 1 : input.runs;
  const reasoning = decider === undefined && input.reasoning === true;
  const { applicable, notApplicable } = applicableRules(input.rules, input.turn.window);
  const warnings: string[] = [];
  const result: TurnJudgement = {
    mode,
    runs,
    findings: [],
    judged: applicable.length,
    notApplicable,
    cached: false,
    warnings,
  };
  if (applicable.length === 0) return result;

  // Indexed over every input source, so a question id does not move when a
  // farther source's rules happen not to apply.
  const sourceIndex = new Map<string, number>();
  for (const r of input.rules) {
    const path = r.source.displayPath;
    if (!sourceIndex.has(path)) sourceIndex.set(path, sourceIndex.size);
  }
  const planned: Planned[] = applicable.map(({ source, rule }) => ({
    qid: `${String(sourceIndex.get(source.displayPath))}:${rule.id}`,
    source: source.displayPath,
    id: rule.id,
    text: rule.text,
    item: buildRuleItem(source.displayPath, rule),
  }));

  // Render the turn, to the state limit when there is one. Every rule counts
  // toward the longest, cached or not, so the render and its key stay put.
  const tail = lastMessageLine(input);
  let budget = input.render.maxTotalChars;
  let limit: number | undefined;
  if (canDecide(provider)) {
    limit = await provider.stateLimit();
    const longest = Math.max(
      ...planned.map((p) =>
        decider !== undefined ? JSON.stringify(questionFor(p.source, p)).length : p.item.length,
      ),
    );
    const fixed =
      decider !== undefined
        ? buildDecisionState("").length
        : TURN_JUDGE_SYSTEM_PROMPT.length + buildTurnShared("").length;
    budget = Math.min(budget, limit * CHARS_PER_TOKEN - longest - fixed);
  }
  const cut = { happened: false };
  const turnText =
    renderTrace(input.trace, {
      maxBlockChars: input.render.maxBlockChars,
      maxTotalChars: budget - tail.length,
      redact: input.render.redact,
      window: input.turn.window,
      onTruncated: () => {
        cut.happened = true;
      },
    }) + tail;
  if (cut.happened) {
    warnings.push(
      limit !== undefined && budget < input.render.maxTotalChars
        ? `the turn was cut to fit the state limit of ${String(limit)} tokens of ${provider.provider()}/${provider.modelName()}; the judge saw its head and tail`
        : `the turn was cut to the render cap of ${String(input.render.maxTotalChars)} characters; the judge saw its head and tail`,
    );
  }

  // Gate 9: the same turn, rule and model reuse the verdict.
  const base = [
    provider.provider(),
    provider.modelName(),
    mode,
    `r${String(runs)}`,
    `t${String(input.temperature)}`,
    `turn-v${String(TURN_JUDGE_PROMPT_VERSION)}`,
    reasoning ? "reasoning" : "scores",
    sha256(turnText),
  ];
  const keyOf = (p: Planned): string =>
    buildCacheKey([...base, sha256(JSON.stringify([p.source, p.id, p.text]))]);

  const verdicts = new Map<Planned, Verdict>();
  const todo: Planned[] = [];
  for (const p of planned) {
    const hit = input.cache?.get(keyOf(p));
    if (hit !== undefined) verdicts.set(p, { runs: hit });
    else todo.push(p);
  }
  result.cached = todo.length === 0;
  if (todo.length > 0) {
    const fresh =
      decider !== undefined
        ? await decide(decider, todo, turnText)
        : await score(provider, todo, turnText, runs, input.temperature, reasoning);
    if (fresh.every((v) => v.runs.length === 0)) {
      throw new Error(fresh.find((v) => v.error !== undefined)?.error ?? "every judge call errored");
    }
    const errored = fresh.filter((v) => v.error !== undefined);
    if (errored.length > 0) {
      warnings.push(
        `the judge errored on ${String(errored.length)} of ${String(todo.length)} rules, so they need review: ${errored[0]?.error ?? ""}`,
      );
    }
    todo.forEach((p, i) => {
      const v = fresh[i] ?? { runs: [], error: "the judge returned nothing" };
      verdicts.set(p, v);
      if (v.error === undefined) input.cache?.set(keyOf(p), v.runs);
    });
  }

  for (const p of planned) {
    const v = verdicts.get(p) ?? { runs: [], error: "the judge returned nothing" };
    const outcome = outcomeOf(v, runs, zones);
    if (outcome === "not-applicable") result.notApplicable += 1;
    else if (outcome !== "followed") result.findings.push(findingOf(p, outcome, v, runs));
  }
  return result;
}

/** One `decide` call; each option's probability becomes its score. */
async function decide(
  decider: DecisionProvider,
  todo: Planned[],
  turnText: string,
): Promise<Verdict[]> {
  const response = await decider.decide({
    state: buildDecisionState(turnText),
    questions: Object.fromEntries(todo.map((p) => [p.qid, questionFor(p.source, p)])),
  });
  const answers: Record<string, DecideAnswer | undefined> = response.answers;
  return todo.map((p) => {
    const answer = answers[p.qid];
    if (answer === undefined) return { runs: [], error: "the judge returned no answer for this rule" };
    const pct = (s: TurnScore): number => Math.round((answer.probabilities[s] ?? 0) * 100);
    return {
      runs: [
        {
          followed: pct("followed"),
          "not-followed": pct("not-followed"),
          "not-applicable": pct("not-applicable"),
        },
      ],
    };
  });
}

/** `runs` shared-prefix calls, one item per rule. */
async function score(
  provider: InferenceProvider,
  todo: Planned[],
  turnText: string,
  runs: number,
  temperature: number,
  reasoning: boolean,
): Promise<Verdict[]> {
  const verdicts: Verdict[] = todo.map(() => ({ runs: [] }));
  const errors = todo.map(() => 0);
  for (let run = 0; run < runs; run++) {
    const response = await completeJSONShared(provider, {
      system: TURN_JUDGE_SYSTEM_PROMPT,
      shared: buildTurnShared(turnText),
      items: todo.map((p) => p.item),
      schema: turnSchema(reasoning),
      temperature,
    });
    verdicts.forEach((v, i) => {
      const answer = response.answers[i];
      if (answer !== undefined && "json" in answer && isScores(answer.json)) {
        v.runs.push(answer.json);
        return;
      }
      errors[i] = (errors[i] ?? 0) + 1;
      v.error ??= answer !== undefined && "error" in answer ? answer.error : "the judge returned nothing";
    });
  }
  return verdicts.map((v, i) =>
    v.error === undefined || v.runs.length === 0
      ? v
      : { ...v, error: `${String(errors[i] ?? 0)} of ${String(runs)} runs errored: ${v.error}` },
  );
}

function classify(s: Scores, zones: ZoneThresholds): Outcome {
  // An integer over 100 lands on the same double as the zone's literal, where
  // the zone times 100 can miss it (0.7 * 100 is 70.00000000000001).
  if (s["not-followed"] / 100 >= zones.autoFail) return "fail";
  if (s["not-applicable"] / 100 >= zones.autoPass) return "not-applicable";
  if (s.followed / 100 >= zones.autoPass) return "followed";
  return "needs-review";
}

/** Every run has to agree: a split ensemble, or any error, is review. */
function outcomeOf(v: Verdict, runs: number, zones: ZoneThresholds): Outcome {
  if (v.error !== undefined || v.runs.length < runs) return "needs-review";
  const each = v.runs.map((s) => classify(s, zones));
  if (each.every((c) => c === "fail")) return "fail";
  if (each.every((c) => c === "not-applicable")) return "not-applicable";
  if (each.every((c) => c === "not-applicable" || c === "followed")) return "followed";
  return "needs-review";
}

function findingOf(
  p: Planned,
  outcome: TurnFinding["outcome"],
  v: Verdict,
  runs: number,
): TurnFinding {
  const base = { source: p.source, rule: p.id, text: p.text, outcome };
  if (v.runs.length === 0) {
    return {
      ...base,
      observed: `the judge returned no answer for this rule: ${v.error ?? ""}`,
      confidence: 0,
    };
  }
  const mean = (s: TurnScore): number =>
    Math.round(v.runs.reduce((sum, r) => sum + r[s], 0) / v.runs.length);
  const scores = `not-followed ${String(mean("not-followed"))}, followed ${String(mean("followed"))}, not-applicable ${String(mean("not-applicable"))}`;
  const errored = v.error !== undefined && runs > 1 ? `; ${v.error}` : "";
  const reasoning = v.runs.find((r) => typeof r.reasoning === "string")?.reasoning;
  return {
    ...base,
    observed: `${scores}${errored}${reasoning !== undefined ? `. ${reasoning}` : ""}`,
    confidence: round(mean("not-followed") / 100),
    ...(reasoning !== undefined ? { reasoning } : {}),
  };
}

/**
 * The transcript is written asynchronously, so its last message can lag the
 * Stop. The payload's copy is appended when the window does not end with it,
 * scrubbed and clipped as every rendered block is.
 */
function lastMessageLine(input: TurnJudgeInput): string {
  const message = input.lastAssistantMessage?.trim();
  if (message === undefined || message === "") return "";
  if (input.turn.window.assistantTexts.at(-1)?.trim() === message) return "";
  const safe = makeRedactor(input.render.redact)(message);
  const max = input.render.maxBlockChars;
  const clipped =
    safe.length <= max
      ? safe
      : `${safe.slice(0, max)} [... truncated ${String(safe.length - max)} chars ...]`;
  return `\n[assistant] ${clipped}`;
}
