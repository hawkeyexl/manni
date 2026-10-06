/**
 * Proposal 0077: graph reads every format lint parses. The formats corpus is
 * one page per format, cross-linked, built through the real CLI. It carries
 * the same gates the Markdown corpus does (goldens, a double build, an n3
 * round-trip, a clean `graph check`), plus the edges the proposal exists for.
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { beforeAll, describe, expect, it } from "vitest";
import { DataFactory, Parser, Store } from "n3";
import { NS, RDF_TYPE } from "../../../src/graph/core/vocab.js";
import { defined } from "../helpers/defined.js";
import { hermeticEnv } from "../helpers/git-env.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const cli = join(root, "dist", "cli.js");
const fixture = join(root, "test", "graph", "fixtures", "formats");
const goldens = join(root, "test", "graph", "fixtures", "formats-golden");
const BASE = "https://example.com/formats/doc/";

function graph(args: string[], cwd: string) {
  return spawnSync(process.execPath, [cli, "graph", ...args], {
    encoding: "utf8",
    cwd,
    env: hermeticEnv(),
  });
}

/** A copy outside any repository, so no git history reaches the goldens. */
function detached(): string {
  const dir = mkdtempSync(join(tmpdir(), "manni-graph-formats-"));
  cpSync(fixture, dir, { recursive: true });
  return dir;
}

function normalizeVersion(ttl: string): string {
  return ttl.replace(/graph:version "[^"]+"/g, 'graph:version "X"');
}

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

let corpus: string;
let ttl: string;
let buildStdout: string;
let store: Store;

/** The objects of `doc dcterms:references ?o`. */
function references(path: string): string[] {
  return store
    .getQuads(
      DataFactory.namedNode(`${BASE}${path}`),
      DataFactory.namedNode(`${NS.dcterms}references`),
      null,
      null,
    )
    .map((q) => q.object.value)
    .sort();
}

beforeAll(() => {
  corpus = detached();
  const r = graph(["build"], corpus);
  expect(r.status, r.stderr).toBe(0);
  buildStdout = r.stdout;
  ttl = readFileSync(join(corpus, "graph.ttl"), "utf8");
  store = new Store(new Parser({ format: "text/turtle" }).parse(ttl));
});

describe("graph build over every format", () => {
  it("matches the golden output byte-for-byte (modulo tool version)", () => {
    expect(normalizeVersion(ttl)).toBe(
      normalizeVersion(readFileSync(join(goldens, "graph.ttl"), "utf8")),
    );
  });

  it("is byte-identical across two runs (determinism gate)", () => {
    const again = graph(["build", "-o", "again.ttl"], corpus);
    expect(again.status, again.stderr).toBe(0);
    expect(readFileSync(join(corpus, "again.ttl"), "utf8")).toBe(ttl);
  });

  it("round-trips through the n3 parser, every triple the build reported", () => {
    const reported = /\((\d+) docs, (\d+) triples\)/.exec(buildStdout);
    expect(reported?.[1]).toBe("6");
    expect(store.size).toBe(Number(reported?.[2]));
  });

  it("walks every format but .xml", () => {
    const paths = store
      .getQuads(null, DataFactory.namedNode(`${NS.graph}path`), null, null)
      .map((q) => q.object.value)
      .sort();
    expect(paths).toEqual([
      "guide.html",
      "index.md",
      "map.ditamap",
      "notes.adoc",
      "ref.rst",
      "topic.dita",
    ]);
  });

  it("keeps a DITA GUID id verbatim, and a link written to it reaches it", () => {
    const section = `${BASE}topic.dita#GUID-A1B2-C3D4`;
    expect(
      store.getQuads(
        DataFactory.namedNode(section),
        DataFactory.namedNode(RDF_TYPE),
        DataFactory.namedNode(`${NS.graph}Section`),
        null,
      ),
    ).toHaveLength(1);
    expect(references("guide.html")).toContain(section);
    expect(references("index.md")).toContain(section);
  });

  it("resolves links across formats in both directions", () => {
    expect(references("index.md")).toEqual([
      `${BASE}guide.html`,
      `${BASE}guide.html#install-the-sdk`,
      `${BASE}notes.adoc`,
      `${BASE}notes.adoc#_upgrade`,
      `${BASE}ref.rst`,
      `${BASE}ref.rst#install-ref`,
      `${BASE}topic.dita`,
      `${BASE}topic.dita#GUID-A1B2-C3D4`,
    ]);
    expect(references("guide.html")).toEqual([
      `${BASE}index.md`,
      `${BASE}topic.dita#GUID-A1B2-C3D4`,
    ]);
    expect(references("topic.dita")).toEqual([
      // Verbatim: a scheme-bearing href is never rewritten as DITA's
      // `file#topic/element`.
      "https://example.com/docs#section/sub",
      `${BASE}guide.html#install-the-sdk`,
    ]);
    expect(references("map.ditamap")).toEqual([
      `${BASE}guide.html`,
      `${BASE}topic.dita`,
    ]);
    expect(references("notes.adoc")).toEqual([
      `${BASE}guide.html#install-the-sdk`,
      `${BASE}index.md`,
    ]);
    // `:doc:` names a page without its extension; the link extensions find it.
    expect(references("ref.rst")).toEqual([`${BASE}guide.html`, `${BASE}index.md`]);
  });

  it("derives no edge from a stylesheet, a permalink, a keyref or an include", () => {
    expect(ttl).not.toContain("style.css");
    expect(ttl).not.toContain("glossary-sdk");
    expect(ttl).not.toContain("missing.adoc");
    expect(ttl).not.toContain("graph:brokenLink");
    expect(references("guide.html")).not.toContain(`${BASE}guide.html#install-the-sdk`);
  });

  it("reports no broken link", () => {
    const r = graph(["stats", "--check", "-g", "graph.ttl"], corpus);
    expect(r.status, r.stdout).toBe(0);
  });

  it("passes the bundled shapes", () => {
    const r = graph(["check", "-g", "graph.ttl"], corpus);
    expect(r.status, r.stdout).toBe(0);
  });
});

