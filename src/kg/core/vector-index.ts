/**
 * The vector sidecar (ADR 01020) — `kg/vectors.<lang>.bin`, embeddings for the
 * same text that language's lexical index covers (ADR 01038).
 *
 * Layout, fixed and little-endian throughout:
 *
 * ```
 *   0  magic "DKGV"            4 bytes
 *   4  format version (u32)    4 bytes
 *   8  header length (u32)     4 bytes
 *  12  header JSON (UTF-8)     headerLength bytes
 *   .  float32 payload         count * dims * 4 bytes
 * ```
 *
 * The header names the model, dtype, dimensions, the node IRIs in payload order
 * (sorted), and a digest of the `search.json` the vectors were built from — so
 * the runtime can refuse to rank against vectors from a different model or a
 * stale corpus rather than returning quietly wrong results.
 *
 * Vectors are **L2-normalized at build time and stored as float32**. Normalizing
 * makes cosine collapse to a dot product at query time; float32 rather than int8
 * because int8 retains only ~91% of retrieval quality at 384 dimensions — see
 * ADR 01020, where that correction is recorded.
 *
 * No `node:` imports: the encoder runs in the CLI, the decoder in the browser.
 */
import { byCodeUnit } from "./sort.js";

/** "DKGV" — dockg vectors. */
const MAGIC = 0x44_4b_47_56;
// 2 since ADR 01038: the header names the language its vectors cover, so a
// consumer cannot pair a sidecar with the wrong locale's index. A version-1
// file is refused by `decodeVectorIndex` rather than read as if it had one.
const FORMAT_VERSION = 2;
const HEADER_OFFSET = 12;

export interface VectorIndexHeader {
  /** Embedding model id, e.g. an HF repo path. */
  model: string;
  /** Model-weight quantization the vectors were produced under. */
  dtype: string;
  /** Vector dimensions. Never assumed — always read from here. */
  dims: number;
  /** Number of vectors; equals `ids.length`. */
  count: number;
  /** Node IRIs, sorted, in payload order. */
  ids: string[];
  /** Digest of the `search.<lang>.json` these were built from (staleness detection). */
  source: string;
  /**
   * BCP-47 tag of the index these cover, or `und` (ADR 01038). Recorded so a
   * host that fetched the wrong pair is refused rather than ranked against a
   * model that never saw the language.
   */
  language: string;
}

export interface VectorIndexDoc {
  header: VectorIndexHeader;
  /** `count * dims` floats, L2-normalized, row-major in `ids` order. */
  vectors: Float32Array;
}

/** Thrown for malformed input so callers can map it to an exit code / refusal. */
export class VectorIndexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VectorIndexError";
  }
}

/**
 * L2-normalize a vector in place and return it. A zero vector is left alone —
 * dividing by its norm would produce NaNs that silently poison every later dot
 * product.
 */
export function normalize(vector: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < vector.length; i++) sum += vector[i]! * vector[i]!;
  if (sum === 0) return vector;
  const inv = 1 / Math.sqrt(sum);
  for (let i = 0; i < vector.length; i++) vector[i]! *= inv;
  return vector;
}

/**
 * Encode entries into the sidecar. Entries are sorted by IRI first, so the bytes
 * depend on the set of entries and not on the order they were produced in.
 */
export function encodeVectorIndex(
  entries: Array<{ id: string; vector: Float32Array }>,
  meta: { model: string; dtype: string; source: string; language: string },
): Uint8Array {
  const sorted = [...entries].sort((a, b) => byCodeUnit(a.id, b.id));
  const dims = sorted[0]?.vector.length ?? 0;
  for (const entry of sorted) {
    if (entry.vector.length !== dims) {
      throw new VectorIndexError(
        `Inconsistent vector dimensions: ${entry.id} has ${entry.vector.length}, expected ${dims}.`,
      );
    }
  }

  const header: VectorIndexHeader = {
    model: meta.model,
    dtype: meta.dtype,
    dims,
    count: sorted.length,
    ids: sorted.map((e) => e.id),
    source: meta.source,
    language: meta.language,
  };
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));

  const payloadBytes = sorted.length * dims * 4;
  const out = new Uint8Array(HEADER_OFFSET + headerBytes.length + payloadBytes);
  const view = new DataView(out.buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, FORMAT_VERSION, true);
  view.setUint32(8, headerBytes.length, true);
  out.set(headerBytes, HEADER_OFFSET);

  let offset = HEADER_OFFSET + headerBytes.length;
  for (const entry of sorted) {
    // Normalize a copy: the caller's array is not ours to mutate.
    const vector = normalize(Float32Array.from(entry.vector));
    for (let i = 0; i < dims; i++) {
      view.setFloat32(offset, vector[i]!, true);
      offset += 4;
    }
  }
  return out;
}

/** Decode a sidecar, rejecting anything malformed rather than mis-reading it. */
export function decodeVectorIndex(bytes: Uint8Array): VectorIndexDoc {
  if (bytes.length < HEADER_OFFSET) {
    throw new VectorIndexError("Not a dockg vector index: file is too short.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== MAGIC) {
    throw new VectorIndexError(
      "Not a dockg vector index: bad magic — is this the right file?",
    );
  }
  const version = view.getUint32(4, true);
  if (version !== FORMAT_VERSION) {
    throw new VectorIndexError(
      `Unsupported vector index version ${version} (this build reads ${FORMAT_VERSION}) — re-run \`manni kg embed\`.`,
    );
  }

  const headerLength = view.getUint32(8, true);
  if (HEADER_OFFSET + headerLength > bytes.length) {
    throw new VectorIndexError("Vector index is truncated: header overruns.");
  }

  let header: VectorIndexHeader;
  try {
    header = JSON.parse(
      new TextDecoder().decode(
        bytes.subarray(HEADER_OFFSET, HEADER_OFFSET + headerLength),
      ),
    ) as VectorIndexHeader;
  } catch {
    throw new VectorIndexError("Vector index header is not valid JSON.");
  }
  if (
    !Array.isArray(header.ids) ||
    typeof header.dims !== "number" ||
    header.ids.length !== header.count
  ) {
    throw new VectorIndexError("Vector index header is malformed.");
  }

  const start = HEADER_OFFSET + headerLength;
  const expected = header.count * header.dims * 4;
  if (bytes.length - start !== expected) {
    throw new VectorIndexError(
      `Vector index is truncated: expected ${expected} payload bytes, found ${bytes.length - start}.`,
    );
  }

  // Copy rather than aliasing: `bytes` may be a view into a larger buffer whose
  // byteOffset is not 4-aligned, which Float32Array construction rejects.
  const vectors = new Float32Array(header.count * header.dims);
  for (let i = 0; i < vectors.length; i++) {
    vectors[i] = view.getFloat32(start + i * 4, true);
  }
  return { header, vectors };
}
