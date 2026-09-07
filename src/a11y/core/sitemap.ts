/**
 * Sitemap discovery: the page list a site publishes for itself.
 *
 * A sitemap reaches pages no link points at, so the crawl reads it first and
 * follows links second. Nothing here is allowed to fail the run: a site with
 * no sitemap, a broken one, or one behind a firewall is a site to crawl by
 * links alone, and the outcome says so with `source: null`.
 */
import { DOMParser } from "@xmldom/xmldom";
import { isHttpUrl, isPageLink, normalizeUrl, sameHost } from "./url.js";

/** `fetch` narrowed to what this module needs, so tests inject a fake. */
export type Fetcher = (
  url: string,
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface SitemapDiscovery {
  /** The sitemap (or sitemap index) URL that was read, `null` when none was usable. */
  source: string | null;
  /** Same-host page URLs from every `<loc>`, normalized and deduped, in document order. */
  urls: string[];
}

export interface ParsedSitemap {
  kind: "index" | "urlset";
  locs: string[];
}

/** How many levels of `<sitemapindex>` nesting are followed below the first. */
const MAX_INDEX_DEPTH = 3;
/** How many child sitemaps one discovery reads, across every index it meets. */
const MAX_CHILD_SITEMAPS = 50;
/** A robots.txt or sitemap that has not answered in this long is "no sitemap". */
const FETCH_TIMEOUT_MS = 10_000;

const defaultFetcher: Fetcher = (url) =>
  fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });

/**
 * The file names tried in each directory of the seed's path, in this order.
 * `sitemap.xml` is the convention; `sitemap-index.xml` is what Astro (and so
 * Starlight) emits; `sitemap_index.xml` is Yoast's and Hugo's spelling.
 */
const WELL_KNOWN_SITEMAP_FILES = ["sitemap.xml", "sitemap-index.xml", "sitemap_index.xml"];

/**
 * Candidates, in order:
 * 1. GET `<origin>/robots.txt`; every `Sitemap:` line (case-insensitive key,
 *    absolute URL) is a candidate, in order.
 * 2. Then, for each directory of the seed's path from the seed's own
 *    directory up to `/`, nearest first (`https://h/manni/meta/fix/` walks
 *    `/manni/meta/fix/`, `/manni/meta/`, `/manni/`, `/`; a seed that names a
 *    file, `https://h/manni/page.html`, starts at `/manni/`), the files
 *    `sitemap.xml`, `sitemap-index.xml`, `sitemap_index.xml`, in that order
 *    within each directory. A project site under a path prefix (GitHub Pages)
 *    cannot write to the origin's `/robots.txt` or `/sitemap.xml`, which is
 *    why the walk starts at the seed and not at the root.
 * Candidates are deduped, keeping the first position of each.
 *
 * Then parse the first candidate that returns 2xx with `@xmldom/xmldom`
 * (`DOMParser`, errors swallowed); a 2xx body that is not a sitemap is skipped
 * and the next candidate tried. A `<sitemapindex>` recurses into each child
 * `<sitemap><loc>` (depth ≤ 3, ≤ 50 child sitemaps). A `<urlset>` yields its
 * `<url><loc>` values. Keep only `sameHost(seed, loc) && isPageLink(loc)`.
 * `source` is the candidate that was actually used.
 *
 * A network error, non-2xx, or unparseable body means "no sitemap here" —
 * never an error, and never a page failure. `.xml.gz` bodies are not
 * decompressed (deferred).
 */
export async function discoverSitemap(
  seed: string,
  fetcher: Fetcher = defaultFetcher,
): Promise<SitemapDiscovery> {
  const origin = new URL(seed).origin;
  const candidates = await robotsSitemaps(`${origin}/robots.txt`, fetcher);
  for (const candidate of wellKnownCandidates(seed)) {
    if (!candidates.includes(candidate)) candidates.push(candidate);
  }

  for (const candidate of candidates) {
    const parsed = await fetchSitemap(candidate, fetcher);
    if (parsed === null) continue;
    const walk: Walk = { fetcher, seen: new Set([candidate]), childBudget: MAX_CHILD_SITEMAPS };
    const locs = await expand(parsed, 0, walk);
    return { source: candidate, urls: pageUrls(seed, locs) };
  }
  return { source: null, urls: [] };
}

