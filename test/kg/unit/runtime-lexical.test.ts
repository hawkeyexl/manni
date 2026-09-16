import { describe, expect, it } from "vitest";
import { createLexicalIndex } from "../../../src/kg/runtime/lexical.js";
import { findEntry, rrfMerge } from "../../../src/kg/runtime/entry.js";
import { createTrace, type EntryCandidate } from "../../../src/kg/runtime/trace.js";
import type { SearchIndexDoc } from "../../../src/kg/core/search-index.js";
import { encodeVectorIndex } from "../../../src/kg/core/vector-index.js";
import {
  createVectorIndex,
  VectorMismatchError,
} from "../../../src/kg/runtime/vector.js";

const DOC = "https://ex.com/kg/doc/docs/a.md";
const SEC_INSTALL = `${DOC}#install`;
const SEC_OTHER = `${DOC}#other`;
const CONCEPT = "https://ex.com/kg/concept/configuration";

const INDEX: SearchIndexDoc = {
  version: 1,
  entries: [
    {
      id: CONCEPT,
      type: "skos:Concept",
      title: "Configuration",
      labels: "Configuration config settings",
    },
    {
      id: DOC,
      type: "dockg:Document",
      title: "A Document",
      description: "About installing.",
    },
    {
      id: SEC_INSTALL,
      type: "dockg:Section",
      title: "Install",
      text: "## Install\n\nRun the installer. The default cache directory is marmalade.",
    },
    {
      id: SEC_OTHER,
      type: "dockg:Section",
      title: "Other",
      text: "## Other\n\nUnrelated notes.",
    },
  ],
};

const index = () => createLexicalIndex(INDEX);

describe("createLexicalIndex", () => {
  it("accepts a JSON string as well as a parsed document", () => {
    expect(createLexicalIndex(JSON.stringify(INDEX)).size()).toBe(4);
  });

  it("finds a node by its title", () => {
    const [top] = index().search("install");
    expect(top?.iri).toBe(SEC_INSTALL);
    expect(top?.via).toBe("lexical");
  });

  it("finds a concept by an alternative label", () => {
    const hits = index().search("settings");
    expect(hits[0]?.iri).toBe(CONCEPT);
  });

  it("finds a node by body text the graph does not contain", () => {
    // "marmalade" appears only in the section body. The graph carries titles
    // only, so this is the case the search artifact exists to make possible
    // (ADR 01019) — without it, this query returns nothing.
    const hits = index().search("marmalade");
    expect(hits.map((h) => h.iri)).toContain(SEC_INSTALL);
  });

  it("tolerates a typo via fuzzy matching", () => {
    const hits = index().search("instal");
    expect(hits.map((h) => h.iri)).toContain(SEC_INSTALL);
  });

  it("honors the limit", () => {
    expect(index().search("install", { limit: 1 })).toHaveLength(1);
  });

  it("yields an empty index for JSON that is not a search artifact", () => {
    // MiniSearch's addAll throws "documents is not iterable" on this.
    const notAnIndex = JSON.stringify({ "@graph": [], entries: { a: 1 } });
    expect(() => createLexicalIndex(notAnIndex)).not.toThrow();
    expect(createLexicalIndex(notAnIndex).size()).toBe(0);
    expect(createLexicalIndex("null").size()).toBe(0);
  });

  it("returns nothing for an empty query or a term with no match", () => {
    expect(index().search("")).toEqual([]);
    expect(index().search("   ")).toEqual([]);
    expect(index().search("zzzznotpresent")).toEqual([]);
  });

  it("ranks identically across repeated searches", () => {
    const a = index().search("configuration");
    const b = index().search("configuration");
    expect(b).toEqual(a);
  });

  it("exposes the entry behind an IRI", () => {
    expect(index().entry(SEC_INSTALL)?.title).toBe("Install");
    expect(index().entry("urn:nope")).toBeUndefined();
  });
});

