/**
 * The line arithmetic behind answer pins (proposal 0087): the file lines a
 * tree-format section spans, and how a pin with no integrity is judged.
 * Lines are 1-based, as the AST positions and a pin's `lines` are.
 */
import { describe, expect, it } from "vitest";
import { freshness, sectionSpans } from "../../../src/graph/commands/questions.js";
import { GraphIndex } from "../../../src/graph/runtime/graph.js";

const DOC = "urn:manni:graph:doc/guide.html";

describe("sectionSpans for a tree format", () => {
  it("spans each heading down to the line before the next heading", async () => {
    const html = [
      "<html><body>", // 1
      "<h2>First</h2>", // 2
      "<p>One.</p>", // 3
      "<h2>Second</h2>", // 4
      "<p>Two.</p>", // 5
      "<p>Three.</p>", // 6
      "</body></html>", // 7
    ].join("\n");
    const spans = await sectionSpans(GraphIndex.fromQuads([]), DOC, "guide.html", html, [
      `${DOC}#first`,
      `${DOC}#second`,
    ]);
    // A page that is no Flare topic carries no resolved text.
    expect(spans).toEqual({
      spans: [
        { iri: `${DOC}#first`, span: { start: 2, end: 3 } },
        { iri: `${DOC}#second`, span: { start: 4, end: 6 } },
      ],
    });
  });
});

describe("freshness of a pin with no integrity", () => {
  const body = ["first line", "second line"];

  it("is current while its lines are on the page", () => {
    expect(freshness(body, { lines: { start: 1, end: 2 }, reviewed: true })).toEqual({
      state: "current",
      ranges: [{ start: 1, end: 2 }],
    });
  });

  it("is changed once its lines run past the end of the page", () => {
    expect(freshness(body, { lines: { start: 2, end: 3 }, reviewed: true })).toEqual({ state: "changed" });
  });
});
