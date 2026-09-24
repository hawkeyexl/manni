/**
 * `manni docevals review` — record human verdicts for evals in the human-review
 * zone. A verdict binds to the page's current content hash; edits to the page
 * return the eval to needs-review on the next run.
 *
 *   manni docevals review                       # list recorded reviews
 *   manni docevals review <file> <eval> pass    # record a verdict
 */
import { existsSync } from "node:fs";
import { resolve, relative } from "node:path";
import pc from "picocolors";
import { DocevalsError } from "../types.js";
import { readPage } from "../core/discover.js";
import {
  contentHash,
  loadReviews,
  recordReview,
  type ReviewEntry,
} from "../core/reviews.js";

export interface ReviewOptions {
  reviewer?: string;
  note?: string;
  cwd?: string;
}

export function listReviews(cwd = process.cwd()): ReviewEntry[] {
  return loadReviews(cwd);
}

export function renderReviews(reviews: ReviewEntry[]): string {
  if (reviews.length === 0) return "No recorded reviews.";
  return reviews
    .map((r) => {
      const verdict =
        r.verdict === "pass" ? pc.green(r.verdict) : pc.red(r.verdict);
      const meta = [r.reviewer, r.date].filter(Boolean).join(" ");
      return `${verdict} ${r.file} ${pc.bold(r.evalName)}${meta ? pc.dim(` (${meta})`) : ""}${r.note ? pc.dim(` — ${r.note}`) : ""}`;
    })
    .join("\n");
}

export function runReview(
  file: string,
  evalName: string,
  verdict: string,
  options: ReviewOptions = {},
): ReviewEntry {
  const cwd = options.cwd ?? process.cwd();
  if (verdict !== "pass" && verdict !== "fail") {
    throw new DocevalsError(`Verdict must be "pass" or "fail", got "${verdict}"`);
  }
  const absPath = resolve(cwd, file);
  if (!existsSync(absPath)) {
    throw new DocevalsError(`Page not found: ${absPath}`);
  }
  const page = readPage(absPath, cwd);
  const entry: ReviewEntry = {
    file: relative(cwd, absPath).replace(/\\/g, "/"),
    evalName,
    contentHash: contentHash(page.body),
    verdict,
    reviewer: options.reviewer,
    date: new Date().toISOString().slice(0, 10),
    note: options.note,
  };
  recordReview(cwd, entry);
  return entry;
}
