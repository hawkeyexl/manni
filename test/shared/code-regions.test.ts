/**
 * The stretches of a text that are code: fenced blocks and backtick spans.
 * cite skips them when scanning for markers, and term's body readers skip the
 * fences, so a page that documents either syntax yields nothing.
 */
import { describe, expect, it } from "vitest";
import { codeEndAt, codeRegions } from "../../src/shared/code-regions.js";

/** The text of each region, which is easier to read than offsets. */
const texts = (text: string, format: string, spans?: boolean): string[] =>
  codeRegions(text, format, spans === undefined ? {} : { spans }).map((r) =>
    text.slice(r.start, r.end),
  );

describe("codeRegions", () => {
  it("finds a backtick fence, fences included", () => {
    const text = "before\n```js\ncode\n```\nafter\n";
    expect(texts(text, "markdown")).toEqual(["```js\ncode\n```"]);
  });

  it("finds a tilde fence in mdx", () => {
    const text = "~~~\ncode\n~~~\n";
    expect(texts(text, "mdx")).toEqual(["~~~\ncode\n~~~"]);
  });

  it("reads an indented markdown fence, as inside a list item", () => {
    const text = "- item\n\n  ```\n  code\n  ```\n";
    expect(texts(text, "markdown")).toEqual(["  ```\n  code\n  ```"]);
  });

  it("does not close a fence with a shorter run or another character", () => {
    const text = "````\n```\n~~~~\n````\n";
    expect(texts(text, "markdown")).toEqual(["````\n```\n~~~~\n````"]);
  });

  it("runs an unclosed fence to the end", () => {
    const text = "a\n```\ncode\nmore";
    expect(texts(text, "markdown")).toEqual(["```\ncode\nmore"]);
  });

  it("finds an asciidoc listing block at column 0 only", () => {
    expect(texts("----\ncode\n----\n", "asciidoc")).toEqual(["----\ncode\n----"]);
    expect(texts("  ----\ntext\n", "asciidoc")).toEqual([]);
  });

  it("finds backtick spans closed by a run of the same length", () => {
    const text = "a `one` b ``two ` two`` c ```open\n";
    expect(texts(text, "markdown")).toEqual(["`one`", "``two ` two``"]);
  });

  it("finds spans in asciidoc and rst, and nothing in html", () => {
    expect(texts("a `b` c", "asciidoc")).toEqual(["`b`"]);
    expect(texts("a ``b`` c", "rst")).toEqual(["``b``"]);
    expect(texts("a `b` c\n```\nx\n```", "html")).toEqual([]);
  });

  it("does not look for spans inside a fence", () => {
    const text = "```\n`a`\n```\n";
    expect(texts(text, "markdown")).toEqual(["```\n`a`\n```"]);
  });

  it("leaves spans out when asked for fences only", () => {
    const text = "`a`\n```\nx\n```\n";
    expect(texts(text, "markdown", false)).toEqual(["```\nx\n```"]);
  });

  it("ends a closed fence at its closing line's newline, CR and all", () => {
    const text = "```\r\nx\r\n```\r\nafter";
    const [region] = codeRegions(text, "markdown");
    expect(region).toBeDefined();
    expect(text.slice(region?.start, region?.end)).toBe("```\r\nx\r\n```\r");
  });
});

describe("codeEndAt", () => {
  it("returns the end of the region an offset falls in, else undefined", () => {
    const regions = [
      { start: 2, end: 5 },
      { start: 9, end: 12 },
    ];
    expect(codeEndAt(regions, 2)).toBe(5);
    expect(codeEndAt(regions, 4)).toBe(5);
    expect(codeEndAt(regions, 5)).toBeUndefined();
    expect(codeEndAt(regions, 11)).toBe(12);
    expect(codeEndAt(regions, 0)).toBeUndefined();
  });
});
