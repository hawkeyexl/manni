/**
 * The trace-adherence ensemble judge: N independent runs per eval plan, each a
 * fresh request with no shared context, aggregated by consensus and routed
 * through confidence zones.
 *
 * The ensemble mechanics (retry-once, errored runs counting against consensus,
 * cache replay) now live in the inference library; what stays here is what is
 * manni tracevals-specific — the per-instance budget gate, the trace-worded
 * verdict schema, and the `JudgedEval` shape the reporters consume.
 */
import {
  JsonCache,
  computeConsensus,
  costOfRuns,
  pricingFor,
  runEnsemble,
  zoneFor,
  type ConsensusResult,
  type InferenceProvider,
  type JudgeRun,
  type Pricing,
} from "@hawkeyexl/inference";
import verdictSchemaJson from "./verdict-schema.json" with { type: "json" };
import type { EvalPlan } from "../core/plan.js";
import { cacheKey } from "./cache.js";
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
   * Construct the provider an eval names with `provider:`, plus its pricing.
   * Without this hook such an eval errors rather than being judged silently by
   * the default model — an eval that names a provider is asking for that one.
   */
  providerFor?: (
    name: string,
    model?: string,
  ) => { provider: InferenceProvider; pricing?: Pricing };
  /**
   * Model named by an explicit operator flag (`--model`), already applied to
   * `provider`. Recorded so the judge can tell an operator override from the
   * provider's own default: precedence is CLI > eval > default, so an eval's
   * `model` must not quietly win over a flag someone just typed.
   */
  model?: string;
  /** Ensemble size; default 3. */
  runs?: number;
  /** Default 0; nonzero adds verdict noise. */
  temperature?: number;
  zones?: { autoPass: number; autoFail: number };
  cacheDir?: string;
  noCache?: boolean;
  maxCostUsd?: number;
  /**
   * Price override for this model, from the selected provider's config
   * section. Without it a model the library's table does not know costs 0,
   * which silently disables `maxCostUsd`.
   */
  pricing?: Pricing;
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
  costUsd: number;
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
 * and `maxCostUsd` spans every call, because the budget lives on the instance
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
  const cache = new JsonCache<JudgeRun[]>(
    options.cacheDir ?? ".manni/tracevals/cache",
    options.noCache !== true && options.cacheDir !== undefined,
    "manni-tracevals",
  );
  const pricing = pricingFor(provider.modelName(), options.pricing);

  // Deliberately outside the returned function: the budget belongs to the
  // *judge instance*, not to one call of it. A batch calls the judge once per
  // trace (ADR 01018), so a per-call counter would make `maxCostUsd` a cap on
  // the largest trace rather than on the run — 50 traces would bill 50x the
  // configured ceiling and every report would look like it obeyed it. A
  // single-trace run calls the judge exactly once, so this is invisible there.
  let spentUsd = 0;

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

      // An eval may name its own provider. Resolve it before the budget gate
      // so a typo is reported as the eval's own error rather than hidden
      // behind an exhausted budget.
      //
      // The comparison is on the provider *name*, which is the unit the
      // schema's `provider` field names — not on instance identity. A match
      // therefore reuses the run's already-constructed default, inheriting any
      // `--model` override, which is what an eval naming only a provider
      // should get. Two spellings of one provider would each construct their
      // own instance, but the accepted set is closed (anthropic, openai,
      // claude-cli, mock) and has no aliases, so that cannot arise today;
      // adding an alias would be the change that makes it matter.
      let evalProvider = provider;
      let evalPricing = pricing;
      // Either half is enough to need a different instance. `model` alone is
      // the common case — "judge this one assertion with a bigger model" —
      // and it names a model *within* the run's provider, so the provider
      // falls back to the default rather than being required alongside it.
      // CLI `--model` still wins: it is applied when `provider` is built, and
      // an eval that pinned a model is an authoring preference, not an
      // operator's explicit "right now".
      const wantsProvider =
        plan.provider !== undefined && plan.provider !== provider.provider();
      const wantsModel =
        options.model === undefined &&
        plan.model !== undefined &&
        plan.model !== provider.modelName();
      if (wantsProvider || wantsModel) {
        const resolved = resolveOverride(
          plan.provider ?? provider.provider(),
          options,
          wantsModel ? plan.model : undefined,
        );
        if ("error" in resolved) {
          results.push({
            ...base,
            outcome: "error",
            error: resolved.error,
            costUsd: 0,
            durationMs: Date.now() - start,
          });
          continue;
        }
        evalProvider = resolved.provider;
        // Through pricingFor, exactly as the default provider's pricing is
        // resolved above: the config override is a fallback for models the
        // library's table does not know, not a replacement for it. Assigning
        // the raw override would leave an unpriced override provider at
        // pricing `undefined`, and costOfRuns returns 0 for that — silently
        // exempting the eval from maxCostUsd.
        evalPricing = pricingFor(evalProvider.modelName(), resolved.pricing);
      }

      if (options.maxCostUsd !== undefined && spentUsd >= options.maxCostUsd) {
        results.push({
          ...base,
          outcome: "skipped",
          skipReason: `judge cost budget exhausted ($${options.maxCostUsd})`,
          costUsd: 0,
          durationMs: 0,
        });
        continue;
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
          costUsd: 0,
          durationMs: Date.now() - start,
        });
        continue;
      }

      const runsPerEval = runsFor(plan);
      const runs = await runEnsemble({
        provider: evalProvider,
        system: JUDGE_SYSTEM_PROMPT,
        user: buildUserContent(plan, selected.text, selected.label),
        runs: runsPerEval,
        temperature,
        schema: verdictSchema,
        cache,
        cacheKey: cacheKey(
          evalProvider.provider(),
          evalProvider.modelName(),
          runsPerEval,
          temperature,
          // The selected bytes, not always the transcript: two targets on one
          // session are two different questions and must not share a verdict.
          selected.text,
          plan,
        ),
        label: "manni-tracevals",
      });

      const consensusBase = computeConsensus(runs);
      const zone = zoneFor(consensusBase, zones);
      const consensus: ConsensusResult = { ...consensusBase, zone };
      const costUsd = costOfRuns(runs, evalPricing);
      spentUsd += costUsd;

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
        costUsd,
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
function resolveOverride(
  name: string,
  options: TraceJudgeOptions,
  model?: string,
): { provider: InferenceProvider; pricing?: Pricing } | { error: string } {
  if (options.providerFor === undefined) {
    return {
      error: `eval names provider "${name}", but this run cannot construct providers by name`,
    };
  }
  try {
    return options.providerFor(name, model);
  } catch (err) {
    return {
      error: `could not construct provider "${name}"${
        model === undefined ? "" : ` at model "${model}"`
      } for this eval: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
