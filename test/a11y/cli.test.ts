/**
 * The a11y CLI's flag parsers, tested without the built bin. The full
 * command surface is exercised against `dist/cli.js` in
 * `cli.integration.test.ts`; this file pins the helpers whose rejections are
 * cheaper to enumerate here.
 */
import { describe, expect, it } from "vitest";
import { positiveInteger } from "../../src/a11y/cli.js";
import { A11yError } from "../../src/a11y/types.js";

describe("positiveInteger", () => {
  it("parses a canonical positive integer", () => {
    expect(positiveInteger("1", "--max-pages")).toBe(1);
    expect(positiveInteger("100", "--max-pages")).toBe(100);
    expect(positiveInteger("30000", "--timeout")).toBe(30000);
  });

  it("rejects zero, negatives, fractions, words, leading zeros and the empty string", () => {
    for (const bad of ["0", "-3", "2.5", "many", "01", "007", "", " 1", "1e3", "+1"]) {
      expect(() => positiveInteger(bad, "--max-pages"), bad).toThrow(
        new A11yError("--max-pages must be an integer >= 1."),
      );
    }
  });

  it("names the flag in the message", () => {
    expect(() => positiveInteger("0", "--timeout")).toThrow("--timeout must be an integer >= 1.");
  });
});
