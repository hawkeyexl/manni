/**
 * `manni tracevals run <trace>` — evaluate one trace end to end.
 *
 * Split into three exports so the batch path can reuse them (ADR 01018):
 * `prepareRun` builds what is shared across traces, `runOne` evaluates one, and
 * `runRun` is the two of them plus rendering, unchanged for callers.
 */
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { discoverConfig } from "../core/config.js";
import { runEvals } from "../core/engine.js";
import type { ArtifactMetadataFor } from "../core/plan.js";
import { loadExternalEvals } from "../evals/external.js";
import { loadGraderPlugins } from "../graders/plugins.js";
import {
  appendHistory,
  compareToLast,
  loadHistory,
  type HistoryComparison,
} from "../history.js";
import {
  announceSelection,
  assertProviderSelection,
  constructProvider,
  resolveProviderIdentity,
  selectProvider,
} from "../judge/provider.js";
import { makeTraceJudge, type TraceJudge } from "../judge/trace-judge.js";
import type { InferenceProvider } from "@hawkeyexl/inference";
import { render, type ReportFormat } from "../reporters/index.js";
import type { RunReport } from "../types.js";
import type { TracevalsConfig } from "../core/config.js";

/**
 * Everything that is the same for every trace in a run. `runRun` adds the one
 * per-trace field; the batch path (ADR 01018) carries a list instead.
 */
export interface RunSharedOptions {
  project?: string;
  provider?: string;
  model?: string;
  /** `--local`: run inference on this machine, over every configured choice. */
  local?: boolean;
  runs?: number;
  deterministicOnly?: boolean;
  noCache?: boolean;
  /** `--max-turns`: ensemble runs for the whole invocation; overrides config. */
  maxTurns?: number;
  format?: ReportFormat;
  output?: string;
  /** Append this run to history and compare against the previous run. */
  history?: boolean;
  /** Overrides config.failOnNeedsReview; undefined defers to the config. */
  failOnNeedsReview?: boolean;
  /**
   * `--no-commands` sets this false. Overrides
   * `config.graders.command.enabled`; undefined defers to the config.
   */
  commands?: boolean;
  /** `--require`: grader plugins to load *in addition to* `config.plugins`. */
  require?: string[];
  /** Overrides config.reportUnusedArtifacts; undefined defers to the config. */
  reportUnusedArtifacts?: boolean;
  /**
   * An explicitly named session manifest (ADR 01024). Without it the engine
   * looks in the conventional places and says nothing when there is none.
   */
  manifest?: string;
  /** Directory holding manni.config.yaml; defaults to cwd. */
  configDir?: string;
  /** `-c/--config`: read this file instead of discovering one. */
  config?: string;
  /** `--no-config`: skip discovery and run on the built-in defaults. */
  noConfig?: boolean;
  /**
   * `--offline`: never fetch a remote external-metadata manifest; read the
   * local ones only. A relocated artifact's evals may live in a manifest a
   * collection declares (0047), and a `https://` one is refused rather than
   * fetched.
   */
  offline?: boolean;
  env?: Record<string, string | undefined>;
  /** Test seam: overrides judge construction entirely. */
  judge?: TraceJudge;
}

export interface RunCommandOptions extends RunSharedOptions {
  tracePath: string;
}

export interface RunCommandResult {
  report: RunReport;
  rendered: string;
  comparison?: HistoryComparison;
}

/**
 * Everything a run needs that is *not* per-trace: the resolved config, the
 * plugin-loading warnings, and the judge.
 *
 * Split out for the batch path (ADR 01018), and the split is not cosmetic. The
 * judge carries the turn budget, so building one per trace would turn
 * `maxTurns` from a ceiling on the run into a ceiling on the largest trace.
 * Config and plugins are hoisted for a smaller reason: a plugin imports once
 * per process (ADR 01017), so re-running the loader would attach its warnings
 * to the first trace's report and to no other.
 */
