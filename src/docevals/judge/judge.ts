/**
 * The ensemble judge: N independent runs per (page, eval), each a fresh
 * request with no shared context (eval isolation), aggregated by consensus
 * and routed through confidence zones. Persisted human reviews resolve
 * needs-review outcomes for unchanged pages.
 *
 * The ensemble mechanics — retry-once, errored runs counting against
 * consensus, cache replay — live in `@hawkeyexl/inference` (ADR 01002). What
 * stays here is manni docevals' own orchestration: the bounded-concurrency pool
 * across targets, the turn budget, the self-judgment warning, and human-review
 * resolution.
 */
import {
  computeConsensus,
  runEnsemble,
  zoneFor,
  type InferenceProvider,
} from "@hawkeyexl/inference";
import verdictSchemaJson from "./verdict-schema.json" with { type: "json" };
import type { EvalResult } from "../types.js";
import type { DocevalsConfig } from "../core/config.js";
import type { JudgeFn, JudgeOptions } from "../core/engine.js";
import type { GraderTarget } from "../graders/types.js";
import { findReview, loadReviews } from "../core/reviews.js";
import { cacheKey, judgeCacheBody, VerdictCache } from "./cache.js";
import { turnBudgetSkipReason } from "./budget.js";
import {
  JUDGE_SYSTEM_PROMPT,
  buildUserContent,
  EVIDENCE_SYSTEM_PROMPT,
  EVIDENCE_SCHEMA,
  buildEvidenceUser,
  renderEvidence,
  type PartEvidence,
} from "./prompt.js";
import { splitBody } from "../core/split.js";
import { readTarget } from "../core/target.js";
import { makeProvider } from "./provider.js";
import type { ResolvedEval } from "../core/resolve.js";
import { resolve as resolvePath } from "node:path";

/**
 * manni docevals' own verdict wording. Structurally identical to the library's
 * canonical schema, but the field descriptions talk about pages rather than
 * generic subjects — and descriptions are prompt surface that steers the
 * model, so they are worth keeping (the inference library's own ADR 01001,
 * not this repo's).
 */
const verdictSchema = verdictSchemaJson as Record<string, unknown>;

export interface JudgeStageDeps {
  /** Provider for evals that do not override `provider`/`model`. */
  provider: InferenceProvider;
  root: string;
  /**
   * Build a provider for an eval that overrides `provider` or `model`.
   *
   * Injected so the engine's tests can drive per-eval overrides with a mock.
   * When absent, one is built from the resolved config — without it `provider`
   * and `model` would validate, appear in the schema, and do nothing, which is
   * worse than not offering them.
   */
  providerFor?: (ev: ResolvedEval) => InferenceProvider;
}

