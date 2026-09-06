/**
 * `manni docevals run` — execute the full pipeline. Deterministic graders run
 * first (cheap-first ordering); the AI judge stage runs when a provider is
 * available and not disabled.
 */
import { runEvals, type EngineReport, type JudgeFn, type RunOptions } from "../core/engine.js";
import { loadConfig, type DocevalsConfig } from "../core/config.js";
import { render, type ReportFormat } from "../reporters/index.js";
import { makeJudge } from "../judge/judge.js";
import { makeProvider } from "../judge/provider.js";
import { makeGenerateScripts } from "../graders/scriptgen.js";
import type { GenerateFn } from "../core/engine.js";
import { DocevalsError } from "../types.js";
import { EXECUTION_GRANTS } from "../core/config.js";
import type { ExecutionGrant } from "../core/config.js";

export interface RunCommandOptions {
  config?: string;
  format?: ReportFormat;
  deterministicOnly?: boolean;
  aiOnly?: boolean;
  /** Extra execution grants for this run. */
  allowExecution?: string[];
  /** `false` clears every grant for this run. */
  execution?: boolean;
  generate?: boolean;
  cache?: boolean;
  failOnReview?: boolean;
  provider?: string;
  model?: string;
  runs?: number;
  chunkChars?: number;
  maxTurns?: number;
  evalNames?: string[];
  suite?: string;
  /** Evaluate only pages that differ between this git ref and HEAD (ADR 01040). */
  since?: string;
  baseline?: string | boolean;
  writeBaseline?: string | boolean;
  toolVersion?: string;
  cwd?: string;
}

/**
 * Grants, checked rather than asserted.
 *
 * The CLI validates in `collectGrant`, but this is also the entry point for
 * programmatic callers, and an unknown grant that silently does nothing is the
 * exact failure the default-deny posture exists to avoid: the run skips every
 * command eval and exits 0, which reads as a clean corpus rather than a
 * misspelled grant.
 */
function asGrants(values: string[] | undefined): ExecutionGrant[] | undefined {
  if (values === undefined) return undefined;
  const unknown = values.filter(
    (v) => !(EXECUTION_GRANTS as readonly string[]).includes(v),
  );
  if (unknown.length > 0) {
    throw new DocevalsError(
      `unknown execution grant${unknown.length > 1 ? "s" : ""} ` +
        `${unknown.map((u) => `"${u}"`).join(", ")}; ` +
        `expected one of ${EXECUTION_GRANTS.join(" | ")}`,
    );
  }
  return values as ExecutionGrant[];
}

export async function runRun(
  globs: string[],
  options: RunCommandOptions = {},
  engineOverrides: Partial<RunOptions> = {},
): Promise<EngineReport> {
  const cwd = options.cwd ?? process.cwd();
  const judgeOptions = {
    provider: options.provider,
    model: options.model,
    runs: options.runs,
    chunkChars: options.chunkChars,
    noCache: options.cache === false,
    maxTurns: options.maxTurns ?? null,
  };

  // Loaded once and passed through to the engine — a run must not validate
  // the config twice or observe two different versions of it.
  const config: DocevalsConfig = loadConfig(options.config, cwd);

  // Build the judge and generation stages unless deterministic-only or an
  // override supplies them. Both share one provider.
  let judge: JudgeFn | undefined;
  let generateScripts: GenerateFn | undefined;
  if (!("judge" in engineOverrides) || !("generateScripts" in engineOverrides)) {
    try {
      const provider = makeProvider(config, judgeOptions);
      if (!options.deterministicOnly) judge = makeJudge({ provider, root: cwd });
      if (options.generate !== false) {
        generateScripts = makeGenerateScripts({ provider, root: cwd });
      }
    } catch (e) {
      if (options.aiOnly || !(e instanceof DocevalsError)) throw e;
      // The warning is about the *judge*, and only the judge (ADR 01043).
      //
      // It used to read `|| options.generate === true`, meaning to fire when
      // generation had been explicitly requested. Commander cannot express
      // that: there is no `--generate` flag, so it defaults a `--no-generate`
      // key to `true` and the clause held on every invocation that was not
      // `--no-generate`. The only silent combination was the accidental
      // `--deterministic-only --no-generate`, and the standard no-key CI run
      // warned about the provider it had just been told to skip.
      //
      // Generation's own need for a provider is not knowable here — it depends
      // on whether the corpus holds a command eval with no command — so it is
      // reported by the engine, where it is, as an `error` result naming the
      // eval and exiting 1. That is a louder signal than this line, not a
      // quieter one.
      if (!options.deterministicOnly) {
        console.warn(
          `manni docevals: provider unavailable — ${e.message}. Running deterministic evals only.`,
        );
      }
    }
  }

  return runEvals({
    judge,
    generateScripts,
    config,
    configPath: options.config,
    globs,
    cwd: options.cwd,
    deterministicOnly: options.deterministicOnly,
    aiOnly: options.aiOnly,
    allowExecution: asGrants(options.allowExecution),
    execution: options.execution,
    generate: options.generate,
    failOnReview: options.failOnReview,
    evalNames: options.evalNames,
    suite: options.suite,
    since: options.since,
    baseline: options.baseline,
    writeBaseline: options.writeBaseline,
    toolVersion: options.toolVersion,
    judgeOptions,
    ...engineOverrides,
  });
}

export { render };
