/**
 * The glob compiler runs on *untrusted* input: the pattern comes from the
 * evaluated project's frontmatter, and `when.ts` matches it against every file
 * access in a window. A pattern that compiles to nested optional-greedy groups
 * therefore hands an artifact author a denial-of-service on the runner.
 */
import { describe, expect, it } from "vitest";
import { globToRegExp, matchesGlob } from "../../../../src/tracevals/graders/glob.js";

describe("globToRegExp resists catastrophic backtracking", () => {
  it("rejects a long non-matching path in linear time", () => {
    // Every `**/` used to compile to its own optional greedy `(?:.*/)?` on top
    // of an unconditional prefix of the same shape, and they nested: eight
    // segments took seconds for one `.test()`.
    const glob = `${"**/".repeat(8)}target.md`;
    const path = `c:/work/${"segment/".repeat(30)}other.md`;
    const started = performance.now();
    const hit = matchesGlob(path, glob);
    const elapsed = performance.now() - started;
    expect(hit).toBe(false);
    expect(elapsed, `one test() took ${elapsed.toFixed(0)}ms`).toBeLessThan(250);
  });

  it("still matches through a run of double stars", () => {
    expect(matchesGlob("c:/w/a/b/c/target.md", "**/**/target.md")).toBe(true);
    expect(matchesGlob("c:/w/target.md", "**/**/target.md")).toBe(true);
  });

  it("memoises compilation per glob string", () => {
    // Recompiling per file access is wasted work on every session with a large
    // window; the compiled form depends only on the string.
    expect(globToRegExp("docs/**")).toBe(globToRegExp("docs/**"));
    expect(globToRegExp("docs/**")).not.toBe(globToRegExp("src/**"));
  });
});
