import { describe, expect, it } from "vitest";
import {
  decodeVectorIndex,
  encodeVectorIndex,
  normalize,
  VectorIndexError,
} from "../../../src/kg/core/vector-index.js";

const META = {
  model: "test/model",
  dtype: "q8",
  source: "sha256:abc",
  language: "en",
};

const ENTRIES = [
  { id: "urn:b", vector: Float32Array.from([0, 3, 4]) },
  { id: "urn:a", vector: Float32Array.from([1, 0, 0]) },
];

describe("normalize", () => {
  it("scales a vector to unit length", () => {
    const v = normalize(Float32Array.from([0, 3, 4]));
    expect(v[0]).toBeCloseTo(0, 6);
    expect(v[1]).toBeCloseTo(0.6, 6);
    expect(v[2]).toBeCloseTo(0.8, 6);
  });

  it("leaves a zero vector alone rather than producing NaNs", () => {
    // Dividing by a zero norm would poison every later dot product.
    const v = normalize(new Float32Array(4));
    expect([...v]).toEqual([0, 0, 0, 0]);
  });
});

describe("encodeVectorIndex / decodeVectorIndex", () => {
  it("round-trips the header and normalized vectors", () => {
    const { header, vectors } = decodeVectorIndex(
      encodeVectorIndex(ENTRIES, META),
    );
    expect(header.model).toBe("test/model");
    expect(header.dtype).toBe("q8");
    expect(header.dims).toBe(3);
    expect(header.count).toBe(2);
    expect(header.source).toBe("sha256:abc");
    // Sorted by IRI, so payload order is independent of input order.
    expect(header.ids).toEqual(["urn:a", "urn:b"]);
    expect([...vectors.slice(0, 3)]).toEqual([1, 0, 0]);
    expect(vectors[4]).toBeCloseTo(0.6, 6);
    expect(vectors[5]).toBeCloseTo(0.8, 6);
  });

  it("normalizes at encode time without mutating the caller's arrays", () => {
    const mine = Float32Array.from([0, 3, 4]);
    encodeVectorIndex([{ id: "urn:x", vector: mine }], META);
    expect([...mine]).toEqual([0, 3, 4]);
  });

  it("is byte-identical across two encodes, regardless of input order", () => {
    const a = encodeVectorIndex(ENTRIES, META);
    const b = encodeVectorIndex([...ENTRIES].reverse(), META);
    expect(Buffer.from(b).equals(Buffer.from(a))).toBe(true);
  });

  it("handles an empty index", () => {
    const { header, vectors } = decodeVectorIndex(encodeVectorIndex([], META));
    expect(header.count).toBe(0);
    expect(header.ids).toEqual([]);
    expect(vectors).toHaveLength(0);
  });

  it("does not assume 384 dimensions", () => {
    const dims = 7;
    const { header, vectors } = decodeVectorIndex(
      encodeVectorIndex(
        [{ id: "urn:a", vector: Float32Array.from({ length: dims }, () => 1) }],
        META,
      ),
    );
    expect(header.dims).toBe(dims);
    expect(vectors).toHaveLength(dims);
  });

  it("decodes correctly when the bytes are a view into a larger buffer", () => {
    // A misaligned byteOffset would break naive Float32Array aliasing.
    const encoded = encodeVectorIndex(ENTRIES, META);
    const padded = new Uint8Array(encoded.length + 3);
    padded.set(encoded, 3);
    const view = padded.subarray(3);
    expect(decodeVectorIndex(view).header.ids).toEqual(["urn:a", "urn:b"]);
  });

  it("rejects inconsistent dimensions at encode time", () => {
    expect(() =>
      encodeVectorIndex(
        [
          { id: "urn:a", vector: Float32Array.from([1, 0]) },
          { id: "urn:b", vector: Float32Array.from([1, 0, 0]) },
        ],
        META,
      ),
    ).toThrow(VectorIndexError);
  });
});

describe("decodeVectorIndex rejects malformed input", () => {
  const encoded = () => encodeVectorIndex(ENTRIES, META);

  it("rejects a file that is too short", () => {
    expect(() => decodeVectorIndex(new Uint8Array(4))).toThrow(
      VectorIndexError,
    );
  });

  it("rejects the wrong file entirely", () => {
    const notOurs = new TextEncoder().encode('{ "@graph": [] }        ');
    expect(() => decodeVectorIndex(notOurs)).toThrow(/bad magic/);
  });

  it("rejects an unsupported format version", () => {
    const bytes = encoded();
    new DataView(bytes.buffer).setUint32(4, 99, true);
    expect(() => decodeVectorIndex(bytes)).toThrow(/version 99/);
  });

  it("rejects a truncated payload", () => {
    const bytes = encoded();
    expect(() =>
      decodeVectorIndex(bytes.subarray(0, bytes.length - 4)),
    ).toThrow(/truncated/);
  });

  it("rejects a header that overruns the file", () => {
    const bytes = encoded();
    new DataView(bytes.buffer).setUint32(8, 10_000, true);
    expect(() => decodeVectorIndex(bytes)).toThrow(/truncated/);
  });

  it("rejects a header that is not valid JSON", () => {
    const bytes = encoded();
    bytes[12] = 0x7b; // '{' with the rest intact → unparseable
    bytes[13] = 0x7b;
    expect(() => decodeVectorIndex(bytes)).toThrow(VectorIndexError);
  });
});

describe("format version 2 (ADR 01038)", () => {
  it("round-trips the language the sidecar covers", () => {
    const bytes = encodeVectorIndex(
      [{ id: "a", vector: Float32Array.from([1, 0]) }],
      { ...META, language: "de-AT" },
    );
    expect(decodeVectorIndex(bytes).header.language).toBe("de-AT");
  });

  it("refuses a version-1 sidecar rather than misreading its header", () => {
    // Language is not optional in v2: a v1 file decoded as v2 would report
    // `undefined` for the one field that says which locale it covers, and a
    // host would pair it with whatever index it happened to fetch.
    const bytes = encodeVectorIndex(
      [{ id: "a", vector: Float32Array.from([1, 0]) }],
      META,
    );
    new DataView(bytes.buffer, bytes.byteOffset).setUint32(4, 1, true);
    expect(() => decodeVectorIndex(bytes)).toThrow(/version 1/);
  });
});