describe("graph export over every format", () => {
  it("names each page's media type in the iiRDS package, and matches the golden", () => {
    const out = join(corpus, "pkg.iirds");
    const r = graph(["export", "iirds", "-g", "graph.ttl", "-o", out], corpus);
    expect(r.status, r.stderr).toBe(0);
    const rdf = defined(readZip(readFileSync(out)).get("META-INF/metadata.rdf")).toString(
      "utf8",
    );
    expect(rdf).toBe(readFileSync(join(goldens, "metadata.rdf"), "utf8"));
    const formats = new Map<string, string>();
    const rendition =
      /<iirds:source>content\/([^<]+)<\/iirds:source>\s*<iirds:format>([^<]+)<\/iirds:format>|<iirds:format>([^<]+)<\/iirds:format>\s*<iirds:source>content\/([^<]+)<\/iirds:source>/g;
    for (const m of rdf.matchAll(rendition)) {
      formats.set(m[1] ?? m[4] ?? "", m[2] ?? m[3] ?? "");
    }
    expect(Object.fromEntries(formats)).toEqual({
      "guide.html": "text/html",
      "index.md": "text/markdown",
      "map.ditamap": "application/dita+xml",
      "notes.adoc": "text/asciidoc",
      "ref.rst": "text/x-rst",
      "topic.dita": "application/dita+xml",
    });
  });

  it("indexes each section's prose from the tree, with no markup, and matches the golden", () => {
    const r = graph(["export", "search", "-g", "graph.ttl", "-o", "search"], corpus);
    expect(r.status, r.stderr).toBe(0);
    const text = readFileSync(join(corpus, "search", "search.und.json"), "utf8");
    expect(text).toBe(readFileSync(join(goldens, "search.und.json"), "utf8"));
    const index = JSON.parse(text) as { entries: { id: string; text?: string }[] };
    for (const entry of index.entries) expect(entry.text ?? "").not.toContain("<");
    const byId = new Map(index.entries.map((e) => [e.id, e.text]));
    expect(byId.get(`${BASE}topic.dita#GUID-A1B2-C3D4`)).toContain(
      "See the upstream docs",
    );
    // A section owns its own prose, not its subsection's.
    expect(byId.get(`${BASE}guide.html#install-the-sdk`)).not.toContain(
      "The concept section",
    );
  });
});

describe("graph build: a named file no parser claims", () => {
  it("is skipped with lint's warning, and an empty set is still exit 2", () => {
    const dir = mkdtempSync(join(tmpdir(), "manni-graph-unclaimed-"));
    writeFileSync(join(dir, "notes.txt"), "plain\n");
    const r = graph(["build", "notes.txt", "--no-config"], dir);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(
      'manni: skipped notes.txt: no parser is registered for ".txt".',
    );
    expect(r.stderr).toContain("No input files matched: notes.txt");
  });
});
