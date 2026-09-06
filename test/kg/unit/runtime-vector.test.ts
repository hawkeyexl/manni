import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { encodeVectorIndex } from "../../../src/kg/core/vector-index.js";
import {
  createVectorIndex,
  searchIndexDigest,
  VectorMismatchError,
} from "../../../src/kg/runtime/vector.js";

const META = {
  model: "test/model",
  dtype: "q8",
  source: "sha256:corpus-v1",
  language: "en",
};

/**
 * Three orthogonal-ish vectors so expected rankings are obvious by hand:
 * a points at x, b at y, c halfway between x and y.
 */
const INDEX = () =>
  createVectorIndex(
    encodeVectorIndex(
      [
        { id: "urn:a", vector: Float32Array.from([1, 0, 0]) },
        { id: "urn:b", vector: Float32Array.from([0, 1, 0]) },
        { id: "urn:c", vector: Float32Array.from([1, 1, 0]) },
      ],
      META,
    ),
  );

describe("createVectorIndex — standalone search", () => {
  it("ranks by cosine similarity without any lexical index or graph", () => {
    // Pure semantic search: a query vector in, ranked IRIs out.
    const hits = INDEX().search(Float32Array.from([1, 0, 0]));
    expect(hits[0]!.iri).toBe("urn:a");
    expect(hits[0]!.score).toBeCloseTo(1, 5);
    // c is 45° from the query, b is orthogonal.
    expect(hits[1]!.iri).toBe("urn:c");
    expect(hits[1]!.score).toBeCloseTo(Math.SQRT1_2, 5);
    expect(hits[2]!.iri).toBe("urn:b");
    expect(hits[2]!.score).toBeCloseTo(0, 5);
    expect(hits.every((h) => h.via === "vector")).toBe(true);
  });

  it("normalizes the query, so magnitude does not change the ranking", () => {
    const unit = INDEX().search(Float32Array.from([1, 0, 0]));
    const scaled = INDEX().search(Float32Array.from([100, 0, 0]));
    expect(scaled.map((h) => h.iri)).toEqual(unit.map((h) => h.iri));
    expect(scaled[0]!.score).toBeCloseTo(unit[0]!.score, 6);
  });

  it("does not mutate the caller's query vector", () => {
    const query = Float32Array.from([3, 4, 0]);
    INDEX().search(query);
    expect([...query]).toEqual([3, 4, 0]);
  });

  it("breaks ties by IRI", () => {
    // b and c... use a query equidistant from two entries with equal scores.
    const index = createVectorIndex(
      encodeVectorIndex(
        [
          { id: "urn:z", vector: Float32Array.from([1, 0]) },
          { id: "urn:a", vector: Float32Array.from([1, 0]) },
        ],
        META,
      ),
    );
    expect(index.search(Float32Array.from([1, 0])).map((h) => h.iri)).toEqual([
      "urn:a",
      "urn:z",
    ]);
  });

  it("honors limit, and falls back to the default for a NaN limit", () => {
    expect(
      INDEX().search(Float32Array.from([1, 0, 0]), { limit: 2 }),
    ).toHaveLength(2);
    expect(INDEX().search(Float32Array.from([1, 0, 0]), { limit: 0 })).toEqual(
      [],
    );
    // `--limit abc` parses to NaN; slice(0, NaN) would report a confident zero.
    const nan = INDEX().search(Float32Array.from([1, 0, 0]), {
      limit: Number.NaN,
    });
    expect(nan).toHaveLength(3);
  });

  it("applies minScore when asked, and imposes none by default", () => {
    const all = INDEX().search(Float32Array.from([1, 0, 0]));
    expect(all).toHaveLength(3);
    const filtered = INDEX().search(Float32Array.from([1, 0, 0]), {
      minScore: 0.5,
    });
    expect(filtered.map((h) => h.iri)).toEqual(["urn:a", "urn:c"]);
  });

  it("throws a typed mismatch on a query of the wrong dimensionality", () => {
    // Zero-filling or truncating would return confident nonsense. Typed like
    // every other mismatch so a caller handles it the same way rather than
    // seeing a bare Error's stack.
    expect(() => INDEX().search(Float32Array.from([1, 0]))).toThrow(
      VectorMismatchError,
    );
    try {
      INDEX().search(Float32Array.from([1, 0]));
    } catch (e) {
      expect((e as VectorMismatchError).reason).toBe("dims");
      expect((e as Error).message).toMatch(/2 dimensions/);
    }
  });

  it("returns nothing from an empty index", () => {
    const empty = createVectorIndex(encodeVectorIndex([], META));
    expect(empty.size()).toBe(0);
    expect(empty.search(Float32Array.from([1]))).toEqual([]);
  });

  it("exposes its provenance", () => {
    const index = INDEX();
    expect(index.model).toBe("test/model");
    // dtype is exposed so the query side can embed at the same quantization —
    // q8 and fp32 weights are different functions (ADR 01020).
    expect(index.dtype).toBe("q8");
    expect(index.dims).toBe(3);
    expect(index.source).toBe("sha256:corpus-v1");
    expect(index.size()).toBe(3);
    expect(index.idAt(0)).toBe("urn:a");
    expect(index.idAt(99)).toBeUndefined();
  });
});

describe("searchIndexDigest", () => {
  it("computes exactly the digest `manni kg embed` records as `source`", async () => {
    // The whole point of exporting this: a browser host that hand-rolled the
    // recipe would get a digest that never matches, turning the staleness
    // check into a permanent refusal. Pinned against the Node recipe in
    // src/commands/embed.ts.
    const raw = '{"version":1,"entries":[]}';
    const expected = `sha256:${createHash("sha256").update(raw, "utf8").digest("hex")}`;
    expect(await searchIndexDigest(raw)).toBe(expected);
  });

  it("hashes the raw text, so re-serializing changes the answer", async () => {
    // Callers must pass the response text, not JSON.stringify(parsed).
    const raw = '{ "version": 1 }';
    expect(await searchIndexDigest(raw)).not.toBe(
      await searchIndexDigest(JSON.stringify(JSON.parse(raw))),
    );
  });
});

describe("check — refuse rather than rank against the wrong vectors", () => {
  it("passes when model, dims, and source agree", () => {
    expect(
      INDEX().check({
        model: "test/model",
        dims: 3,
        source: "sha256:corpus-v1",
      }),
    ).toBeUndefined();
    expect(INDEX().check({})).toBeUndefined();
  });

  it("reports a model mismatch", () => {
    const m = INDEX().check({ model: "other/model" });
    expect(m?.reason).toBe("model");
    expect(m?.detail).toContain("manni kg embed");
  });

  it("reports a dtype mismatch", () => {
    // Same model at a different quantization is still a different function.
    const m = INDEX().check({ model: "test/model", dtype: "fp32" });
    expect(m?.reason).toBe("dtype");
    expect(m?.detail).toContain("manni kg embed");
  });

  it("reports a dimension mismatch", () => {
    expect(INDEX().check({ dims: 384 })?.reason).toBe("dims");
  });

  it("reports a stale corpus", () => {
    const m = INDEX().check({ source: "sha256:corpus-v2" });
    expect(m?.reason).toBe("stale-source");
    expect(m?.detail).toContain("corpus changed");
  });
});
