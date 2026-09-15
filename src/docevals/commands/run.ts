/**
 * `manni docevals run` — execute the full pipeline. Deterministic graders run
 * first (cheap-first ordering); the AI judge stage runs when a provider is
 * available and not disabled.
 */
import { runEvals, type EngineReport, type JudgeFn, type RunOptions } from "../core/engine.js";
import { loadRunConfig, type DocevalsConfig } from "../core/config.js";
import { runConfigOptions, type DocumentInputOptions } from "../core/discover.js";
import { render, type ReportFormat } from "../reporters/index.js";
import { makeJudge } from "../judge/judge.js";
import {
  assertProviderSelection,
  makeProvider,
  selectProvider,
} from "../judge/provider.js";
import type { InferenceProvider } from "@hawkeyexl/inference";
import { makeGenerateScripts } from "../graders/scriptgen.js";
import type { GenerateFn } from "../core/engine.js";
import { DocevalsError } from "../types.js";
import { EXECUTION_GRANTS } from "../core/config.js";
import type { ExecutionGrant } from "../core/config.js";
import { warn } from "../../shared/warn.js";

export interface RunCommandOptions extends DocumentInputOptions {
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
  /** Run inference on this machine, with llama-cpp, over any configured or eval-level provider. */
  local?: boolean;
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
  paths: string[],
  options: RunCommandOptions = {},
  engineOverrides: Partial<RunOptions> = {},
): Promise<EngineReport> {
  const cwd = options.cwd ?? process.cwd();
  const judgeOptions = {
    provider: options.provider,
    model: options.model,
    local: options.local,
    runs: options.runs,
    chunkChars: options.chunkChars,
    noCache: options.cache === false,
    maxTurns: options.maxTurns ?? null,
  };

  // Loaded once and passed through to the engine — a run must not validate
  // the config twice or observe two different versions of it.
  const config: DocevalsConfig = loadRunConfig(runConfigOptions(paths, options), cwd);

  // A selection that cannot be right is a usage error, exit 2, whatever else
  // the run was asked to do: an unknown name or a model with no provider to
  // own it is a typo to fix, not a missing provider to degrade around.
  assertProviderSelection(selectProvider(config, judgeOptions));

  // Build the judge and generation stages unless deterministic-only or an
  // override supplies them. Both share one provider, resolved at most once.
  let judge: JudgeFn | undefined;
  let generateScripts: GenerateFn | undefined;
  let resolving: Promise<InferenceProvider> | undefined;
  const provider = (): Promise<InferenceProvider> =>
    (resolving ??= makeProvider(config, judgeOptions));
  if (!("judge" in engineOverrides) || !("generateScripts" in engineOverrides)) {
    if (!options.deterministicOnly) {
      try {
        const resolved = await provider();
        judge = makeJudge({ provider: resolved, root: cwd });
        if (options.generate !== false) {
          generateScripts = makeGenerateScripts({ provider: resolved, root: cwd });
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
        warn(`provider unavailable — ${e.message}. Running deterministic evals only.`);
      }
    } else if (options.generate !== false) {
      // No judge, so the provider is wanted only if the corpus holds a command
      // eval with no command, which is not knowable here. It is resolved when
      // generation first needs it, so a deterministic run never detects a
      // provider — never probes the machine, never spawns the Claude CLI — to
      // generate nothing. Generation's own need for a provider it cannot have
      // is reported by the engine, where it is, as an `error` result naming
      // the eval and exiting 1.
      generateScripts = makeGenerateScripts({ provider, root: cwd });
    }
  }

  return runEvals({
    judge,
    generateScripts,
    config,
    configPath: options.config,
    noConfig: options.noConfig,
    paths,
    collection: options.collection,
    exclude: options.exclude,
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