/** Build the engine's judge stage around a concrete provider. */
export function makeJudge(deps: JudgeStageDeps): JudgeFn {
  return async (
    targets: GraderTarget[],
    config: DocevalsConfig,
    options: JudgeOptions,
  ): Promise<EvalResult[]> => {
    const { provider, root } = deps;

    // CLI > eval > config, the same precedence `runsFor` uses. Providers are
    // memoized on their resolved identity: a corpus where fifty evals name one
    // stronger judge builds it once.
    const overridden = new Map<string, InferenceProvider>();
    const buildProvider =
      deps.providerFor ??
      ((ev: ResolvedEval): InferenceProvider =>
        makeProvider(config, {
          ...options,
          provider: options.provider ?? ev.provider,
          model: options.model ?? ev.model,
        }));
    // Keyed on what the eval *resolves to*, not on what it wrote. With
    // `--provider anthropic` in force, an eval naming `openai` and one naming
    // `mock` both resolve to the same provider: keying on the authored value
    // builds it twice and stores two entries for one identity. The effective
    // pair is also what decides the short-circuit — once a flag has overridden
    // both halves, every eval resolves to the run's default and none of them
    // needs a provider of its own.
    const defaultIdentity = `${options.provider ?? ""}:${options.model ?? ""}`;
    const providerFor = (ev: ResolvedEval): InferenceProvider => {
      const effProvider = options.provider ?? ev.provider;
      const effModel = options.model ?? ev.model;
      if (effProvider === undefined && effModel === undefined) return provider;
      const key = `${effProvider ?? ""}:${effModel ?? ""}`;
      if (key === defaultIdentity) return provider;
      let p = overridden.get(key);
      if (p === undefined) {
        p = buildProvider(ev);
        overridden.set(key, p);
      }
      return p;
    };
    // CLI > eval > config. The flag is an explicit operator act ("run cheap
    // right now"), so it outranks a page asking for more agreement; the page
    // outranks the corpus default, which is the point of having it.
    const runsFor = (ev: ResolvedEval): number =>
      options.runs ?? ev.runs ?? config.judge.ensembleRuns;
    const temperature = config.judge.temperature;
    const chunkChars = options.chunkChars ?? config.judge.chunkChars;
    const cache = new VerdictCache(
      resolvePath(root, config.judge.cacheDir),
      options.noCache !== true,
      "manni-docevals",
    );
    const reviews = loadReviews(root);
    const maxTurns = options.maxTurns ?? config.judge.maxTurns;
    let turnsSpent = 0;

    const results: EvalResult[] = [];
    // `makeJudge` is a published export taking a caller-supplied config, so a
    // JS consumer can hand us one shaped for a version before `judge.concurrency`
    // existed. The type says that cannot happen; at a package boundary it can.
    // Unguarded it is `Math.min(undefined, n)` -> NaN -> `Array.from({length:
    // NaN})` -> zero workers, and every AI eval vanishes from the results —
    // not skipped, not errored, absent — with the run exiting 0.
    //
    // Tested with `Number.isFinite` rather than `??` because the value is typed
    // non-optional: `??` is dead code to the compiler and the lint rejects it,
    // while the runtime hazard is real. This says what is actually being
    // checked (ADR 01039).
    // `Number.isInteger(n) && n >= 1`, not `Number.isFinite`: the hazard is a
    // worker pool of zero, and `Number.isFinite(0)` is `true`. A caller-supplied
    // `judge.concurrency: 0` sails past a finite check into
    // `Array.from({length: 0})`, which builds no workers at all — every AI eval
    // then vanishes from the results, not skipped and not errored but absent,
    // with the run exiting 0. The config file cannot express it (`minimum: 1`),
    // but `makeJudge` is exported and takes a caller-supplied config.
    const configured = config.judge.concurrency;
    const concurrency =
      Number.isInteger(configured) && configured >= 1
        ? configured
        : config.defaults.concurrency;
    let index = 0;

    /**
     * Safeguard layer 1: a model judging its own output shows self-preference
     * bias.
     *
     * Two axes, deliberately reported apart because the remedy differs. The
     * *content* axis is the page's `generated-by` (docmeta:ai-context) — the
     * model wrote the prose it is now grading, and the fix is to judge with a
     * different model. The *criterion* axis is `eval-provenance` — the model
     * proposed the assertion it is now grading, and the fix is for a human to
     * confirm the assertion, which is what `calibrate`'s `reviewed` bit is for.
     *
     * Marked on the result rather than written to stderr: a verdict formed
     * under self-preference must not look identical to any other in JSON,
     * SARIF, JUnit or the HTML report. It stays a warning, not a failure —
     * bias skews a verdict, it does not prevent one forming, so ADR 01022's
     * "no verdict fails" rule does not apply, and erroring would punish a
     * single-model corpus with no second provider to reach for.
     */
    const selfPreferenceFor = (
      target: GraderTarget,
      judgeModel: string,
    ): EvalResult["selfPreference"] => {
      const { plan, eval: ev } = target;
      if (plan.generatedBy && plan.generatedBy === judgeModel) {
        return { axis: "content", model: judgeModel };
      }
      const proposed = plan.provenance.some(
        (p) =>
          p.generatedBy === judgeModel &&
          (p.evals === undefined || p.evals.includes(ev.name)),
      );
      if (proposed) return { axis: "criterion", model: judgeModel };
      return undefined;
    };

    const judgeTarget = async (target: GraderTarget): Promise<EvalResult> => {
      const { plan, eval: ev } = target;
      const start = Date.now();
      const runsPerEval = runsFor(ev);
      const judgeProvider = providerFor(ev);

      // Self-preference: the model that wrote the page is the model grading
      // it. Compared against the model that judged *this eval*, not the run's
      // default — an eval naming its own provider or model is exactly the
      // case a run-wide comparison would miss. Per page rather than
      // deduplicated by model name, so a corpus with several affected pages
      // names each one instead of only the first.
      const by = plan.generatedBy;
      if (by !== undefined && by === judgeProvider.modelName()) {
        console.warn(
          `manni docevals: ${plan.page.file} declares generated-by: ${by}, ` +
            `which is also the model judging it. Self-judging favors the ` +
            `author — run this eval with a different model.`,
        );
      }

      // Read what the eval asked to be graded. A target that cannot be served
      // errors here rather than falling back to the page body: a verdict about
      // the wrong bytes is worse than no verdict (ADR 01022).
      const selected = readTarget(ev.target, plan);
      if (!selected.ok) {
        return {
          evalName: ev.name,
          type: ev.type,
          grader: ev.grader,
          file: plan.page.file,
          outcome: "error",
          skipReason: selected.reason,
          durationMs: Date.now() - start,
        };
      }

      // A page longer than the chunk budget is read in parts: each part
      // contributes the passages bearing on the assertion, and one judge then
      // answers the original question against the collection. Merging
      // per-part *verdicts* would be unsound — see EVIDENCE_SYSTEM_PROMPT.
      //
      // Content that fits skips this entirely and is judged exactly as before,
      // so the common path costs nothing and its cached verdicts stay valid.
      const chunks = splitBody(selected.text, chunkChars);
      let judged = selected.text;
      let judgedLabel = selected.label;

      // The key is built from what was *selected*, never from the evidence.
      // Evidence is model output: keying on it would change every run, so a
      // split page could never hit its cached verdict — and the committed docs
      // fixtures for long pages would be dead weight. The chunk budget rides
      // along because it decides how the page was read.
      const key = cacheKey(
        judgeProvider.provider(),
        judgeProvider.modelName(),
        runsPerEval,
        temperature,
        judgeCacheBody(chunkChars, selected.text),
        ev,
      );
      const cached = cache.get(key) !== undefined;

      // Gathering evidence costs one call per part, so it happens only on a
      // miss. A cached ensemble must make no inference call at all (ADR 01019).
      if (chunks.length > 1 && !cached) {
        const gathered: PartEvidence[] = [];
        for (const [i, chunk] of chunks.entries()) {
          if (maxTurns != null && turnsSpent >= maxTurns) {
            return {
              evalName: ev.name,
              type: ev.type,
              grader: ev.grader,
              file: plan.page.file,
              outcome: "skipped",
              skipReason: `${turnBudgetSkipReason(maxTurns)} (after ${String(i)} of ${String(chunks.length)} parts)`,
              durationMs: Date.now() - start,
            };
          }
          turnsSpent += 1;
          try {
            const res = await judgeProvider.completeJSON({
              system: EVIDENCE_SYSTEM_PROMPT,
              user: buildEvidenceUser(ev, chunk, {
                index: i,
                total: chunks.length,
              }),
              schema: EVIDENCE_SCHEMA,
              temperature,
            });
            const json = res.json as Partial<PartEvidence>;
            gathered.push({
              supports: json.supports ?? [],
              contradicts: json.contradicts ?? [],
            });
          } catch (e) {
            // A part that could not be read leaves the collection incomplete,
            // and a verdict over incomplete evidence is exactly the silent
            // wrong answer this stage exists to avoid (ADR 01022).
            return {
              evalName: ev.name,
              type: ev.type,
              grader: ev.grader,
              file: plan.page.file,
              outcome: "error",
              skipReason: `gathering evidence from part ${String(i + 1)} of ${String(chunks.length)} failed: ${e instanceof Error ? e.message : String(e)}`,
              durationMs: Date.now() - start,
            };
          }
        }
        judged = renderEvidence(gathered, chunks.length);
        judgedLabel = `${selected.label}, ${String(chunks.length)} parts`;
      }

      // A cached ensemble makes no inference call, so it never touches the
      // budget — the docs corpus replays committed fixtures under any cap.
      // For an uncached one the turns are claimed *before* dispatching, which
      // is the whole point of counting turns rather than dollars: the claim is
      // synchronous, so two workers cannot both clear an almost-exhausted
      // budget and then both spend. See ADR 01019.
      if (maxTurns != null && !cached) {
        if (turnsSpent + runsPerEval > maxTurns) {
          return {
            evalName: ev.name,
            type: ev.type,
            grader: ev.grader,
            file: plan.page.file,
            outcome: "skipped",
            skipReason: turnBudgetSkipReason(maxTurns),
            durationMs: 0,
          };
        }
        // One turn per ensemble run. A run can make a second provider call
        // when the first response fails schema validation (the inference
        // layer retries once), so this is a floor on calls, not an exact
        // count — the cap is exact in *runs*, which is the unit the ensemble
        // is configured in.
        turnsSpent += runsPerEval;
      }

      const runs = await runEnsemble({
        provider: judgeProvider,
        system: JUDGE_SYSTEM_PROMPT,
        user: buildUserContent(ev, judged, judgedLabel),
        runs: runsPerEval,
        temperature,
        schema: verdictSchema,
        cache,
        cacheKey: key,
        label: "manni-docevals",
      });

      const consensusBase = computeConsensus(runs);
      const zone = zoneFor(consensusBase, config.judge.zones);
      const consensus = { ...consensusBase, zone };

      let outcome: EvalResult["outcome"] =
        zone === "auto-pass" ? "pass" : zone === "auto-fail" ? "fail" : "needs-review";
      let via: EvalResult["via"];
      if (outcome === "needs-review") {
        const review = findReview(reviews, plan.page.file, ev.name, plan.page.body);
        if (review) {
          outcome = review.verdict;
          via = "human-review";
        }
      }

      const selfPreference = selfPreferenceFor(
        target,
        judgeProvider.modelName(),
      );

      return {
        evalName: ev.name,
        type: ev.type,
        grader: ev.grader,
        file: plan.page.file,
        outcome,
        consensus,
        via,
        ...(selfPreference ? { selfPreference } : {}),
        durationMs: Date.now() - start,
      };
    };

    // Simple bounded-concurrency pool across targets; runs within one eval
    // stay sequential (independent requests, no shared context).
    const workers = Array.from(
      { length: Math.min(concurrency, targets.length) },
      async () => {
        while (index < targets.length) {
          const i = index++;
          results[i] = await judgeTarget(targets[i]!);
        }
      },
    );
    await Promise.all(workers);
    return results;
  };
}
