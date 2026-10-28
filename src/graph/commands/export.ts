/**
 * `manni graph export` — reserialize the built graph into a consumer format. Reads
 * the graph the same way `stats`/`check` do (loadGraph over the config `out`,
 * missing graph → exit 2) and writes a deterministic rendering. `jsonld` emits a
 * whole-graph JSON-LD file; `iirds` projects the graph into a conformant,
 * deterministic unrestricted iiRDS package (`.iirds` ZIP) — see ADR 01017.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { GraphError } from "../types.js";
import { type GraphConfig, loadRunConfig } from "../core/config.js";
import { EVALS_ARE_AUTHOR_FACING, NO_AUTHORING_EXPORT } from "../core/graph-output.js";
import { documentBase, parseContexts } from "../core/discover.js";
import type { ParseContext } from "../../lint/types.js";
import { emitJsonLd } from "../core/emit-jsonld.js";
import { emitRdfXml } from "../core/emit-rdfxml.js";
import { projectPackage } from "../core/iirds-package.js";
import { loadGraph, storeToQuads } from "../core/load.js";
import {
  buildSearchIndex,
  documentsByLanguage,
  emitSearchIndex,
  partitionByLanguage,
} from "../core/search-index.js";
import {
  emitLocalizations,
  isLanguageTag,
  LOCALIZATIONS_FILENAME,
  searchIndexFilename,
  type LocalizationEntry,
} from "../core/localizations.js";
import { byCodeUnit } from "../core/sort.js";
import { PREFIXES } from "../core/vocab.js";
import { exportSampleQuestions } from "./questions.js";
import { exportChunks } from "./chunks.js";
import { defaultLlmsPath, exportLlms } from "./llms.js";
import { GraphIndex } from "../runtime/graph.js";
import { writeZip, type ZipEntry } from "../core/zip.js";

/**
 * What `manni graph export <target>` can write, in the order messages list them.
 * The CLI names its positional against this list, and `runExport` holds a
 * library caller to it too.
 */
export const EXPORT_TARGETS = ["jsonld", "iirds", "search", "questions", "chunks", "llms"] as const;

export type ExportFormat = (typeof EXPORT_TARGETS)[number];

export interface ExportOptions {
  config?: string;
  /** `--no-config`: skip discovery and run on the built-in defaults. */
  noConfig?: boolean;
  /** Graph .ttl path (default: config `out`). */
  graph?: string;
  format: ExportFormat;
  /** Output path (default: the graph path with the format's extension). */
  out?: string;
  /** `--evals`: a docevals JSON report for `chunks`, overriding `graph.export.chunks.evals`. */
  evals?: string;
  /**
   * `--no-authoring` passes `false` (proposal 0110). Overrides
   * `graph.authoring`. `false` leaves strategy records, external values,
   * pins and eval verdicts out of what `chunks` and `llms` read from pages.
   */
  authoring?: boolean;
  cwd?: string;
}

export interface ExportResult {
  outPath: string;
  format: ExportFormat;
  /** Distinct subject nodes in the emitted (or projected) graph; questions for `questions`, pages for `llms`. */
  nodes: number;
  /** Non-fatal warnings: iiRDS projection, stale answers, chunk records. */
  warnings: string[];
  /** Notices, said once: chunks withheld, or a run outside git. */
  notices?: string[];
  /** Every file the export wrote, absolute. */
  files: string[];
  /** `chunks`: the passages `graph.retrieve.withhold` left out. */
  withheld?: number;
}

/** File extension each single-file format writes to. */
const EXTENSION: Record<"jsonld" | "iirds", string> = {
  jsonld: ".jsonld",
  iirds: ".iirds",
};

/** Replace a path's extension (or append one) with `.jsonld`-style ext. */
function withExtension(path: string, ext: string): string {
  return path.replace(/\.[^./\\]*$/, "") + ext;
}

function runJsonLd(cwd: string, graphPath: string, out?: string): ExportResult {
  const store = loadGraph(graphPath);
  const quads = storeToQuads(store);
  const serialized = emitJsonLd(quads);
  const nodes = new Set(quads.map((q) => q.s)).size;
  const outPath = out
    ? resolve(cwd, out)
    : withExtension(graphPath, EXTENSION.jsonld);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, serialized, "utf8");
  return { outPath, format: "jsonld", nodes, warnings: [], files: [outPath] };
}

