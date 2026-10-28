/**
 * The Flare glossary reader (proposal 0125, decision 18): one term per
 * `GlossaryEntry`, its id the `glossTerm` topics cite, and an entry the
 * target excludes left unread. The fixture's terms are pinned in
 * `glossary.expected.json` beside it.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { deriveGraph } from "../../src/graph/core/derive.js";
import { NS, RDF_TYPE } from "../../src/graph/core/vocab.js";
import { runCheck } from "../../src/term/commands/check.js";
import { termLabels } from "../../src/term/commands/labels.js";
import { FLARE_GLOSSARY_FORMAT, flareGlossaryInput, loadTermSet } from "../../src/term/core/load-set.js";
import { readerForConstruct } from "../../src/term/core/readers/index.js";
import { TermError } from "../../src/term/errors.js";
import type { Term, TermReader, TermRun } from "../../src/term/types.js";

const DIR = resolve(__dirname, "../fixtures/term/readers/flare-glossary");
const PROJECT = join(DIR, "project");
const GLOSSARY = join(DIR, "glossary.flglo");

function reader(): TermReader {
  const found = readerForConstruct("flare-glossary");
  if (found === undefined) throw new Error("no flare-glossary reader");
  return found;
}

function runFor(base: string, inputs: string[], extra: Partial<TermRun> = {}): TermRun {
  return { config: null, inputs, base, collections: [], fromCollections: false, manifests: [], tools: {}, ...extra };
}

/** What the expected file pins: each term without its absolute path. */
function pinned(terms: readonly Term[]): unknown[] {
  return terms.map((t) => ({
    id: t.id,
    ...(t.language === undefined ? {} : { language: t.language }),
    line: t.location.line,
    record: t.record,
  }));
}

const labels = (terms: readonly Term[]) => terms.map((t) => t.record.label);

describe("flare-glossary reader", () => {
  it("is registered, read-only, for the flare-glossary format", () => {
    expect(reader().label).toBe("Flare glossary");
    expect(reader().formats).toEqual([FLARE_GLOSSARY_FORMAT]);
    expect(reader().apply).toBeUndefined();
  });

  it("reads the fixture as its expected terms", () => {
    const result = reader().read(flareGlossaryInput(readFileSync(GLOSSARY, "utf8"), "glossary.flglo", GLOSSARY));
    const expected = JSON.parse(readFileSync(join(DIR, "glossary.expected.json"), "utf8")) as unknown;
    expect({ terms: pinned(result.terms), notices: result.notices }).toEqual(expected);
  });

  it("places each entry by its span in the content", () => {
    const content = readFileSync(GLOSSARY, "utf8");
    const [first] = reader().read(flareGlossaryInput(content, "glossary.flglo", GLOSSARY)).terms;
    const span = first?.location.span;
    expect(span).toBeDefined();
    const text = content.slice(span?.start, span?.end);
    expect(text.startsWith("<GlossaryEntry")).toBe(true);
    expect(text.endsWith("</GlossaryEntry>")).toBe(true);
    expect(first?.location.fieldLines).toEqual({ label: 9, "alt-labels": 10, definition: 12 });
  });

  it("refuses a file whose root is not a Flare glossary", () => {
    expect(() => reader().read(flareGlossaryInput("<glossary/>", "x.flglo"))).toThrow(
      new TermError("x.flglo: is not a Flare glossary: its root element is <glossary>, not <CatapultGlossary>."),
    );
    expect(() => reader().read(flareGlossaryInput("<CatapultGlossary>", "y.flglo"))).toThrow(
      new TermError("y.flglo: could not be read as a Flare glossary."),
    );
  });
});

describe("loading a Flare glossary", () => {
  it("reads one named on the command line, every entry kept with no project", async () => {
    const set = await loadTermSet({ run: runFor(DIR, ["glossary.flglo"]) });
    expect(labels(set.terms)).toEqual(["CDC", "Object manager", "Replication", "Print margin", "IMDG"]);
  });

  it("reads one listed under term.manifests", async () => {
    const set = await loadTermSet({
      run: runFor(DIR, [], { manifests: [{ path: GLOSSARY, written: "glossary.flglo" }] }),
    });
    expect(set.terms.map((t) => t.id)).toContain("Glossary.Term0");
    expect(set.terms[0]?.location.construct).toBe("flare-glossary");
  });

  it("reads one from stdin with --as flare-glossary", async () => {
    const set = await loadTermSet({
      run: runFor(DIR, ["-"]),
      stdin: readFileSync(GLOSSARY, "utf8"),
      as: "flare-glossary",
    });
    expect(set.terms).toHaveLength(5);
  });

  it("leaves out an entry the project's target excludes, and keeps the file-level conditions from filtering", async () => {
    const set = await loadTermSet({ run: runFor(PROJECT, ["Project"]) });
    expect(labels(set.terms)).toEqual(["Widget", "Gadget"]);
  });
});

describe("term check over a Flare project", () => {
  it("walks the glossary in a collection and reports a topic definition as missing", async () => {
    const report = await runCheck({ cwd: PROJECT, inputs: [] });
    expect(report.terms).toBe(2);
    // No page cites either term, so each is also an unused-term notice.
    const missing = report.findings.filter((f) => f.rule === "missing-definition").map((f) => f.id);
    expect(missing).toEqual(["Glossary.Term2"]);
  });
});

describe("the concept scheme from a Flare glossary", () => {
  it("mints one concept per entry, by its glossTerm id", async () => {
    const termbase = await termLabels({ cwd: PROJECT });
    const base = "https://example.com/graph/";
    const quads = deriveGraph([], { baseIri: base, derive: ["terms"], termbase });
    const concepts = quads
      .filter((q) => q.p === RDF_TYPE && q.o.value === `${NS.skos}Concept`)
      .map((q) => q.s)
      .sort();
    expect(concepts).toEqual([`${base}concept/Glossary.Term0`, `${base}concept/Glossary.Term2`]);
  });
});
