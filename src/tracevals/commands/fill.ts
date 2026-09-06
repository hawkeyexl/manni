/**
 * `manni tracevals fill [paths...]` — propose evals for a project's
 * instruction artifacts and append the survivors to their frontmatter.
 *
 * Authoring, not evaluation: `run` never calls this, and everything written is
 * the same declared-evals contract a human would type by hand. Project
 * rules are proposed but never written — evals inside a file the agent
 * reads before acting would be teaching to the test (ADR 01005).
 */
import { writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import pc from "picocolors";
import { discoverArtifacts, type DiscoveredArtifact } from "../artifacts/discover.js";
import { appendArtifactEvals, type NewEvalEntry } from "../evals/write.js";
import { discoverConfig } from "../core/config.js";
import { loadGraderPlugins } from "../graders/plugins.js";
import { TracevalsError } from "../types.js";
import {
  costOfUsage,
  pricingFor,
  resolveProviderIdentity,
  type ProviderName,
} from "@hawkeyexl/inference";
import {
  makeJudgeProvider,
  pricingOverrideFor,
  providerSpecFor,
} from "../judge/provider.js";
import { FillCache, fillCacheKey } from "../fill/cache.js";
import { artifactFacts } from "../fill/facts.js";
import {
  gateProposals,
  type ProposedEval,
  type Rejection,
} from "../fill/gate.js";
import {
  PROPOSAL_SCHEMA,
  buildFillUser,
  isValidProposal,
  systemPromptFor,
} from "../fill/prompt.js";
import { mockFillProposal } from "../fill/mock.js";
import { buildVocabulary } from "../fill/vocabulary.js";
import type { InferenceProvider } from "@hawkeyexl/inference";

export interface FillOptions {
  /** Files or directories to scan; defaults to the whole project. */
  paths?: string[];
  /** Project root; defaults to cwd. */
  project?: string;
  configDir?: string;
  cwd?: string;
  /** Report proposals without writing. */
  dryRun?: boolean;
  confidence?: number;
  /** Ceiling on an artifact's total evals, existing ones included. */
  maxEvals?: number;
  maxCostUsd?: number;
  noCache?: boolean;
  provider?: string;
  model?: string;
  /** `--require`: grader plugins to load *in addition to* `config.plugins`. */
  require?: string[];
  /** Test seam: bypasses provider construction entirely. */
  providerInstance?: InferenceProvider;
}

export type FillStatus =
  | "filled"
  | "proposed"
  | "nothing-proposed"
  | "propose-only"
  | "skipped"
  | "unreadable"
  | "error";

export interface SharpeningNote {
  instruction: string;
  reason: string;
  suggestion?: string;
}

export interface FillArtifactResult {
  artifact: string;
  type: string;
  status: FillStatus;
  /** Evals written, or that would be written in a dry run. */
  written: ProposedEval[];
  rejected: Rejection[];
  capped: ProposedEval[];
  /** Instructions the model judged untestable as written. */
  needsSharpening: SharpeningNote[];
  cached: boolean;
  error?: string;
}

export interface FillReport {
  results: FillArtifactResult[];
  threshold: number;
  /** True when nothing was written because this was a dry run. */
  dryRun: boolean;
  warnings: string[];
  exitCode: 0 | 1;
}

export interface FillRun {
  report: FillReport;
  rendered: string;
}

/** Proposals become inline evals; confidence and rationale stay report-only. */
function toEvalEntry(proposed: ProposedEval): NewEvalEntry {
  const entry: NewEvalEntry = {
    id: proposed.name,
    assertion: proposed.assertion,
    // New evals start as regression: they describe behavior the artifact
    // already asks for, not a boundary being probed.
    type: "regression",
    grader: proposed.grader,
    // The vocabulary takes one anchor or a list; the model proposes one of each.
    examples: { pass: [proposed.examples.pass], fail: [proposed.examples.fail] },
  };
  if (proposed.options !== undefined) entry.options = proposed.options;
  if (proposed.evidence !== undefined) entry.evidence = proposed.evidence;
  if (proposed.severity !== undefined) entry.severity = proposed.severity;
  return entry;
}

export async function runFill(options: FillOptions = {}): Promise<FillRun> {
  const cwd = options.cwd ?? process.cwd();
  const root = resolve(options.project ?? cwd);
  const { config: loaded, dir: configDir } = await discoverConfig(
    options.configDir ?? cwd,
  );
  // `--require` is folded into the resolved config, the same way `run` does it,
  // rather than merged inline at the load call. Downstream code reads one
  // fully-resolved `config.plugins`; two commands disagreeing about whether it
  // includes the flag is how a knob starts behaving differently depending on
  // which command reached it.
  const config = {
    ...loaded,
    plugins: [...loaded.plugins, ...(options.require ?? [])],
  };

  // The same list `run` loads, appended to the same way, for the same reason:
  // a repo whose config names its house graders must not behave differently
  // depending on which command reached the registry. What it changes here is
  // narrower — `ALLOWED_GRADERS` still refuses to propose a custom kind, but a
  // plugin that *replaces* a built-in replaces the `validateOptions` the gate
  // ground-checks proposals with (ADR 01017).
  const plugins = await loadGraderPlugins({
    plugins: config.plugins,
    configDir,
  });

  const threshold = options.confidence ?? config.fill.confidenceThreshold;
  const maxEvals = options.maxEvals ?? config.fill.maxEvalsPerArtifact;
  const temperature = config.fill.temperature;
  const maxCostUsd = options.maxCostUsd ?? config.fill.maxCostUsd;
  const cache = new FillCache(
    resolve(configDir, config.fill.cacheDir),
    options.noCache !== true,
  );

  const discovery = await discoverArtifacts({
    root,
    cwd,
    ...(options.paths !== undefined ? { paths: options.paths } : {}),
  });
  const vocabulary = buildVocabulary(discovery.artifacts);
  const knownSkills = [...vocabulary.skills].sort();

  // Constructed lazily so a fully-cached or all-skipped run needs no API key.
  let provider = options.providerInstance;
  const getProvider = (): InferenceProvider =>
    (provider ??= makeJudgeProvider(config, {
      ...(options.provider !== undefined ? { provider: options.provider } : {}),
      ...(options.model !== undefined ? { model: options.model } : {}),
      // The default mock response is judge-shaped and would fail this
      // command's schema, so seed the mock with a proposal instead.
      mockResponses: [mockFillProposal()],
    }));
  // Identity is resolved without constructing the provider so a fully-cached
  // run needs no API key. Going through the library's resolver rather than
  // reading config by hand matters: it applies the same per-provider model
  // default makeProvider would, so the model in the cache key is the model
  // that actually produced the proposal.
  const providerName = (options.provider ??
    config.provider.default ??
    "claude-cli") as ProviderName;
  const identity = provider
    ? { name: provider.provider(), model: provider.modelName() }
    : (() => {
        const resolved = resolveProviderIdentity(
          providerSpecFor(config, providerName, {
            ...(options.model !== undefined ? { model: options.model } : {}),
          }),
        );
        return { name: resolved.provider, model: resolved.model };
      })();
  // The configured override belongs to the *configured* provider. An injected
  // instance (the test seam, or programmatic use) may be an entirely different
  // provider and model, so applying the override to it would invent a price
  // for something it was never written for — a mock run would report non-zero
  // cost. Fall back to the built-in table in that case.
  const pricing = pricingFor(
    identity.model,
    options.providerInstance
      ? undefined
      : pricingOverrideFor(config, {
          ...(options.provider !== undefined
            ? { provider: options.provider }
            : {}),
        }),
  );

  let costUsd = 0;
  const results: FillArtifactResult[] = [];

  for (const discovered of discovery.artifacts) {
    results.push(await fillOne(discovered));
  }

  const report: FillReport = {
    results,
    threshold,
    dryRun: options.dryRun === true,
    warnings: [...plugins.warnings, ...discovery.warnings],
    exitCode: results.some((r) => r.status === "error") ? 1 : 0,
  };
  return { report, rendered: renderFill(report, { cwd }) };

  async function fillOne(
    discovered: DiscoveredArtifact,
  ): Promise<FillArtifactResult> {
    const { artifact } = discovered;
    const base: FillArtifactResult = {
      artifact: artifact.path,
      type: artifact.type,
      status: "nothing-proposed",
      written: [],
      rejected: [],
      capped: [],
      needsSharpening: [],
      cached: false,
    };

    if (discovered.status !== "ok") {
      return {
        ...base,
        status: discovered.status === "unreadable" ? "unreadable" : "error",
        ...(discovered.error !== undefined ? { error: discovered.error } : {}),
      };
    }
    if (discovered.skip) return { ...base, status: "skipped" };

    const facts = artifactFacts(artifact);
    const key = fillCacheKey({
      provider: identity.name,
      model: identity.model,
      temperature,
      maxEvals,
      artifactType: artifact.type,
      path: artifact.path,
      body: artifact.content,
      existingNames: discovered.existingNames,
      knownSkills,
    });

    let raw = cache.get(key);
    const cached = raw !== undefined;
    if (raw === undefined) {
      if (maxCostUsd !== undefined && costUsd >= maxCostUsd) {
        return { ...base, status: "skipped", error: "cost budget exhausted" };
      }
      try {
        const response = await getProvider().completeJSON({
          system: systemPromptFor(artifact.type),
          user: buildFillUser({
            artifact,
            existingNames: discovered.existingNames,
            maxEvals,
            facts,
            knownSkills,
          }),
          schema: PROPOSAL_SCHEMA,
          temperature,
        });
        costUsd += costOfUsage(response.usage, pricing);
        if (!isValidProposal(response.json)) {
          return {
            ...base,
            status: "error",
            error: "provider returned a proposal that does not match the schema",
          };
        }
        raw = response.json as Record<string, unknown>;
        cache.set(key, raw);
      } catch (err) {
        // An operational failure (no API key, unknown provider) is not this
        // artifact's fault and would repeat for every one: let it out so the
        // CLI reports it once and exits 2.
        if (err instanceof TracevalsError) throw err;
        return {
          ...base,
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }

    const gated = gateProposals(raw.evals as ProposedEval[], {
      artifactType: artifact.type,
      threshold,
      existingNames: discovered.existingNames,
      // The cap is a ceiling on the artifact's total, not on one run's
      // additions, so repeated fills cannot grow it without bound.
      maxEvals: Math.max(0, maxEvals - discovered.existingNames.length),
      vocabulary,
    });
    const result: FillArtifactResult = {
      ...base,
      written: gated.accepted,
      rejected: gated.rejected,
      capped: gated.capped,
      needsSharpening: (raw.needsSharpening as SharpeningNote[]) ?? [],
      cached,
    };

    if (gated.accepted.length === 0) return result;
    // Project rules are read by the agent under test before it acts, so
    // writing evals there would leak the rubric into the system prompt.
    if (artifact.type === "project-rules") {
      return { ...result, status: "propose-only" };
    }
    if (options.dryRun === true) return { ...result, status: "proposed" };

    try {
      const updated = appendArtifactEvals(
        artifact.content,
        artifact.path,
        gated.accepted.map(toEvalEntry),
        // Machines propose; humans retire the trail. Recording which model
        // proposed what, at what confidence, is what lets a reviewer tell an
        // unreviewed suggestion from an eval someone actually signed off on.
        {
          generatedBy: identity.model
            ? `${identity.name}:${identity.model}`
            : identity.name,
          confidence: Object.fromEntries(
            gated.accepted.map((c) => [c.name, c.confidence]),
          ),
        },
      );
      await writeFile(artifact.path, updated);
    } catch (err) {
      return {
        ...result,
        status: "error",
        written: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
    return { ...result, status: "filled" };
  }
}

const STATUS_LABEL: Record<FillStatus, string> = {
  filled: "filled",
  proposed: "proposed",
  "propose-only": "proposed",
  "nothing-proposed": "no-op",
  skipped: "skipped",
  unreadable: "skipped",
  error: "error",
};

function names(entries: ProposedEval[]): string {
  return entries
    .map((c) => `${c.name} ${c.confidence.toFixed(2)}`)
    .join(", ");
}

export function renderFill(
  report: FillReport,
  opts: { color?: boolean; cwd?: string } = {},
): string {
  const color = opts.color ?? true;
  const from = opts.cwd ?? process.cwd();
  /** Absolute paths stay in the report; the human view is relative. */
  const show = (path: string): string => {
    const rel = relative(from, path);
    return rel === "" || rel.startsWith("..") ? path : rel;
  };
  const paint = (fn: (s: string) => string) => (s: string) =>
    color ? fn(s) : s;
  const green = paint(pc.green);
  const cyan = paint(pc.cyan);
  const dim = paint(pc.dim);
  const red = paint(pc.red);

  const lines: string[] = [];
  for (const result of report.results) {
    const label = STATUS_LABEL[result.status].padEnd(9);
    const tag = result.cached ? dim(" [cached]") : "";
    switch (result.status) {
      case "filled":
        lines.push(`${green(label)} ${show(result.artifact)}  +${result.written.length} (${names(result.written)})${tag}`);
        break;
      case "proposed":
        lines.push(`${cyan(label)} ${show(result.artifact)}  +${result.written.length} (${names(result.written)})${tag} — dry run, not written`);
        break;
      case "propose-only":
        lines.push(`${cyan(label)} ${show(result.artifact)}  +${result.written.length} (${names(result.written)})${tag} — project rules are never written; copy what you want`);
        break;
      case "nothing-proposed":
        lines.push(`${dim(label)} ${show(result.artifact)}  (nothing new proposed)${tag}`);
        break;
      case "skipped":
        lines.push(`${dim(label)} ${show(result.artifact)}  (${result.error ?? "metadata.evals.skip"})`);
        break;
      case "unreadable":
        lines.push(`${dim(label)} ${show(result.artifact)}  (${result.error ?? "unreadable frontmatter"})`);
        break;
      case "error":
        lines.push(`${red(label)} ${show(result.artifact)}: ${result.error ?? "unknown error"}`);
        break;
    }
    const belowThreshold = result.rejected.filter((r) => r.reason === "low-confidence");
    if (belowThreshold.length > 0) {
      lines.push(dim(`          below ${report.threshold}: ${names(belowThreshold.map((r) => r.proposal))}`));
    }
    for (const rejection of result.rejected) {
      if (rejection.reason === "low-confidence") continue;
      lines.push(dim(`          ${rejection.reason}: ${rejection.proposal.name}${rejection.detail ? ` — ${rejection.detail}` : ""}`));
    }
    if (result.capped.length > 0) {
      lines.push(dim(`          over per-artifact cap: ${names(result.capped)}`));
    }
    for (const note of result.needsSharpening) {
      lines.push(dim(`          needs sharpening: "${note.instruction}" — ${note.reason}`));
    }
  }

  if (report.results.length === 0) {
    lines.push("No skills, agent definitions, or project rules found.");
  }
  for (const warning of report.warnings) lines.push(dim(`warning: ${warning}`));

  lines.push("");
  const total = report.results.reduce((n, r) => n + r.written.length, 0);
  lines.push(
    report.dryRun
      ? `Threshold ${report.threshold} · ${total} evals proposed, none written (dry run)`
      : `Threshold ${report.threshold} · ${total} evals written`,
  );
  return lines.join("\n");
}
