/**
 * The `dockg:` vocabulary document, and the guard that keeps it honest
 * (ADR 01030).
 *
 * A vocabulary rots the first time a phase mints a predicate and forgets the
 * document. So the check runs in **both** directions: every term the emitter
 * can produce must be defined here, and nothing may be defined that the emitter
 * cannot produce. A definition for a term that does not exist is as misleading
 * as a term with no definition.
 *
 * The emitter's side is read from source rather than from a hand-kept list,
 * because a hand-kept list is the thing that drifts.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { Parser, Store, DataFactory } from "n3";
import { NS, ROLE } from "../../../src/kg/core/vocab.js";

const { namedNode } = DataFactory;
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
/**
 * The newest vocabulary version, resolved rather than named.
 *
 * Published versions are immutable, so a new term means a new file — and a
 * hardcoded filename here would keep guarding the old one, silently, which is
 * the drift this whole file exists to prevent. Sorted numerically so 1.10.0
 * follows 1.9.0 rather than preceding it.
 */
function newestVocabulary(): string {
  const parse = (name: string): number[] =>
    (name.match(/(\d+)\.(\d+)\.(\d+)/) ?? []).slice(1).map(Number);
  const files = readdirSync(join(root, "ns", "kg"))
    .filter((f) => /^dockg-\d+\.\d+\.\d+\.ttl$/.test(f))
    .sort((x, y) => {
      const [a, b] = [parse(x), parse(y)];
      for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
      return 0;
    });
  const newest = files[files.length - 1];
  if (newest === undefined) throw new Error("no vocabulary file in ns/");
  return newest;
}

const VOCAB_FILE = newestVocabulary();
const VOCAB = join(root, "ns", "kg", VOCAB_FILE);
const ONTOLOGY = "https://hawkeyexl.github.io/dockg/ns";

const store = new Store(
  new Parser().parse(readFileSync(VOCAB, "utf8")),
);

/** Local names defined by the vocabulary document. */
function definedTerms(): Set<string> {
  const out = new Set<string>();
  for (const q of store.getQuads(null, null, null, null)) {
    if (q.subject.value.startsWith(NS.dockg)) {
      out.add(q.subject.value.slice(NS.dockg.length));
    }
  }
  return out;
}

/**
 * Local names the emitter can produce, read out of src/. Every mint goes
 * through the `${NS.dockg}name` template or the ROLE table, so one regex plus
 * the table is exhaustive.
 */
function mintedTerms(): Set<string> {
  const out = new Set<string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".ts")) {
        for (const m of readFileSync(path, "utf8").matchAll(
          /NS\.dockg\}([A-Za-z][A-Za-z0-9]*)/g,
        )) {
          out.add(m[1]!);
        }
      }
    }
  };
  walk(join(root, "src", "kg"));
  for (const iri of Object.values(ROLE)) out.add(iri.slice(NS.dockg.length));
  return out;
}

