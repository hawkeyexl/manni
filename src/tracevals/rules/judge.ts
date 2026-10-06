/**
 * The turn judge (proposal 0079, "The judge, decisions first" and "The block
 * bar"). It checks one turn against the rules that governed it.
 *
 * Each rule is judged on its own, against the rendered turn. Which path runs
 * is detected from the provider, never configured. A decision-only provider
 * gets one `decide` call, one question per rule, branching from the turn.
 * Every provider that generates gets `runs` calls of `completeJSONShared`, one
 * item per rule, each answered with a sentence of reasoning and then three
 * independent scores. Both share what earlier turns of the transcript did,
 * and a scored rule's item carries what the session ledger holds for it.
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
  ruleKey,
  TURN_SCHEMA,
  type TurnScore,
} from "./judge-prompt.js";
import { historyBlock, type Ledger } from "./ledger.js";
import type { RuleSource } from "./sources.js";
import { timelineBlock } from "./timeline.js";
import type { TurnSlice } from "./turn.js";

/** Default location, under the tool's per-project cache directory. */
export const DEFAULT_TURN_CACHE_DIR = ".manni/tracevals/cache/turns";

/**
 * Characters per token when fitting a provider's state limit. Prose and code
 * run near 4 characters a token in common tokenizers, and dense text such as
 * JSON, paths and hashes runs lower. 3 errs toward a smaller render, which
 * costs evidence; erring the other way costs the request.
 */
export const CHARS_PER_TOKEN = 3;

export interface TurnRule {
  /** `path` lets the earlier turns say the session read the source. */
  source: Pick<RuleSource, "displayPath"> & Partial<Pick<RuleSource, "path">>;
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
  /**
   * The session's earlier verdicts, and which earlier turns had no rule in
   * scope. Only a scored rule's item carries its own history.
   */
  ledger?: Ledger;
  /** Where paths in earlier turns are made relative; the trace's cwd by default. */
  project?: { cwd: string; root: string };
  cache?: TurnCache;
}

export interface TurnFinding {
  source: string;
  rule: string;
  text: string;
  outcome: "fail" | "needs-review";
  observed: string;
  confidence: number;
  /** The judge's reasoning. A decision-only provider gives none. */
  reasoning?: string;
}

/** Every rule sent to the judge, with where its verdict landed. */
export interface TurnVerdict {
  source: string;
  rule: string;
  text: string;
  outcome: Outcome;
  reasoning?: string;
}

export interface TurnJudgement {
  mode: "decision" | "generative";
  runs: number;
  /** Only `fail` and `needs-review`; a rule left out passed or did not apply. */
  findings: TurnFinding[];
  /** One per rule sent to the judge, whatever its outcome. */
  verdicts: TurnVerdict[];
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

export type Outcome = "fail" | "not-applicable" | "followed" | "needs-review";

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

export interface ModelId {
  provider: string;
  model: string;
}

/**
 * What a provider's `stateLimit()` last said, per provider and model, with
 * `null` for one that has no limit. A local model loads to report it, and the
 * limit sets how much of the turn is rendered, which the verdict key hashes. So
 * "is every verdict cached?" could not be answered without loading the model
 * until this remembered the answer. A stale limit costs a miss, never a wrong
 * verdict, because a hit is keyed by the text it was scored on.
 */
export class StateLimits {
  private readonly store: JsonCache<unknown>;

  constructor(dir: string, enabled = true) {
    this.store = new JsonCache<unknown>(dir, enabled, "manni-tracevals");
  }

  get(id: ModelId): number | null | undefined {
    const v = this.store.get(buildCacheKey([id.provider, id.model]));
    return isRecord(v) && (v.limit === null || typeof v.limit === "number") ? v.limit : undefined;
  }

