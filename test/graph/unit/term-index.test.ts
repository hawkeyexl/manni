/**
 * The termbase index is built once per termbase: `graph build` asks for it to
 * count the termbase's concepts and again to derive them.
 */
import { describe, expect, it } from "vitest";
import { termIndex } from "../../../src/graph/core/concepts.js";
import type { TermLabel } from "../../../src/shared/term-labels.js";

describe("termIndex", () => {
  it("returns the same index for the same termbase", () => {
    const terms: TermLabel[] = [{ label: "Retry", id: "retry" }];
    expect(termIndex(terms)).toBe(termIndex(terms));
  });

  it("builds a separate index for a different termbase", () => {
    const a: TermLabel[] = [{ label: "Retry", id: "retry" }];
    const b: TermLabel[] = [{ label: "Retry", id: "retry" }];
    expect(termIndex(a)).not.toBe(termIndex(b));
  });
});
