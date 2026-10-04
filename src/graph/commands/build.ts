/**
 * `manni graph build` — derive the knowledge graph from discovered docs and write
 * deterministic Turtle. Running twice over unchanged inputs produces
 * byte-identical output.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { GraphError } from "../types.js";
import { analyzeDoc } from "../core/analyze.js";
import { loadRunConfig } from "../core/config.js";
import { deriveGraph } from "../core/derive.js";
import {
  assertInputFormat,
  documentSetPatterns,
  resolveDocumentSet,
  STDIN,
  type DocumentInputOptions,
} from "../core/discover.js";
import { STDIN_PATH } from "../core/iri.js";
import { emitTurtle } from "../core/emit.js";
import { harvestWarnings } from "../core/harvest.js";
import { collectGitHistory } from "../core/git.js";
import { suppressGraphOutput } from "../core/graph-output.js";
import { openMetaView, withExternalMetadata } from "../core/external.js";
import { errorMessage } from "../../shared/errors.js";
import pkg from "../../../package.json" with { type: "json" };

export interface BuildOptions extends DocumentInputOptions {
  /** Output path override (default: config `out`). */
  out?: string;
  cwd?: string;
  /**
   * What `-` reads: the document from stdin, read by the caller. Required
   * when `paths` holds `-`. Its display path is `<stdin>`, its node is
   * `{baseIri}stdin`, and its links resolve from `cwd`.
   */
  stdinContent?: string;
  /** `--allow-empty`: zero matched files writes an empty graph, not an error. */
  allowEmpty?: boolean;
}

/**
 * What a run that wanted git history and could not have it is told. Said once,
 * through `warn()` at the CLI edge: git is detected now rather than switched
 * (proposal 0051 §6), so the degradation graph ADR 01010 built the warnings
 * channel for is all that is left of the tri-state.
 *
 * The reason travels with the sentence. Detection removed the user's way of
 * saying "I require this", so the warning is the only thing standing between a
 * CI runner that lost git and a quietly thinner graph — and "not a repository"
 * wants a different fix from "git is not on PATH" or "`git log` timed out".
 */
export const GIT_ABSENT_WARNING =
  "the graph has no revision history or commit agents";

export function gitAbsentWarning(reason: string): string {
  return `${GIT_ABSENT_WARNING}: ${reason}`;
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
  const config = loadRunConfig(
    {
      ...(opts.config === undefined ? {} : { configPath: opts.config }),
      ...(opts.noConfig === undefined ? {} : { noConfig: opts.noConfig }),
      ...(opts.paths === undefined ? {} : { paths: opts.paths }),
      ...(opts.collection === undefined ? {} : { collection: opts.collection }),
    },
    cwd,
  );

  const format = assertInputFormat(opts.paths ?? [], opts.as);
  const files = resolveDocumentSet(config, opts, "build", cwd);
  const usingStdin = (opts.paths ?? []).includes(STDIN);
  const outPath = resolve(cwd, opts.out ?? config.out);
  if (files.length === 0 && !usingStdin) {
    if (opts.allowEmpty) {
      // Zero documents is an empty graph, written where the graph goes, so a
      // later step that reads it finds a file rather than a stale one.
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, emitTurtle([]), "utf8");
      return { outPath, docs: 0, quads: 0, warnings: [] };
    }
    throw new GraphError(
      `No input files matched: ${documentSetPatterns(config, opts).join(", ")} (cwd: ${cwd})`,
    );
  }
  if (usingStdin && opts.stdinContent === undefined) {
    throw new GraphError("graph build was given `-` but no stdin content.");
  }

  const allPaths = new Set(usingStdin ? [...files, STDIN_PATH] : files);
  const analyzeOptions = {
    routes: config.routes,
    ...(format === undefined ? {} : { format }),
  };
  const read = files.map((path) =>
    analyzeDoc(readFileSync(resolve(cwd, path), "utf8"), path, allPaths, analyzeOptions),
  );
  if (usingStdin && opts.stdinContent !== undefined) {
    read.push(analyzeDoc(opts.stdinContent, STDIN_PATH, allPaths, analyzeOptions));
  }

  // A page's metadata is what `manni meta validate` reads: its frontmatter
  // plus every key a manifest of its collections owns (proposal 0047), merged
  // through meta's own merge. Read from meta's section of the same config the
  // output marks come from, so one file answers both.
  const view = await openMetaView(
    {
      ...(opts.config === undefined ? {} : { configPath: opts.config }),
      ...(opts.noConfig === undefined ? {} : { noConfig: opts.noConfig }),
    },
    cwd,
    files,
  );
  const merged = await withExternalMetadata(read, view);

  // What the graph carries is the schema's call (proposal 0051 §5): a top-level
  // field marked `x-manni-graph-output: false` is dropped here, before derivation,
  // and the schemas are the set `manni meta validate` resolves (proposal 0074),
  // so it reaches none of Turtle, JSON-LD, iiRDS or the search index. All four
  // read what `deriveGraph` produces, so one filter at the fan-in is the whole
  // mechanism; suppressing a field downstream would be triple surgery in four
  // places. It runs after the merge, so a field kept in a manifest is filtered
  // by the same mark as one kept on the page.
  const docs = await suppressGraphOutput(merged, view);

  // Page-level keys that look like harvest inputs but are not. The graph block
  // is schema-strict, so a typo there is a hard error; at the page level
  // nothing validates, and a near miss derives silently nothing (ADR 01028).
  const warnings: string[] = harvestWarnings(docs);
  // The git pass only feeds the provenance derive source, so the subprocess is
  // skipped entirely when that source is off. Otherwise git is *detected*
  // (proposal 0051 §6): history is used wherever git can run over a
  // repository, and a run that would have used it and cannot says so once and
  // builds the rest — graph ADR 01010's degradation, without its switch.
  let gitHistory: Awaited<ReturnType<typeof collectGitHistory>> | undefined;
  if (config.build.derive.includes("provenance")) {
    try {
      gitHistory = await collectGitHistory(cwd);
    } catch (e) {
      warnings.push(gitAbsentWarning(errorMessage(e)));
    }
  }

  const quads = deriveGraph(docs, {
    baseIri: config.baseIri,
    derive: config.build.derive,
    // The package version, stamped on the build agent (graph:version). One
    // package, one version: the tool no longer has one of its own.
    toolVersion: pkg.version,
    gitHistory,
    qualified: config.provenance.qualified,
  });
  const turtle = emitTurtle(quads);

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, turtle, "utf8");

  return { outPath, docs: docs.length, quads: quads.length, warnings };
}
