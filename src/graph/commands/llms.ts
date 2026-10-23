/**
 * `manni graph export llms` (proposal 0090): `llms.txt` from the built graph.
 *
 * Each page's link and description come from the same place every other
 * output reads: its route, and its delivered fields (the 0090 delivery rule),
 * so the file never repeats a description by hand. Links take the detected
 * framework's URL style, and a page under no route is left out.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { loadSiteConfig } from "../../site/core/config.js";
import { detectFramework } from "../../site/core/detect.js";
import { analyzeDoc } from "../core/analyze.js";
import type { GraphConfig, RouteMapping } from "../core/config.js";
import { documentBase, routesFrom } from "../core/discover.js";
import { openMetaView, withExternalMetadata, type MetaViewSource } from "../core/external.js";
import { deliveredFields } from "../core/graph-output.js";
import { STDIN_PATH } from "../core/iri.js";
import { loadGraph, storeToQuads } from "../core/load.js";
import { canonicalLanguageTag, UNDETERMINED } from "../core/localizations.js";
import { byCodeUnit } from "../core/sort.js";
import { NS, PREFIXES } from "../core/vocab.js";
import { GraphIndex } from "../runtime/graph.js";
import { GraphError } from "../types.js";

/** The file's name, beside the graph or in `graph publish --out`. */
export const LLMS_FILENAME = "llms.txt";

/** How a framework spells a page's URL: `/a/b/`, `/a/b`, or `/a/b.html`. */
export type UrlStyle = "slash" | "bare" | "html";

const BARE = new Set(["Docusaurus", "Nextra", "Fumadocs", "Mintlify", "Fern"]);
const HTML = new Set(["VitePress", "Rspress", "Sphinx", "Jekyll"]);

/** The URL style of the framework `site` detects; routes end in `/` without one. */
export function urlStyle(framework: string | null): UrlStyle {
  if (framework !== null && BARE.has(framework)) return "bare";
  if (framework !== null && HTML.has(framework)) return "html";
  return "slash";
}

/**
 * A page's route under the nearest route whose `root` holds it, or
 * `undefined` when none does. `path` and each `root` are labelled from the
 * same base. An index file names its directory.
 */
export function routeOf(path: string, routes: readonly RouteMapping[], style: UrlStyle): string | undefined {
  const holders = routes.filter((r) => r.root === "" || path.startsWith(`${r.root}/`));
  const route = holders.sort((a, b) => b.root.length - a.root.length)[0];
  if (route === undefined) return undefined;
  const rest = (route.root === "" ? path : path.slice(route.root.length + 1)).replace(/\.[^./]+$/, "");
  const segments = rest.split("/");
  const last = segments[segments.length - 1] ?? "";
  const index = route.indexFiles.includes(last);
  const parts = [...route.basePath.split("/"), ...(index ? segments.slice(0, -1) : segments)].filter((s) => s !== "");
  const joined = `/${parts.join("/")}`;
  if (index || parts.length === 0) return style === "bare" ? joined : `${joined === "/" ? "" : joined}/`;
  if (style === "slash") return `${joined}/`;
  return style === "html" ? `${joined}.html` : joined;
}

/** One line of the file. */
export interface LlmsEntry {
  language: string;
  title: string;
  link: string;
  description?: string;
}

const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

