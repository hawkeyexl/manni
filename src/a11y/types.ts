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

/** axe's impact levels, least to most severe. `null` impact from axe maps to "minor". */
export const IMPACTS = ["minor", "moderate", "serious", "critical"] as const;
export type Impact = (typeof IMPACTS)[number];

export function isImpact(value: string): value is Impact {
  return (IMPACTS as readonly string[]).includes(value);
}

/** `true` when `impact` is at or above `min`. */
export function meetsImpact(impact: Impact, min: Impact): boolean {
  return IMPACTS.indexOf(impact) >= IMPACTS.indexOf(min);
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
  impact: Impact;
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
  /** Violations at or above the impact floor. Empty when `error` is set. */
  violations: Violation[];
  /** Count of axe rules that passed on this page. */
  passes: number;
  /** Count of rules axe could not decide (reported, never counted as failures). */
  incomplete: number;
  /**
   * round(100 × passes ÷ (passes + violations.length)), the share of applicable
   * axe rules that passed after impact filtering. Not a Lighthouse score.
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
  /** Pages with ≥1 remaining violation or an `error`. Drives exit 1. */
  failed: number;
  /** Total remaining violations across pages (rules, not nodes). */
  violations: number;
  /** Violations by impact, always all four keys. */
  byImpact: Record<Impact, number>;
  /** The sitemap URL that supplied pages, or `null` if none was used. */
  sitemap: string | null;
}

export interface CheckRun {
  results: PageResult[];
  summary: CheckSummary;
}
