/**
 * `manni site annotate` (proposal 0095): join the chunk artifact
 * `manni graph publish` writes to the built site, and write the result into
 * each page as data. Each placed block gains `data-manni-*` attributes, and
 * each page gains one `#manni-provenance` JSON island. No mark, stylesheet or
 * script is written: a theme decides the look.
 *
 * Not a gate: the report is `0` whatever the pins say, and a run that cannot
 * read its inputs throws `SiteError` (exit 2).
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { formatOf } from "../../graph/core/analyze.js";
import { loadRunConfig } from "../../graph/core/config.js";
import { documentBase } from "../../graph/core/discover.js";
import type { ChunkRow, ChunksManifest } from "../../graph/runtime/chunks.js";
import { parseChunkRows, parseChunksManifest } from "../../graph/runtime/retrieve.js";
import { integrityOf, locateFrontmatter } from "../../meta/index.js";
import { errorMessage } from "../../shared/errors.js";
import { bodyLineOf } from "../../shared/pin.js";
import { notice, warn } from "../../shared/warn.js";
import { joinPage, renderedText, stampedFiles, stripStamps, type UnplacedReason } from "../core/annotate.js";
import { resolveAnnotateSite, type Layout } from "../core/detect.js";
import { SiteError } from "../errors.js";

export interface AnnotateOptions {
  cwd: string;
  /** The positional `[dir]`, relative to `cwd`. */
  dir?: string;
  configPath?: string;
  /** `--out`, relative to `cwd`. */
  out?: string;
  /** `--chunks`, relative to `cwd`. */
  chunks?: string;
}

export type AnnotateFormat = "pretty" | "json";
export const ANNOTATE_FORMATS: readonly AnnotateFormat[] = ["pretty", "json"];

/** One line under the success line, in page order. */
export type AnnotateNote =
  | { kind: "pin" | "statement"; page: string; ids: string[]; reason: UnplacedReason | "no-page"; expected?: string }
  | { kind: "drifted"; page: string; ids: string[]; blocks: number };

export interface AnnotateReport {
  /** The built site, relative to the working directory. */
  out: string;
  /** Pages that gained an island. */
  pages: number;
  pins: { total: number; placed: number };
  statements: { total: number; placed: number };
  /** Blocks and headings carrying a statement's verification. */
  verified: number;
  notes: AnnotateNote[];
}

const slash = (path: string): string => path.split("\\").join("/");

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function htmlFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".html"))
    .map((e) => join(e.parentPath, e.name))
    .sort();
}

/** Where a page's built HTML is by the framework's convention, or `undefined` outside its content. */
function routeOf(layout: Layout, siteDir: string, page: string): string | undefined {
  const rel = slash(relative(resolve(siteDir, layout.content), page));
  if (rel.startsWith("../") || rel === "..") return undefined;
  const parts = rel.slice(0, rel.length - extname(rel).length).split("/");
  const index = parts.at(-1) === "index";
  if (index) parts.pop();
  const path = parts.join("/");
  const file = path === "" ? "index.html" : layout.route === "dir" || index ? `${path}/index.html` : `${path}.html`;
  return `${layout.prefix ?? ""}${file}`;
}

/** The chunk artifact, held to the graph it was built from. */
function readArtifact(path: string, label: string, shown: (p: string) => string): { manifest: ChunksManifest; rows: ChunkRow[] } {
  if (!existsSync(path)) throw new SiteError(`${label} does not exist; run manni graph publish.`);
  let manifest: ChunksManifest;
  try {
    manifest = parseChunksManifest(readFileSync(path, "utf8"));
  } catch {
    throw new SiteError(`${label} is not a chunk manifest; run manni graph publish.`);
  }
  const stale = new SiteError(`${label} was built from another graph; run manni graph publish.`);
  const graphFile = resolve(dirname(path), manifest.graphFile);
  if (existsSync(graphFile) && integrityOf(readFileSync(graphFile)) !== manifest.graph) throw stale;
  const rows: ChunkRow[] = [];
  for (const language of Object.values(manifest.languages)) {
    const file = resolve(dirname(path), language.file);
    if (!existsSync(file)) throw new SiteError(`${shown(file)} does not exist; run manni graph publish.`);
    try {
      rows.push(...parseChunkRows(readFileSync(file, "utf8")));
    } catch (e) {
      throw new SiteError(`${shown(file)}: ${errorMessage(e)} Run manni graph publish.`);
    }
  }
  if (rows.some((r) => r.graph !== manifest.graph)) throw stale;
  return { manifest, rows };
}

