/**
 * The trace-adherence ensemble judge: N independent runs per eval plan, each a
 * fresh request with no shared context, aggregated by consensus and routed
 * through confidence zones.
 *
 * The ensemble mechanics (retry-once, errored runs counting against consensus,
 * cache replay) now live in the inference library; what stays here is what is
 * manni tracevals-specific — the per-instance turn budget, the trace-worded
 * verdict schema, and the `JudgedEval` shape the reporters consume.
 */
import {
  computeConsensus,
  runEnsemble,
  zoneFor,
  type ConsensusResult,
  type InferenceProvider,
} from "@hawkeyexl/inference";
import verdictSchemaJson from "./verdict-schema.json" with { type: "json" };
import type { EvalPlan } from "../core/plan.js";
import { VerdictCache, cacheKey } from "./cache.js";
import { turnBudgetSkipReason } from "../../docevals/judge/budget.js";
import { buildUserContent, JUDGE_SYSTEM_PROMPT } from "./prompt.js";
import { readTarget, describeTarget } from "../core/target.js";
import type { Trace } from "../trace/types.js";

/**
 * manni tracevals' own verdict wording. Structurally identical to the library's
 * canonical schema, but the field descriptions talk about sessions and tool
 * calls rather than pages — and those descriptions are prompt surface that
 * steers the model, so they are worth keeping (inference ADR 01001).
 */
const verdictSchema = verdictSchemaJson as Record<string, unknown>;

export interface TraceJudgeOptions {
  provider: InferenceProvider;
  /**
   * The provider for an eval that names its own `provider:` or `model:`.
   *
   * The choice is passed through rather than resolved here: precedence across
   * the flag, the eval, `tracevals.provider` and the family's `providers:` is
   * one rule, in `judge/provider.ts`, and a second copy of it inside the judge
   * is how a run and an eval come to disagree about which model answered.
   * Without this hook an eval naming a provider errors rather than being
   * judged silently by the default model — an eval that names a provider is
   * asking for that one.
   */
  providerFor?: (choice: {
    provider?: string;
    model?: string;
    origin?: string;
  }) => Promise<InferenceProvider>;
  /** Ensemble size; default 3. */
  runs?: number;
  /** Default 0; nonzero adds verdict noise. */
  temperature?: number;
  zones?: { autoPass: number; autoFail: number };
  cacheDir?: string;
  noCache?: boolean;
  /**
   * Ensemble runs this judge may spend, over every call of it. `null` or
   * absent is unbounded. A cached ensemble makes no inference call, so it
   * spends none (docevals ADR 01019).
   */
  maxTurns?: number | null;
}

export interface JudgedEval {
  evalName: string;
  artifact: string;
  artifactName: string;
  grader: string;
  implicit: boolean;
  outcome: "pass" | "fail" | "needs-review" | "skipped" | "error";
  consensus?: ConsensusResult;
  skipReason?: string;
  /** Set when the eval could not be judged at all. */
  error?: string;
  /** Set when the judge model also produced what it graded. See EvalResult. */
  selfPreference?: { axis: "session" | "criterion"; model: string };
  /**
   * Uncached ensemble runs this eval spent. `0` when the ensemble came from
   * cache, when the budget stopped it, and when it never reached a provider.
   */
  turns: number;
  durationMs: number;
}

/** What the judge needs about the session beyond its rendered form. */
export interface TraceJudgeContext {
  /**
   * The parsed session. Supplies `target` selection and the model that
   * produced the run — absent means "unknown", which is reported rather than
   * treated as "not the same model".
   */
  trace?: Trace;
  /** Root a relative `{source: file}` target resolves against. */
  projectRoot?: string;
}

/**
 * The digest is requested per plan rather than handed over once: each eval is
 * judged against the window its artifact was governing (ADR 01015), so the
 * transcript differs from eval to eval. `target` then selects within that
 * window, which is why it reads the rendered result rather than the trace.
 *
 * The returned function is callable repeatedly — once per trace in a batch —
 * and `maxTurns` spans every call, because the budget lives on the instance
 * rather than on the call (ADR 01018).
 */
