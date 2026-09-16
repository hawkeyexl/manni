/**
 * `manni kg build` — derive the knowledge graph from discovered docs and write
 * deterministic Turtle. Running twice over unchanged inputs produces
 * byte-identical output.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DockgError } from "../types.js";
import { analyzeDoc } from "../core/analyze.js";
import { loadConfig } from "../core/config.js";
import { deriveGraph } from "../core/derive.js";
import { discoverFiles } from "../core/discover.js";
import { emitTurtle } from "../core/emit.js";
import { harvestWarnings } from "../core/harvest.js";
import { collectGitHistory } from "../core/git.js";
import pkg from "../../../package.json" with { type: "json" };

export interface BuildOptions {
  /** Positional globs; override config `inputs` when non-empty. */
  globs?: string[];
  /** Explicit config file path. */
  config?: string;
  /** Output path override (default: config `out`). */
  out?: string;
  cwd?: string;
}

export interface BuildResult {
  outPath: string;
  docs: number;
  quads: number;
  /**
   * Non-fatal diagnostics: the build succeeded, but something it would have
   * done by default could not run (see ADR 01010). Rendered to stderr by the
   * CLI; never affects the exit code.
   */
  warnings: string[];
}

export async function runBuild(opts: BuildOptions = {}): Promise<BuildResult> {
  const cwd = opts.cwd ?? process.cwd();
  const config = loadConfig(opts.config, cwd);
  const inputs =
    opts.globs && opts.globs.length > 0 ? opts.globs : config.inputs;

  const files = discoverFiles(inputs, config.exclude, cwd);
  if (files.length === 0) {
    throw new DockgError(
      `No input files matched: ${inputs.join(", ")} (cwd: ${cwd})`,
    );
  }

  const allPaths = new Set(files);
  const docs = files.map((path) =>
    analyzeDoc(readFileSync(resolve(cwd, path), "utf8"), path, allPaths, {
      routes: config.routes,
    }),
  );

  // Page-level keys that look like harvest inputs but are not. The kg block is
  // schema-strict, so a typo there is a hard error; at the page level nothing
  // validates, and a near miss derives silently nothing (ADR 01028).
  const warnings: string[] = harvestWarnings(docs);
  // The git pass only feeds the provenance derive source — skip the subprocess
  // entirely when that source, or provenance.git itself, is off. Under "auto"
  // an unavailable git degrades to a warning; under `true` the user demanded
  // it, so failing to honor that is an operational error (ADR 01010).
  let gitHistory: Awaited<ReturnType<typeof collectGitHistory>> | undefined;
  if (
    config.provenance.git !== false &&
    config.build.derive.includes("provenance")
  ) {
    try {
      gitHistory = await collectGitHistory(cwd);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      if (config.provenance.git === true) {
        throw new DockgError(`provenance.git is true but ${detail}`);
      }
      warnings.push(
        `provenance.git is "auto" and ${detail} — continuing without git-derived provenance`,
      );
    }
  }

  const quads = deriveGraph(docs, {
    baseIri: config.baseIri,
    derive: config.build.derive,
    // The package version, stamped on the build agent (dockg:version). One
    // package, one version: the tool no longer has one of its own.
    toolVersion: pkg.version,
    gitHistory,
    qualified: config.provenance.qualified,
  });
  const turtle = emitTurtle(quads);

  const outPath = resolve(cwd, opts.out ?? config.out);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, turtle, "utf8");

  return { outPath, docs: docs.length, quads: quads.length, warnings };
}
