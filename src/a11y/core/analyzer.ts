/**
 * The browser seam.
 *
 * Everything that needs a real page — navigation, the live DOM's links, axe
 * itself — sits behind `PageAnalyzer`, so the crawl and the check core can be
 * exercised with a canned analyzer and no browser. The Playwright-backed
 * implementation lives here too, behind the same interface.
 */
import { AxeBuilder } from "@axe-core/playwright";
import { chromium, type Browser, type Page, type Request, type Response } from "playwright-core";
import {
  A11yError,
  isAxeImpact,
  type AxeImpact,
  type PageResult,
  type Severity,
  type Violation,
  type ViolationNode,
} from "../types.js";
import { dedupeKey } from "./url.js";

export interface AnalyzeOptions {
  /** axe tags to restrict to; empty = axe defaults. */
  tags: string[];
  /** Navigation timeout in ms. */
  timeout: number;
}

export interface AnalyzedPage {
  /** Raw result: every violation regardless of severity; `source` and `score` are filled in by `runCheck`. */
  result: Omit<PageResult, "source" | "score">;
  /** Absolute `href` of every `a[href]` in the live DOM after load, unfiltered. */
  links: string[];
  /**
   * The browser's URL once navigation and any redirects settled. The crawl
   * marks it visited so a later queued spelling of the same page is not
   * loaded again. Absent when the analyzer does not know it.
   */
  finalUrl?: string;
}

/**
 * A page that sent the browser elsewhere once it had loaded: a meta refresh
 * to another page, or a navigation while links or axe were being read. It was
 * not analyzed. Tell it from `AnalyzedPage` with `"redirect" in x`.
 */
export interface RedirectedPage {
  /** The absolute URL the page redirects to. */
  redirect: string;
}

export interface PageAnalyzer {
  /**
   * Load `url` and run axe, or report where the page redirects in the
   * browser. Rejects with `A11yError` on navigation failure or timeout
   * (message names the URL and the underlying reason); the caller decides
   * whether that is fatal (seed) or a per-page `error` (crawled page).
   */
  analyze(url: string, opts: AnalyzeOptions): Promise<AnalyzedPage | RedirectedPage>;
  /** Close the browser. Safe to call when nothing was launched, and twice. */
  close(): Promise<void>;
}

export type BrowserChannel = "chrome" | "msedge" | "chromium";

/** The message when nothing launches; the same words the CLI's ladder promises. */
export const NO_BROWSER_MESSAGE =
  "No browser found. Install one with `npx playwright install chromium`, or install Google Chrome or Microsoft Edge.";

/** The launch order: what the machine already has first, Playwright's own download last. */
const CHANNELS: readonly BrowserChannel[] = ["chrome", "msedge", "chromium"];

function launch(channel: BrowserChannel): Promise<Browser> {
  return channel === "chromium"
    ? chromium.launch({ headless: true })
    : chromium.launch({ channel, headless: true });
}

/** The first channel that launches, still open, or `null` when none does. */
async function launchAny(): Promise<{ browser: Browser; channel: BrowserChannel } | null> {
  for (const channel of CHANNELS) {
    try {
      return { browser: await launch(channel), channel };
    } catch {
      // Not installed, or not launchable here. Try the next one.
    }
  }
  return null;
}

/**
 * Try, in order: `chromium.launch({ channel: "chrome", headless: true })`,
 * `{ channel: "msedge" }`, `chromium.launch()` (Playwright's own download).
 * Returns the first that launches, closed again, or `null`. Exported so the
 * integration suite can `describe.skipIf`.
 */
export async function findBrowser(): Promise<BrowserChannel | null> {
  const found = await launchAny();
  if (found === null) return null;
  await found.browser.close();
  return found.channel;
}

/** axe's result shapes, as `@axe-core/playwright` declares them; no direct axe-core import. */
type AxeResults = Awaited<ReturnType<AxeBuilder["analyze"]>>;
type AxeResult = AxeResults["violations"][number];
type AxeNode = AxeResult["nodes"][number];

interface Session {
  browser: Browser;
  page: Page;
}