describe("the dockg vocabulary document", () => {
  it("parses as Turtle", () => {
    expect(store.size).toBeGreaterThan(0);
  });

  it("defines every term the emitter can produce", () => {
    const missing = [...mintedTerms()].filter((t) => !definedTerms().has(t));
    expect(
      missing.sort(),
      `minted but undefined — add them to ns/${VOCAB_FILE}`,
    ).toEqual([]);
  });

  it("defines nothing the emitter cannot produce", () => {
    const extra = [...definedTerms()].filter((t) => !mintedTerms().has(t));
    expect(
      extra.sort(),
      `defined but never minted — a definition for a term that does not exist`,
    ).toEqual([]);
  });

  it("gives every term a label, a comment, and a way home", () => {
    for (const term of definedTerms()) {
      const s = namedNode(`${NS.dockg}${term}`);
      const has = (p: string): boolean =>
        store.countQuads(s, namedNode(p), null, null) > 0;
      expect(has("http://www.w3.org/2000/01/rdf-schema#label"), term).toBe(
        true,
      );
      expect(has("http://www.w3.org/2000/01/rdf-schema#comment"), term).toBe(
        true,
      );
      expect(
        has("http://www.w3.org/2000/01/rdf-schema#isDefinedBy"),
        term,
      ).toBe(true);
    }
  });

  it("carries the ontology header a consumer needs to use it", () => {
    const s = namedNode(ONTOLOGY);
    for (const p of [
      "http://purl.org/dc/terms/title",
      "http://purl.org/dc/terms/license",
      "http://www.w3.org/2002/07/owl#versionInfo",
      "http://www.w3.org/2002/07/owl#versionIRI",
      // The prefix the emitter actually writes, so a consumer that fetches
      // this document learns it rather than guessing.
      "http://purl.org/vocab/vann/preferredNamespacePrefix",
      "http://purl.org/vocab/vann/preferredNamespaceUri",
    ]) {
      expect(store.countQuads(s, namedNode(p), null, null), p).toBe(1);
    }
  });

  it("declares the prefix and namespace the emitter uses", () => {
    const objectOf = (p: string): string | undefined =>
      store.getQuads(namedNode(ONTOLOGY), namedNode(p), null, null)[0]?.object
        .value;
    expect(
      objectOf("http://purl.org/vocab/vann/preferredNamespacePrefix"),
    ).toBe("dockg");
    expect(objectOf("http://purl.org/vocab/vann/preferredNamespaceUri")).toBe(
      NS.dockg,
    );
  });

  it("states domain and range non-entailingly", () => {
    // rdfs:domain is an inference rule: it licenses a reasoner to type any
    // subject carrying the property. schema:domainIncludes documents the same
    // intent without entailing anything — which matters here, because ADR 01014
    // exists to refuse inference dockg did not assert.
    for (const p of [
      "http://www.w3.org/2000/01/rdf-schema#domain",
      "http://www.w3.org/2000/01/rdf-schema#range",
    ]) {
      expect(store.countQuads(null, namedNode(p), null, null), p).toBe(0);
    }
    expect(
      store.countQuads(
        null,
        namedNode("https://schema.org/domainIncludes"),
        null,
        null,
      ),
    ).toBeGreaterThan(0);
  });

  it("uses the namespace the emitter uses, not the retired one", () => {
    expect(readFileSync(VOCAB, "utf8")).not.toContain("dockg.dev");
    expect(NS.dockg).toBe("https://hawkeyexl.github.io/dockg/ns#");
  });

  // The guard above protects the copy that ships in the npm package. The one a
  // consumer actually reaches by dereferencing the namespace IRI is the docs
  // site's `public/ns.ttl`, and a hand-kept second copy is exactly what this
  // file's docstring warns drifts. The kg docs site section has not moved into
  // this repository yet, so the published copy is not here to compare; this
  // resumes when it lands.
  const published = join(root, "docs", "public", "kg", "ns.ttl");
  it.skipIf(!existsSync(published))(
    "is byte-identical to the copy the namespace IRI resolves to",
    () => {
      expect(
        readFileSync(published, "utf8"),
        `docs/public/kg/ns.ttl is stale — copy ns/kg/${VOCAB_FILE} over it`,
      ).toBe(readFileSync(VOCAB, "utf8"));
    },
  );
});

describe("no file points at a superseded vocabulary version", () => {
  /**
   * Every tracked text file of the kg tool, minus the vocabulary documents
   * themselves. Scoped to the tool's own directories rather than the whole
   * repository: the monorepo root also holds sibling worktrees and the docs
   * site's dependency tree, neither of which is this tool's to police.
   */
  function trackedText(): string[] {
    const out: string[] = [];
    const skip = new Set(["node_modules", ".git", "dist", ".tmp", "ns"]);
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (skip.has(entry.name)) continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.(ts|mjs|md|mdx|json|yaml|yml)$/.test(entry.name))
          out.push(path);
      }
    };
    for (const dir of [
      join(root, "src", "kg"),
      join(root, "test", "kg"),
      join(root, "docs", "proposals", "kg"),
      join(root, "schemas", "kg"),
      join(root, "shapes", "kg"),
    ]) {
      walk(dir);
    }
    return out;
  }

  it("names only the newest one", () => {
    // The nits this guard exists for: `src/core/vocab.ts` and
    // `docs/src/content/docs/ns.mdx` both kept naming the 1.0.0 file after
    // 1.1.0 shipped, and review found two of the four. Nothing failed — a prose
    // reference to a superseded file is invisible to every other gate, and it
    // points a reader at a document missing the term they came to look up.
    //
    // The `ns/` directory itself is exempt: an older version file may name
    // itself, and 1.1.0 records 1.0.0 as its owl:priorVersion on purpose.
    const stale: string[] = [];
    for (const file of trackedText()) {
      for (const m of readFileSync(file, "utf8").matchAll(
        /ns\/(dockg-\d+\.\d+\.\d+\.ttl)/g,
      )) {
        if (m[1] !== VOCAB_FILE) {
          stale.push(`${file.slice(root.length + 1)} → ${m[1] ?? ""}`);
        }
      }
    }
    expect(stale, `superseded, should be ${VOCAB_FILE}`).toEqual([]);
  });
});
