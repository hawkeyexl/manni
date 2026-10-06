/**
 * The turn judge (proposal 0079, "The judge, decisions first" and "The block
 * bar"). It checks one turn against the rules that governed it.
 *
 * Which mode runs is detected from the provider, never configured. A provider
 * that can decide gets one `decide` call, one question per rule, branching
 * from the rendered turn. Any other provider gets `runs` generative calls,
 * each returning only the rules the turn broke or could not settle.
 *
 * Only a confident violation blocks. Everything short of that is
 * `needs-review`, and an errored run can only push a rule there, never to a
 * silent pass and never to a fail.
 */
import {
  JsonCache,
  buildCacheKey,
  canDecide,
  completeValidatedJSON,
  sha256,
  type DecideAnswer,
  type DecideQuestion,
  type InferenceProvider,
  type ZoneThresholds,
} from "@hawkeyexl/inference";
import type { TraceWindow } from "../graders/util.js";
import { evaluateWhen } from "../graders/when.js";
import { makeRedactor } from "../judge/redact.js";
import { renderTrace } from "../judge/render.js";
import type { Trace } from "../trace/types.js";
import type { Rule } from "./extract.js";
import {
  TURN_CRITERIA,
  TURN_JUDGE_PROMPT_VERSION,
  TURN_JUDGE_SYSTEM_PROMPT,
  TURN_SCHEMA,
  buildDecisionState,
  buildTurnUser,
  questionFor,
  ruleKey,
  type RuleGroup,
} from "./judge-prompt.js";
import type { RuleSource } from "./sources.js";
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
  source: Pick<RuleSource, "displayPath">;
  rule: Rule;
}

export interface TurnJudgeInput {
  trace: Trace;
  turn: TurnSlice;
  /** Every in-scope rule, sources ordered farthest to nearest. */
  rules: TurnRule[];
  provider: InferenceProvider;
  /** Generative runs. Decision mode makes one call and reports 1. */
  runs: number;
  temperature: number;
  zones: ZoneThresholds;
  render: { maxBlockChars: number; maxTotalChars: number; redact: string[] };
  /** The Stop payload's `last_assistant_message`, appended when the transcript lags. */
  lastAssistantMessage?: string;
  cache?: TurnCache;
}

export interface TurnFinding {
  source: string;
  rule: string;
  text: string;
  outcome: "fail" | "needs-review";
  observed: string;
  confidence: number;
}

export interface TurnJudgement {
  mode: "decision" | "generative";
  runs: number;
  /** Only `fail` and `needs-review`; a rule left out passed or did not apply. */
  findings: TurnFinding[];
  /** Rules sent to the judge. */
  judged: number;
  /** Rules whose `when` failed over the turn, plus decisions of `not_applicable`. */
  notApplicable: number;
  cached: boolean;
  warnings: string[];
}

interface Entry {
  rule: string;
  observed: string;
  confidence: number;
}

interface TurnAnswer {
  violations: Entry[];
  unclear: Entry[];
}

type TurnCacheEntry =
  | { answers: Record<string, DecideAnswer> }
  | { runs: TurnAnswer[] };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function isTurnAnswer(v: unknown): v is TurnAnswer {
  return isRecord(v) && Array.isArray(v.violations) && Array.isArray(v.unclear);
}

/**
 * Raw judge answers per turn, before the block bar is applied, so a change of
 * `zones` reuses them. An answer with an errored run is never written.
 */
export class TurnCache {
  private readonly store: JsonCache<unknown>;

  constructor(dir: string = DEFAULT_TURN_CACHE_DIR, enabled = true) {
    this.store = new JsonCache<unknown>(dir, enabled, "manni-tracevals");
  }

  /** An entry of any other shape, from an older version, is a miss. */
  get(key: string): TurnCacheEntry | undefined {
    const v = this.store.get(key);
    if (!isRecord(v)) return undefined;
    if (isRecord(v.answers)) return { answers: v.answers as Record<string, DecideAnswer> };
    if (Array.isArray(v.runs) && v.runs.every(isTurnAnswer)) return { runs: v.runs };
    return undefined;
  }

