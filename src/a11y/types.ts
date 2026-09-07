/**
 * The shapes the a11y tool produces and the error it throws.
 *
 * Everything downstream of the browser — the crawl, the check core, the
 * reporters — speaks in these types, so the analyzer is the only module that
 * knows axe's own result shape.
 */
import { ToolError } from "../shared/errors.js";

/** Operational/usage failure of the a11y tool: one line on stderr, exit 2. */
export class A11yError extends ToolError {
  constructor(message: string) {
    super(message);
    this.name = "A11yError";
  }
}

/** The four levels, least to most severe. The analyzer maps axe's `null` to "minor". */
export const SEVERITIES = ["minor", "moderate", "serious", "critical"] as const;
export type Severity = (typeof SEVERITIES)[number];

export function isSeverity(value: string): value is Severity {
  return (SEVERITIES as readonly string[]).includes(value);
}

/** `true` when `severity` is at or above `min`. */
export function meetsSeverity(severity: Severity, min: Severity): boolean {
  return SEVERITIES.indexOf(severity) >= SEVERITIES.indexOf(min);
}

export interface ViolationNode {
  /** axe's CSS selector path to the element (joined `target`). */
  target: string;
  /** The element's outer HTML, as axe reports it (truncated to 200 chars in pretty output only). */
  html: string;
  /** axe's failureSummary: what to fix, in prose. */
  summary: string;
}

export interface Violation {
  /** axe rule id, e.g. "image-alt". */
  id: string;
  severity: Severity;
  /** Short rule description, e.g. "Images must have alternate text". */
  help: string;
  /** Deque University rule page. */
  helpUrl: string;
  /** axe tags, e.g. ["cat.text-alternatives", "wcag2a", "wcag111"]. */
  tags: string[];
  nodes: ViolationNode[];
}

export interface PageResult {
  /** Normalized URL that was checked. */
  url: string;
  /** How the URL entered the run. */
  source: "seed" | "sitemap" | "link";
  /** Violations at or above the severity floor. Empty when `error` is set. */
  violations: Violation[];
  /** Count of axe rules that passed on this page. */
  passes: number;
  /** Count of rules axe could not decide (reported, never counted as failures). */
  incomplete: number;
  /**
   * round(100 × passes ÷ (passes + violations.length)), the share of applicable
   * axe rules that passed after severity filtering. Not a Lighthouse score.
   * `null` when the page did not load, or when no rule applied.
   */
  score: number | null;
  /** Set when the page could not be loaded or analyzed; the page counts as failed. */
  error?: string;
}

export interface CheckSummary {
  /** Distinct URLs that entered the frontier (seeds + sitemap + links). */
  discovered: number;
  /** Pages actually analyzed. */
  checked: number;
  /** Discovered but not checked because `maxPages` was reached. */
  skipped: number;
  /**
   * Discovered, then dropped unloaded because the browser had already landed
   * on the same page under another spelling (a redirect target). Neither
   * checked nor skipped: `checked + skipped + duplicates === discovered`.
   */
  duplicates: number;
  /** Pages with ≥1 remaining violation or an `error`. Drives exit 1. */
  failed: number;
  /** Total remaining violations across pages (rules, not nodes). */
  violations: number;
  /** Violations by severity, always all four keys. */
  bySeverity: Record<Severity, number>;
  /** The sitemap URL that supplied pages, or `null` if none was used. */
  sitemap: string | null;
  /**
   * Whether the run discovered pages beyond the seeds (sitemap and same-host
   * links). `false` under `--no-crawl`, where `sitemap` is always `null` and
   * no link was followed.
   */
  crawl: boolean;
}

export interface CheckRun {
  results: PageResult[];
  summary: CheckSummary;
}

/**
 * What a run says while it is still running. The crawl emits these in order
 * (`browser`, then `page`/`checked` per page, then `done`); the check core
 * adds `sitemap` before them when it crawls. A listener is optional, and
 * nothing is emitted without one.
 */
export type ProgressEvent =
  /** About to launch the browser, before the first page. */
  | { kind: "browser" }
  /** Discovery finished: the sitemap that supplied pages (or none), and how many URLs it gave. */
  | { kind: "sitemap"; source: string | null; urls: number }
  /** About to check page `index` (1-based); `queued` is every URL discovered so far. */
  | { kind: "page"; index: number; queued: number; url: string }
  /**
   * Page `index` finished. `violations` is axe's count for the page before the
   * severity floor is applied, so it can be higher than what the report keeps.
   * `error` is set when the page could not be loaded or analyzed. A seed that
   * fails ends the run instead, and is reported as the run's error.
   */
  | { kind: "checked"; index: number; url: string; violations: number; error?: string }
  /** The crawl is over: pages analyzed, and pages left in the frontier. */
  | { kind: "done"; checked: number; skipped: number };

export type ProgressListener = (event: ProgressEvent) => void;
