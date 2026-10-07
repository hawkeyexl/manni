/**
 * `--newer-than <duration>`: one grammar and one message for every domain
 * that selects by age.
 */
import { describe, expect, it } from "vitest";
import { durationMessage, parseDuration } from "../../src/shared/duration.js";
import { ToolError } from "../../src/shared/errors.js";

class DomainError extends ToolError {}
const raise = (message: string): Error => new DomainError(message);

describe("parseDuration", () => {
  it("accepts minutes, hours, days and weeks", () => {
    expect(parseDuration("30m", raise)).toBe(30 * 60_000);
    expect(parseDuration("24h", raise)).toBe(24 * 60 * 60_000);
    expect(parseDuration("7d", raise)).toBe(7 * 24 * 60 * 60_000);
    expect(parseDuration("2w", raise)).toBe(14 * 24 * 60 * 60_000);
  });

  it("keeps the fractional count the tracevals parser accepted", () => {
    expect(parseDuration("1.5h", raise)).toBe(90 * 60_000);
  });

  it("refuses anything else through the domain's own error", () => {
    for (const bad of ["", "7", "d", "-1d", "7y", "1.5.2d", "seven days"]) {
      expect(() => parseDuration(bad, raise)).toThrow(DomainError);
    }
  });

  it("says what a duration looks like, naming the value it got", () => {
    expect(() => parseDuration("7y", raise)).toThrow(
      '--newer-than must be a duration such as 30m, 24h, 7d or 2w, got "7y"',
    );
    expect(durationMessage("x")).toBe(
      '--newer-than must be a duration such as 30m, 24h, 7d or 2w, got "x"',
    );
  });

  it("names the flag or key the caller passes", () => {
    expect(() => parseDuration("7y", raise, "--keep")).toThrow(
      '--keep must be a duration such as 30m, 24h, 7d or 2w, got "7y"',
    );
    expect(durationMessage("x", "--keep")).toBe(
      '--keep must be a duration such as 30m, 24h, 7d or 2w, got "x"',
    );
  });
});
