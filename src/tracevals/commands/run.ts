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
import { loadGraderPlugins } from "../graders/plugins.js";
import {
  appendHistory,
  compareToLast,
  loadHistory,
  type HistoryComparison,
} from "../history.js";
import {
  makeJudgeProvider,
  pricingOverrideFor,
} from "../judge/provider.js";
import { makeTraceJudge, type TraceJudge } from "../judge/trace-judge.js";
import type { InferenceProvider, Pricing } from "@hawkeyexl/inference";
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
  runs?: number;
  deterministicOnly?: boolean;
  noCache?: boolean;
  maxCostUsd?: number;
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
 * judge carries the cost budget, so building one per trace would turn
 * `maxCostUsd` from a ceiling on the run into a ceiling on the largest trace.
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
}

export async function prepareRun(
  options: RunSharedOptions,
): Promise<RunContext> {
  const { config: loaded, dir: configDir } = await discoverConfig(
    options.configDir ?? process.cwd(),
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

  let judge = options.judge;
  if (judge === undefined && options.deterministicOnly !== true) {
    const provider = makeJudgeProvider(config, {
      ...(options.provider !== undefined ? { provider: options.provider } : {}),
      ...(options.model !== undefined ? { model: options.model } : {}),
    });
    const maxCostUsd = options.maxCostUsd ?? config.judge.maxCostUsd;
    // Without the configured override, a model the library's built-in price
    // table does not know costs 0, and maxCostUsd would never trip.
    const pricing = pricingOverrideFor(config, {
      ...(options.provider !== undefined ? { provider: options.provider } : {}),
    });
    const overrideProviders = new Map<
      string,
      { provider: InferenceProvider; pricing?: Pricing }
    >();
    judge = makeTraceJudge({
      provider,
      // An eval may name its own provider. Build it from the same config the
      // default came from, so a per-eval override picks up that provider's
      // model default, API-key env, and price override rather than a bare name.
      // Memoized: the judge calls this once per eval, and twenty evals naming
      // one provider should not build twenty of it.
      providerFor: (name, model) => {
        // Keyed on the pair: two evals naming one provider at two models are
        // two instances, and caching on the name alone would hand the second
        // the first's model.
        const key = model === undefined ? name : `${name}\u0000${model}`;
        const cached = overrideProviders.get(key);
        if (cached) return cached;
        const built = {
          provider: makeJudgeProvider(config, {
            provider: name,
            ...(model !== undefined ? { model } : {}),
          }),
          ...(() => {
            const p = pricingOverrideFor(config, { provider: name });
            return p !== undefined ? { pricing: p } : {};
          })(),
        };
        overrideProviders.set(key, built);
        return built;
      },
      ...(options.model !== undefined ? { model: options.model } : {}),
      runs: options.runs ?? config.judge.ensembleRuns,
      temperature: config.judge.temperature,
      zones: config.judge.zones,
      cacheDir: resolve(configDir, config.judge.cacheDir),
      ...(options.noCache !== undefined ? { noCache: options.noCache } : {}),
      ...(maxCostUsd !== undefined ? { maxCostUsd } : {}),
      ...(pricing !== undefined ? { pricing } : {}),
    });
  }

  return {
    config,
    configDir,
    warnings: plugins.warnings,
    ...(judge !== undefined ? { judge } : {}),
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

  let rendered = render(report, options.format ?? "human");
  if (comparison && (options.format ?? "human") !== "json") {
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
