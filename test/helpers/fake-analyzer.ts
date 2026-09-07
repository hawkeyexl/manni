/**
 * A `PageAnalyzer` with canned pages, for the crawl and check cores.
 *
 * No browser and no network: the site is a table from normalized URL to the
 * links that page lists and the violations it carries. A URL missing from the
 * table, or one whose entry is an `Error`, rejects the way the Playwright
 * analyzer does for a page that will not load. Every `analyze` call is
 * recorded so a test can assert visit order and the options handed through.
 */
import type {
  AnalyzeOptions,
  AnalyzedPage,
  PageAnalyzer,
} from "../../src/a11y/core/analyzer.js";
import { A11yError, type Violation } from "../../src/a11y/types.js";

export interface FakePage {
  /** Absolute hrefs the page links to, as the live DOM would report them. */
  links?: string[];
  /** Violations of every severity; the check core filters. */
  violations?: Violation[];
  passes?: number;
  incomplete?: number;
  /** Where the browser landed, when the page redirects. Absent means it stayed put. */
  finalUrl?: string;
}

export type FakeSite = Record<string, FakePage | Error>;

export interface FakeAnalyzer extends PageAnalyzer {
  /** Every `analyze` call, in order. */
  calls: { url: string; opts: AnalyzeOptions }[];
  /** How many times `close` ran. */
  closed: number;
}

export function fakeAnalyzer(site: FakeSite): FakeAnalyzer {
  const calls: FakeAnalyzer["calls"] = [];
  const analyzer: FakeAnalyzer = {
    calls,
    closed: 0,
    analyze(url, opts) {
      calls.push({ url, opts });
      const page = site[url];
      if (page === undefined) {
        return Promise.reject(new A11yError(`Could not load ${url}: net::ERR_NAME_NOT_RESOLVED`));
      }
      if (page instanceof Error) return Promise.reject(page);
      const analyzed: AnalyzedPage = {
        result: {
          url,
          violations: page.violations ?? [],
          passes: page.passes ?? 10,
          incomplete: page.incomplete ?? 0,
        },
        links: page.links ?? [],
      };
      if (page.finalUrl !== undefined) analyzed.finalUrl = page.finalUrl;
      return Promise.resolve(analyzed);
    },
    close() {
      analyzer.closed += 1;
      return Promise.resolve();
    },
  };
  return analyzer;
}

/** axe's word for each family level, when a test does not name one itself. */
const IMPACT_FOR: Record<Violation["severity"], Violation["impact"]> = {
  notice: "minor",
  warning: "moderate",
  error: "critical",
};

/**
 * A violation of the given family severity with one node, enough for
 * counting. `impact` is axe's value and defaults to the one the severity is
 * mapped from most often; a test that cares (say, `serious` beside
 * `critical`, both `error`) names it.
 */
export function violation(
  id: string,
  severity: Violation["severity"],
  impact: Violation["impact"] = IMPACT_FOR[severity],
): Violation {
  return {
    id,
    severity,
    impact,
    help: `Rule ${id}`,
    helpUrl: `https://dequeuniversity.com/rules/axe/4.13/${id}`,
    tags: ["wcag2a"],
    nodes: [{ target: "html", html: "<html>", summary: `Fix ${id}` }],
  };
}