  set(key: string, entry: TurnCacheEntry): void {
    this.store.set(key, entry);
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
  /** How the generative mode names the rule. */
  key: string;
  source: string;
  id: string;
  text: string;
}

const round = (n: number): number => Math.round(n * 100) / 100;

export async function judgeTurn(input: TurnJudgeInput): Promise<TurnJudgement> {
  const { provider, zones } = input;
  const decider = canDecide(provider) ? provider : undefined;
  const mode = decider !== undefined ? "decision" : "generative";
  const runs = decider !== undefined ? 1 : input.runs;
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
  const groups: RuleGroup[] = [];
  for (const { source, rule } of applicable) {
    let group = groups.find((g) => g.displayPath === source.displayPath);
    if (group === undefined) {
      group = { displayPath: source.displayPath, rules: [] };
      groups.push(group);
    }
    group.rules.push({ id: rule.id, text: rule.text });
  }
  const planned: Planned[] = groups.flatMap((g) =>
    g.rules.map((r) => ({
      qid: `${String(sourceIndex.get(g.displayPath))}:${r.id}`,
      key: ruleKey(g.displayPath, r.id),
      source: g.displayPath,
      id: r.id,
      text: r.text,
    })),
  );

  // Render the turn, to the state limit when there is one.
  const tail = lastMessageLine(input);
  let budget = input.render.maxTotalChars;
  let limit: number | undefined;
  let questions: Record<string, DecideQuestion> | undefined;
  if (decider !== undefined) {
    questions = Object.fromEntries(planned.map((p) => [p.qid, questionFor(p.source, p)]));
    limit = await decider.stateLimit();
    const longest = Math.max(...Object.values(questions).map((q) => JSON.stringify(q).length));
    const fixed = buildDecisionState(groups, "").length;
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

  // Gate 9: the same turn, rule set and model reuse the verdict.
  const key = buildCacheKey([
    provider.provider(),
    provider.modelName(),
    mode,
    `r${String(runs)}`,
    `t${String(input.temperature)}`,
    `turn-v${String(TURN_JUDGE_PROMPT_VERSION)}`,
    sha256(turnText),
    sha256(JSON.stringify(groups)),
  ]);
  const hit = input.cache?.get(key);

  if (decider !== undefined && questions !== undefined) {
    let answers = hit !== undefined && "answers" in hit ? hit.answers : undefined;
    result.cached = answers !== undefined;
    if (answers === undefined) {
      const response = await decider.decide({
        state: buildDecisionState(groups, turnText),
        questions,
      });
      answers = response.answers;
      // A missing answer is an errored question, so the whole set stays out.
      if (planned.every((p) => answers?.[p.qid] !== undefined)) {
        input.cache?.set(key, { answers });
      }
    }
    for (const p of planned) {
      const answer = answers[p.qid];
      const choice = answer?.choice;
      if (answer === undefined || choice === undefined || !(choice in TURN_CRITERIA)) {
        result.findings.push(finding(p, "needs-review", "the judge returned no answer for this rule", 0));
        continue;
      }
      if (choice === "followed") continue;
      if (choice === "not_applicable") {
        result.notApplicable += 1;
        continue;
      }
      const observed = `${choice} with probability ${answer.confidence.toFixed(2)}`;
      const blocks = choice === "violated" && answer.confidence >= zones.autoFail;
      result.findings.push(
        finding(p, blocks ? "fail" : "needs-review", observed, round(answer.confidence)),
      );
    }
    return result;
  }

  let answers = hit !== undefined && "runs" in hit ? hit.runs : undefined;
  result.cached = answers !== undefined;
  const errors: string[] = [];
  if (answers === undefined) {
    answers = [];
    for (let i = 0; i < runs; i++) {
      const run = await completeValidatedJSON<TurnAnswer>({
        provider,
        system: TURN_JUDGE_SYSTEM_PROMPT,
        user: buildTurnUser(groups, turnText),
        schema: TURN_SCHEMA,
        temperature: input.temperature,
      });
      if (run.result === undefined) errors.push(run.error ?? "the judge returned nothing");
      else answers.push(run.result);
    }
    if (answers.length === 0) throw new Error(errors[0] ?? "every judge run errored");
    if (errors.length > 0) {
      warnings.push(
        `${String(errors.length)} of ${String(runs)} judge runs errored, so no rule could fail: ${errors[0] ?? ""}`,
      );
    } else {
      input.cache?.set(key, { runs: answers });
    }
  }
  for (const p of planned) {
    const flags = answers.map((a) => {
      const violated = a.violations.find((e) => e.rule === p.key);
      if (violated !== undefined) return { violated: true, ...violated };
      const unclear = a.unclear.find((e) => e.rule === p.key);
      return unclear === undefined ? undefined : { violated: false, ...unclear };
    });
    const flagged = flags.filter((f) => f !== undefined);
    const first = flagged.find((f) => f.violated) ?? flagged[0];
    if (first === undefined) continue;
    const unanimous =
      errors.length === 0 &&
      flags.every((f) => f !== undefined && f.violated && f.confidence >= zones.autoFail);
    const mean = flagged.reduce((sum, f) => sum + f.confidence, 0) / flagged.length;
    result.findings.push(
      finding(p, unanimous ? "fail" : "needs-review", first.observed, round(mean)),
    );
  }
  return result;
}

function finding(
  p: Planned,
  outcome: TurnFinding["outcome"],
  observed: string,
  confidence: number,
): TurnFinding {
  return { source: p.source, rule: p.id, text: p.text, outcome, observed, confidence };
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
