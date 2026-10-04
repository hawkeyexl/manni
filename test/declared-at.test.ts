/**
 * Where a value of a document's merged metadata was written.
 *
 * docevals and tracevals both point an eval result at the entry that declares
 * the eval. That entry is in the page, or in a manifest a collection declares
 * (proposal 0037). `declaredAt` is the one answer to "which file, which line",
 * built on the merge's `locate` and the extractor's `lineFor`.
 */
import { describe, expect, it } from "vitest";
import { declaredAt } from "../src/meta/internal.js";
import { extractFrontmatter } from "../src/meta/index.js";

const PAGE = [
  "---",
  "title: T",
  "evals:",
  "  - id: first",
  "    assertion: One.",
  "  - id: second",
  "    assertion: Two.",
  "---",
  "",
  "Body.",
].join("\n");

describe("declaredAt", () => {
  it("answers the page and its own line for a value the page carries", () => {
    const extracted = extractFrontmatter(PAGE, "markdown");
    expect(declaredAt("docs/a.md", "/evals/1", { extracted })).toEqual({
      file: "docs/a.md",
      line: 6,
    });
  });

  it("answers the manifest and its line when the merge located the value there", () => {
    const extracted = extractFrontmatter(PAGE, "markdown");
    const locate = (pointer: string) =>
      pointer === "/evals/1" ? { file: "meta.yaml", line: 12 } : undefined;
    expect(declaredAt("docs/a.md", "/evals/1", { extracted, locate })).toEqual({
      file: "meta.yaml",
      line: 12,
    });
  });

  it("answers the manifest alone when it has no line for the value", () => {
    const extracted = extractFrontmatter(PAGE, "markdown");
    const locate = () => ({ file: "https://example.com/meta.yaml" });
    expect(declaredAt("docs/a.md", "/evals/0", { extracted, locate })).toEqual({
      file: "https://example.com/meta.yaml",
    });
  });

  it("answers the page alone when it has no metadata block to take a line from", () => {
    const extracted = extractFrontmatter("# No front matter\n", "markdown");
    expect(declaredAt("CLAUDE.md", "/evals/0", { extracted })).toEqual({
      file: "CLAUDE.md",
    });
  });

  it("falls back to the page when the merge does not locate the pointer", () => {
    const extracted = extractFrontmatter(PAGE, "markdown");
    expect(
      declaredAt("docs/a.md", "/evals/0", { extracted, locate: () => undefined }),
    ).toEqual({ file: "docs/a.md", line: 4 });
  });
});
