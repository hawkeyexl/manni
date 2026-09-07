/**
 * The crawl: which pages a run visits, and in what order.
 *
 * A breadth-first walk over a FIFO frontier. Seeds go in first, then the
 * sitemap's pages, then every same-host link each visited page lists, in the
 * order it listed them. A page enters the frontier once, under its `dedupeKey`
 * (so `/a` and `/a/` are one page), keeping the spelling that arrived first.
 * Pages run one at a time so a site sees one request at a time.
 */
import type { AnalyzeOptions, PageAnalyzer } from "./analyzer.js";
import type { PageResult, ProgressListener } from "../types.js";
import { dedupeKey, isPageLink, normalizeUrl, sameHost } from "./url.js";

export interface CrawlOptions {
  /** Normalized http(s) seeds; each seed's host is in scope. */
  seeds: string[];
  /** `false` = check exactly `seeds`. */
  crawl: boolean;
  /** Hard cap on pages analyzed. Absent means no cap: the whole frontier is analyzed. */
  maxPages?: number;
  /** Extra URLs to enqueue right after the seeds (from the sitemap). */
  extra: string[];
  analyze: AnalyzeOptions;
  /** Told about each step as it happens. Absent means silent. */
  onProgress?: ProgressListener;
}

export interface CrawlOutcome {
  /** In visit order. `source` is "seed", "sitemap" (came from `extra`) or "link". */
  pages: Omit<PageResult, "score">[];
  /** Distinct pages (by `dedupeKey`) that entered the frontier. */
  discovered: number;
  /** Left in the frontier when `maxPages` stopped the run; `0` without a cap. */
  skipped: number;
  /**
   * Dequeued and dropped unloaded, because the browser had already landed on
   * that page under another spelling. `checked + skipped + duplicates` is
   * `discovered`.
   */
  duplicates: number;
}

type Source = PageResult["source"];

interface Candidate {
  url: string;
  key: string;
  source: Source;
}

/**
 * BFS over a FIFO frontier: seeds, then `extra`, then links in the order each
 * page listed them. Every candidate goes through `normalizeUrl`, and is
 * enqueued once per `dedupeKey` (so a trailing slash does not make a second
 * page), only when `isPageLink` and `sameHost` with **any** seed. The first
 * spelling seen is the one fetched and reported. Pages run sequentially.
 * - A seed that fails to analyze rethrows (nothing was checked: exit 2).
 * - Any other page's failure is recorded as `error` and the crawl continues.
 * - A page's `finalUrl` (where the browser landed) counts as visited, so a
 *   queued spelling of it is dropped at dequeue time (`duplicates`), and a
 *   link to it seen afterwards is never queued.
 * - With `maxPages` set, stops when `pages.length === maxPages`; `skipped` =
 *   frontier left behind. Without it, runs the frontier dry and `skipped` is 0.
 * - With `crawl: false`, `extra` is ignored and no links are followed.
 * - `onProgress` hears `browser` once before the first analyze (that is where
 *   the lazy launch happens), `page` before each analyze, `checked` after
 *   each, and `done` at the end. A failing seed rethrows before `checked`.
 */
export async function crawl(opts: CrawlOptions, analyzer: PageAnalyzer): Promise<CrawlOutcome> {
  const frontier: Candidate[] = [];
  /** Keys that entered the frontier, or that the browser landed on. */
  const seen = new Set<string>();
  /** Keys analyzed, or that the browser landed on. */
  const visited = new Set<string>();
  const progress = opts.onProgress ?? (() => undefined);

  const enqueue = (raw: string, source: Source): void => {
    let url: string;
    let key: string;
    try {
      url = normalizeUrl(raw);
      key = dedupeKey(url);
    } catch {
      return;
    }
    // A seed is what the user asked for, so it is never filtered as an asset;
    // it still has to be on its own host, which it is by definition.
    if (source !== "seed" && !isPageLink(url)) return;
    if (!opts.seeds.some((seed) => sameHost(seed, url))) return;
    if (seen.has(key)) return;
    seen.add(key);
    frontier.push({ url, key, source });
  };

  /** Where the browser landed is a page the run has now checked, whatever it was asked for. */
  const landed = (finalUrl: string | undefined): void => {
    if (finalUrl === undefined) return;
    try {
      const key = dedupeKey(finalUrl);
      seen.add(key);
      visited.add(key);
    } catch {
      // Not a URL the crawl could ever queue, so nothing to mark.
    }
  };

  for (const seed of opts.seeds) enqueue(seed, "seed");
  if (opts.crawl) for (const url of opts.extra) enqueue(url, "sitemap");

  const pages: CrawlOutcome["pages"] = [];
  let duplicates = 0;
  const capped = (): boolean => opts.maxPages !== undefined && pages.length >= opts.maxPages;
  for (let next = 0; next < frontier.length && !capped(); next++) {
    const candidate = frontier[next];
    if (candidate === undefined) break;
    const { url, key, source } = candidate;
    if (visited.has(key)) {
      duplicates += 1;
      continue;
    }
    visited.add(key);
    const index = pages.length + 1;
    if (index === 1) progress({ kind: "browser" });
    progress({ kind: "page", index, queued: frontier.length, url });
    try {
      const analyzed = await analyzer.analyze(url, opts.analyze);
      pages.push({ ...analyzed.result, url, source });
      landed(analyzed.finalUrl);
      if (opts.crawl) for (const link of analyzed.links) enqueue(link, "link");
      progress({ kind: "checked", index, url, violations: analyzed.result.violations.length });
    } catch (err) {
      if (source === "seed") throw err;
      const error = err instanceof Error ? err.message : String(err);
      pages.push({ url, source, violations: [], passes: 0, incomplete: 0, error });
      progress({ kind: "checked", index, url, violations: 0, error });
    }
  }

  const skipped = frontier.length - pages.length - duplicates;
  progress({ kind: "done", checked: pages.length, skipped });
  return { pages, discovered: frontier.length, skipped, duplicates };
}
