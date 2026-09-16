import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const cli = join(root, "dist", "cli.js");
const corpus = join(root, "test", "kg", "fixtures", "corpus");
const golden = join(root, "test", "kg", "fixtures", "golden", "graph.jsonld");
const rdfGolden = join(root, "test", "kg", "fixtures", "golden", "metadata.rdf");

/** Read a .iirds ZIP's entries (name → bytes) via its central directory. */
function readZip(zip: Buffer): Map<string, Buffer> {
  const eocd = zip.length - 22;
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    const method = zip.readUInt16LE(p + 10);
    const compSize = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const localOffset = zip.readUInt32LE(p + 42);
    const name = zip.toString("utf8", p + 46, p + 46 + nameLen);
    const lNameLen = zip.readUInt16LE(localOffset + 26);
    const lExtraLen = zip.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const raw = zip.subarray(dataStart, dataStart + compSize);
    out.set(name, method === 0 ? Buffer.from(raw) : inflateRawSync(raw));
    p += 46 + nameLen;
  }
  return out;
}

/** Entry names in stored (central-directory) order. */
function zipOrder(zip: Buffer): string[] {
  const eocd = zip.length - 22;
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    const nameLen = zip.readUInt16LE(p + 28);
    names.push(zip.toString("utf8", p + 46, p + 46 + nameLen));
    p += 46 + nameLen;
  }
  return names;
}

function run(args: string[], cwd: string): { stdout: string; status: number } {
  try {
    const stdout = execFileSync(process.execPath, [cli, "kg", ...args], {
      encoding: "utf8",
      cwd,
    });
    return { stdout, status: 0 };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: (err.stdout ?? "") + (err.stderr ?? ""),
      status: err.status ?? -1,
    };
  }
}

/** The tool version is stamped into the graph; normalize it so release
 *  version bumps don't invalidate the golden. */
function normalizeVersion(jsonld: string): string {
  return jsonld.replace(/"dockg:version": "[^"]+"/g, '"dockg:version": "X"');
}

/** Build the corpus into a fresh temp dir and return its graph path. */
function buildGraph(): { dir: string; graph: string } {
  const dir = mkdtempSync(join(tmpdir(), "dockg-export-"));
  const graph = join(dir, "graph.ttl");
  execFileSync(process.execPath, [cli, "kg", "build", "--out", graph], {
    encoding: "utf8",
    cwd: corpus,
  });
  return { dir, graph };
}

