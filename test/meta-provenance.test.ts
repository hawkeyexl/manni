/**
 * The shared `meta-provenance` merge and reader (proposal 0046). `manni meta
 * fill` merges under `fields` and `manni docevals fill` under `evals`; both
 * keep what an entry already held, and the reader never throws on a page.
 */
import { describe, expect, it } from "vitest";
import {
  mergeMetaProvenance,
  metaProvenanceEntries,
} from "../src/meta/core/meta-provenance.js";

describe("mergeMetaProvenance", () => {
  it("appends a new entry under the key it is given", () => {
    const merged = mergeMetaProvenance(undefined, "m", "evals", [{ name: "a", confidence: 0.8 }]);
    expect(merged?.list).toEqual([{ "generated-by": "m", evals: ["a"], confidence: { a: 0.8 } }]);
    expect(merged?.names).toEqual(["a"]);
  });

  it("merges evals into the model's first entry, keeping its fields and confidences", () => {
    const held = [
      { "generated-by": "other", evals: ["a"] },
      { "generated-by": "m", fields: ["/title"], evals: ["a"], confidence: { "/title": 0.9, a: 0.5 } },
      { "generated-by": "m", evals: ["z"] },
    ];
    const merged = mergeMetaProvenance(held, "m", "evals", [
      { name: "a", confidence: 0.7 },
      { name: "b", confidence: 0.6 },
    ]);
    expect(merged?.entry).toEqual({
      "generated-by": "m",
      fields: ["/title"],
      evals: ["a", "b"],
      confidence: { "/title": 0.9, a: 0.7, b: 0.6 },
    });
    expect(merged?.list[0]).toBe(held[0]);
    expect(merged?.list[2]).toBe(held[2]);
    expect(held[1]?.evals).toEqual(["a"]);
  });

  it("merges fields without touching the entry's evals", () => {
    const held = [{ "generated-by": "m", evals: ["a"] }];
    const merged = mergeMetaProvenance(held, "m", "fields", [{ name: "/title", confidence: 0.9 }]);
    expect(merged?.entry).toEqual({
      "generated-by": "m",
      evals: ["a"],
      fields: ["/title"],
      confidence: { "/title": 0.9 },
    });
  });

  it("does not merge into something other than a list", () => {
    expect(mergeMetaProvenance("reviewed", "m", "evals", [])).toBeUndefined();
  });
});

describe("metaProvenanceEntries", () => {
  it("reads each entry's model, fields and evals", () => {
    expect(
      metaProvenanceEntries([
        { "generated-by": "m", fields: ["/title"], evals: ["a"], confidence: { a: 1 } },
        { "generated-by": "n" },
      ]),
    ).toEqual([
      { "generated-by": "m", fields: ["/title"], evals: ["a"] },
      { "generated-by": "n", fields: [], evals: [] },
    ]);
  });

  it("skips what it cannot read rather than throwing", () => {
    expect(metaProvenanceEntries("nonsense")).toEqual([]);
    expect(
      metaProvenanceEntries(["x", null, [], { fields: ["/a"] }, { "generated-by": "" }, { "generated-by": "m", evals: "a" }]),
    ).toEqual([{ "generated-by": "m", fields: [], evals: [] }]);
  });
});
