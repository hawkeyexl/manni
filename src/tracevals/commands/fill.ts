/**
 * `manni tracevals fill [paths...]` — propose evals for a project's
 * instruction artifacts and append the survivors to their frontmatter.
 *
 * Authoring, not evaluation: `run` never calls this, and everything written is
 * the same declared-evals contract a human would type by hand. Project
 * rules are proposed but never written — evals inside a file the agent
 * reads before acting would be teaching to the test (ADR 01005).
 */
import { readFile, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import pc from "picocolors";
import { memberOf } from "../../meta/index.js";
import {
  externalWriteWarnings,
  spliceManifestValue,
  type ExternalWrite,
} from "../../meta/internal.js";
import { discoverArtifacts, type DiscoveredArtifact } from "../artifacts/discover.js";
import {
  appendArtifactEvals,
  appendMetadataEvals,
  type NewEvalEntry,
} from "../evals/write.js";
import {
  METADATA_KEY,
  loadExternalEvals,
  writableOwner,
  type ArtifactMetadata,
} from "../evals/external.js";
import { discoverConfig } from "../core/config.js";
import { loadGraderPlugins } from "../graders/plugins.js";
import { TracevalsError } from "../types.js";
import {
  assertProviderSelection,
  constructProvider,
  resolveProviderIdentity,
  selectProvider,
} from "../judge/provider.js";
import { TURN_BUDGET_SKIP } from "../../docevals/judge/budget.js";
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
  /** `-c/--config`: read this file instead of discovering one. */
  config?: string;
  /** `--no-config`: skip discovery and run on the built-in defaults. */
  noConfig?: boolean;
  /**
   * `--offline`: never fetch a remote external-metadata manifest; read the
   * local ones only. A relocated artifact's evals live in one (0047).
   */
  offline?: boolean;
  /**
   * `--exclude <glob>`, repeatable. Removes matching artifacts from whatever
   * the scan would otherwise have found, positional paths included.
   */
  exclude?: string[];
  cwd?: string;
  /** Report proposals without writing. */
  dryRun?: boolean;
  confidence?: number;
  /** Ceiling on an artifact's total evals, existing ones included. */
  maxEvals?: number;
  /** `--max-turns`: inference calls for the whole invocation, one per artifact. */
  maxTurns?: number;
  noCache?: boolean;
  provider?: string;
  model?: string;
  /** `--local`: run inference on this machine, over every configured choice. */
  local?: boolean;
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
  /**
   * The external-metadata manifest the evals were written to, when this
   * artifact's `metadata` block lives in one (0047). Absent when they went to
   * the artifact's own front matter.
   */
  manifest?: string;
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
  const { config: loaded, dir: configDir, collections } = await discoverConfig(
    options.configDir ?? cwd,
    {
      ...(options.config === undefined ? {} : { configPath: options.config }),
      ...(options.noConfig === undefined ? {} : { noConfig: options.noConfig }),
    },
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

  // The command line's say over every configured level, checked up front and
  // regardless of an injected provider: it costs nothing, and a typo must fail
  // on a run where no artifact needs a model too.
  const flags = {
    ...(options.provider !== undefined ? { provider: options.provider } : {}),
    ...(options.model !== undefined ? { model: options.model } : {}),
    ...(options.local !== undefined ? { local: options.local } : {}),
  };
  assertProviderSelection(selectProvider(config, flags));

  const threshold = options.confidence ?? config.fill.confidenceThreshold;
  const maxEvals = options.maxEvals ?? config.fill.maxEvalsPerArtifact;
  const temperature = config.fill.temperature;
  const maxTurns = options.maxTurns ?? config.fill.maxTurns;
  const cache = new FillCache(
    resolve(configDir, config.fill.cacheDir),
    options.noCache !== true,
  );

  // Where each artifact's `metadata` block lives. Collections do not choose
  // what `fill` scans — that is still `--project` plus `[paths...]`, and there
  // is no `--collection` (0049 §1). What they say is where a relocated block
  // lives, both for reading what an artifact already declares and for writing
  // what this run proposes.
  const external = await loadExternalEvals({
    collections,
    configDir,
    ...(options.offline === undefined ? {} : { offline: options.offline }),
  });
  const metadataOf = (artifact: {
    path: string;
    content: string;
  }): ArtifactMetadata | undefined => external?.forArtifact(artifact);

  const discovery = await discoverArtifacts({
    root,
    cwd,
    ...(options.paths !== undefined ? { paths: options.paths } : {}),
    ...(options.exclude !== undefined ? { exclude: options.exclude } : {}),
    ...(external === null
      ? {}
      : { metadataFor: (artifact) => external.forArtifact(artifact).extracted }),
  });
  const vocabulary = buildVocabulary(discovery.artifacts);
  const knownSkills = [...vocabulary.skills].sort();

  // Identity is resolved without constructing the provider, so a fully cached
  // run needs no API key, and on first use, so an all-skipped run never detects
  // a provider under `auto`. Resolved once, and shared by every artifact.
  //
  // Going through the shared resolver rather than reading config by hand
  // matters: it applies the same per-provider model default construction would,
  // so the model in the cache key is the model that actually produced the
  // proposal.
  const injected = options.providerInstance;
  let resolving: ReturnType<typeof resolveProviderIdentity> | undefined;
  const resolveOnce = (): ReturnType<typeof resolveProviderIdentity> =>
    (resolving ??= resolveProviderIdentity(config, flags));
  const getIdentity = async (): Promise<{ provider: string; model: string }> =>
    injected !== undefined
      ? { provider: injected.provider(), model: injected.modelName() }
      : resolveOnce();
  let provider = injected;
  const getProvider = async (): Promise<InferenceProvider> =>
    (provider ??= constructProvider(config, await resolveOnce(), {
      // The default mock response is judge-shaped and would fail this
      // command's schema, so seed the mock seam with a proposal instead.
      mockResponses: [mockFillProposal()],
    }));

  let turns = 0;
  const results: FillArtifactResult[] = [];
  /** Blocks that landed on a page whose schema would rather they did not. */
  const homeless: ExternalWrite[] = [];

  for (const discovered of discovery.artifacts) {
    results.push(await fillOne(discovered));
  }

  const report: FillReport = {
    results,
    threshold,
    dryRun: options.dryRun === true,
    warnings: [
      ...plugins.warnings,
      ...discovery.warnings,
      ...externalWriteWarnings(homeless, options.dryRun === true),
    ],
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
    const identity = await getIdentity();
    const key = fillCacheKey({
      provider: identity.provider,
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
      // Claimed before the call, not tallied after it (docevals ADR 01019). A
      // cache hit never reaches here, so replaying a cached corpus spends no
      // turns.
      if (maxTurns !== null && turns >= maxTurns) {
        return { ...base, status: "skipped", error: `${TURN_BUDGET_SKIP} exhausted` };
      }
      turns += 1;
      try {
        const response = await (await getProvider()).completeJSON({
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
      needsSharpening: (raw.needsSharpening as SharpeningNote[] | undefined) ?? [],
      cached,
    };

    if (gated.accepted.length === 0) return result;
    // Project rules are read by the agent under test before it acts, so
    // writing evals there would leak the rubric into the system prompt.
    if (artifact.type === "project-rules") {
      return { ...result, status: "propose-only" };
    }

    // Where the block lives decides where it is written. A URL manifest is
    // readable and not writable, and `writableOwner` refuses one — before the
    // dry-run check would have, so `--dry-run` still reports against a hosted
    // trail rather than refusing a run that writes nothing.
    const metadata = metadataOf(artifact);
    const target =
      options.dryRun === true
        ? metadata?.owner === undefined || metadata.entry === undefined
          ? undefined
          : { manifest: metadata.owner, entry: metadata.entry }
        : writableOwner(artifact.path, metadata);
    const landed: FillArtifactResult =
      target === undefined
        ? result
        : { ...result, manifest: target.manifest.file };

    if (options.dryRun === true) return { ...landed, status: "proposed" };

    // Machines propose; humans retire the trail. Recording which model proposed
    // what, at what confidence, is what lets a reviewer tell an unreviewed
    // suggestion from an eval someone actually signed off on.
    //
    // The model's own name, not `provider:model`. The judge's self-preference
    // check compares this against `modelName()`, so a composed spelling would
    // read as a different model every time. The provider name is the fallback
    // only when there is no model to name.
    const provenance = {
      generatedBy: identity.model || identity.provider,
      confidence: Object.fromEntries(
        gated.accepted.map((c) => [c.name, c.confidence]),
      ),
    };

    try {
      if (target !== undefined) {
        // Through meta's own splice writer: one value of one entry is replaced
        // and no other byte of the manifest moves, comments included.
        const text = await readFile(target.manifest.path, "utf-8");
        const spliced = spliceManifestValue(text, {
          entry: target.entry,
          key: METADATA_KEY,
          value: appendMetadataEvals(
            metadata?.extracted.data[METADATA_KEY],
            artifact.path,
            gated.accepted.map(toEvalEntry),
            provenance,
          ),
          join: target.manifest.join,
          file: target.manifest.file,
        });
        await writeFile(target.manifest.path, spliced.text);
      } else {
        const updated = appendArtifactEvals(
          artifact.content,
          artifact.path,
          gated.accepted.map(toEvalEntry),
          provenance,
        );
        await writeFile(artifact.path, updated);
        noteHomeless(artifact.path);
      }
    } catch (err) {
      return {
        ...landed,
        status: "error",
        written: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
    return { ...landed, status: "filled" };
  }

  /**
   * One W1/W2 line's worth of evidence: the schema marks `metadata`
   * `x-manni-location: external` (0047), and this block went to the page
   * anyway because no manifest owns it.
   *
   * Only when a collection is declared. With none there is nothing to relocate
   * into and no 0047 story to tell, and a repository that has never heard of
   * collections would otherwise be warned on every fill.
   */
  function noteHomeless(label: string): void {
    if (collections.length === 0) return;
    // Against every declared collection, not only the ones that own
    // `metadata`: an artifact in a collection with no manifest is the W1 case,
    // and one in no collection at all is W2.
    const collection = memberOf(collections, configDir, configDir, label)[0];
    homeless.push({
      label,
      key: METADATA_KEY,
      home:
        collection === undefined
          ? { kind: "none", reason: "collections", collections: collections.length }
          : {
              kind: "collection",
              collection,
              // Read by `relocate`'s planner, never by the warning's wording.
              manifest: "",
              createsManifest: true,
              createsCollection: false,
            },
    });
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
    // Where it landed, when that is not the artifact: a relocated block is
    // written to the manifest that owns it, and a report that did not say so
    // would send the reviewer to a file this run never touched.
    const where =
      result.manifest === undefined ? "" : dim(` in ${result.manifest}`);
    switch (result.status) {
      case "filled":
        lines.push(`${green(label)} ${show(result.artifact)}  +${result.written.length} (${names(result.written)})${where}${tag}`);
        break;
      case "proposed":
        lines.push(`${cyan(label)} ${show(result.artifact)}  +${result.written.length} (${names(result.written)})${where}${tag} — dry run, not written`);
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
