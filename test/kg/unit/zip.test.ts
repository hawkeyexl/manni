import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { writeZip, type ZipEntry } from "../../../src/kg/core/zip.js";

/** Minimal central-directory reader: returns entries in stored order with the
 *  fields the tests assert on. Parses only what a deterministic writeZip emits. */
function readEntries(zip: Buffer): Array<{
  name: string;
  method: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}> {
  // Locate the End Of Central Directory (fixed 22 bytes, no comment).
  const eocd = zip.length - 22;
  expect(zip.readUInt32LE(eocd)).toBe(0x06054b50);
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  const out = [];
  for (let i = 0; i < count; i++) {
    expect(zip.readUInt32LE(p)).toBe(0x02014b50);
    const method = zip.readUInt16LE(p + 10);
    const crc = zip.readUInt32LE(p + 16);
    const compressedSize = zip.readUInt32LE(p + 20);
    const uncompressedSize = zip.readUInt32LE(p + 24);
    const nameLen = zip.readUInt16LE(p + 28);
    const localOffset = zip.readUInt32LE(p + 42);
    const name = zip.toString("utf8", p + 46, p + 46 + nameLen);
    out.push({
      name,
      method,
      crc,
      compressedSize,
      uncompressedSize,
      localOffset,
    });
    p += 46 + nameLen;
  }
  return out;
}

/** Read an entry's raw stored bytes from its local header. */
function readData(zip: Buffer, localOffset: number): Buffer {
  expect(zip.readUInt32LE(localOffset)).toBe(0x04034b50);
  const compSize = zip.readUInt32LE(localOffset + 18);
  const nameLen = zip.readUInt16LE(localOffset + 26);
  const extraLen = zip.readUInt16LE(localOffset + 28);
  const start = localOffset + 30 + nameLen + extraLen;
  return zip.subarray(start, start + compSize);
}

const mime: ZipEntry = {
  name: "mimetype",
  data: Buffer.from("application/iirds+zip"),
  store: true,
};

describe("writeZip", () => {
  it("keeps the mimetype entry first and stored (uncompressed)", () => {
    const zip = writeZip([
      mime,
      { name: "content/a.md", data: Buffer.from("# Hello\n".repeat(20)) },
    ]);
    const entries = readEntries(zip);
    expect(entries[0]!.name).toBe("mimetype");
    expect(entries[0]!.method).toBe(0); // stored
    expect(entries[0]!.compressedSize).toBe(entries[0]!.uncompressedSize);
    // The mimetype's stored bytes are exactly the payload.
    expect(readData(zip, entries[0]!.localOffset).toString()).toBe(
      "application/iirds+zip",
    );
  });

  it("deflates non-stored entries and round-trips their content", () => {
    const payload = Buffer.from("# Hello\n".repeat(50));
    const zip = writeZip([mime, { name: "content/a.md", data: payload }]);
    const entries = readEntries(zip);
    const a = entries.find((e) => e.name === "content/a.md")!;
    expect(a.method).toBe(8); // deflate
    expect(inflateRawSync(readData(zip, a.localOffset)).equals(payload)).toBe(
      true,
    );
  });

  it("preserves the exact entry order it was given", () => {
    const zip = writeZip([
      mime,
      { name: "META-INF/metadata.rdf", data: Buffer.from("<rdf/>") },
      { name: "content/z.md", data: Buffer.from("z") },
      { name: "content/a.md", data: Buffer.from("a") },
    ]);
    expect(readEntries(zip).map((e) => e.name)).toEqual([
      "mimetype",
      "META-INF/metadata.rdf",
      "content/z.md",
      "content/a.md",
    ]);
  });

  it("is byte-identical across two calls with the same input (determinism)", () => {
    const input = (): ZipEntry[] => [
      mime,
      { name: "META-INF/metadata.rdf", data: Buffer.from("<rdf/>") },
      { name: "content/a.md", data: Buffer.from("# A\n".repeat(30)) },
    ];
    expect(writeZip(input()).equals(writeZip(input()))).toBe(true);
  });

  it("starts with the local file header signature", () => {
    const zip = writeZip([mime]);
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
  });
});