function runIirds(
  cwd: string,
  sources: string,
  graphPath: string,
  iirds: { title?: string; creator?: string; version: "1.2" | "1.3" },
  baseIri: string,
  out?: string,
): ExportResult {
  const store = loadGraph(graphPath);
  const projection = projectPackage(
    store,
    {
      baseIri,
      version: iirds.version,
      title: iirds.title,
      creator: iirds.creator,
    },
    sources,
  );
  const metadata = emitRdfXml(projection.quads, projection.prefixes);

  // Deterministic entry order: mimetype (stored, first) → metadata → content
  // files sorted by their in-archive path.
  const content = [...projection.contentFiles]
    .sort((a, b) => byCodeUnit(a.zipPath, b.zipPath))
    .map((f): ZipEntry => ({ name: f.zipPath, data: readFileSync(f.absPath) }));
  const entries: ZipEntry[] = [
    {
      name: "mimetype",
      data: Buffer.from("application/iirds+zip"),
      store: true,
    },
    { name: "META-INF/metadata.rdf", data: Buffer.from(metadata, "utf8") },
    ...content,
  ];

  const outPath = out
    ? resolve(cwd, out)
    : withExtension(graphPath, EXTENSION.iirds);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, writeZip(entries));
  const nodes = new Set(projection.quads.map((q) => q.s)).size;
  return { outPath, format: "iirds", nodes, warnings: projection.warnings, files: [outPath] };
}

/**
 * The same digest `manni graph embed` records as a sidecar's `source` and the runtime
 * recomputes in a browser: SHA-256 over the index file's exact bytes. Computed
 * here from the string about to be written, so the manifest cannot disagree
 * with the file it describes.
 */
function searchIndexDigest(raw: string): string {
  return `sha256:${createHash("sha256").update(raw, "utf8").digest("hex")}`;
}

/**
 * The lexical search artifacts. Reads each document's source from disk — the
 * same thing the iiRDS projection does for renditions — because the graph
 * deliberately carries no prose (ADR 01008/01019).
 *
 * Fans out per language and writes a manifest beside them (ADR 01038). The
 * fan-out is unconditional, including for a monolingual corpus: one rule beats
 * a filename that changes shape the day someone adds a translation.
 */
async function runSearchIndex(
  cwd: string,
  sources: string,
  graphPath: string,
  out: string | undefined,
  context: (label: string) => ParseContext,
): Promise<ExportResult> {
  const store = loadGraph(graphPath);
  const graph = GraphIndex.fromQuads(
    storeToQuads(store),
    Object.fromEntries(PREFIXES),
  );
  const warnings: string[] = [];
  const index = await buildSearchIndex(graph, sources, { warnings, context });
  const byLanguage = partitionByLanguage(graph, index);
  const docCounts = documentsByLanguage(graph);

  // Siblings of the graph, named for what they are: `graph.json` next to
  // `graph.jsonld` would be a trap. `--out` names the directory here, not a
  // file, because there is more than one.
  const outDir = out ? resolve(cwd, out) : dirname(graphPath);
  mkdirSync(outDir, { recursive: true });

  const languages: LocalizationEntry[] = [];
  for (const [language, doc] of byLanguage) {
    // The tag becomes a filename, and `export` does not run SHACL — so a
    // `dcterms:language` literal reaches this line exactly as the corpus wrote
    // it. Unchecked, `lang: ../escaped` would put a path segment into
    // `writeFileSync` and crash with a raw stack trace (exit 1) instead of the
    // operational error this is (exit 2).
    if (!isLanguageTag(language)) {
      throw new GraphError(
        `Cannot write an index for language "${language}": not a BCP-47 tag. ` +
          `Fix the \`lang\`/\`language\` frontmatter, or the route's \`language\`, ` +
          `and rebuild — \`manni graph check\` reports which document carries it.`,
      );
    }
    const filename = searchIndexFilename(language);
    const serialized = emitSearchIndex(doc);
    writeFileSync(join(outDir, filename), serialized, "utf8");
    languages.push({
      language,
      documents: docCounts.get(language) ?? 0,
      search: {
        path: filename,
        entries: doc.entries.length,
        digest: searchIndexDigest(serialized),
      },
    });
  }

  const manifestPath = join(outDir, LOCALIZATIONS_FILENAME);
  writeFileSync(
    manifestPath,
    emitLocalizations({ version: 1, languages }),
    "utf8",
  );
  return {
    outPath: manifestPath,
    format: "search",
    nodes: index.entries.length,
    warnings,
    files: [...languages.map((l) => join(outDir, l.search.path)), manifestPath],
  };
}

/**
 * The golden set of questions (proposal 0087 § 7d): one JSON line per
 * question, read from the pages' sources and the golden-set files.
 */
