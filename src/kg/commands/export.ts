/**
 * `manni kg export` — reserialize the built graph into a consumer format. Reads
 * the graph the same way `stats`/`check` do (loadGraph over the config `out`,
 * missing graph → exit 2) and writes a deterministic rendering. `jsonld` emits a
 * whole-graph JSON-LD file; `iirds` projects the graph into a conformant,
 * deterministic unrestricted iiRDS package (`.iirds` ZIP) — see ADR 01017.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DockgError } from "../types.js";
import { loadConfig } from "../core/config.js";
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
import { GraphIndex } from "../runtime/graph.js";
import { writeZip, type ZipEntry } from "../core/zip.js";

export type ExportFormat = "jsonld" | "iirds" | "search";

export interface ExportOptions {
  config?: string;
  /** Graph .ttl path (default: config `out`). */
  graph?: string;
  format: ExportFormat;
  /** Output path (default: the graph path with the format's extension). */
  out?: string;
  cwd?: string;
}

export interface ExportResult {
  outPath: string;
  format: ExportFormat;
  /** Distinct subject nodes in the emitted (or projected) graph. */
  nodes: number;
  /** Non-fatal projection warnings (iiRDS only; empty otherwise). */
  warnings: string[];
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
  return { outPath, format: "jsonld", nodes, warnings: [] };
}

function runIirds(
  cwd: string,
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
    cwd,
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
  return { outPath, format: "iirds", nodes, warnings: projection.warnings };
}

/**
 * The same digest `manni kg embed` records as a sidecar's `source` and the runtime
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
function runSearchIndex(
  cwd: string,
  graphPath: string,
  out?: string,
): ExportResult {
  const store = loadGraph(graphPath);
  const graph = GraphIndex.fromQuads(
    storeToQuads(store),
    Object.fromEntries(PREFIXES),
  );
  const warnings: string[] = [];
  const index = buildSearchIndex(graph, cwd, { warnings });
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
      throw new DockgError(
        `Cannot write an index for language "${language}": not a BCP-47 tag. ` +
          `Fix the \`lang\`/\`language\` frontmatter, or the route's \`language\`, ` +
          `and rebuild — \`manni kg check\` reports which document carries it.`,
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
  };
}

const FORMATS: ExportFormat[] = ["jsonld", "iirds", "search"];

export async function runExport(opts: ExportOptions): Promise<ExportResult> {
  const cwd = opts.cwd ?? process.cwd();
  if (!FORMATS.includes(opts.format)) {
    throw new DockgError(
      `Unknown export format: ${opts.format} (expected: ${FORMATS.join(" | ")}).`,
    );
  }

  const config = loadConfig(opts.config, cwd);
  const graphPath = resolve(cwd, opts.graph ?? config.out);

  if (opts.format === "jsonld") return runJsonLd(cwd, graphPath, opts.out);
  if (opts.format === "search") {
    return runSearchIndex(cwd, graphPath, opts.out);
  }
  return runIirds(
    cwd,
    graphPath,
    config.export.iirds,
    config.baseIri,
    opts.out,
  );
}
