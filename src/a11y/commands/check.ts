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
  /** Stop after this many pages. Default `100`. */
  maxPages: number;
  /** axe tags to restrict to; empty is axe's default rule set. Default `[]`. */
  tags: string[];
  /** Minimum severity reported and counted. Default `"minor"`. */
  severity: Severity;
  /** Per-page navigation timeout in ms. Default `30000`. */
  timeout: number;
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

export const CHECK_DEFAULTS: Readonly<Omit<CheckOptions, "urls">> = Object.freeze({
  crawl: true,
  maxPages: 100,
  tags: [],
  severity: "minor",
  timeout: 30000,
});

/**
 * 1. `urls.length === 0` → A11yError("No URLs to check. Pass one or more, or set `a11y.urls` in manni.config.yaml.")
 * 2. Any non-http(s) url → A11yError(`Not an http(s) URL: "<url>".`)
 * 3. When `crawl`: `discoverSitemap(firstSeed)` (one sitemap per run, the first seed's origin).
 * 4. `crawl(...)`, then per page: drop violations below `severity`, compute `score`.
 * 5. Build `CheckSummary`. Always awaits `analyzer.close()` in `finally`.
 */
export async function runCheck(opts: CheckOptions, deps: CheckDeps): Promise<CheckRun> {
  const { analyzer } = deps;
  try {
    if (opts.urls.length === 0) {
      throw new A11yError(
        "No URLs to check. Pass one or more, or set `a11y.urls` in manni.config.yaml.",
      );
    }
    for (const url of opts.urls) {
      if (!isHttpUrl(url)) throw new A11yError(`Not an http(s) URL: "${url}".`);
    }
    const seeds = opts.urls.map(normalizeUrl);

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
        analyze: { tags: opts.tags, timeout: opts.timeout },
        onProgress: deps.onProgress,
      },
      analyzer,
    );

    const results = outcome.pages.map((page) => finishPage(page, opts.severity));
    return {
      results,
      summary: summarize(results, outcome, sitemap.source, opts.crawl),
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

function summarize(
  results: PageResult[],
  { discovered, skipped, duplicates }: CrawlOutcome,
  sitemap: string | null,
  crawl: boolean,
): CheckSummary {
  const bySeverity: Record<Severity, number> = { minor: 0, moderate: 0, serious: 0, critical: 0 };
  let failed = 0;
  let violations = 0;
  for (const page of results) {
    if (page.error !== undefined || page.violations.length > 0) failed += 1;
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
    failed,
    violations,
    bySeverity,
    sitemap,
    crawl,
  };
}
