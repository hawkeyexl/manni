/**
 * The analyzer's mapping from axe's impact onto the family severity scale.
 * The browser-backed path is exercised in `cli.integration.test.ts`; this
 * file pins the one pure function the analyzer exports.
 */
import { describe, expect, it } from "vitest";
import { severityOf } from "../../src/a11y/core/analyzer.js";

describe("severityOf", () => {
  it("maps axe's four impacts onto the three family levels", () => {
    expect(severityOf("critical")).toBe("error");
    expect(severityOf("serious")).toBe("error");
    expect(severityOf("moderate")).toBe("warning");
    expect(severityOf("minor")).toBe("notice");
  });

  it("treats a missing impact as the lowest level", () => {
    expect(severityOf(null)).toBe("notice");
    expect(severityOf(undefined)).toBe("notice");
  });
});
