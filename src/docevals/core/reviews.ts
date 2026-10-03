/**
 * Persisted human reviews (Level 3 grading). `.manni/docevals/reviews.yaml` records
 * human verdicts for evals that landed in the human-review zone. A review
 * applies only while the page body it reviewed is unchanged (contentHash);
 * stale reviews silently return the eval to needs-review.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { sha256 } from "../judge/cache.js";

export interface ReviewEntry {
  file: string;
  evalName: string;
  /** sha256 of the page body at review time. */
  contentHash: string;
  verdict: "pass" | "fail";
  reviewer?: string;
  date?: string;
  note?: string;
}

export const REVIEWS_PATH = join(".manni/docevals", "reviews.yaml");

export function loadReviews(root: string): ReviewEntry[] {
  const path = join(root, REVIEWS_PATH);
  if (!existsSync(path)) return [];
  const raw = parseYaml(readFileSync(path, "utf8")) as unknown;
  if (!Array.isArray(raw)) return [];
  return raw as ReviewEntry[];
}

export function saveReviews(root: string, reviews: ReviewEntry[]): void {
  const path = join(root, REVIEWS_PATH);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, stringifyYaml(reviews));
}

/** Record (or replace) a review for a (file, eval) pair. */
export function recordReview(root: string, entry: ReviewEntry): void {
  const reviews = loadReviews(root).filter(
    (r) => !(r.file === entry.file && r.evalName === entry.evalName),
  );
  reviews.push(entry);
  saveReviews(root, reviews);
}

/** Find the applicable (non-stale) review for a page body, if any. */
export function findReview(
  reviews: ReviewEntry[],
  file: string,
  evalName: string,
  body: string,
): ReviewEntry | undefined {
  const entry = reviews.find(
    (r) => r.file === file && r.evalName === evalName,
  );
  if (!entry) return undefined;
  return entry.contentHash === sha256(body) ? entry : undefined;
}

export { sha256 as contentHash };