export type TraceJudge = (
  plans: EvalPlan[],
  renderFor: (plan: EvalPlan) => string,
  context?: TraceJudgeContext,
) => Promise<JudgedEval[]>;

export function makeTraceJudge(options: TraceJudgeOptions): TraceJudge {
  const provider = options.provider;
  // CLI > eval > default. The flag is an explicit operator act ("run cheap
  // right now"), so it outranks an eval asking for more agreement; the eval
  // outranks the run default, which is the point of having it.
  const runsFor = (plan: EvalPlan): number => options.runs ?? plan.runs ?? 3;
  const temperature = options.temperature ?? 0;
  const zones = options.zones ?? { autoPass: 0.8, autoFail: 0.8 };
  const cache = new VerdictCache(
    options.cacheDir ?? ".manni/tracevals/cache",
    options.noCache !== true && options.cacheDir !== undefined,
    "manni-tracevals",
  );
  const maxTurns = options.maxTurns ?? null;

  // Deliberately outside the returned function: the budget belongs to the
  // *judge instance*, not to one call of it. A batch calls the judge once per
  // trace (ADR 01018), so a per-call counter would make `maxTurns` a cap on
  // the largest trace rather than on the run — 50 traces would spend 50x the
  // configured ceiling and every report would look like it obeyed it. A
  // single-trace run calls the judge exactly once, so this is invisible there.
  let turnsSpent = 0;

  return async (plans, renderFor, context) => {
    const trace = context?.trace;
    const sessionModel = trace?.model;
    const results: JudgedEval[] = [];

    for (const plan of plans) {
      const start = Date.now();
      const base = {
        evalName: plan.evalName,
        artifact: plan.artifact.path,
        artifactName: plan.artifact.name,
        grader: plan.grader,
        implicit: plan.implicit,
      };

      // An eval may name its own provider or model. Resolve it before the
      // budget gate so a typo is reported as the eval's own error rather than
      // hidden behind an exhausted budget.
      //
      // Which provider the pair resolves to is `providerFor`'s to decide, not
      // this loop's: the flag outranks the eval, the eval outranks the config,
      // and that ladder is one rule in `judge/provider.ts`. An eval whose
      // choice resolves to the run's own gets the run's already-constructed
      // provider back.
      let evalProvider = provider;
      if (plan.provider !== undefined || plan.model !== undefined) {
        const resolved = await resolveOverride(plan, options);
        if ("error" in resolved) {
          results.push({
            ...base,
            outcome: "error",
            error: resolved.error,
            turns: 0,
            durationMs: Date.now() - start,
          });
          continue;
        }
        evalProvider = resolved.provider;
      }

      // The window this artifact was governing (ADR 01015). `target` selects
      // within it, so the two compose: a `transcript` target means "this
      // eval's window", not "the whole session".
      const renderedTrace = renderFor(plan);

      // What this eval asked to be graded. A target that cannot be served
      // errors rather than falling back to the transcript: a verdict about the
      // wrong bytes is worse than no verdict.
      // Without a parsed trace only the transcript and the artifact can be
      // served. Saying so beats quietly grading the transcript instead.
      const selected =
        trace === undefined
          ? plan.target === undefined ||
            plan.target === "transcript" ||
            plan.target === "artifact"
            ? ({
                ok: true as const,
                text:
                  plan.target === "artifact"
                    ? plan.artifact.content
                    : renderedTrace,
                label: plan.target === "artifact" ? "artifact" : "transcript",
              })
            : ({
                ok: false as const,
                reason: `target "${describeTarget(plan.target)}" needs the parsed session, which this run did not supply`,
              })
          : readTarget(plan.target, {
              trace,
              renderedTrace,
              artifactContent: plan.artifact.content,
              root: context?.projectRoot ?? trace.cwd,
            });
      if (!selected.ok) {
        results.push({
          ...base,
          outcome: "error",
          error: selected.reason,
          turns: 0,
          durationMs: Date.now() - start,
        });
        continue;
      }

      const runsPerEval = runsFor(plan);
      const key = cacheKey(
        evalProvider.provider(),
        evalProvider.modelName(),
        runsPerEval,
        temperature,
        // The selected bytes, not always the transcript: two targets on one
        // session are two different questions and must not share a verdict.
        selected.text,
        plan,
      );
      const cached = cache.get(key) !== undefined;

      // A cached ensemble makes no inference call, so it never touches the
      // budget — a committed cache replays under any cap. For an uncached one
      // the turns are claimed *before* dispatching, which is the whole point
      // of counting turns rather than dollars: the claim is synchronous, so
      // nothing can clear an almost-exhausted budget and then overspend it
      // (docevals ADR 01019).
      if (maxTurns !== null && !cached) {
        if (turnsSpent + runsPerEval > maxTurns) {
          results.push({
            ...base,
            outcome: "skipped",
            skipReason: turnBudgetSkipReason(maxTurns),
            turns: 0,
            durationMs: 0,
          });
          continue;
        }
        // One turn per ensemble run. A run can make a second provider call
        // when the first response fails schema validation (the inference layer
        // retries once), so this is a floor on calls, not an exact count — the
        // cap is exact in *runs*, which is the unit the ensemble is
        // configured in.
        turnsSpent += runsPerEval;
      }

      const runs = await runEnsemble({
        provider: evalProvider,
        system: JUDGE_SYSTEM_PROMPT,
        user: buildUserContent(plan, selected.text, selected.label),
        runs: runsPerEval,
        temperature,
        schema: verdictSchema,
        cache,
        cacheKey: key,
        label: "manni-tracevals",
      });

      const consensusBase = computeConsensus(runs);
      const zone = zoneFor(consensusBase, zones);
      const consensus: ConsensusResult = { ...consensusBase, zone };

      // Compared against the model that actually judged this eval, not the
      // run's default: an eval that names its own model is exactly the case a
      // run-wide check would miss.
      const judgeModel = evalProvider.modelName();
      // Two distinct biases, and the session axis is reported first because
      // its remedy is the stronger one. Judging your own session is bias about
      // the behavior under test; judging your own assertion is bias about the
      // yardstick — the fix there is a human confirming the criterion, not a
      // second model, since another model would still grade the same wording.
      const selfPreference =
        sessionModel !== undefined && sessionModel === judgeModel
          ? ({ axis: "session", model: judgeModel } as const)
          : plan.proposedBy?.includes(judgeModel) === true
            ? ({ axis: "criterion", model: judgeModel } as const)
            : undefined;

      results.push({
        ...base,
        outcome:
          zone === "auto-pass"
            ? "pass"
            : zone === "auto-fail"
              ? "fail"
              : "needs-review",
        consensus,
        turns: cached ? 0 : runsPerEval,
        ...(selfPreference ? { selfPreference } : {}),
        durationMs: Date.now() - start,
      });
    }
    return results;
  };
}