/** The body lines of a page source, rendered, for the text step. */
function claimTexts(page: string): { bodyLine: number; text: (start: number, end: number) => string } {
  let content: string;
  try {
    content = readFileSync(page, "utf8");
  } catch {
    return { bodyLine: 1, text: () => "" };
  }
  const format = formatOf(page);
  const bodyLine = format === "html" || format === "xml" ? 1 : bodyLineOf(content, locateFrontmatter(content)?.closeEnd ?? 0);
  const lines = content.split(/\r?\n/);
  return { bodyLine, text: (start, end) => renderedText(lines.slice(start + bodyLine - 2, end + bodyLine - 1)) };
}

export function runAnnotate(opts: AnnotateOptions): AnnotateReport {
  const { cwd } = opts;
  const shown = (path: string): string => slash(relative(cwd, path)) || ".";
  const site = resolveAnnotateSite(opts);
  const configured = site.config.out;
  const out =
    opts.out !== undefined
      ? resolve(cwd, opts.out)
      : resolve(site.dir, configured ?? site.layout?.out ?? ".");
  const outLabel = shown(out);
  if (!isDirectory(out)) {
    const server = site.framework === "Nextra" || site.framework === "Fumadocs";
    if (server && opts.out === undefined && configured === undefined) {
      throw new SiteError(
        `${outLabel} does not exist. ${site.framework ?? ""} writes static pages only with output: "export" in next.config.`,
      );
    }
    throw new SiteError(`no built site at ${outLabel}. Run manni site build first, or pass --out.`);
  }

  let graph;
  try {
    graph = loadRunConfig(opts.configPath === undefined ? {} : { configPath: opts.configPath }, cwd);
  } catch (e) {
    throw new SiteError(errorMessage(e));
  }
  const chunks = opts.chunks !== undefined ? resolve(cwd, opts.chunks) : join(dirname(resolve(cwd, graph.out)), "chunks.json");
  const label = shown(chunks);
  const { manifest, rows } = readArtifact(chunks, label, shown);

  notice(`${site.framework === null ? "" : `${site.framework} in ${site.where}. `}Annotating ${outLabel} from ${label}.`);
  if (manifest.commit === null) notice(`${basename(chunks)} carries no commit, so pages get no data-manni-commit.`);

  // Each built page, and the source files its stamps name.
  const files = htmlFiles(out);
  const stampedBy = new Map<string, string[]>();
  for (const file of files) {
    for (const source of stampedFiles(readFileSync(file, "utf8"))) {
      const abs = resolve(site.dir, source);
      stampedBy.set(abs, [...(stampedBy.get(abs) ?? []), file]);
    }
  }
  if (stampedBy.size === 0 && site.layout?.unified === true) {
    warn(
      `${outLabel} carries no line stamps, so blocks are placed by text alone. Add @hawkeyexl/manni/site/rehype to the framework's rehype plugins.`,
    );
  }

  const byPage = new Map<string, ChunkRow[]>();
  for (const row of rows) byPage.set(row.page, [...(byPage.get(row.page) ?? []), row]);
  const base = documentBase(graph, {}, cwd);
  const report: AnnotateReport = {
    out: outLabel,
    pages: 0,
    pins: { total: 0, placed: 0 },
    statements: { total: 0, placed: 0 },
    verified: 0,
    notes: [],
  };
  const joined = new Set<string>();

  for (const page of [...byPage.keys()].sort()) {
    const pageRows = byPage.get(page) ?? [];
    const source = resolve(base, page);
    const route = site.layout === null ? undefined : routeOf(site.layout, site.dir, source);
    const routed = route === undefined ? undefined : join(out, route);
    const stamped = stampedBy.get(source) ?? [];
    const html =
      stamped.length === 1
        ? stamped[0]
        : stamped.length > 1
          ? (stamped.find((f) => f === routed) ?? stamped[0])
          : routed !== undefined && existsSync(routed)
            ? routed
            : undefined;
    const texts = claimTexts(source);
    const result = joinPage({
      html: html === undefined ? "" : readFileSync(html, "utf8"),
      file: source,
      stampBase: site.dir,
      bodyLine: texts.bodyLine,
      claimText: texts.text,
      rows: pageRows,
      commit: manifest.commit,
    });
    report.pins.total += result.pins.total;
    report.statements.total += result.statements.total;
    if (html === undefined) {
      const expected = routed === undefined ? undefined : shown(routed);
      const all = result.unplaced;
      const ids = (kind: "pin" | "statement"): string[] => all.filter((u) => u.kind === kind).flatMap((u) => u.ids);
      for (const kind of ["pin", "statement"] as const) {
        if (ids(kind).length > 0) report.notes.push({ kind, page, ids: ids(kind), reason: "no-page", ...(expected === undefined ? {} : { expected }) });
      }
      continue;
    }
    if (joined.has(html)) continue;
    joined.add(html);
    writeFileSync(html, result.html, "utf8");
    const at = slash(relative(out, html));
    report.pages += 1;
    report.pins.placed += result.pins.placed;
    report.statements.placed += result.statements.placed;
    report.verified += result.verified;
    if (result.drifted.blocks > 0) report.notes.push({ kind: "drifted", page: at, ids: result.drifted.ids, blocks: result.drifted.blocks });
    for (const u of result.unplaced) report.notes.push({ kind: u.kind, page: at, ids: u.ids, reason: u.reason });
  }

  // A page no record names still loses its stamps.
  for (const file of files) {
    if (joined.has(file)) continue;
    const text = readFileSync(file, "utf8");
    const clean = stripStamps(text);
    if (clean !== text) writeFileSync(file, clean, "utf8");
  }
  return report;
}

