/**
 * `@hawkeyexl/manni/site/rehype` (proposal 0095): each block element is
 * stamped with the file it came from and its file lines. A partial imported
 * into a page is compiled as its own file, so its blocks name the partial.
 */
import { describe, expect, it } from "vitest";
import manniLines from "../../src/site/rehype.js";

interface Node {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  position?: { start: { line: number }; end: { line: number } };
  children?: Node[];
}

const el = (tagName: string, start: number, end: number, children: Node[] = []): Node => ({
  type: "element",
  tagName,
  properties: {},
  position: { start: { line: start }, end: { line: end } },
  children,
});

function tree(): Node {
  return {
    type: "root",
    children: [
      el("h2", 5, 5, [{ type: "text" }]),
      el("p", 7, 8, [el("code", 7, 7)]),
      el("ul", 10, 11, [el("li", 10, 10), el("li", 11, 11)]),
      { type: "element", tagName: "p", properties: {}, children: [] },
      { type: "mdxJsxFlowElement", children: [el("p", 13, 13)] },
    ],
  };
}

const stamps = (node: Node, out: string[] = []): string[] => {
  const s = node.properties?.["dataManniSrc"];
  if (typeof s === "string") out.push(`${node.tagName ?? ""} ${s}`);
  for (const c of node.children ?? []) stamps(c, out);
  return out;
};

describe("manniLines", () => {
  it("stamps each block with its file, relative to the build's directory, and its lines", () => {
    const t = tree();
    manniLines()(t, { path: "/site/src/content/docs/guide.mdx", cwd: "/site" });
    expect(stamps(t)).toEqual([
      "h2 src/content/docs/guide.mdx:5-5",
      "p src/content/docs/guide.mdx:7-8",
      "ul src/content/docs/guide.mdx:10-11",
      "li src/content/docs/guide.mdx:10-10",
      "li src/content/docs/guide.mdx:11-11",
      "p src/content/docs/guide.mdx:13-13",
    ]);
  });

  it("names the partial in a partial's blocks", () => {
    const t = { type: "root", children: [el("p", 1, 2)] };
    manniLines()(t, { path: "C:\\site\\src\\partials\\note.mdx", cwd: "C:\\site" });
    expect(stamps(t)).toEqual(["p src/partials/note.mdx:1-2"]);
  });

  it("keeps the whole path of a file outside the build's directory", () => {
    const t = { type: "root", children: [el("p", 3, 3)] };
    manniLines()(t, { path: "/shared/note.md", cwd: "/site" });
    expect(stamps(t)).toEqual(["p /shared/note.md:3-3"]);
  });

  it("stamps nothing for a file with no path", () => {
    const t = tree();
    manniLines()(t, {});
    expect(stamps(t)).toEqual([]);
  });
});