/** The file: the H1, the summary, then `## Docs` or one section per language, each in the given order. */
export function renderLlms(head: { title: string; summary?: string }, entries: readonly LlmsEntry[]): string {
  const lines = [`# ${oneLine(head.title)}`, ""];
  if (head.summary !== undefined) lines.push(`> ${oneLine(head.summary)}`, "");
  const languages = [...new Set(entries.map((e) => e.language))].sort(byCodeUnit);
  for (const language of languages) {
    lines.push(`## ${languages.length > 1 ? language : "Docs"}`, "");
    for (const e of entries.filter((x) => x.language === language)) {
      const text = `[${oneLine(e.title).replace(/([[\]])/g, "\\$1")}](${e.link})`;
      lines.push(`- ${text}${e.description === undefined ? "" : `: ${oneLine(e.description)}`}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export interface LlmsOptions {
  cwd: string;
  config: GraphConfig;
  source: MetaViewSource;
  graphPath: string;
  outPath: string;
}

/** Writes `llms.txt`. Returns the pages it lists and its warnings. */
export async function exportLlms(opts: LlmsOptions): Promise<{ pages: number; warnings: string[] }> {
  const { cwd, config } = opts;
  const settings = config.export.llms;
  const title = settings?.title;
  const origin = settings?.origin;
  if (title === undefined) throw new GraphError("graph export llms needs graph.export.llms.title.");
  if (origin === undefined) {
    throw new GraphError("graph export llms needs graph.export.llms.origin, the site's scheme and host.");
  }

  const graph = GraphIndex.fromQuads(storeToQuads(loadGraph(opts.graphPath)), Object.fromEntries(PREFIXES));
  const sources = documentBase(config, {}, cwd);
  const pages: { doc: string; path: string; content: string }[] = [];
  let missing = 0;
  for (const doc of graph.instancesOf(`${NS.graph}Document`)) {
    const path = graph.literal(doc, `${NS.graph}path`);
    if (path === undefined || path === STDIN_PATH) continue;
    const abs = resolve(sources, path);
    if (existsSync(abs)) pages.push({ doc, path, content: readFileSync(abs, "utf8") });
    else missing += 1;
  }
  pages.sort((a, b) => byCodeUnit(a.path, b.path));

  const routes = routesFrom(config, sources);
  // The site is where `manni site` looks: `site.dir` when set, else the config's directory.
  const style = urlStyle(detectFramework(loadSiteConfig(config.configDir).dir ?? config.configDir));
  const paths = pages.map((p) => p.path);
  const view = await openMetaView(opts.source, cwd, paths, sources);
  const models = await withExternalMetadata(
    await Promise.all(pages.map((p) => analyzeDoc(p.content, p.path, new Set(paths), { routes }))),
    view,
  );

  const entries: LlmsEntry[] = [];
  let unrouted = 0;
  for (const [n, page] of pages.entries()) {
    const route = routeOf(page.path, routes, style);
    const model = models[n];
    if (route === undefined || model === undefined) {
      unrouted += 1;
      continue;
    }
    const metadata = await deliveredFields(model.frontmatter, view.refsFor(page.path, model.frontmatter), view.validator);
    const tag = graph.literal(page.doc, `${NS.dcterms}language`);
    const description = metadata.description;
    entries.push({
      language: tag === undefined ? UNDETERMINED : canonicalLanguageTag(tag),
      title:
        typeof metadata.title === "string" ? metadata.title : (graph.literal(page.doc, `${NS.dcterms}title`) ?? page.path),
      link: `${origin}${route}`,
      ...(typeof description === "string" ? { description } : {}),
    });
  }

  mkdirSync(dirname(opts.outPath), { recursive: true });
  writeFileSync(opts.outPath, renderLlms({ title, ...(settings?.summary === undefined ? {} : { summary: settings.summary }) }, entries), "utf8");
  const warnings: string[] = [];
  if (missing > 0) {
    warnings.push(
      missing === 1
        ? "1 page in the graph is not on disk, so llms.txt leaves it out; run manni graph build."
        : `${String(missing)} pages in the graph are not on disk, so llms.txt leaves them out; run manni graph build.`,
    );
  }
  if (unrouted > 0) {
    warnings.push(
      unrouted === 1
        ? "1 page is under no route, so llms.txt leaves it out."
        : `${String(unrouted)} pages are under no route, so llms.txt leaves them out.`,
    );
  }
  return { pages: entries.length, warnings };
}

/** Where `graph export llms` writes without `--out`: beside the graph. */
export function defaultLlmsPath(graphPath: string): string {
  return join(dirname(graphPath), LLMS_FILENAME);
}
