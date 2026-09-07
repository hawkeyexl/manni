/**
 * The browser seam.
 *
 * Everything that needs a real page — navigation, the live DOM's links, axe
 * itself — sits behind `PageAnalyzer`, so the crawl and the check core can be
 * exercised with a canned analyzer and no browser. The Playwright-backed
 * implementation lives here too, behind the same interface.
 */
import { AxeBuilder } from "@axe-core/playwright";
import { chromium, type Browser, type Page } from "playwright-core";
import { A11yError, type PageResult, type Violation, type ViolationNode } from "../types.js";

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

export interface PageAnalyzer {
  /**
   * Load `url` and run axe. Rejects with `A11yError` on navigation failure or
   * timeout (message names the URL and the underlying reason); the caller
   * decides whether that is fatal (seed) or a per-page `error` (crawled page).
   */
  analyze(url: string, opts: AnalyzeOptions): Promise<AnalyzedPage>;
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
 * - links: every `a[href]`'s absolute `href` from the live DOM
 * - `new AxeBuilder({ page })`, `.withTags(tags)` only when `tags.length > 0`, `.analyze()`
 * - map axe `Result` → `Violation` (axe `impact` `null`/`undefined` → `severity` "minor"; node
 *   `target` joined with " "; `failureSummary ?? ""`), `passes.length`, `incomplete.length`
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
      try {
        await page.goto(url, { waitUntil: "load", timeout: opts.timeout });
      } catch (err) {
        throw new A11yError(`Could not load ${url}: ${reason(err)}`);
      }
      const links = await page.$$eval("a[href]", (anchors): string[] =>
        anchors.map((a) => (a as unknown as { href: string }).href),
      );
      let builder = new AxeBuilder({ page });
      if (opts.tags.length > 0) builder = builder.withTags(opts.tags);
      let results: AxeResults;
      try {
        results = await builder.analyze();
      } catch (err) {
        throw new A11yError(`Could not analyze ${url}: ${reason(err)}`);
      }
      return {
        result: {
          url,
          violations: results.violations.map(toViolation),
          passes: results.passes.length,
          incomplete: results.incomplete.length,
        },
        links,
        finalUrl: page.url(),
      };
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

function toViolation(result: AxeResult): Violation {
  return {
    id: result.id,
    // axe's name for this level is `impact`; manni says `severity`.
    severity: result.impact ?? "minor",
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