describe("rrfMerge", () => {
  const cand = (iri: string, via: EntryCandidate["via"]): EntryCandidate => ({
    iri,
    score: 1,
    via,
  });

  it("is an identity ranking for a single list", () => {
    const list = [cand("urn:a", "lexical"), cand("urn:b", "lexical")];
    expect(rrfMerge([list]).map((c) => c.iri)).toEqual(["urn:a", "urn:b"]);
  });

  it("keeps a single leg's provenance and marks fused seeds hybrid", () => {
    const lexical = [cand("urn:a", "lexical")];
    const vector = [cand("urn:a", "vector"), cand("urn:b", "vector")];
    const merged = rrfMerge([lexical, vector]);
    expect(merged.find((c) => c.iri === "urn:a")?.via).toBe("hybrid");
    expect(merged.find((c) => c.iri === "urn:b")?.via).toBe("vector");
  });

  it("ranks a node both legs agree on above one only a single leg found", () => {
    const lexical = [
      cand("urn:shared", "lexical"),
      cand("urn:onlyA", "lexical"),
    ];
    const vector = [cand("urn:shared", "vector"), cand("urn:onlyB", "vector")];
    expect(rrfMerge([lexical, vector])[0]?.iri).toBe("urn:shared");
  });

  it("does not depend on the order the rankings are passed in", () => {
    const a = [cand("urn:a", "lexical"), cand("urn:b", "lexical")];
    const b = [cand("urn:b", "vector"), cand("urn:c", "vector")];
    expect(rrfMerge([b, a])).toEqual(rrfMerge([a, b]));
  });

  it("breaks ties by IRI", () => {
    const one = [cand("urn:z", "lexical")];
    const two = [cand("urn:a", "vector")];
    // Both are rank 1 in their own list, so scores are equal.
    expect(rrfMerge([one, two]).map((c) => c.iri)).toEqual(["urn:a", "urn:z"]);
  });

  it("returns nothing for no rankings or empty ones", () => {
    expect(rrfMerge([])).toEqual([]);
    expect(rrfMerge([[], []])).toEqual([]);
  });
});

describe("findEntry", () => {
  it("records every candidate in the trace", async () => {
    const trace = createTrace();
    const { candidates } = await findEntry("install", {
      lexical: index(),
      trace,
    });
    expect(candidates.length).toBeGreaterThan(0);
    expect(trace.entry).toEqual(candidates);
    expect(trace.entry[0]?.via).toBe("lexical");
  });

  it("honors the limit and starts its own trace when none is given", async () => {
    const result = await findEntry("install", { lexical: index(), limit: 1 });
    expect(result.candidates).toHaveLength(1);
    expect(result.trace.entry).toHaveLength(1);
  });

  it("falls back to the default limit when the limit is not a count", async () => {
    // `--limit abc` parses to NaN; slice(0, NaN) would report "0 results" for a
    // query that does match.
    const result = await findEntry("install", {
      lexical: index(),
      limit: Number.NaN,
    });
    expect(result.candidates.length).toBeGreaterThan(0);
    const zero = await findEntry("install", { lexical: index(), limit: 0 });
    expect(zero.candidates).toHaveLength(0);
  });

  it("returns no candidates and no trace entries for an unmatched query", async () => {
    const result = await findEntry("zzzznotpresent", { lexical: index() });
    expect(result.candidates).toEqual([]);
    expect(result.trace.entry).toEqual([]);
  });

  it("returns the lexical leg separately, with an empty vector leg", async () => {
    // A caller rendering a search UI wants "text matches" as its own list.
    const result = await findEntry("install", { lexical: index() });
    expect(result.lexical.length).toBeGreaterThan(0);
    expect(result.lexical.every((c) => c.via === "lexical")).toBe(true);
    expect(result.vector).toEqual([]);
  });
});

