/**
 * `manni a11y check`, the command core.
 *
 * Validates the seeds, finds the sitemap, runs the crawl, drops the findings
 * below the severity floor, scores each page and totals the summary. No CLI
 * and no IO of its own beyond the injected analyzer and fetcher, so it can be
 * tested end to end with neither a browser nor a network.
 */
import type { PageAnalyzer } from "../core/analyzer.js";
import { crawl, type CrawlOutcome } from "../core/crawl.js";
import { createExcludeFilter, type ExcludeGlob } from "../core/exclude.js";
import { NO_SEEDS_MESSAGE } from "../core/seeds.js";
import { discoverSitemap, type Fetcher, type SitemapDiscovery } from "../core/sitemap.js";
import { isHttpUrl, normalizeUrl } from "../core/url.js";
import {
  A11yError,
  meetsSeverity,
  type CheckRun,
  type CheckSummary,
  type Severity,
  type PageResult,
  type ProgressListener,
} from "../types.js";

export interface CheckOptions {
  /** Seeds as typed (validated and normalized here). */
  urls: string[];
  /** Follow the sitemap and same-host links. Default `true`. */
  crawl: boolean;
  /** Stop after this many pages. Absent means no cap: every discovered page is checked. */
  maxPages?: number;
  /** axe tags to restrict to; empty is axe's default rule set. Default `[]`. */
  tags: string[];
  /** Minimum family severity reported and counted. Default `"notice"`, everything. */
  severity: Severity;
  /** Per-page navigation timeout in ms. Default `30000`. */
  timeout: number;
  /**
   * Globs matched against a URL's path; a match keeps the page out of the
   * crawl. Default `[]`, which excludes nothing. A pattern that excludes a
   * seed is an error, since the seed and the pattern are both the caller's
   * statement and a contradiction is not this command's to resolve. Each
   * pattern carries the name the refusal gives it, so the message points at
   * the flag or the config key the pattern actually came from.
   */
  exclude: ExcludeGlob[];
}

export interface CheckDeps {
  analyzer: PageAnalyzer;
  /** Defaults to global `fetch`. */
  fetcher?: Fetcher;
  /**
   * Told about each step as it happens: `sitemap` once discovery is done
   * (only when crawling), then everything the crawl reports. Absent means
   * silent.
   */
  onProgress?: ProgressListener;
}

/**
 * `maxPages` is deliberately absent: the default is no cap. A capped crawl
 * reports a partial site as checked, so the cap is opt-in, through
 * `--max-pages` or the config key.
 */
export const CHECK_DEFAULTS: Readonly<Omit<CheckOptions, "urls">> = Object.freeze({
  crawl: true,
  tags: [],
  severity: "notice",
  timeout: 30000,
  exclude: [],
});

/**
 * 1. `urls.length === 0` → A11yError(NO_SEEDS_MESSAGE). The CLI resolves its
 *    seeds with `resolveSeeds` and never arrives here empty; a programmatic
 *    caller that passed none hears the same thing.
 * 2. Any non-http(s) url → A11yError(`Not an http(s) URL: "<url>".`)
 * 3. Any seed an `exclude` pattern matches → A11yError naming **every** such
 *    seed, one per line, each under the pattern's own `source`. A user who
 *    typed two wrong patterns should not need one run per fix, and nothing is
 *    checked either way.
 * 4. When `crawl`: `discoverSitemap(firstSeed)` (one sitemap per run, the first seed's origin).
 * 5. `crawl(...)`, then per page: drop violations below `severity`, compute `score`.
 * 6. Build `CheckSummary`. Always awaits `analyzer.close()` in `finally`.
 */
export async function runCheck(opts: CheckOptions, deps: CheckDeps): Promise<CheckRun> {
  const { analyzer } = deps;
  try {
    if (opts.urls.length === 0) {
      throw new A11yError(NO_SEEDS_MESSAGE);
    }
    for (const url of opts.urls) {
      if (!isHttpUrl(url)) throw new A11yError(`Not an http(s) URL: "${url}".`);
    }
    const seeds = opts.urls.map(normalizeUrl);

    const exclude = createExcludeFilter(opts.exclude);
    const contradictions = seeds
      .map((seed) => {
        const pattern = exclude.match(seed);
        return pattern === null ? null : `${pattern.source} excludes the seed ${seed}.`;
      })
      .filter((line): line is string => line !== null);
    if (contradictions.length > 0) throw new A11yError(contradictions.join("\n"));

    let sitemap: SitemapDiscovery = { source: null, urls: [] };
    const first = seeds[0];
    if (opts.crawl && first !== undefined) {
      sitemap = await discoverSitemap(first, deps.fetcher);
      deps.onProgress?.({ kind: "sitemap", source: sitemap.source, urls: sitemap.urls.length });
    }

    const outcome = await crawl(
      {
        seeds,
        crawl: opts.crawl,
        maxPages: opts.maxPages,
        extra: sitemap.urls,
        exclude,
        analyze: { tags: opts.tags, timeout: opts.timeout },
        onProgress: deps.onProgress,
      },
      analyzer,
    );

    const results = outcome.pages.map((page) => finishPage(page, opts.severity));
    return {
      results,
      summary: summarize(results, outcome, sitemap, opts.crawl),
    };
  } finally {
    await analyzer.close();
  }
}

/** Apply the severity floor, then score what is left. */
function finishPage(page: Omit<PageResult, "score">, floor: Severity): PageResult {
  if (page.error !== undefined) return { ...page, violations: [], score: null };
  const violations = page.violations.filter((v) => meetsSeverity(v.severity, floor));
  const applicable = page.passes + violations.length;
  const score = applicable === 0 ? null : Math.round((100 * page.passes) / applicable);
  return { ...page, violations, score };
}

/**
 * Does this page fail the run?
 *
 * The level is not read here, and that is the decision rather than an
 * oversight. `--severity` is the floor, and the floor is the gate: anything
 * `finishPage` kept fails the page, whatever its level. `manni meta validate`
 * and `manni cite check` fail on error-severity findings alone, because a
 * user decides there what becomes an error, through the schema or through
 * `cite.severity.<rule>`. axe assigns a11y's severities and nothing in the
 * config moves one, so the floor is the only lever this domain's shape
 * allows. Proposal 0064 records why, and supersedes the one paragraph of
 * 0035 that described the two as separable.
 */
function fails(page: PageResult): boolean {
  return page.error !== undefined || page.violations.length > 0;
}

function summarize(
  results: PageResult[],
  { discovered, skipped, duplicates, excluded }: CrawlOutcome,
  sitemap: SitemapDiscovery,
  crawl: boolean,
): CheckSummary {
  // Spelled out so the compiler, not a test, says when the family scale moves.
  const bySeverity: Record<Severity, number> = { notice: 0, warning: 0, error: 0 };
  let failed = 0;
  let violations = 0;
  for (const page of results) {
    if (fails(page)) failed += 1;
    for (const violation of page.violations) {
      violations += 1;
      bySeverity[violation.severity] += 1;
    }
  }
  return {
    discovered,
    checked: results.length,
    skipped,
    duplicates,
    excluded,
    failed,
    violations,
    bySeverity,
    sitemap: sitemap.source,
    // The count the progress line already reported as `(N pages)`, so the
    // report cannot disagree with the narration that preceded it.
    sitemapPages: sitemap.urls.length,
    crawl,
  };
}