const plural = (n: number, one: string, many: string): string => `${String(n)} ${n === 1 ? one : many}`;

export function renderAnnotate(report: AnnotateReport, format: AnnotateFormat): string {
  if (format === "json") {
    const unplaced = report.notes.flatMap((n) =>
      n.kind === "drifted" ? [] : [{ page: n.page, kind: n.kind, ids: n.ids, reason: n.reason }],
    );
    const drifted = report.notes.flatMap((n) => (n.kind === "drifted" ? [{ page: n.page, ids: n.ids }] : []));
    return JSON.stringify(
      { out: report.out, pages: report.pages, pins: report.pins, statements: report.statements, unplaced, drifted },
      null,
      2,
    );
  }
  const { pins } = report;
  const lines = [
    `${report.out}: ${plural(report.pages, "page", "pages")} annotated. ` +
      `${String(pins.placed)} of ${String(pins.total)} pins placed, ${String(pins.total - pins.placed)} listed on their page only. ` +
      `${plural(report.verified, "block carries", "blocks carry")} a verification.`,
  ];
  let lastMissing = "";
  for (const n of report.notes) {
    const ids = n.ids.join(", ");
    const its = n.ids.length === 1 ? "its" : "their";
    if (n.kind === "drifted") {
      lines.push(`  ${n.page}: ${plural(n.blocks, "block", "blocks")} drifted, because a source changed: ${ids}.`);
    } else if (n.reason === "no-page") {
      // One line per page, though its pins and its statements are two entries.
      if (n.page === lastMissing) continue;
      lastMissing = n.page;
      lines.push(`  ${n.page}: no built page ${n.expected === undefined ? `in ${report.out}` : `at ${n.expected}`}.`);
    } else if (n.kind === "statement") {
      lines.push(`  ${n.page}: ${plural(n.ids.length, "statement", "statements")} not placed, because no block holds lines ${ids}.`);
    } else {
      const why = n.reason === "repeated-text" ? `${its} text appears twice` : `no block holds ${its} text`;
      lines.push(`  ${n.page}: ${plural(n.ids.length, "pin", "pins")} not placed, because ${why}: ${ids}.`);
    }
  }
  return lines.join("\n");
}
