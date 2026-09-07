/**
 * The a11y tool's library surface. Not re-exported from `src/index.ts`: the
 * published programmatic API is meta's (proposal 0034), and this stays
 * importable by relative path for the tools beside it.
 */
export { runCheck, CHECK_DEFAULTS } from "./commands/check.js";
export type { CheckOptions, CheckDeps } from "./commands/check.js";
export { crawl } from "./core/crawl.js";
export type { CrawlOptions, CrawlOutcome } from "./core/crawl.js";
export { discoverSitemap, parseSitemapXml } from "./core/sitemap.js";
export type { Fetcher, SitemapDiscovery, ParsedSitemap } from "./core/sitemap.js";
export {
  createPlaywrightAnalyzer,
  findBrowser,
  NO_BROWSER_MESSAGE,
} from "./core/analyzer.js";
export type {
  AnalyzeOptions,
  AnalyzedPage,
  PageAnalyzer,
  BrowserChannel,
} from "./core/analyzer.js";
export { loadA11yConfig, parseA11yConfig } from "./core/config.js";
export type { A11yConfig, LoadedA11yConfig } from "./core/config.js";
export {
  normalizeUrl,
  isHttpUrl,
  sameHost,
  isPageLink,
  ASSET_EXTENSIONS,
} from "./core/url.js";
export {
  render,
  renderPretty,
  renderJson,
  renderGithub,
  A11Y_FORMATS,
  A11Y_FORMAT_LIST,
  isA11yFormat,
} from "./reporters/index.js";
export type { A11yFormat, RenderOptions } from "./reporters/index.js";
export { A11yError, IMPACTS, isImpact, meetsImpact } from "./types.js";
export type {
  Impact,
  ViolationNode,
  Violation,
  PageResult,
  CheckSummary,
  CheckRun,
} from "./types.js";
