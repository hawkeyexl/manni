import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  authoringMetadata,
  explorerModel,
  filterNodes,
  neighborhood,
  nearestNode,
  nearestEdge,
  hoverNeighborhood,
  highlightSeed,
  readState,
  writeState,
  sourceLinks,
} from "../../docs/src/components/graph-explorer-model.js";

const fixture = JSON.parse(
  readFileSync(
    new URL("../fixtures/graph-explorer/graph.jsonld", import.meta.url),
    "utf8",
  ),
) as object;

describe("graph explorer", () => {
  it("keeps a clicked highlight ahead of pointer hover and falls back when it is cleared or filtered out", () => {
    const nodes = explorerModel(fixture).nodes;
    expect(highlightSeed(nodes, "urn:doc:ci", "urn:persona:devin")).toBe(
      "urn:doc:ci",
    );
    expect(highlightSeed(nodes, "urn:doc:ci", "")).toBe("urn:doc:ci");
    expect(highlightSeed(nodes, "", "urn:persona:devin")).toBe(
      "urn:persona:devin",
    );
    expect(highlightSeed(nodes, "not-visible", "urn:persona:devin")).toBe(
      "urn:persona:devin",
    );
    expect(highlightSeed(nodes, "not-visible", "not-visible")).toBe("");
  });
  it("highlights only the hovered node and its direct incoming and outgoing neighbors", () => {
    const model = explorerModel(fixture);
    const related = hoverNeighborhood(model.edges, "urn:journey:d11");
    expect([...related].sort()).toEqual([
      "urn:doc:ci",
      "urn:journey:d11",
      "urn:persona:devin",
    ]);
    expect(related.has("urn:doc:config")).toBe(false);
    expect([...hoverNeighborhood([], "isolated")]).toEqual(["isolated"]);
    expect(hoverNeighborhood(model.edges, "").size).toBe(0);
  });
  it("finds the nearest connection segment and ignores distant or unresolved edges", () => {
    const edges = [
      { source: "a", target: "b", predicate: "serves" },
      { source: "c", target: "d", predicate: "references" },
    ];
    const positions = new Map([
      ["a", { x: 0, y: 0 }],
      ["b", { x: 100, y: 0 }],
      ["c", { x: 0, y: 40 }],
      ["d", { x: 100, y: 40 }],
    ]);
    expect(nearestEdge(edges, positions, 50, 3, 8)).toEqual(edges[0]);
    expect(nearestEdge(edges, positions, 50, 38, 8)).toEqual(edges[1]);
    expect(nearestEdge(edges, positions, 150, 0, 8)).toBeUndefined();
    expect(nearestEdge(edges, new Map(), 0, 0, 8)).toBeUndefined();
  });
  it("picks the nearest node in a dense view without selecting distant or unpositioned nodes", () => {
    const model = explorerModel(fixture);
    const positions = new Map([
      ["urn:persona:devin", { x: 10, y: 20 }],
      ["urn:doc:ci", { x: 14, y: 20 }],
    ]);
    expect(nearestNode(model.nodes, positions, 11, 20, 22)).toBe(
      "urn:persona:devin",
    );
    expect(nearestNode(model.nodes, positions, 500, 500, 22)).toBeUndefined();
    expect(nearestNode(model.nodes, new Map(), 10, 20, 22)).toBeUndefined();
  });
  it("keeps typed authoring records and the incoming journey chain", () => {
    const model = explorerModel(fixture);
    expect(model.nodes.find((n) => n.id === "urn:persona:devin")?.kind).toBe(
      "Persona",
    );
    const result = neighborhood(model, "urn:persona:devin", 2, "");
    expect(result.map((n) => n.id)).toContain("urn:doc:ci");
    expect(result.map((n) => n.id)).not.toContain("urn:doc:config");
    expect(
      neighborhood(model, "urn:persona:devin", 2, "schema:audience").map(
        (n) => n.id,
      ),
    ).not.toContain("urn:doc:ci");
  });

  it("searches the whole graph by title, identifier and source path", () => {
    const model = explorerModel(fixture);
    expect(filterNodes(model.nodes, "CI", [], "").map((n) => n.id)).toContain(
      "urn:doc:ci",
    );
    expect(
      filterNodes(model.nodes, "content-strategy/personas", ["Document"], ""),
    ).toHaveLength(1);
    expect(filterNodes(model.nodes, "devin", ["Journey"], "")).toHaveLength(0);
  });

  it("restores Unicode and reserved characters, rejects invalid options, and uses repeated type keys", () => {
    const state = {
      node: "urn:例?#&",
      highlight: "urn:例?#&",
      focus: "urn:journey:d11",
      q: "CI & docs",
      types: ["Persona", "Journey"],
      relation: "schema:audience",
      depth: 2 as const,
      view: "list" as const,
      contentType: "",
      metadata: [],
    };
    expect(readState(writeState(state))).toEqual(state);
    expect(readState("#depth=900&view=bad&type=MadeUp")).toMatchObject({
      depth: 1,
      view: "graph",
      types: [],
    });
  });

  it("links docs to their published route and strategy records to repository source", () => {
    expect(
      sourceLinks(
        "docs/src/content/docs/meta/ci/index.mdx",
        "/manni/",
        "abc123",
      ).page,
    ).toBe("/manni/meta/ci/");
    expect(
      sourceLinks(
        "docs/content-strategy/personas/devin.md",
        "/manni/",
        "abc123",
      ).source,
    ).toContain("/blob/abc123/docs/content-strategy/personas/devin.md");
    expect(sourceLinks("../../private", "/manni/", "main")).toEqual({});
    expect(sourceLinks("javascript:alert(1)", "/manni/", "main")).toEqual({});
  });

  it("rejects an invalid graph instead of displaying a misleading empty result", () => {
    expect(() => explorerModel({})).toThrow("Invalid graph");
  });

  it("keeps the focus first and resolves section metadata through its document", () => {
    const model = explorerModel(fixture);
    expect(neighborhood(model, "urn:persona:devin", 2, "")[0]?.id).toBe(
      "urn:persona:devin",
    );
    expect(
      model.nodes.find((node) => node.id === "urn:doc:ci#setup")?.path,
    ).toBe("docs/src/content/docs/meta/ci/index.mdx");
  });

  it("reads author-facing fields in the existing meta get format and rejects malformed records", () => {
    expect(
      authoringMetadata([
        { file: "docs/page.md", values: { personas: ["devin"] } },
      ]).get("docs/page.md"),
    ).toEqual({ personas: ["devin"] });
    expect(() => authoringMetadata({})).toThrow("Invalid authoring metadata");
    expect(() =>
      authoringMetadata([{ file: "docs/page.md", values: null }]),
    ).toThrow("Invalid authoring metadata");
  });
});
