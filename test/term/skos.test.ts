/**
 * SKOS in and out (proposal 0086 § 5). A `.ttl` or `.jsonld` file named on the
 * command line, or listed in `term.manifests`, reads as SKOS, and `-f skos`
 * and `-f skos-ttl` write it back. Every field SKOS holds survives a round
 * trip through either serialization.
 */
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runWrite } from "../../src/term/commands/write.js";
import { listFormats } from "../../src/term/commands/formats.js";
import { loadTermSet, skosInput } from "../../src/term/core/load-set.js";
import { readerForConstruct } from "../../src/term/core/readers/index.js";
import { writerFor } from "../../src/term/core/writers/index.js";
import { TermError } from "../../src/term/errors.js";
import type { Term, TermReadResult, TermRecord, TermRun, TermWriteFormat } from "../../src/term/types.js";
import { term } from "./writer-fixture.js";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "term", "skos");
const NO_EXISTING = { existing: new Map<string, string>() };

async function readSkos(content: string, file: string, path?: string): Promise<TermReadResult> {
  const reader = readerForConstruct("skos");
  if (reader === undefined) throw new Error("no skos reader");
  return reader.read(await skosInput(content, file, path));
}

async function readFixture(name: string): Promise<TermReadResult> {
  const path = join(FIXTURE, name);
  return readSkos(await readFile(path, "utf8"), name, path);
}

function render(terms: readonly Term[], format: TermWriteFormat, name: string): string {
  const writer = writerFor(format);
  if (writer === undefined) throw new Error(`no ${format} writer`);
  return writer.render(terms, { path: join(FIXTURE, "out", name), shape: "file" }, NO_EXISTING).files[0]?.content ?? "";
}

/** What must survive a round trip: each term's id, language and whole record, in order. */
function records(terms: readonly Term[]): { id: string; language: string | undefined; record: TermRecord }[] {
  return terms.map((t) => ({ id: t.id, language: t.language, record: t.record }));
}

const PROGRESSIVE_CONCEPT = {
  broader: ["spectacle-lens"],
  "related-terms": ["bifocal"],
  notation: "OPT-2",
  "exact-matches": ["http://www.wikidata.org/entity/Q1052424"],
  "close-matches": ["https://vocab.example.org/varifocal"],
  "broad-matches": ["https://vocab.example.org/lens"],
  "narrow-matches": ["https://vocab.example.org/office-progressive"],
  "related-matches": ["https://vocab.example.org/presbyopia"],
};

const VOCAB = [
  {
    id: "bifocal",
    language: "de",
    record: { label: "Bifokalglas", broader: ["spectacle-lens"], "related-terms": ["progressive-lens"] },
  },
  {
    id: "bifocal",
    language: "en",
    record: {
      label: "bifocal",
      definition: "A lens with two distinct powers.",
      broader: ["spectacle-lens"],
      "related-terms": ["progressive-lens"],
    },
  },
  {
    id: "progressive-lens",
    language: "de",
    record: {
      label: "Gleitsichtglas",
      "alt-labels": ["Gleitsichtbrille"],
      definition: "Ein Brillenglas, dessen Stärke stufenlos zunimmt.",
      "scope-note": "Nur Brillen, keine Kameraoptik.",
      notes: ["Auch Gleitsichtbrille genannt."],
      ...PROGRESSIVE_CONCEPT,
    },
  },
  {
    id: "progressive-lens",
    language: "en",
    record: {
      label: "progressive lens",
      "alt-labels": ["PAL", "graduated lens"],
      "hidden-labels": ["no-line bifocal"],
      definition: "A spectacle lens whose power changes gradually, with no visible line.",
      "scope-note": "Eyewear only, not camera optics.",
      notes: ["Also called varifocal."],
      contexts: ["She switched to progressive lenses at 45."],
      ...PROGRESSIVE_CONCEPT,
    },
  },
  {
    id: "spectacle-lens",
    language: "de",
    record: {
      label: "Brillenglas",
      definition: "Ein Glas vor dem Auge, das die Sicht korrigiert.",
      narrower: ["progressive-lens", "bifocal"],
      notation: "OPT-1",
    },
  },
  {
    id: "spectacle-lens",
    language: "en",
    record: {
      label: "spectacle lens",
      definition: "A lens worn in front of the eye to correct vision.",
      narrower: ["progressive-lens", "bifocal"],
      notation: "OPT-1",
    },
  },
];