/** Pure parser, exported for tests: returns `{ kind: "index" | "urlset", locs: string[] }` or `null`. */
export function parseSitemapXml(text: string): ParsedSitemap | null {
  if (text.trim() === "") return null;
  let root: XmlNode | null;
  try {
    // Every parse problem is routed to `onError` and ignored; what matters is
    // whether a sitemap root came out the other side.
    const doc = new DOMParser({ onError: () => undefined }).parseFromString(text, "text/xml");
    root = doc.documentElement;
  } catch {
    return null;
  }
  if (root === null) return null;
  const kind = root.localName;
  if (kind !== "sitemapindex" && kind !== "urlset") return null;
  const entry = kind === "sitemapindex" ? "sitemap" : "url";
  const locs: string[] = [];
  for (const child of childElements(root, entry)) {
    for (const loc of childElements(child, "loc")) {
      const value = (loc.textContent ?? "").trim();
      if (value !== "") locs.push(value);
    }
  }
  return { kind: kind === "sitemapindex" ? "index" : "urlset", locs };
}

type XmlDocument = ReturnType<DOMParser["parseFromString"]>;
/**
 * xmldom's `Node`, reached through the parser's own types rather than an
 * import so the alias tracks whatever the installed version declares. It is
 * enough here: `localName`, `textContent` and the sibling walk are all on
 * `Node`, and `documentElement` narrows to it.
 */
type XmlNode = NonNullable<XmlDocument["firstChild"]>;

/** Element children of `node` whose local name is `name`, in document order. */
function childElements(node: XmlNode, name: string): XmlNode[] {
  const out: XmlNode[] = [];
  for (let n = node.firstChild; n !== null; n = n.nextSibling) {
    if (n.nodeType === 1 && n.localName === name) out.push(n);
  }
  return out;
}

interface Walk {
  fetcher: Fetcher;
  /** Sitemap URLs already read, so an index that lists itself terminates. */
  seen: Set<string>;
  /** Child sitemaps still allowed; shared across the whole recursion. */
  childBudget: number;
}

async function expand(parsed: ParsedSitemap, depth: number, walk: Walk): Promise<string[]> {
  if (parsed.kind === "urlset") return parsed.locs;
  if (depth >= MAX_INDEX_DEPTH) return [];
  const out: string[] = [];
  for (const child of parsed.locs) {
    if (walk.childBudget <= 0) break;
    if (!isHttpUrl(child) || walk.seen.has(child)) continue;
    walk.seen.add(child);
    walk.childBudget -= 1;
    const nested = await fetchSitemap(child, walk.fetcher);
    if (nested === null) continue;
    out.push(...(await expand(nested, depth + 1, walk)));
  }
  return out;
}

/**
 * The well-known sitemap file names in every directory of the seed's path,
 * nearest directory first, root last. Query and fragment are dropped; the
 * directory of `/manni/page.html` is `/manni/`, of `/manni/` is itself.
 */
function wellKnownCandidates(seed: string): string[] {
  const url = new URL(seed);
  const directories = ancestorDirectories(url.pathname);
  return directories.flatMap((dir) =>
    WELL_KNOWN_SITEMAP_FILES.map((file) => `${url.origin}${dir}${file}`),
  );
}

/**
 * `/manni/meta/fix/` → `["/manni/meta/fix/", "/manni/meta/", "/manni/", "/"]`;
 * `/manni/page.html` → `["/manni/", "/"]`; `/` → `["/"]`.
 */
function ancestorDirectories(pathname: string): string[] {
  let dir = pathname.slice(0, pathname.lastIndexOf("/") + 1);
  const out: string[] = [];
  for (;;) {
    out.push(dir);
    if (dir === "/") return out;
    // Drop the trailing slash, then everything after the previous one.
    const parent = dir.slice(0, dir.lastIndexOf("/", dir.length - 2) + 1);
    dir = parent === "" ? "/" : parent;
  }
}

/** The `Sitemap:` candidates from a robots.txt, or none when it is missing. */
async function robotsSitemaps(url: string, fetcher: Fetcher): Promise<string[]> {
  const text = await fetchText(url, fetcher);
  if (text === null) return [];
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*sitemap\s*:\s*(\S+)/i.exec(line);
    const candidate = match?.[1];
    if (candidate !== undefined && isHttpUrl(candidate) && !out.includes(candidate)) {
      out.push(candidate);
    }
  }
  return out;
}

async function fetchSitemap(url: string, fetcher: Fetcher): Promise<ParsedSitemap | null> {
  const text = await fetchText(url, fetcher);
  return text === null ? null : parseSitemapXml(text);
}

/** The body of a 2xx response, or `null` for anything else, thrown included. */
async function fetchText(url: string, fetcher: Fetcher): Promise<string | null> {
  try {
    const response = await fetcher(url);
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

/** Filter, normalize and dedupe the `<loc>` values into crawlable page URLs. */
function pageUrls(seed: string, locs: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const loc of locs) {
    if (!isHttpUrl(loc) || !sameHost(seed, loc) || !isPageLink(loc)) continue;
    const url = normalizeUrl(loc);
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}
