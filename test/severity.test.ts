import { describe, it, expect } from "vitest";
import { isErrorSeverity } from "../src/meta/types.js";

// The invariant on `FieldError.severity`, stated once: a result is `ok` iff
// no entry of `errors` has severity `error`, and an absent severity means
// `error`. Every derivation of `ok` in the family goes through this.
describe("isErrorSeverity", () => {
  it("treats an absent severity as error, so every existing producer is unchanged", () => {
    expect(isErrorSeverity({})).toBe(true);
    expect(isErrorSeverity({ severity: undefined })).toBe(true);
  });

  it("is true for error and false for warning", () => {
    expect(isErrorSeverity({ severity: "error" })).toBe(true);
    expect(isErrorSeverity({ severity: "warning" })).toBe(false);
  });
});
