/**
 * The crawl: which pages a run visits, and in what order.
 *
 * A breadth-first walk over a FIFO frontier. Seeds go in first, then the
 * sitemap's pages, then every same-host link each visited page lists, in the
 * order it listed them. A URL enters the frontier once, under its normalized
 * spelling, and pages run one at a time so a site sees one request at a time.
 */
import type { AnalyzeOptions, PageAnalyzer } from "./analyzer.js";
import type { PageResult, ProgressListener } from "../types.js";
import { isPageLink, normalizeUrl, sameHost } from "./url.js";

export interface CrawlOptions {
  /** Normalized http(s) seeds; each seed's host is in scope. */
  seeds: string[];
  /** `false` = check exactly `seeds`. */
  crawl: boolean;
  /** Hard cap on pages analyzed. */
  maxPages: number;
  /** Extra URLs to enqueue right after the seeds (from the sitemap). */
  extra: string[];
  analyze: AnalyzeOptions;
  /** Told about each step as it happens. Absent means silent. */
  onProgress?: ProgressListener;
}

export interface CrawlOutcome {
  /** In visit order. `source` is "seed", "sitemap" (came from `extra`) or "link". */
  pages: Omit<PageResult, "score">[];
  discovered: number;
  skipped: number;
}

type Source = PageResult["source"];

interface Candidate {
  url: string;
  source: Source;
}

/**
 * BFS over a FIFO frontier: seeds, then `extra`, then links in the order each
 * page listed them. Every candidate goes through `normalizeUrl`; a URL is
 * enqueued once (Set of normalized URLs), and only when `isPageLink` and
 * `sameHost` with **any** seed. Pages run sequentially.
 * - A seed that fails to analyze rethrows (nothing was checked: exit 2).
 * - Any other page's failure is recorded as `error` and the crawl continues.
 * - Stops when `pages.length === maxPages`; `skipped` = frontier left behind.
 * - With `crawl: false`, `extra` is ignored and no links are followed.
 * - `onProgress` hears `browser` once before the first analyze (that is where
 *   the lazy launch happens), `page` before each analyze, `checked` after
 *   each, and `done` at the end. A failing seed rethrows before `checked`.
 */
export async function crawl(opts: CrawlOptions, analyzer: PageAnalyzer): Promise<CrawlOutcome> {
  const frontier: Candidate[] = [];
  const seen = new Set<string>();
  const progress = opts.onProgress ?? (() => undefined);

  const enqueue = (raw: string, source: Source): void => {
    let url: string;
    try {
      url = normalizeUrl(raw);
    } catch {
      return;
    }
    // A seed is what the user asked for, so it is never filtered as an asset;
    // it still has to be on its own host, which it is by definition.
    if (source !== "seed" && !isPageLink(url)) return;
    if (!opts.seeds.some((seed) => sameHost(seed, url))) return;
    if (seen.has(url)) return;
    seen.add(url);
    frontier.push({ url, source });
  };

  for (const seed of opts.seeds) enqueue(seed, "seed");
  if (opts.crawl) for (const url of opts.extra) enqueue(url, "sitemap");

  const pages: CrawlOutcome["pages"] = [];
  for (let next = 0; next < frontier.length && pages.length < opts.maxPages; next++) {
    const candidate = frontier[next];
    if (candidate === undefined) break;
    const { url, source } = candidate;
    const index = pages.length + 1;
    if (index === 1) progress({ kind: "browser" });
    progress({ kind: "page", index, queued: seen.size, url });
    try {
      const analyzed = await analyzer.analyze(url, opts.analyze);
      pages.push({ ...analyzed.result, url, source });
      if (opts.crawl) for (const link of analyzed.links) enqueue(link, "link");
      progress({ kind: "checked", index, url, violations: analyzed.result.violations.length });
    } catch (err) {
      if (source === "seed") throw err;
      const error = err instanceof Error ? err.message : String(err);
      pages.push({ url, source, violations: [], passes: 0, incomplete: 0, error });
      progress({ kind: "checked", index, url, violations: 0, error });
    }
  }

  const skipped = seen.size - pages.length;
  progress({ kind: "done", checked: pages.length, skipped });
  return { pages, discovered: seen.size, skipped };
}