export interface RunContext {
  config: TracevalsConfig;
  configDir: string;
  /** Plugin-loading warnings, prepended to every report in the batch. */
  warnings: string[];
  judge?: TraceJudge;
  /**
   * Where each artifact's `metadata` block lives, loaded once per invocation
   * rather than per trace: the manifests are the config's, not the trace's, and
   * a URL one would otherwise be fetched once per trace in a corpus.
   */
  metadataFor?: ArtifactMetadataFor;
}

export async function prepareRun(
  options: RunSharedOptions,
): Promise<RunContext> {
  const { config: loaded, dir: configDir, collections } = await discoverConfig(
    options.configDir ?? process.cwd(),
    {
      ...(options.config === undefined ? {} : { configPath: options.config }),
      ...(options.noConfig === undefined ? {} : { noConfig: options.noConfig }),
    },
  );
  // Flags override the config rather than bypassing it, so the engine still
  // reads one fully-resolved value (CLAUDE.md, "Config <-> CLI flags").
  const config = {
    ...loaded,
    failOnNeedsReview: options.failOnNeedsReview ?? loaded.failOnNeedsReview,
    graders: {
      ...loaded.graders,
      command: {
        ...loaded.graders.command,
        enabled: options.commands ?? loaded.graders.command.enabled,
      },
    },
    // A set-valued knob, so `--require` *adds* instead of replacing. A one-off
    // flag must not silently unregister the house graders a repo's config
    // names — every eval declaring one would flip to `unknown grader kind`,
    // which reads as a typo in an artifact nobody touched. Config entries load
    // first, so a deliberate `--require` still wins a colliding kind
    // (ADR 01017).
    plugins: [...loaded.plugins, ...(options.require ?? [])],
    reportUnusedArtifacts:
      options.reportUnusedArtifacts ?? loaded.reportUnusedArtifacts,
  };

  // Before planning: `planEvals` is downstream of the registry, and a grader
  // registered after it has been read is a grader that does not exist.
  const plugins = await loadGraderPlugins({
    plugins: config.plugins,
    configDir,
  });

  // The command line's say over every configured level. Checked even on a
  // `--deterministic-only` run, where no provider is built: `--provider gemini`
  // is a usage error whatever the run then does with it.
  const flags = {
    ...(options.provider !== undefined ? { provider: options.provider } : {}),
    ...(options.model !== undefined ? { model: options.model } : {}),
    ...(options.local !== undefined ? { local: options.local } : {}),
  };
  const selection = selectProvider(config, flags);
  assertProviderSelection(selection);

  let judge = options.judge;
  if (judge === undefined && options.deterministicOnly !== true) {
    const provider = constructProvider(
      config,
      await resolveProviderIdentity(config, flags),
    );
    // Memoized on the selection an eval *resolves to*, not on what it wrote:
    // with `--provider mock` in force, an eval naming `openai` and one naming
    // `anthropic` both resolve to the same provider, and keying on the authored
    // value would build it twice. Memoized as a promise, so a selection that
    // detects or fails does so once and every eval sharing it gets the same
    // provider or the same error.
    const overridden = new Map<string, Promise<InferenceProvider>>();
    const keyOf = (s: { provider: string; model: string | undefined }): string =>
      `${s.provider}:${s.model ?? ""}`;
    const defaultKey = keyOf(selection);
    judge = makeTraceJudge({
      provider,
      // An eval may name its own provider or model. It is selected by the same
      // rule the run's own was — flag, then eval, then `tracevals.provider`,
      // then the family's `providers:` — so an eval cannot quietly outrank a
      // flag someone just typed.
      providerFor: async (ev) => {
        const chosen = selectProvider(config, flags, ev);
        // Said before the short-circuit: under `--local` an eval naming a
        // hosted provider resolves to the run's own selection, and is still
        // replaced.
        announceSelection(chosen);
        const key = keyOf(chosen);
        if (key === defaultKey) return provider;
        let built = overridden.get(key);
        if (built === undefined) {
          // The eval's own choice follows the run's rules: an unknown name, or
          // a model with no provider to own it, is refused before anything is
          // built.
          built = (async () => {
            assertProviderSelection(chosen);
            return constructProvider(
              config,
              await resolveProviderIdentity(config, flags, ev),
            );
          })();
          overridden.set(key, built);
        }
        return built;
      },
      runs: options.runs ?? config.judge.ensembleRuns,
      temperature: config.judge.temperature,
      zones: config.judge.zones,
      cacheDir: resolve(configDir, config.judge.cacheDir),
      ...(options.noCache !== undefined ? { noCache: options.noCache } : {}),
      maxTurns: options.maxTurns ?? config.judge.maxTurns,
    });
  }

  // The evals an artifact no longer carries inline. Collections never selected
  // this run's traces and never will; what they say here is where a relocated
  // `metadata` block lives (proposals 0047 and 0049 §1).
  const external = await loadExternalEvals({
    collections,
    configDir,
    ...(options.offline === undefined ? {} : { offline: options.offline }),
  });

  return {
    config,
    configDir,
    warnings: plugins.warnings,
    ...(judge !== undefined ? { judge } : {}),
    ...(external === null
      ? {}
      : { metadataFor: (artifact) => external.forArtifact(artifact).extracted }),
  };
}