describe("skos reader", () => {
  it.each(["vocab.ttl", "vocab.jsonld"])("reads %s into one term per language, joined on id", async (name) => {
    const { terms, notices } = await readFixture(name);
    expect(notices).toEqual([]);
    expect(records(terms)).toEqual(VOCAB);
    expect(terms.every((t) => t.location.construct === "skos" && t.location.file === name)).toBe(true);
  });

  it("tells JSON-LD from Turtle by the first byte on stdin", async () => {
    for (const name of ["vocab.ttl", "vocab.jsonld"]) {
      const { terms } = await readSkos(await readFile(join(FIXTURE, name), "utf8"), "<stdin>");
      expect(records(terms)).toEqual(VOCAB);
    }
  });

  it("reports what it did not read, once per predicate per file", async () => {
    const { terms, notices } = await readFixture("unread.ttl");
    expect(records(terms)).toEqual([
      { id: "lens", language: "de", record: { label: "Linse" } },
      { id: "lens", language: "en", record: { label: "lens", definition: "A shaped piece of glass." } },
      { id: "prism", language: "en", record: { label: "prism" } },
    ]);
    expect(notices).toEqual([
      'unread.ttl: skipped SKOS concept "unlabelled", which has no skos:prefLabel.',
      'unread.ttl: "lens" has no skos:prefLabel in fr, so 1 value was not read.',
      'unread.ttl: "lens" holds one skos:definition per language, so 1 value was not read.',
      "unread.ttl: skos:changeNote is not a term field, so 3 values were not read.",
      "unread.ttl: dcterms:created is not a term field, so 1 value was not read.",
      'unread.ttl: skos:broader on "prism" is not an IRI, so 1 value was not read.',
    ]);
  });

  it("reads an untagged prefLabel as a term with no language", async () => {
    const { terms } = await readSkos(
      '@prefix skos: <http://www.w3.org/2004/02/skos/core#> .\n<https://x.test/a%20b> a skos:Concept ; skos:prefLabel "a b" .\n',
      "x.ttl",
    );
    expect(records(terms)).toEqual([{ id: "a b", language: undefined, record: { label: "a b" } }]);
  });

  it("refuses a remote @context rather than fetching it", async () => {
    await expect(readFixture("remote-context.jsonld")).rejects.toThrow(
      new TermError(
        "remote-context.jsonld: names the remote @context https://example.com/skos-context.jsonld, which is not fetched. Inline the context to read it.",
      ),
    );
  });

  it("refuses a file that does not parse", async () => {
    await expect(readFixture("malformed.ttl")).rejects.toThrow(/^malformed\.ttl: could not be read as SKOS: /);
  });
});

describe("skos round trip", () => {
  it.each([
    ["vocab.ttl", "skos-ttl", "terms.ttl"],
    ["vocab.ttl", "skos", "terms.jsonld"],
    ["vocab.jsonld", "skos-ttl", "terms.ttl"],
    ["vocab.jsonld", "skos", "terms.jsonld"],
  ] as const)("%s through -f %s reads back the same records", async (name, format, out) => {
    const { terms } = await readFixture(name);
    const first = render(terms, format, out);
    const again = await readSkos(first, out);
    expect(again.notices).toEqual([]);
    expect(records(again.terms)).toEqual(records(terms));
    // And the second render is the same bytes as the first.
    expect(render(again.terms, format, out)).toBe(first);
  });
});

