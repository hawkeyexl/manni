/**
 * `manni graph build` — derive the knowledge graph from discovered docs and write
 * deterministic Turtle. Running twice over unchanged inputs produces
 * byte-identical output.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { GraphError } from "../types.js";
import { analyzeDoc } from "../core/analyze.js";
import { ANALYZE_CACHE_DIR, AnalyzeCache } from "../core/analyze-cache.js";
import { loadRunConfig } from "../core/config.js";
import { deriveGraph, strategyRecords, termConceptCount } from "../core/derive.js";
import {
  assertInputFormat,
  documentBase,
  documentSetPatterns,
  noInputMessage,
  resolveDocumentSet,
  routesFrom,
  STDIN,
  type DocumentInputOptions,
} from "../core/discover.js";
import { STDIN_PATH } from "../core/iri.js";
import { emitTurtle } from "../core/emit.js";
import { harvestWarnings } from "../core/harvest.js";
import { collectGitHistory } from "../core/git.js";
import { suppressGraphOutput, userFacing } from "../core/graph-output.js";
import { openMetaView, withExternalMetadata } from "../core/external.js";
import { errorMessage } from "../../shared/errors.js";
import { termLabelSource, type TermLabel } from "../../shared/term-labels.js";
import { NS, RDF_TYPE } from "../core/vocab.js";
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
  /**
   * `--no-authoring` passes `false` (proposal 0110). Overrides
   * `graph.authoring`. `false` leaves the strategy records out of the
   * document set, and every value a page's schemas mark
   * `x-manni-location: external` out of every page.
   */
  authoring?: boolean;
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
   * The concepts the graph holds, and how many of them the termbase defines
   * (proposal 0086 §1). `fromTermbase` is 0 when the `terms` derive source
   * is off or no termbase is set up.
   */
  concepts: { total: number; fromTermbase: number };
  /** The strategy records the graph types (proposal 0110). `0` when none is in the build. */
  strategyRecords: number;
  /**
   * Non-fatal diagnostics: the build succeeded, but something it would have
   * done by default could not run (see ADR 01010). Rendered to stderr by the
   * CLI; never affects the exit code.
   */
  warnings: string[];
}

/** The build with its Turtle in hand, before anything is written. */
export interface BuiltGraph extends BuildResult {
  turtle: string;
}

export async function runBuild(opts: BuildOptions = {}): Promise<BuildResult> {
  const { turtle, ...result } = await buildGraph(opts);
  mkdirSync(dirname(result.outPath), { recursive: true });
  writeFileSync(result.outPath, turtle, "utf8");
  return result;
}

/**
 * `runBuild` without the write: the graph as Turtle, in memory. `manni check`
 * builds the graph this way and checks it, writing no file.
 */
export async function buildGraph(opts: BuildOptions = {}): Promise<BuiltGraph> {
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
  // Collection pages are labelled from the config's directory and typed paths
  // from cwd, as meta labels them. Every read below resolves from `base`.
  const base = documentBase(config, opts, cwd);
  const files = resolveDocumentSet(config, opts, "build", cwd, base);
  const usingStdin = (opts.paths ?? []).includes(STDIN);
  const outPath = resolve(cwd, opts.out ?? config.out);
  if (files.length === 0 && !usingStdin) {
    if (opts.allowEmpty) {
      // Zero documents is an empty graph, written where the graph goes, so a
      // later step that reads it finds a file rather than a stale one.
      return {
        outPath,
        docs: 0,
        quads: 0,
        concepts: { total: 0, fromTermbase: 0 },
        strategyRecords: 0,
        warnings: [],
        turtle: emitTurtle([]),
      };
    }
    throw new GraphError(noInputMessage(documentSetPatterns(config, opts), cwd));
  }
  if (usingStdin && opts.stdinContent === undefined) {
    throw new GraphError("graph build was given `-` but no stdin content.");
  }

  // Each page's body parse is cached across runs (`analyze-cache.ts`). Link
  // resolution against the document set and `routes` still runs on every build.
  const cache = new AnalyzeCache(resolve(cwd, ANALYZE_CACHE_DIR));
  const analyzeOptions = {
    routes: routesFrom(config, base),
    ...(format === undefined ? {} : { format }),
    parse: cache.parse,
  };
  /** Every page of `set`, its links resolved against `set`. `<stdin>` is the page `-` read. */
  const analyzeAll = (set: readonly string[]) => {
    const allPaths = new Set(set);
    // `async`, so a read that throws rejects inside `Promise.all` rather than
    // escaping `map` and leaving earlier pages' rejections unhandled.
    return Promise.all(
      set.map(async (path) =>
        analyzeDoc(
          path === STDIN_PATH ? (opts.stdinContent ?? "") : readFileSync(resolve(base, path), "utf8"),
          path,
          allPaths,
          analyzeOptions,
        ),
      ),
    );
  };
  const documentSet = usingStdin ? [...files, STDIN_PATH] : files;
  const read = await analyzeAll(documentSet);

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
    base,
  );
  let merged = await withExternalMetadata(read, view);

  // Author-facing content (proposal 0110) is on unless `--no-authoring` or
  // `graph.authoring: false` says otherwise. Off, a strategy record leaves
  // the document set, so the pages are read again without it and a link to
  // one resolves as a link outside the build. Then every value a page's
  // schemas prefer in a sidecar leaves the page, at any depth.
  if (!(opts.authoring ?? config.authoring)) {
    const records = new Set(strategyRecords(merged, config.baseIri).map((r) => r.path));
    if (records.size > 0) {
      merged = await withExternalMetadata(await analyzeAll(documentSet.filter((p) => !records.has(p))), view);
    }
    merged = await userFacing(merged, view);
  }

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
      gitHistory = await collectGitHistory(base);
    } catch (e) {
      warnings.push(gitAbsentWarning(errorMessage(e)));
    }
  }

  // The termbase `manni term check` reads, from the same config, under the
  // `terms` derive source (proposal 0086 §1). Nothing registers a source
  // under a library call, and then the graph builds as it always did. A
  // termbase that cannot be read is `term check`'s failure to report, so the
  // graph warns once and builds the rest, as it does without git.
  const source = termLabelSource();
  let termbase: readonly TermLabel[] = [];
  if (config.build.derive.includes("terms") && source !== undefined) {
    try {
      termbase = await source({
        cwd,
        ...(opts.config === undefined ? {} : { configPath: opts.config }),
        ...(opts.noConfig === true ? { noConfig: true } : {}),
      });
    } catch (e) {
      warnings.push(
        `the graph holds no termbase concepts: the termbase could not be read — ${errorMessage(e)}`,
      );
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
    termbase,
  });
  const concept = `${NS.skos}Concept`;
  const concepts = {
    total: quads.filter((q) => q.p === RDF_TYPE && q.o.value === concept).length,
    fromTermbase: termConceptCount(termbase),
  };
  const turtle = emitTurtle(quads);
  await cache.flush();

  return {
    outPath,
    docs: docs.length,
    quads: quads.length,
    concepts,
    strategyRecords: strategyRecords(docs, config.baseIri).length,
    warnings,
    turtle,
  };
}
