/**
 * What every reporter prints under a result that did not pass (proposal
 * 0089): the judged block for a judged or reviewed eval, and the guidance
 * lines that say what the eval asks for.
 */
import { guidanceLines } from "../../shared/guidance.js";
import { verdictLines } from "../../shared/verdict-lines.js";
import type { EvalResult } from "../types.js";

/**
 * `AI judge: …`, `Observed: …`, `Reasoning: …` for a judged failure or an
 * eval awaiting review, and the human-review line for an eval no judge saw.
 * Empty for every other result.
 */
export function judgedLines(r: EvalResult): string[] {
  if (r.outcome === "fail" && r.consensus) {
    return verdictLines(r.consensus, "fail", "Edit the page so the assertion holds.");
  }
  if (r.outcome !== "needs-review") return [];
  if (!r.consensus) {
    return ["Awaiting human review. Record a verdict with manni docevals review."];
  }
  return verdictLines(
    r.consensus,
    "no confident verdict",
    "Record a verdict with manni docevals review, or sharpen the assertion and run manni docevals calibrate.",
  );
}

/**
 * The guidance lines, under a result that failed, errored or awaits review,
 * and under any finding, which a passing eval at warning severity still has.
 */
export function resultGuidance(r: EvalResult): string[] {
  const speaks =
    r.outcome === "fail" ||
    r.outcome === "error" ||
    r.outcome === "needs-review" ||
    (r.findings ?? []).length > 0;
  return speaks ? guidanceLines(r.guidance) : [];
}
