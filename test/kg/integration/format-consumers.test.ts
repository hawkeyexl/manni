/**
 * The emitted formats, read by the consumers they are emitted for.
 *
 * Every other test of these artifacts compares dockg's output to dockg's own
 * golden, or reads it back with a reader written in the same file as the
 * assertions. That proves the bytes have not changed; it cannot prove they are
 * *valid*. An unescaped character in a title, an unbound prefix, a malformed
 * central directory, or an `@context` that expands to the wrong IRIs would all
 * ship green.
 *
 * So each format here is handed to an independent implementation:
 *
 * | Artifact | Consumer |
 * |---|---|
 * | `META-INF/metadata.rdf` | `rdfxml-streaming-parser` |
 * | the `.iirds` container | `yauzl` |
 * | `graph.jsonld` | `jsonld` (digitalbazaar), cross-checked against `graph.ttl` |
 *
 * The Turtle emitter already had this (`build.test.ts` round-trips it through
 * n3); these three did not. See ADR 01026.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { Parser as N3Parser, Store } from "n3";
import { RdfXmlParser } from "rdfxml-streaming-parser";
import type { Quad } from "@rdfjs/types";
import yauzl from "yauzl";
import jsonld from "jsonld";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const cli = join(root, "dist", "cli.js");
const corpus = join(root, "test", "kg", "fixtures", "corpus");
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";

/** Build the corpus into a fresh temp dir and return its graph path. */
function buildGraph(): { dir: string; graph: string } {
  const dir = mkdtempSync(join(tmpdir(), "dockg-consumers-"));
  const graph = join(dir, "graph.ttl");
  execFileSync(process.execPath, [cli, "kg", "build", "--out", graph], {
    encoding: "utf8",
    cwd: corpus,
  });
  return { dir, graph };
}

function exportAs(format: string, graph: string, out: string): void {
  execFileSync(
    process.execPath,
    [cli, "kg", "export", "-f", format, "-g", graph, "-o", out],
    {
      encoding: "utf8",
      cwd: corpus,
    },
  );
}

/** Parse RDF/XML with an independent parser. Rejects on malformed input. */
function parseRdfXml(xml: string, baseIRI: string): Promise<Quad[]> {
  return new Promise((resolve, reject) => {
    const quads: Quad[] = [];
    const parser = new RdfXmlParser({ baseIRI });
    parser.on("data", (q: Quad) => quads.push(q));
    parser.on("error", reject);
    parser.on("end", () => { resolve(quads); });
    parser.write(xml);
    parser.end();
  });
}

/** Read a ZIP with yauzl: an implementation that shares nothing with the writer. */
function readZipWithYauzl(path: string): Promise<{
  names: string[];
  methods: Map<string, number>;
  bytes: Map<string, Buffer>;
}> {
  return new Promise((resolve, reject) => {
    // lazyEntries + validateEntrySizes: make yauzl check declared sizes against
    // what it actually decompresses, rather than trusting the headers.
    yauzl.open(
      path,
      { lazyEntries: true, validateEntrySizes: true },
      (err, zip) => {
        if (err) { reject(err); return; }
        const names: string[] = [];
        const methods = new Map<string, number>();
        const bytes = new Map<string, Buffer>();
        zip.on("entry", (entry) => {
          names.push(entry.fileName);
          methods.set(entry.fileName, entry.compressionMethod);
          zip.openReadStream(entry, (e, stream) => {
            if (e) { reject(e); return; }
            const chunks: Buffer[] = [];
            stream.on("data", (c: Buffer) => chunks.push(c));
            stream.on("error", reject);
            stream.on("end", () => {
              bytes.set(entry.fileName, Buffer.concat(chunks));
              zip.readEntry();
            });
          });
        });
        zip.on("error", reject);
        zip.on("end", () => { resolve({ names, methods, bytes }); });
        zip.readEntry();
      },
    );
  });
}

/** A quad as a comparable string, so two graphs can be compared as sets. */
function key(q: Quad): string {
  const o =
    q.object.termType === "Literal"
      ? `"${q.object.value}"^^${q.object.datatype.value}@${q.object.language}`
      : q.object.value;
  return JSON.stringify([q.subject.value, q.predicate.value, o]);
}

function turtleQuads(ttl: string): Quad[] {
  const store = new Store();
  store.addQuads(new N3Parser().parse(ttl));
  return store.getQuads(null, null, null, null);
}