  set(id: ModelId, limit: number | null): void {
    this.store.set(buildCacheKey([id.provider, id.model]), { limit });
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
  /** The ledger's block for this rule, "" for none and on the decision path. */
  history: string;
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

/** The input without the provider, which a gate can use before one is built. */
export type TurnPlanInput = Omit<TurnJudgeInput, "provider">;

interface Plan {
  planned: Planned[];
  turnText: string;
  /** The transcript's account of earlier turns, "" for none. */
  earlier: string;
  warnings: string[];
  hits: Map<Planned, Verdict>;
  todo: Planned[];
  keyOf: (p: Planned) => string;
}

/**
 * Everything short of the model call: each rule's item, the turn rendered to
 * `limit` (undefined for no limit), and the verdict cache read. `decisionOnly`
 * and `limit` are all that come from the provider, so a caller that knows both
 * can plan without one.
 */
function planTurn(
  input: TurnPlanInput,
  id: ModelId,
  decisionOnly: boolean,
  limit: number | undefined,
): Plan {
  const runs = decisionOnly ? 1 : input.runs;
  const { applicable } = applicableRules(input.rules, input.turn.window);
  const warnings: string[] = [];
  const hits = new Map<Planned, Verdict>();

  // Indexed over every input source, so a question id does not move when a
  // farther source's rules happen not to apply.
  const sourceIndex = new Map<string, number>();
  for (const r of input.rules) {
    const path = r.source.displayPath;
    if (!sourceIndex.has(path)) sourceIndex.set(path, sourceIndex.size);
  }
  const planned: Planned[] = applicable.map(({ source, rule }) => {
    const history =
      !decisionOnly && input.ledger !== undefined
        ? historyBlock(input.ledger, ruleKey(source.displayPath, rule.id), rule.text, input.turn.from)
        : "";
    return {
      qid: `${String(sourceIndex.get(source.displayPath))}:${rule.id}`,
      source: source.displayPath,
      id: rule.id,
      text: rule.text,
      history,
      item: buildRuleItem(source.displayPath, rule, history),
    };
  });
  if (planned.length === 0) {
    return { planned, turnText: "", earlier: "", warnings, hits, todo: [], keyOf: () => "" };
  }

  // Render the turn, to the state limit when there is one. Every rule counts
  // toward the longest, cached or not, so the render and its key stay put.
  const tail = lastMessageLine(input);
  let budget = input.render.maxTotalChars;
  let byLimit = false;
  if (limit !== undefined) {
    const longest = Math.max(
      ...planned.map((p) =>
        decisionOnly ? JSON.stringify(questionFor(p.source, p)).length : p.item.length,
      ),
    );
    const fixed = decisionOnly
      ? buildDecisionState("").length
      : TURN_JUDGE_SYSTEM_PROMPT.length + buildTurnShared("").length;
    const fit = limit * CHARS_PER_TOKEN - longest - fixed;
    if (fit < budget) {
      budget = fit;
      byLimit = true;
    }
  }
  // Earlier turns share the budget with the turn, and take at most a quarter
  // of it, so the turn itself is never crowded out.
  const sources = [
    ...new Map(
      input.rules.flatMap(({ source: { path, displayPath } }) =>
        // A source with no file (the typed prompts, an inline plan) is never read.
        path !== undefined && path !== "" ? [[displayPath, { path, displayPath }] as const] : [],
      ),
    ).values(),
  ];
  const earlier = timelineBlock(input.trace, input.turn.from, {
    cwd: input.project?.cwd ?? input.trace.cwd,
    root: input.project?.root ?? input.trace.cwd,
    redact: input.render.redact,
    sources,
    ...(input.ledger !== undefined ? { ledger: input.ledger } : {}),
    maxChars: Math.floor(budget / 4),
  });
  budget -= buildTurnShared("", earlier).length - buildTurnShared("").length;
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
      byLimit
        ? `the turn was cut to fit the state limit of ${String(limit)} tokens of ${id.provider}/${id.model}; the judge saw its head and tail`
        : `the turn was cut to the render cap of ${String(input.render.maxTotalChars)} characters; the judge saw its head and tail`,
    );
  }