describe("findEntry with a vector leg", () => {
  const A = SEC_INSTALL;
  const B = CONCEPT;

  /** A tiny vector index: A points at x, B at y. */
  const vectors = () =>
    createVectorIndex(
      encodeVectorIndex(
        [
          { id: A, vector: Float32Array.from([1, 0]) },
          { id: B, vector: Float32Array.from([0, 1]) },
        ],
        { model: "mock", dtype: "q8", source: "sha256:x", language: "en" },
      ),
    );

  const embedTo = (v: number[]) => () => Promise.resolve(Float32Array.from(v));

  it("returns both legs and a fused ranking", async () => {
    const result = await findEntry("install", {
      lexical: index(),
      vectors: vectors(),
      embedQuery: embedTo([1, 0]),
    });
    expect(result.lexical.every((c) => c.via === "lexical")).toBe(true);
    expect(result.vector.every((c) => c.via === "vector")).toBe(true);
    expect(result.vector[0]!.iri).toBe(A);
    expect(result.candidates.length).toBeGreaterThan(0);
  });

  it("promotes a node both legs rank, and marks it hybrid", async () => {
    // "install" ranks SEC_INSTALL lexically; the query vector ranks it first
    // semantically too — so fusion should put it on top, via hybrid.
    const result = await findEntry("install", {
      lexical: index(),
      vectors: vectors(),
      embedQuery: embedTo([1, 0]),
    });
    expect(result.candidates[0]!.iri).toBe(A);
    expect(result.candidates[0]!.via).toBe("hybrid");
  });

  it("surfaces a node only the vector leg found", async () => {
    // The concept is not a lexical hit for this query, but is the nearest
    // vector — the whole point of adding the semantic leg.
    const result = await findEntry("zzzznotpresent", {
      lexical: index(),
      vectors: vectors(),
      embedQuery: embedTo([0, 1]),
    });
    expect(result.lexical).toEqual([]);
    expect(result.candidates.map((c) => c.iri)).toContain(B);
  });

  it("stays lexical-only when the embedder is absent", async () => {
    // Degrade, never fail (ADR 01009) — a vector index without an embedder is
    // not an error.
    const result = await findEntry("install", {
      lexical: index(),
      vectors: vectors(),
    });
    expect(result.vector).toEqual([]);
    expect(result.candidates.every((c) => c.via === "lexical")).toBe(true);
  });

  it("does not embed an empty query", async () => {
    let called = 0;
    const result = await findEntry("   ", {
      lexical: index(),
      vectors: vectors(),
      embedQuery: () => {
        called += 1;
        return Float32Array.from([1, 0]);
      },
    });
    expect(called).toBe(0);
    expect(result.candidates).toEqual([]);
  });

  it("refuses a wrong-model index at the runtime layer, not just the CLI", async () => {
    // The browser is the surface this matters on: a host following the README
    // example gets the refusal without wiring a check itself (ADR 01020).
    await expect(
      findEntry("install", {
        lexical: index(),
        vectors: vectors(),
        embedder: {
          model: "some/other-model",
          dtype: "q8",
          embed: () => Float32Array.from([1, 0]),
        },
      }),
    ).rejects.toThrow(VectorMismatchError);
  });

  it("refuses a dtype mismatch too", async () => {
    await expect(
      findEntry("install", {
        lexical: index(),
        vectors: vectors(),
        embedder: {
          model: "mock",
          dtype: "fp32",
          embed: () => Float32Array.from([1, 0]),
        },
      }),
    ).rejects.toThrow(/different function/);
  });

  it("refuses before embedding, so a mismatch costs nothing", async () => {
    let embedCalls = 0;
    await expect(
      findEntry("install", {
        lexical: index(),
        vectors: vectors(),
        embedder: {
          model: "wrong/model",
          dtype: "q8",
          embed: () => {
            embedCalls += 1;
            return Float32Array.from([1, 0]);
          },
        },
      }),
    ).rejects.toThrow(VectorMismatchError);
    expect(embedCalls).toBe(0);
  });

  it("runs the vector leg when the embedder matches the index", async () => {
    const result = await findEntry("install", {
      lexical: index(),
      vectors: vectors(),
      embedder: {
        model: "mock",
        dtype: "q8",
        embed: () => Float32Array.from([1, 0]),
      },
    });
    expect(result.vector.length).toBeGreaterThan(0);
  });

  it("still allows a bare embedQuery, unverified by design", async () => {
    // The escape hatch carries no identity, so no model check is possible —
    // documented as such rather than silently pretending to verify.
    const result = await findEntry("install", {
      lexical: index(),
      vectors: vectors(),
      embedQuery: () => Float32Array.from([1, 0]),
    });
    expect(result.vector.length).toBeGreaterThan(0);
  });

  it("refuses a sidecar built from an older corpus", async () => {
    // The IRIs in a stale sidecar may no longer exist, and it misses
    // everything added since — ranking against it is the silent wrong answer.
    await expect(
      findEntry("install", {
        lexical: index(),
        vectors: vectors(),
        embedder: {
          model: "mock",
          dtype: "q8",
          embed: () => Float32Array.from([1, 0]),
        },
        source: "sha256:a-different-corpus",
      }),
    ).rejects.toThrow(/corpus changed/);
  });

  it("checks staleness on the unverified path too", async () => {
    // Staleness is a property of the corpus, not the embedder, so a caller
    // using the `embedQuery` escape hatch still gets this half.
    await expect(
      findEntry("install", {
        lexical: index(),
        vectors: vectors(),
        embedQuery: () => Float32Array.from([1, 0]),
        source: "sha256:a-different-corpus",
      }),
    ).rejects.toThrow(VectorMismatchError);
  });

  it("runs when the digest agrees", async () => {
    const result = await findEntry("install", {
      lexical: index(),
      vectors: vectors(),
      embedQuery: () => Float32Array.from([1, 0]),
      source: "sha256:x",
    });
    expect(result.vector.length).toBeGreaterThan(0);
  });

  it("accepts a synchronous embedder", async () => {
    const result = await findEntry("install", {
      lexical: index(),
      vectors: vectors(),
      embedQuery: () => Float32Array.from([1, 0]),
    });
    expect(result.vector.length).toBeGreaterThan(0);
  });
});