describe("emitted formats, read by independent consumers", () => {
  it("metadata.rdf parses as RDF/XML", async () => {
    const { dir, graph } = buildGraph();
    const pkg = join(dir, "package.iirds");
    exportAs("iirds", graph, pkg);
    const { bytes } = await readZipWithYauzl(pkg);
    const xml = bytes.get("META-INF/metadata.rdf");
    expect(xml, "package is missing META-INF/metadata.rdf").toBeDefined();

    const quads = await parseRdfXml(
      xml!.toString("utf8"),
      "https://example.com/kg/",
    );
    expect(quads.length).toBeGreaterThan(0);

    // The mandatory set for unrestricted iiRDS 1.3, as ADR 01017 established it
    // — checked against the *parsed* graph, so each one holds because the RDF
    // says so and not because our own string appears in our own output.
    const IIRDS = "http://iirds.tekom.de/iirds#";
    const typeOf = (s: string): string[] =>
      quads
        .filter(
          (q) => q.subject.value === s && q.predicate.value === `${RDF}type`,
        )
        .map((q) => q.object.value);
    const objectsOf = (p: string): string[] =>
      quads
        .filter((q) => q.predicate.value === `${IIRDS}${p}`)
        .map((q) => q.object.value);
    const subjectsOf = (p: string): string[] =>
      quads
        .filter((q) => q.predicate.value === `${IIRDS}${p}`)
        .map((q) => q.subject.value);

    // Exactly one Package, carrying exactly one iiRDSVersion.
    const packages = [...new Set(quads.map((q) => q.subject.value))].filter(
      (s) => typeOf(s).includes(`${IIRDS}Package`),
    );
    expect(packages).toHaveLength(1);
    expect(objectsOf("iiRDSVersion")).toHaveLength(1);

    // Information units are linked to that package, and every one of them is a
    // typed subclass rather than a bare node.
    const units = subjectsOf("is-part-of-package");
    expect(units.length).toBeGreaterThan(0);
    for (const unit of units) {
      expect(
        typeOf(unit),
        `information unit ${unit} carries no rdf:type`,
      ).toContain(`${IIRDS}Topic`);
    }

    // Every rendition carries both source and format.
    const renditions = [...new Set(quads.map((q) => q.subject.value))].filter(
      (s) => typeOf(s).includes(`${IIRDS}Rendition`),
    );
    expect(renditions.length).toBeGreaterThan(0);
    for (const r of renditions) {
      const has = (p: string): boolean =>
        quads.some(
          (q) => q.subject.value === r && q.predicate.value === `${IIRDS}${p}`,
        );
      expect(has("source"), `rendition ${r} has no iirds:source`).toBe(true);
      expect(has("format"), `rendition ${r} has no iirds:format`).toBe(true);
    }

    // No blank nodes anywhere: the determinism invariant, verified after a
    // round trip rather than at emission.
    expect(quads.filter((q) => q.subject.termType === "BlankNode")).toEqual([]);
    expect(quads.filter((q) => q.object.termType === "BlankNode")).toEqual([]);
  });

  it("rejects malformed RDF/XML, so the check above can fail", async () => {
    // The test of the test: a parser that accepted anything would make the
    // assertion above vacuous.
    await expect(
      parseRdfXml(
        `<rdf:RDF><rdf:Description rdf:about="x"></rdf:RDF>`,
        "https://example.com/",
      ),
    ).rejects.toThrow();
  });

  it("the .iirds container opens with an independent ZIP reader", async () => {
    const { dir, graph } = buildGraph();
    const pkg = join(dir, "package.iirds");
    exportAs("iirds", graph, pkg);

    const { names, methods, bytes } = await readZipWithYauzl(pkg);

    // OCF: mimetype first and stored uncompressed, so a reader can sniff the
    // type from the first bytes of the file without inflating anything.
    expect(names[0]).toBe("mimetype");
    expect(methods.get("mimetype")).toBe(0);
    expect(bytes.get("mimetype")?.toString("utf8")).toBe(
      "application/iirds+zip",
    );

    expect(names).toContain("META-INF/metadata.rdf");
    expect(names.some((n) => n.startsWith("content/"))).toBe(true);

    // validateEntrySizes is on, so reaching here means every declared
    // uncompressed size matched what actually came out.
    for (const name of names) {
      expect(bytes.get(name), `entry ${name} did not decompress`).toBeDefined();
    }
  });

  it("graph.jsonld expands to exactly the same graph as graph.ttl", async () => {
    const { dir, graph } = buildGraph();
    const out = join(dir, "graph.jsonld");
    exportAs("jsonld", graph, out);

    const doc: unknown = JSON.parse(readFileSync(out, "utf8"));
    // toRDF runs the real expansion algorithm over @context. A context that
    // expanded a CURIE to the wrong IRI would show up here as a quad mismatch,
    // which neither a JSON.parse structural check nor dockg's own reader can
    // see.
    const nquads = (await jsonld.toRDF(doc as jsonld.JsonLdDocument, {
      format: "application/n-quads",
    })) as unknown as string;

    const fromJsonLd = new Set(turtleQuads(nquads).map(key));
    const fromTurtle = new Set(
      turtleQuads(readFileSync(graph, "utf8")).map(key),
    );

    const missing = [...fromTurtle].filter((k) => !fromJsonLd.has(k));
    const extra = [...fromJsonLd].filter((k) => !fromTurtle.has(k));
    expect(
      missing,
      `in Turtle but not JSON-LD: ${missing.slice(0, 3).join(" | ")}`,
    ).toEqual([]);
    expect(
      extra,
      `in JSON-LD but not Turtle: ${extra.slice(0, 3).join(" | ")}`,
    ).toEqual([]);
    expect(fromJsonLd.size).toBe(fromTurtle.size);
    expect(fromJsonLd.size).toBeGreaterThan(0);
  });
});