/**
 * Playwright-backed analyzer. Lazy: the browser launches on the first
 * `analyze`, one context and one page are reused for every URL.
 * - `page.goto(url, { waitUntil: "load", timeout })`; `finalUrl` is `page.url()` after it
 * - one in-page evaluation reads every `a[href]`'s absolute `href` and the
 *   first meta refresh; a refresh to another page (by `dedupeKey`) is a
 *   redirect, returned before axe runs
 * - a read or axe that rejects because the page navigated: wait up to
 *   `timeout` for the URL to change and return the redirect, else rethrow
 * - `new AxeBuilder({ page })`, `.withTags(tags)` only when `tags.length > 0`, `.analyze()`
 * - map axe `Result` → `Violation` (`severity` from `severityOf(impact)`, `impact` kept as
 *   axe's word with `null`/`undefined` → "minor"; node `target` joined with " ";
 *   `failureSummary ?? ""`), `passes.length`, `incomplete.length`
 * - launch failure on every channel → `A11yError(NO_BROWSER_MESSAGE)`
 */
export function createPlaywrightAnalyzer(): PageAnalyzer {
  let session: Promise<Session> | null = null;

  const open = (): Promise<Session> => {
    session ??= (async () => {
      const found = await launchAny();
      if (found === null) throw new A11yError(NO_BROWSER_MESSAGE);
      const context = await found.browser.newContext();
      const page = await context.newPage();
      return { browser: found.browser, page };
    })();
    return session;
  };

  return {
    async analyze(url, opts) {
      const { page } = await open();
      // Every navigation the main frame starts, first hop only, so the one
      // that follows the load can be named even when it never commits (an
      // unresolvable host leaves the browser on its own error page).
      const navigations: Request[] = [];
      const onRequest = (request: Request): void => {
        if (
          request.isNavigationRequest() &&
          request.frame() === page.mainFrame() &&
          request.redirectedFrom() === null
        ) {
          navigations.push(request);
        }
      };
      page.on("request", onRequest);
      try {
        return await analyzePage(page, url, opts, navigations);
      } finally {
        page.off("request", onRequest);
      }
    },

    async close() {
      if (session === null) return;
      const pending = session;
      session = null;
      try {
        const { browser } = await pending;
        await browser.close();
      } catch {
        // The launch itself failed: there is nothing to close.
      }
    },
  };
}

/**
 * One `analyze`, on the session's page. `navigations` is filled while it
 * runs: the first hop of every main-frame navigation, in order.
 */
async function analyzePage(
  page: Page,
  url: string,
  opts: AnalyzeOptions,
  navigations: readonly Request[],
): Promise<AnalyzedPage | RedirectedPage> {
  let response: Response | null;
  try {
    response = await page.goto(url, { waitUntil: "load", timeout: opts.timeout });
  } catch (err) {
    throw new A11yError(`Could not load ${url}: ${reason(err)}`);
  }
  // Where the load settled, HTTP redirects included. The browser being
  // anywhere else later means the page navigated on its own.
  const loaded = response?.url() ?? page.url();

  /**
   * Where the page sent the browser: the navigation started after the load's
   * own, or the URL the frame is on when that is unknown.
   */
  const destination = (): string => {
    let first = response?.request() ?? null;
    for (let from = first?.redirectedFrom() ?? null; from !== null; from = from.redirectedFrom()) {
      first = from;
    }
    const own = first === null ? -1 : navigations.indexOf(first);
    const next = own === -1 ? undefined : navigations[own + 1];
    return next?.url() ?? page.url();
  };

  /**
   * After a read rejected: wait, up to the timeout, for the main frame to
   * commit another page. The original error stands when it never does.
   */
  const navigatedAway = async (): Promise<RedirectedPage | null> => {
    try {
      await page.waitForURL((u) => !samePage(u.href, loaded), {
        waitUntil: "commit",
        timeout: opts.timeout,
      });
      return { redirect: destination() };
    } catch {
      return null;
    }
  };

  let read: InPage;
  try {
    read = await page.evaluate(readPage);
  } catch (err) {
    const moved = await navigatedAway();
    if (moved !== null) return moved;
    throw new A11yError(`Could not analyze ${url}: ${reason(err)}`);
  }
  const refresh = refreshTarget(read.refresh, page.url());
  if (refresh !== null) return { redirect: refresh };

  let builder = new AxeBuilder({ page });
  if (opts.tags.length > 0) builder = builder.withTags(opts.tags);
  let results: AxeResults;
  try {
    results = await builder.analyze();
  } catch (err) {
    const moved = await navigatedAway();
    if (moved !== null) return moved;
    throw new A11yError(`Could not analyze ${url}: ${reason(err)}`);
  }
  // The page can navigate between two reads without either rejecting, and
  // then what was read belongs to the destination, not to `url`.
  if (!samePage(page.url(), loaded)) return { redirect: destination() };
  return {
    result: {
      url,
      violations: results.violations.map(toViolation),
      passes: results.passes.length,
      incomplete: results.incomplete.length,
    },
    links: read.links,
    finalUrl: page.url(),
  };
}