  // Gate 9: the same turn, rule and model reuse the verdict.
  const base = [
    id.provider,
    id.model,
    decisionOnly ? "decision" : "generative",
    `r${String(runs)}`,
    `t${String(input.temperature)}`,
    `turn-v${String(TURN_JUDGE_PROMPT_VERSION)}`,
    sha256(turnText),
    sha256(earlier),
  ];
  const keyOf = (p: Planned): string =>
    buildCacheKey([...base, sha256(JSON.stringify([p.source, p.id, p.text, p.history]))]);
  const todo: Planned[] = [];
  for (const p of planned) {
    const hit = input.cache?.get(keyOf(p));
    if (hit !== undefined) hits.set(p, { runs: hit });
    else todo.push(p);
  }
  return { planned, turnText, earlier, warnings, hits, todo, keyOf };
}

/**
 * Whether every applicable rule already has its verdict, answered without a
 * provider and so without loading a local model. The render depends on the
 * provider's state limit, which `StateLimits` remembers from the last
 * judgement, so a model never judged with is unknown and the answer is no.
 * A decision-only provider is never asked here: it is not a local model.
 */
export function allVerdictsCached(
  input: TurnPlanInput & { limits: StateLimits },
  id: ModelId,
): boolean {
  const limit = input.limits.get(id);
  if (limit === undefined || DECISION_ONLY_PROVIDERS.has(id.provider)) return false;
  const plan = planTurn(input, id, false, limit ?? undefined);
  return plan.planned.length > 0 && plan.todo.length === 0;
}

export async function judgeTurn(
  input: TurnJudgeInput & { limits?: StateLimits },
): Promise<TurnJudgement> {
  const { provider, zones } = input;
  const decider = decisionOnly(provider);
  const mode = decider !== undefined ? "decision" : "generative";
  const runs = decider !== undefined ? 1 : input.runs;
  const id: ModelId = { provider: provider.provider(), model: provider.modelName() };
  const { applicable, notApplicable } = applicableRules(input.rules, input.turn.window);
  const result: TurnJudgement = {
    mode,
    runs,
    findings: [],
    verdicts: [],
    judged: applicable.length,
    notApplicable,
    cached: false,
    warnings: [],
  };
  if (applicable.length === 0) return result;

  // The provider's limit, remembered. A remembered one lets a fully cached
  // turn finish without asking the provider at all; any miss asks for the real
  // one, which refreshes the memory, and plans again if it moved.
  const fresh = async (): Promise<number | null> => {
    const real = canDecide(provider) ? await provider.stateLimit() : null;
    input.limits?.set(id, real);
    return real;
  };
  const remembered = input.limits?.get(id);
  let limit = remembered ?? (await fresh());
  let plan = planTurn(input, id, decider !== undefined, limit ?? undefined);
  if (remembered !== undefined && plan.todo.length > 0) {
    const real = await fresh();
    if (real !== limit) {
      limit = real;
      plan = planTurn(input, id, decider !== undefined, limit ?? undefined);
    }
  }
  const { planned, hits: verdicts, todo, keyOf, turnText, earlier } = plan;
  const warnings = plan.warnings;
  result.warnings = warnings;
  result.cached = todo.length === 0;
  if (todo.length > 0) {
    const scored =
      decider !== undefined
        ? await decide(decider, todo, buildDecisionState(turnText, earlier))
        : await score(provider, todo, buildTurnShared(turnText, earlier), runs, input.temperature);
    if (scored.every((v) => v.runs.length === 0)) {
      throw new Error(scored.find((v) => v.error !== undefined)?.error ?? "every judge call errored");
    }
    const errored = scored.filter((v) => v.error !== undefined);
    if (errored.length > 0) {
      warnings.push(
        `the judge errored on ${String(errored.length)} of ${String(todo.length)} rules, so they need review: ${errored[0]?.error ?? ""}`,
      );
    }
    todo.forEach((p, i) => {
      const v = scored[i] ?? { runs: [], error: "the judge returned nothing" };
      verdicts.set(p, v);
      if (v.error === undefined) input.cache?.set(keyOf(p), v.runs);
    });
  }

  for (const p of planned) {
    const v = verdicts.get(p) ?? { runs: [], error: "the judge returned nothing" };
    const outcome = outcomeOf(v, runs, zones);
    const reasoning = v.runs.find((r) => typeof r.reasoning === "string")?.reasoning;
    result.verdicts.push({
      source: p.source,
      rule: p.id,
      text: p.text,
      outcome,
      ...(reasoning !== undefined ? { reasoning } : {}),
    });
    if (outcome === "not-applicable") result.notApplicable += 1;
    else if (outcome !== "followed") result.findings.push(findingOf(p, outcome, v, runs));
  }
  return result;
}

/** One `decide` call; each option's probability becomes its score. */
async function decide(
  decider: DecisionProvider,
  todo: Planned[],
  state: string,
): Promise<Verdict[]> {
  const response = await decider.decide({
    state,
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
  shared: string,
  runs: number,
  temperature: number,
): Promise<Verdict[]> {
  const verdicts: Verdict[] = todo.map(() => ({ runs: [] }));
  const errors = todo.map(() => 0);
  for (let run = 0; run < runs; run++) {
    const response = await completeJSONShared(provider, {
      system: TURN_JUDGE_SYSTEM_PROMPT,
      shared,
      items: todo.map((p) => p.item),
      schema: TURN_SCHEMA,
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
function lastMessageLine(input: TurnPlanInput): string {
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
