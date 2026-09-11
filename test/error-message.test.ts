import { describe, expect, it } from "vitest";
import { errorMessage } from "../src/shared/errors.js";

/**
 * JavaScript can throw anything, so `(err as Error).message` is `undefined`
 * for a thrown string, number or `null`, and "undefined" is what the user
 * reads. `errorMessage` gives every caught value a message worth reading.
 */
describe("errorMessage", () => {
  it("gives an Error its message", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });

  it("gives a string itself", () => {
    expect(errorMessage("boom")).toBe("boom");
  });

  it("gives a number its digits", () => {
    expect(errorMessage(42)).toBe("42");
  });

  it.each([
    [NaN, "NaN"],
    [Infinity, "Infinity"],
    [-Infinity, "-Infinity"],
  ])("gives %s its own name, not the null JSON would write", (thrown, message) => {
    expect(errorMessage(thrown)).toBe(message);
  });

  it("says null for null", () => {
    expect(errorMessage(null)).toBe("null");
  });

  it("gives an object without a message its JSON text", () => {
    expect(errorMessage({ code: "EBUSY" })).toBe('{"code":"EBUSY"}');
  });

  it("takes the message of an Error-like object from another realm", () => {
    expect(errorMessage({ message: "from elsewhere" })).toBe("from elsewhere");
  });

  it("falls back to String() for a value JSON cannot serialise", () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(errorMessage(cycle)).toBe("[object Object]");
    expect(errorMessage(10n)).toBe("10");
  });

  it("never answers undefined for a value that is not undefined", () => {
    for (const thrown of [new Error("x"), "x", 0, null, {}, [], false]) {
      expect(errorMessage(thrown)).not.toBe("undefined");
    }
  });
});
