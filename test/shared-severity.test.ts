/**
 * The family severity scale in `src/shared/severity.ts`: the values every
 * tool speaks, the guard, and the floor comparison. a11y is its first user;
 * the scale is pinned here, outside `test/a11y/`, because it is not a11y's.
 */
import { describe, expect, it } from "vitest";
import {
  SEVERITIES,
  SEVERITY_LIST,
  isSeverity,
  meetsSeverity,
} from "../src/shared/severity.js";

describe("SEVERITIES", () => {
  it("is notice, warning, error, least to most severe", () => {
    expect(SEVERITIES).toEqual(["notice", "warning", "error"]);
  });

  it("spells the list the way a usage message does", () => {
    expect(SEVERITY_LIST).toBe("notice | warning | error");
  });
});

describe("isSeverity", () => {
  it("accepts the three family values", () => {
    for (const s of SEVERITIES) expect(isSeverity(s)).toBe(true);
  });

  it("rejects axe's values, other linters' words and the empty string", () => {
    for (const bad of ["minor", "moderate", "serious", "critical", "note", "high", "Error", ""]) {
      expect(isSeverity(bad), bad).toBe(false);
    }
  });
});

describe("meetsSeverity", () => {
  it("is true at or above the floor", () => {
    expect(meetsSeverity("error", "error")).toBe(true);
    expect(meetsSeverity("error", "warning")).toBe(true);
    expect(meetsSeverity("warning", "warning")).toBe(true);
    expect(meetsSeverity("notice", "notice")).toBe(true);
  });

  it("is false below the floor", () => {
    expect(meetsSeverity("warning", "error")).toBe(false);
    expect(meetsSeverity("notice", "error")).toBe(false);
    expect(meetsSeverity("notice", "warning")).toBe(false);
  });

  it("keeps everything at the notice floor", () => {
    for (const s of SEVERITIES) expect(meetsSeverity(s, "notice")).toBe(true);
  });
});