async function runQuestions(
  cwd: string,
  sources: string,
  graphPath: string,
  config: Pick<GraphConfig, "questionFiles" | "configDir" | "tools">,
  source: { configPath?: string; noConfig?: boolean },
  out?: string,
): Promise<ExportResult> {
  const { lines, stale } = await exportSampleQuestions(
    loadGraph(graphPath),
    sources,
    { source, cwd },
    config.questionFiles,
    config.configDir,
    parseContexts(config, sources),
  );
  const outPath = out ? resolve(cwd, out) : join(dirname(graphPath), "questions.jsonl");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, lines.map((l) => `${l}\n`).join(""), "utf8");
  const warnings =
    stale === 0
      ? []
      : [
          stale === 1
            ? "1 answer changed since it was pinned, so it is exported as it reads now, marked stale."
            : `${String(stale)} answers changed since they were pinned, so they are exported as they read now, marked stale.`,
        ];
  return { outPath, format: "questions", nodes: lines.length, warnings, files: [outPath] };
}

/** Every command core is async, and the CLI awaits this one. A usage error rejects. */
export async function runExport(opts: ExportOptions): Promise<ExportResult> {
  const cwd = opts.cwd ?? process.cwd();
  if (!(EXPORT_TARGETS as readonly string[]).includes(opts.format)) {
    throw new GraphError(
      `Unknown export target "${opts.format}". Use ${EXPORT_TARGETS.join(" | ")}.`,
    );
  }
  if (opts.evals !== undefined && opts.format !== "chunks") {
    throw new GraphError("--evals applies only to graph export chunks.");
  }
  // Only chunks and llms read the pages, so only they can leave author-facing content out.
  if (opts.authoring === false && opts.format !== "chunks" && opts.format !== "llms") {
    throw new GraphError(NO_AUTHORING_EXPORT);
  }

  const config = loadRunConfig(
    {
      ...(opts.config === undefined ? {} : { configPath: opts.config }),
      ...(opts.noConfig === undefined ? {} : { noConfig: opts.noConfig }),
    },
    cwd,
  );
  const authoring = opts.authoring ?? config.authoring;
  if (!authoring && opts.evals !== undefined) throw new GraphError(EVALS_ARE_AUTHOR_FACING);
  const graphPath = resolve(cwd, opts.graph ?? config.out);
  // A page's `graph:path` is read from where a bare `build` labels it from:
  // the config's directory when it declares collections, else the working one.
  const sources = documentBase(config, {}, cwd);

  if (opts.format === "jsonld") return runJsonLd(cwd, graphPath, opts.out);
  if (opts.format === "chunks") {
    const configured = config.export.chunks.evals;
    const evals =
      opts.evals !== undefined
        ? { label: opts.evals, path: resolve(cwd, opts.evals) }
        : configured === null
          ? undefined
          : { label: configured, path: resolve(config.configDir, configured) };
    const result = await exportChunks({
      cwd,
      config,
      source: {
        ...(opts.config === undefined ? {} : { configPath: opts.config }),
        ...(opts.noConfig === undefined ? {} : { noConfig: opts.noConfig }),
      },
      graphPath,
      // `--out` names the directory, as for `search`: there is more than one file.
      outDir: opts.out ? resolve(cwd, opts.out) : dirname(graphPath),
      ...(evals === undefined ? {} : { evals }),
      authoring,
    });
    return {
      outPath: result.manifestPath,
      format: "chunks",
      nodes: result.rows,
      warnings: result.warnings,
      notices: result.notices,
      files: result.files,
      withheld: result.withheld,
    };
  }
  if (opts.format === "llms") {
    const outPath = opts.out ? resolve(cwd, opts.out) : defaultLlmsPath(graphPath);
    const { pages, warnings } = await exportLlms({
      cwd,
      config,
      source: {
        ...(opts.config === undefined ? {} : { configPath: opts.config }),
        ...(opts.noConfig === undefined ? {} : { noConfig: opts.noConfig }),
      },
      graphPath,
      outPath,
      authoring,
    });
    return { outPath, format: "llms", nodes: pages, warnings, files: [outPath] };
  }
  if (opts.format === "search") {
    return runSearchIndex(cwd, sources, graphPath, opts.out, parseContexts(config, sources));
  }
  if (opts.format === "questions") {
    return runQuestions(
      cwd,
      sources,
      graphPath,
      config,
      {
        ...(opts.config === undefined ? {} : { configPath: opts.config }),
        ...(opts.noConfig === undefined ? {} : { noConfig: opts.noConfig }),
      },
      opts.out,
    );
  }
  return runIirds(
    cwd,
    sources,
    graphPath,
    config.export.iirds,
    config.baseIri,
    opts.out,
  );
}