/**
 * Build the provider an eval named, or say why it could not be built. Kept
 * out of the loop so the failure is one shape: never a throw that costs the
 * report every other verdict, never a silent fall back to the default model.
 */
async function resolveOverride(
  plan: EvalPlan,
  options: TraceJudgeOptions,
): Promise<{ provider: InferenceProvider } | { error: string }> {
  // Either half is enough to need a different instance, so the message names
  // whichever the eval actually wrote.
  const named =
    plan.provider !== undefined
      ? `provider "${plan.provider}"`
      : `model "${plan.model ?? ""}"`;
  if (options.providerFor === undefined) {
    return {
      error: `eval names ${named}, but this run cannot construct providers by name`,
    };
  }
  try {
    // The origin a `--local` notice names. The caller knows the artifact; the
    // eval's own id is what tells one line of it from another.
    return {
      provider: await options.providerFor({
        ...(plan.provider !== undefined ? { provider: plan.provider } : {}),
        ...(plan.model !== undefined ? { model: plan.model } : {}),
        origin: `eval "${plan.evalName}" in ${plan.artifact.path}`,
      }),
    };
  } catch (err) {
    return {
      error: `could not construct ${named}${
        plan.provider === undefined || plan.model === undefined
          ? ""
          : ` at model "${plan.model}"`
      } for this eval: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
