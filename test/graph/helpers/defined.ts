/**
 * `expect(x).toBeDefined()` that also **narrows**.
 *
 * vitest's matchers do not narrow: after `expect(hit).toBeDefined()` the value
 * is still `T | undefined`, and every reader then either repeats `?.` or
 * reaches for `!`. This does the same assertion and hands back the value at
 * `T`, so a test that looks something up says once that it expects to find it
 * and reads it plainly afterwards.
 *
 * The `throw` is unreachable — `expect` has already failed the test by then —
 * and is what makes this an assertion the compiler can follow.
 */
import { expect } from "vitest";

export function defined<T>(value: T | null | undefined, what = "value"): T {
  expect(value, `expected ${what} to be defined`).toBeDefined();
  if (value === null || value === undefined) {
    throw new Error(`${what} is not defined`);
  }
  return value;
}
