/**
 * Deterministic ZIP writer — the container half of the iiRDS package export
 * (ADR 01017). Hand-rolled rather than a library, for the same reason the Turtle
 * emitter avoids N3.Writer: byte output must be a stability contract, not
 * incidental library behavior. Node is `>=24`, so `zlib.crc32`/`deflateRawSync`
 * are native — no dependency.
 *
 * Determinism: DOS timestamps pinned to a fixed epoch (1980-01-01, never the
 * wall clock), no extra fields, fixed version bytes, and entry order = the order
 * passed in. Two `writeZip` calls with the same input produce identical bytes.
 * The caller is responsible for putting a stored `mimetype` entry first (the
 * iiRDS/OCF container rule).
 */
import { crc32, deflateRawSync } from "node:zlib";

export interface ZipEntry {
  /** In-archive path (forward slashes). */
  name: string;
  data: Buffer;
  /** Store uncompressed. Required for the leading `mimetype` entry. */
  store?: boolean;
}

// Pinned deterministic DOS date/time: 1980-01-01 00:00:00. A zeroed date byte
// would encode an invalid day 0; 0x0021 is the earliest valid DOS date.
const DOS_DATE = 0x0021;
const DOS_TIME = 0x0000;
const VERSION = 20; // 2.0 — supports deflate; used for made-by and needed.

export function writeZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    // Flag bit 11 signals UTF-8 filenames; only needed for non-ASCII names.
    const flags = name.some((b) => b > 0x7f) ? 0x0800 : 0x0000;
    const method = entry.store ? 0 : 8;
    const stored = entry.store ? entry.data : deflateRawSync(entry.data);
    const crc = crc32(entry.data) >>> 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(VERSION, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra field length
    locals.push(local, name, stored);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(VERSION, 4); // version made by (host 0 = MS-DOS)
    central.writeUInt16LE(VERSION, 6); // version needed
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(stored.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra field length
    central.writeUInt16LE(0, 32); // file comment length
    central.writeUInt16LE(0, 34); // disk number start
    central.writeUInt16LE(0, 36); // internal file attributes
    central.writeUInt32LE(0, 38); // external file attributes
    central.writeUInt32LE(offset, 42); // relative offset of local header
    centrals.push(central, name);

    offset += local.length + name.length + stored.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); // number of this disk
  eocd.writeUInt16LE(0, 6); // disk where central directory starts
  eocd.writeUInt16LE(entries.length, 8); // cd records on this disk
  eocd.writeUInt16LE(entries.length, 10); // total cd records
  eocd.writeUInt32LE(centralBuf.length, 12); // size of central directory
  eocd.writeUInt32LE(offset, 16); // offset of start of central directory
  eocd.writeUInt16LE(0, 20); // .zip file comment length

  return Buffer.concat([...locals, centralBuf, eocd]);
}
