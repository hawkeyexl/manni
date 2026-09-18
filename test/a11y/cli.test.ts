/**
 * The a11y CLI's flag parsers, tested without the built bin. The full
 * command surface is exercised against `dist/cli.js` in
 * `cli.integration.test.ts`; this file pins the helpers whose rejections are
 * cheaper to enumerate here.
 */
import { describe, expect, it } from "vitest";
import {
  assertExcludeGlobs,
  configExcludeGlobs,
  parseMaxPages,
  positiveInteger,
  resolveCrawl,
  resolveMaxPages,
} from "../../src/a11y/cli.js";
import { A11yError } from "../../src/a11y/types.js";

describe("assertExcludeGlobs", () => {
  it("passes patterns that can match a path, each named as the flag", () => {
    expect(assertExcludeGlobs(["/proposals/**", "/"])).toEqual([
      { glob: "/proposals/**", source: '--exclude "/proposals/**"' },
      { glob: "/", source: '--exclude "/"' },
    ]);
    expect(assertExcludeGlobs([])).toEqual([]);
  });

  it("rejects a pattern that cannot, naming it and saying why", () => {
    expect(() => assertExcludeGlobs(["proposals/**"])).toThrow(
      new A11yError('--exclude "proposals/**" must start with "/": it matches a URL path.'),
    );
    expect(() => assertExcludeGlobs(["/ok/**", "**/drafts"])).toThrow(
      new A11yError('--exclude "**/drafts" must start with "/": it matches a URL path.'),
    );
  });

  it("takes a value containing a comma as one pattern", () => {
    expect(assertExcludeGlobs(["/a,/b"])).toEqual([
      { glob: "/a,/b", source: '--exclude "/a,/b"' },
    ]);
  });
});

describe("configExcludeGlobs", () => {
  it("names each entry by the file it came from and its position", () => {
    expect(configExcludeGlobs(["/proposals/**", "/blog/**"], "ci/manni.config.yaml")).toEqual([
      { glob: "/proposals/**", source: 'ci/manni.config.yaml: "a11y.exclude[0]"' },
      { glob: "/blog/**", source: 'ci/manni.config.yaml: "a11y.exclude[1]"' },
    ]);
  });

  it("falls back to the family file's name when no source was recorded", () => {
    expect(configExcludeGlobs(["/blog/**"], null)).toEqual([
      { glob: "/blog/**", source: 'manni.config.yaml: "a11y.exclude[0]"' },
    ]);
  });

  it("is empty for an empty list, whatever the source", () => {
    expect(configExcludeGlobs([], null)).toEqual([]);
    expect(configExcludeGlobs([], "manni.config.yaml")).toEqual([]);
  });
});

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

describe("parseMaxPages", () => {
  it("parses a typed cap", () => {
    expect(parseMaxPages("1")).toBe(1);
    expect(parseMaxPages("250")).toBe(250);
  });

  it("reads commander's false for --no-max-pages as an uncapped run", () => {
    expect(parseMaxPages(false)).toBe("uncapped");
  });

  it("is undefined when neither half of the pair was typed", () => {
    expect(parseMaxPages(undefined)).toBeUndefined();
  });

  it("rejects a cap that is not an integer of 1 or more", () => {
    for (const bad of ["0", "-3", "2.5", "many", "01", ""]) {
      expect(() => parseMaxPages(bad), bad).toThrow(
        new A11yError("--max-pages must be an integer >= 1."),
      );
    }
  });
});

describe("resolveMaxPages", () => {
  it("prefers a typed cap over the config key", () => {
    expect(resolveMaxPages(50, 500)).toBe(50);
  });

  it("--no-max-pages removes a configured cap", () => {
    expect(resolveMaxPages("uncapped", 500)).toBeUndefined();
  });

  it("falls back to the config key when neither half was typed", () => {
    expect(resolveMaxPages(undefined, 500)).toBe(500);
  });

  it("is no cap when neither the command line nor config sets one", () => {
    expect(resolveMaxPages(undefined, undefined)).toBeUndefined();
    expect(resolveMaxPages("uncapped", undefined)).toBeUndefined();
  });
});

describe("resolveCrawl", () => {
  it("--crawl wins over crawl: false in config", () => {
    expect(resolveCrawl(true, false)).toBe(true);
  });

  it("--no-crawl wins over crawl: true in config", () => {
    expect(resolveCrawl(false, true)).toBe(false);
  });

  it("falls back to the config key when neither half was typed", () => {
    expect(resolveCrawl(undefined, false)).toBe(false);
    expect(resolveCrawl(undefined, true)).toBe(true);
  });

  it("crawls when neither the command line nor config sets it", () => {
    expect(resolveCrawl(undefined, undefined)).toBe(true);
  });
});
