import type { TestFinding } from "../core/results.js";

/**
 * What a failed step asks of its reader. Doc Detective reports only what the
 * step expected against what happened, so it cannot tell which of the three
 * is wrong, and the sentence says so.
 */
const FAIL_ADVICE = "Fix the step, fix the procedure it documents, or report a product regression.";

/** Doc Detective's description, and for a FAIL the advice after it. A WARNING is left as written. */
export function findingMessage(f: TestFinding): string {
  if (f.result !== "FAIL") return f.description;
  if (f.description === "") return FAIL_ADVICE;
  const stop = f.description.endsWith(".") ? "" : ".";
  return `${f.description}${stop} ${FAIL_ADVICE}`;
}