describe("skos writers", () => {
  it("writes one node per id, with each language's labels on it", async () => {
    const { terms } = await readFixture("vocab.ttl");
    const graph = (JSON.parse(render(terms, "skos", "x.jsonld")) as { "@graph": Record<string, unknown>[] })["@graph"];
    expect(graph.map((node) => node["@id"])).toEqual(["", "#bifocal", "#progressive-lens", "#spectacle-lens"]);
    expect(graph[2]?.["skos:prefLabel"]).toEqual([
      { "@value": "Gleitsichtglas", "@language": "de" },
      { "@value": "progressive lens", "@language": "en" },
    ]);
  });

  it("marks the concepts with no broader as top concepts, from both ends", async () => {
    const { terms } = await readFixture("vocab.ttl");
    const graph = (JSON.parse(render(terms, "skos", "x.jsonld")) as { "@graph": Record<string, unknown>[] })["@graph"];
    expect(graph[0]?.["skos:hasTopConcept"]).toEqual([{ "@id": "#spectacle-lens" }]);
    expect(graph[3]?.["skos:topConceptOf"]).toEqual({ "@id": "" });
    expect(graph[1]?.["skos:topConceptOf"]).toBeUndefined();
  });

  it("writes a see entry as an altLabel on its target, not as a concept", () => {
    const writer = writerFor("skos");
    const render = writer?.render(
      [
        term("k8s", { label: "K8s cluster", see: "Kubernetes" }),
        term("kubernetes", { label: "Kubernetes", definition: "An orchestrator." }),
      ],
      { path: join(FIXTURE, "out", "x.jsonld"), shape: "file" },
      NO_EXISTING,
    );
    const graph = (JSON.parse(render?.files[0]?.content ?? "{}") as { "@graph": Record<string, unknown>[] })["@graph"];
    expect(graph.map((node) => node["@id"])).toEqual(["", "#kubernetes"]);
    expect(graph[1]?.["skos:altLabel"]).toEqual(["K8s cluster"]);
    expect(render?.dropped).toEqual([]);
  });

  it("keeps the first language's notation where languages differ, and says so", () => {
    const render = writerFor("skos-ttl")?.render(
      [term("a", { label: "a", notation: "A1" }, "en"), term("a", { label: "a", notation: "A2" }, "de")],
      { path: join(FIXTURE, "out", "x.ttl"), shape: "file" },
      NO_EXISTING,
    );
    expect(render?.files[0]?.content).toContain('skos:notation "A1"');
    expect(render?.files[0]?.content).not.toContain("A2");
    expect(render?.conflicts).toEqual([{ id: "a", field: "notation" }]);
  });

  it("is listed by term formats as a reader and two writers", () => {
    const rows = listFormats().filter((row) => row.format.startsWith("skos"));
    expect(rows).toEqual([
      { format: "skos", construct: "skos", label: "SKOS concept", read: true, write: true },
      { format: "skos", label: "JSON-LD", read: false, write: true },
      { format: "skos-ttl", label: "Turtle", read: false, write: true },
    ]);
  });
});

describe("skos loading", () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await realpath(await mkdtemp(join(tmpdir(), "manni-term-skos-")));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  function run(inputs: string[], manifests: string[] = []): TermRun {
    return {
      config: null,
      inputs,
      base: tmp,
      collections: [],
      fromCollections: false,
      manifests: manifests.map((written) => ({ path: join(tmp, written), written })),
      tools: {},
    };
  }

  it("reads a named .ttl and a manifest-listed .jsonld, and never walks one", async () => {
    await mkdir(join(tmp, "graph"));
    await writeFile(join(tmp, "graph", "graph.ttl"), await readFile(join(FIXTURE, "vocab.ttl"), "utf8"));
    await writeFile(join(tmp, "vocab.jsonld"), await readFile(join(FIXTURE, "vocab.jsonld"), "utf8"));
    await writeFile(join(tmp, "graph", "page.md"), "---\ntype: term\nlabel: lens\ndefinition: A lens.\n---\n");

    const walked = await loadTermSet({ run: run(["graph"]) });
    expect(walked.terms.map((t) => t.id)).toEqual(["lens"]);

    const named = await loadTermSet({ run: run(["graph/graph.ttl"], ["vocab.jsonld"]) });
    expect(named.terms).toHaveLength(12);
  });

  it("reads stdin with --as skos", async () => {
    const stdin = await readFile(join(FIXTURE, "vocab.jsonld"), "utf8");
    const set = await loadTermSet({ run: run(["-"]), stdin, as: "skos" });
    expect(records(set.terms)).toEqual(VOCAB);
  });

  it("refuses to write a SKOS source in place", async () => {
    await writeFile(join(tmp, "vocab.ttl"), await readFile(join(FIXTURE, "vocab.ttl"), "utf8"));
    await expect(runWrite({ cwd: tmp, inputs: ["vocab.ttl"] })).rejects.toThrow(
      new TermError("vocab.ttl is SKOS and is not rewritten in place; render it with -f skos or -f skos-ttl."),
    );
  });
});
