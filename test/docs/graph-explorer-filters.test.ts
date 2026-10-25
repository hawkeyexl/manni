import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  authoringMetadata,
  explorerModel,
  defaults,
  readState,
  writeState,
} from "../../docs/src/components/graph-explorer-model.js";
import {
  metadataFields,
  metadataValues,
  filterMetadata,
} from "../../docs/src/components/graph-explorer-filters.js";

const read = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      new URL(`../fixtures/graph-explorer/${name}`, import.meta.url),
      "utf8",
    ),
  );
const graph = read("graph.jsonld");
if (!graph || typeof graph !== "object") throw new Error("Invalid fixture");
const model = explorerModel(graph);
const metadata = authoringMetadata(read("metadata.json"));

describe("page metadata filters", () => {
  it("filters how-to documents and their sections using source-page metadata", () => {
    expect(
      filterMetadata(model.nodes, metadata, "how-to", []).map(
        (node) => node.id,
      ),
    ).toEqual(expect.arrayContaining(["urn:doc:ci", "urn:doc:ci#setup"]));
    expect(
      filterMetadata(model.nodes, metadata, "how-to", []).some(
        (node) => node.id === "urn:doc:config",
      ),
    ).toBe(false);
  });
  it("combines conditions with AND and supports array members, nested fields and booleans", () => {
    const result = filterMetadata(model.nodes, metadata, "", [
      { field: "/tags", operator: "is", value: "CI" },
      { field: "/graph/type", operator: "is", value: "task" },
      { field: "/reviewed", operator: "is", value: "true" },
    ]);
    expect(result.map((node) => node.id)).toContain("urn:doc:ci");
    expect(result.map((node) => node.id)).not.toContain("urn:doc:config");
    expect(
      filterMetadata(model.nodes, metadata, "", [
        { field: "/tags", operator: "contains", value: "auto" },
      ]).map((node) => node.id),
    ).toContain("urn:doc:ci");
  });
  it("matches present/missing fields only on nodes with a source page", () => {
    const result = filterMetadata(model.nodes, metadata, "", [
      { field: "/language", operator: "missing", value: "" },
    ]);
    expect(result.map((node) => node.id)).toContain("urn:persona:devin");
    expect(result.every((node) => Boolean(node.path))).toBe(true);
    expect(filterMetadata(model.nodes, metadata, "", [])).toEqual(model.nodes);
  });
  it("discovers available fields and values without flattening object arrays", () => {
    expect(metadataFields(metadata)).toContain("/graph/type");
    expect(metadataFields(metadata)).toContain("/tags");
    expect(metadataValues(metadata, "/type")).toEqual([
      "how-to",
      "persona",
      "reference",
    ]);
    expect(metadataValues(metadata, "/tags")).toContain("automation");
  });
  it("roundtrips metadata conditions in shareable URLs and ignores malformed conditions", () => {
    const state = {
      ...defaults(),
      contentType: "how-to",
      metadata: [
        { field: "/tags", operator: "is" as const, value: "ci & checks" },
      ],
    };
    expect(readState(writeState(state))).toEqual(state);
    expect(
      readState(
        "#meta=broken&meta=%5B%22%2Ftype%22%2C%22execute%22%2C%22bad%22%5D",
      ).metadata,
    ).toEqual([]);
  });
});