/**
 * One trace, through the engine and the history file. No rendering: the batch
 * path renders once over the aggregate rather than per trace.
 */
export async function runOne(
  options: RunCommandOptions,
  context: RunContext,
): Promise<{ report: RunReport; comparison?: HistoryComparison }> {
  const { config } = context;
  const report = await runEvals({
    tracePath: options.tracePath,
    ...(options.project !== undefined ? { projectDir: options.project } : {}),
    ...(options.env !== undefined ? { env: options.env } : {}),
    config,
    ...(context.judge !== undefined ? { judge: context.judge } : {}),
    ...(options.deterministicOnly !== undefined
      ? { deterministicOnly: options.deterministicOnly }
      : {}),
    ...(options.manifest !== undefined ? { manifest: options.manifest } : {}),
    ...(context.warnings.length > 0 ? { warnings: context.warnings } : {}),
    ...(context.metadataFor !== undefined
      ? { metadataFor: context.metadataFor }
      : {}),
  });

  let comparison: HistoryComparison | undefined;
  if (options.history) {
    const historyFile = resolve(context.configDir, config.history.file);
    comparison =
      compareToLast(await loadHistory(historyFile), report) ?? undefined;
    await appendHistory(historyFile, report);
  }
  return { report, ...(comparison ? { comparison } : {}) };
}

export async function runRun(
  options: RunCommandOptions,
): Promise<RunCommandResult> {
  const context = await prepareRun(options);
  const { report, comparison } = await runOne(options, context);

  let rendered = render(report, options.format ?? "pretty");
  if (comparison && (options.format ?? "pretty") !== "json") {
    rendered += `\n\n${renderComparison(comparison)}`;
  }
  if (options.output) {
    await writeFile(options.output, rendered, "utf-8");
  }
  return { report, rendered, ...(comparison ? { comparison } : {}) };
}

/** Exported for the batch reporter, which renders one block per trace. */
export function renderComparison(comparison: HistoryComparison): string {
  const lines = [`History vs ${comparison.previousTimestamp}:`];
  for (const r of comparison.regressions) {
    lines.push(`  regression: ${r.evalName} (${r.outcome})`);
  }
  for (const i of comparison.improvements) {
    lines.push(`  improvement: ${i.evalName} (${i.outcome})`);
  }
  if (comparison.added.length) lines.push(`  added: ${comparison.added.join(", ")}`);
  if (comparison.removed.length) {
    lines.push(`  removed: ${comparison.removed.join(", ")}`);
  }
  if (lines.length === 1) lines.push("  no changes");
  return lines.join("\n");
}