describe("manni kg export (integration)", () => {
  it("matches the JSON-LD golden byte-for-byte (modulo tool version)", () => {
    const { dir, graph } = buildGraph();
    const out = join(dir, "graph.jsonld");
    const { status } = run(
      ["export", "--format", "jsonld", "--graph", graph, "--out", out],
      corpus,
    );
    expect(status).toBe(0);
    expect(normalizeVersion(readFileSync(out, "utf8"))).toBe(
      normalizeVersion(readFileSync(golden, "utf8")),
    );
  });

  it("is byte-identical across two exports (determinism gate)", () => {
    const { dir, graph } = buildGraph();
    const a = join(dir, "a.jsonld");
    const b = join(dir, "b.jsonld");
    run(["export", "-f", "jsonld", "-g", graph, "-o", a], corpus);
    run(["export", "-f", "jsonld", "-g", graph, "-o", b], corpus);
    expect(readFileSync(a, "utf8")).toBe(readFileSync(b, "utf8"));
  });

  it("emits valid JSON whose @graph node count equals distinct subjects", () => {
    const { dir, graph } = buildGraph();
    const out = join(dir, "graph.jsonld");
    const { stdout } = run(
      ["export", "-f", "jsonld", "-g", graph, "-o", out],
      corpus,
    );
    const doc = JSON.parse(readFileSync(out, "utf8"));
    expect(Array.isArray(doc["@graph"])).toBe(true);
    expect(doc["@context"].dockg).toBe("https://hawkeyexl.github.io/dockg/ns#");
    const ids: string[] = doc["@graph"].map((n: { "@id": string }) => n["@id"]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(stdout).toContain(`${ids.length} node`);
  });

  it("defaults the out path to the graph path with a .jsonld extension", () => {
    const { dir, graph } = buildGraph();
    const { status } = run(["export", "-f", "jsonld", "-g", graph], corpus);
    expect(status).toBe(0);
    const defaulted = join(dir, "graph.jsonld");
    expect(() => readFileSync(defaulted, "utf8")).not.toThrow();
  });

  it("exports a conformant iiRDS package (mimetype first, metadata + content)", () => {
    const { dir, graph } = buildGraph();
    const out = join(dir, "pkg.iirds");
    const { status } = run(
      ["export", "-f", "iirds", "-g", graph, "-o", out],
      corpus,
    );
    expect(status).toBe(0);
    const zip = readFileSync(out);
    const order = zipOrder(zip);
    // The mimetype entry must come first (iiRDS/OCF container rule).
    expect(order[0]).toBe("mimetype");
    const entries = readZip(zip);
    expect(entries.get("mimetype")!.toString()).toBe("application/iirds+zip");
    expect(entries.has("META-INF/metadata.rdf")).toBe(true);
    // Every corpus doc ships as a content rendition.
    expect(order).toContain("content/docs/configuration.md");
    expect(order).toContain("content/docs/windows-notes.md");
    // Embedded content is the verbatim source (CRLF preserved for windows-notes).
    expect(entries.get("content/docs/windows-notes.md")!).toEqual(
      readFileSync(join(corpus, "docs", "windows-notes.md")),
    );
  });

  it("matches the metadata.rdf golden byte-for-byte", () => {
    const { dir, graph } = buildGraph();
    const out = join(dir, "pkg.iirds");
    run(["export", "-f", "iirds", "-g", graph, "-o", out], corpus);
    const meta = readZip(readFileSync(out)).get("META-INF/metadata.rdf")!;
    expect(meta.toString("utf8")).toBe(readFileSync(rdfGolden, "utf8"));
  });

  it("is byte-identical across two iirds exports (determinism gate)", () => {
    const { dir, graph } = buildGraph();
    const a = join(dir, "a.iirds");
    const b = join(dir, "b.iirds");
    run(["export", "-f", "iirds", "-g", graph, "-o", a], corpus);
    run(["export", "-f", "iirds", "-g", graph, "-o", b], corpus);
    expect(readFileSync(a).equals(readFileSync(b))).toBe(true);
  });

  it("defaults the iirds out path to the graph path with a .iirds extension", () => {
    const { dir, graph } = buildGraph();
    const { status } = run(["export", "-f", "iirds", "-g", graph], corpus);
    expect(status).toBe(0);
    expect(() => readFileSync(join(dir, "graph.iirds"))).not.toThrow();
  });

  it("adds a Creator Party + vcard org when export.iirds.creator is set", () => {
    const { dir, graph } = buildGraph();
    const cfg = join(dir, "dockg.config.yaml");
    writeFileSync(
      cfg,
      "version: 1\nbaseIri: https://example.com/kg/\nexport:\n  iirds:\n    creator: Acme Docs\n",
    );
    const out = join(dir, "pkg.iirds");
    run(["export", "-f", "iirds", "-g", graph, "-c", cfg, "-o", out], corpus);
    const meta = readZip(readFileSync(out))
      .get("META-INF/metadata.rdf")!
      .toString("utf8");
    expect(meta).toContain(
      "<vcard:organization-name>Acme Docs</vcard:organization-name>",
    );
    expect(meta).toContain(
      'rdf:resource="http://iirds.tekom.de/iirds#Creator"',
    );
  });

  it("writes export.iirds.title as the package title in metadata.rdf", () => {
    const { dir, graph } = buildGraph();
    const cfg = join(dir, "dockg.config.yaml");
    writeFileSync(
      cfg,
      "version: 1\nbaseIri: https://example.com/kg/\nexport:\n  iirds:\n    title: My Corpus\n",
    );
    const out = join(dir, "pkg.iirds");
    run(["export", "-f", "iirds", "-g", graph, "-c", cfg, "-o", out], corpus);
    const meta = readZip(readFileSync(out))
      .get("META-INF/metadata.rdf")!
      .toString("utf8");
    expect(meta).toContain("<iirds:title>My Corpus</iirds:title>");
  });

  it("exits 2 when a Document's source content file is missing", () => {
    const { graph } = buildGraph();
    // Run from a directory that lacks the corpus `docs/` sources: the graph's
    // dockg:path entries resolve to files that do not exist here → exit 2.
    const elsewhere = mkdtempSync(join(tmpdir(), "dockg-export-nosrc-"));
    const { status, stdout } = run(
      ["export", "-f", "iirds", "-g", graph, "-o", join(elsewhere, "p.iirds")],
      elsewhere,
    );
    expect(status).toBe(2);
    expect(stdout.toLowerCase()).toContain("not found");
  });

  it("exits 2 for an unknown --format", () => {
    const { graph } = buildGraph();
    const { status, stdout } = run(
      ["export", "-f", "bogus", "-g", graph],
      corpus,
    );
    expect(status).toBe(2);
    expect(stdout.toLowerCase()).toContain("unknown export format");
  });

  it("exits 2 when the graph is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "dockg-export-"));
    const { status, stdout } = run(
      ["export", "-f", "jsonld", "-g", join(dir, "nope.ttl")],
      dir,
    );
    expect(status).toBe(2);
    expect(stdout.toLowerCase()).toContain("not found");
  });
});