/** What one in-page evaluation reads before axe runs. */
interface InPage {
  /** Every `a[href]`'s absolute `href`. */
  links: string[];
  /** The first `<meta http-equiv="refresh">`'s `content`, or `null`. */
  refresh: string | null;
}

/** Runs in the page. The project has no DOM lib, so the DOM is typed as narrowly as it is used. */
function readPage(): InPage {
  const doc = (
    globalThis as unknown as {
      document: {
        querySelectorAll(selector: string): ArrayLike<{ href: string }>;
        querySelector(selector: string): { getAttribute(name: string): string | null } | null;
      };
    }
  ).document;
  return {
    links: Array.from(doc.querySelectorAll("a[href]"), (a) => a.href),
    refresh:
      doc.querySelector('meta[http-equiv="refresh" i]')?.getAttribute("content") ?? null,
  };
}

/**
 * The URL part of a meta refresh's `content`: `<delay>;url=<url>` or
 * `<delay>, <url>`, `url=` optional and any case, quotes around the URL
 * optional. `null` for a bare delay, which is a reload rather than a redirect.
 */
export function refreshUrl(content: string): string | null {
  const match = /^\s*[\d.]*\s*[;,]\s*(?:url\s*=\s*)?(.*)$/is.exec(content);
  let target = match?.[1]?.trim() ?? "";
  const quote = target[0];
  if (quote === "'" || quote === '"') {
    const end = target.indexOf(quote, 1);
    target = (end === -1 ? target.slice(1) : target.slice(1, end)).trim();
  }
  return target === "" ? null : target;
}

/**
 * Where a meta refresh sends the browser, resolved against the page, or
 * `null` when there is no refresh, no URL in it, or it points back at the
 * page itself.
 */
function refreshTarget(content: string | null, base: string): string | null {
  if (content === null) return null;
  const target = refreshUrl(content);
  if (target === null) return null;
  let to: string;
  try {
    to = new URL(target, base).href;
  } catch {
    return null;
  }
  return samePage(to, base) ? null : to;
}

/** One page by `dedupeKey`; a string that is not an http(s) URL compares as itself. */
function samePage(a: string, b: string): boolean {
  try {
    return dedupeKey(a) === dedupeKey(b);
  } catch {
    return a === b;
  }
}

/** What axe may put in `impact`; the same union `@axe-core/playwright` declares. */
type ImpactValue = AxeResult["impact"];

/**
 * axe's impact onto the family severity scale (`src/shared/severity.ts`).
 * Four levels fold onto three: `critical` and `serious` are both `error`,
 * `moderate` is `warning`, `minor` is `notice`. A missing impact, which axe
 * reports as `null` for a rule with no impact set, is the lowest level. The
 * original word is kept on the violation as `impact`, so nothing is lost for
 * anyone looking the rule up where axe names it.
 */
export function severityOf(impact: ImpactValue | null | undefined): Severity {
  switch (impact) {
    case "critical":
    case "serious":
      return "error";
    case "moderate":
      return "warning";
    default:
      return "notice";
  }
}

/** axe's word as it stands, or `minor` when it gave none. */
function impactOf(impact: ImpactValue | null | undefined): AxeImpact {
  return impact != null && isAxeImpact(impact) ? impact : "minor";
}

function toViolation(result: AxeResult): Violation {
  return {
    id: result.id,
    severity: severityOf(result.impact),
    impact: impactOf(result.impact),
    help: result.help,
    helpUrl: result.helpUrl,
    tags: result.tags,
    nodes: result.nodes.map(toNode),
  };
}

function toNode(node: AxeNode): ViolationNode {
  return {
    // A shadow-DOM target is a nested list of selectors; flatten it the same way.
    target: node.target.map((t) => (Array.isArray(t) ? t.join(" ") : t)).join(" "),
    html: node.html,
    summary: node.failureSummary ?? "",
  };
}

/**
 * The first line of a Playwright error. The rest is a call log that repeats
 * the URL and the timeout, which the caller's message already carries.
 */
function reason(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.split("\n")[0]?.trim() ?? message;
}
