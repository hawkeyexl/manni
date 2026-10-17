/**
 * The file-shaped interchange writers: JSON, CSV, SKOS (JSON-LD) and TBX
 * (proposal 0052 § 5). Each renders the representative set to a golden file,
 * reports the fields its format cannot hold, and parses back.
 */
import { DOMParser } from "@xmldom/xmldom";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { writerFor } from "../../src/term/core/writers/index.js";
import { INTERCHANGE_WRITERS } from "../../src/term/core/writers/interchange.js";
import { TermError } from "../../src/term/errors.js";
import { TERM_FIELDS, type DroppedField, type TermTarget, type TermWriteFormat, type TermWriter } from "../../src/term/types.js";
import { fixtureTerms, golden, term } from "./writer-fixture.js";

const OUT = resolve("out");

/** The ten 1.0.0 fields, the ones the CSV columns hold. */
const CSV_FIELDS = [
  "label",
  "definition",
  "abstract",
  "alt-labels",
  "hidden-labels",
  "broader",
  "narrower",
  "related-terms",
  "see",
  "scope-note",
];
const NO_EXISTING = { existing: new Map<string, string>() };

function writer(format: TermWriteFormat): TermWriter {
  const found = writerFor(format, INTERCHANGE_WRITERS);
  if (found === undefined) throw new Error(`no ${format} writer`);
  return found;
}

function fileTarget(name: string): TermTarget {
  return { path: join(OUT, name), shape: "file" };
}

function renderOne(format: TermWriteFormat, name: string): { content: string; dropped: DroppedField[] } {
  const target = fileTarget(name);
  const render = writer(format).render(fixtureTerms(), target, NO_EXISTING);
  expect(render.files.map((f) => f.path)).toEqual([target.path]);
  expect(render.removals).toEqual([]);
  const [file] = render.files;
  if (file === undefined) throw new Error("no file rendered");
  return { content: file.content, dropped: render.dropped };
}

describe("interchange writers", () => {
  it("registers tbx, tbx3, skos, csv, json and vale", () => {
    expect(INTERCHANGE_WRITERS.map((w) => w.format)).toEqual(["tbx", "tbx3", "skos", "csv", "json", "vale"]);
    for (const format of ["tbx", "tbx3", "skos", "csv", "json"] as const) {
      expect(writer(format).shapes).toEqual(["file"]);
    }
    expect(writer("vale").shapes).toEqual(["directory"]);
  });

  it.each(["tbx", "tbx3", "skos", "csv", "json"] as const)("%s refuses a directory target", (format) => {
    expect(() =>
      writer(format).render(fixtureTerms(), { path: OUT, shape: "directory" }, NO_EXISTING),
    ).toThrow(TermError);
  });

  it.each([
    ["tbx", "terms.golden.tbx"],
    ["tbx3", "terms-v3.golden.tbx"],
    ["skos", "terms.golden.jsonld"],
    ["csv", "terms.golden.csv"],
    ["json", "terms.golden.json"],
  ] as const)("%s renders the same bytes twice", (format, name) => {
    const first = renderOne(format, name);
    const second = renderOne(format, name);
    expect(second.content).toBe(first.content);
    expect(first.content.endsWith("\n")).toBe(true);
    expect(first.content.endsWith("\n\n")).toBe(false);
    expect(first.content).not.toContain("\r");
  });
});

describe("json writer", () => {
  it("renders every field in vocabulary order", () => {
    const { content, dropped } = renderOne("json", "terms.json");
    expect(content).toBe(golden("terms.golden.json"));
    expect(dropped).toEqual([]);
    expect(writer("json").holds("file")).toEqual(TERM_FIELDS);
  });

  it("parses back to the terms it was given", () => {
    const { content } = renderOne("json", "terms.json");
    const parsed = JSON.parse(content) as { terms: Record<string, unknown>[] };
    expect(parsed.terms.map((t) => t["id"])).toEqual(fixtureTerms().map((t) => t.id));
    expect(parsed.terms[5]?.["language"]).toBe("de");
  });
});

describe("csv writer", () => {
  it("renders self-describing columns per language, quoting where needed", () => {
    const { content, dropped } = renderOne("csv", "terms.csv");
    expect(content).toBe(golden("terms.golden.csv"));
    expect(dropped).toEqual([]);
    expect(writer("csv").holds("file")).toEqual(CSV_FIELDS);
  });

  it("reports the 1.1.0 keys as dropped, and writes the same columns", () => {
    const plain = term("x", { label: "x", definition: "A lens." });
    const rich = term("x", {
      ...plain.record,
      "subject-field": "optics",
      "concept-entry": { notes: ["n"] },
      designations: [{ term: "x", "part-of-speech": "noun" }],
    });
    const render = writer("csv").render([rich], fileTarget("x.csv"), NO_EXISTING);
    expect(render.files[0]?.content).toBe(writer("csv").render([plain], fileTarget("x.csv"), NO_EXISTING).files[0]?.content);
    expect(render.dropped).toEqual([
      { id: "x", field: "subject-field" },
      { id: "x", field: "concept-entry" },
      { id: "x", field: "designations" },
    ]);
  });

  it("quotes a cell holding a newline", () => {
    const render = writer("csv").render(
      [term("x", { label: "x", definition: "one\ntwo" })],
      fileTarget("x.csv"),
      NO_EXISTING,
    );
    expect(render.files[0]?.content).toContain('"one\ntwo"');
  });
});

describe("skos writer", () => {
  it("renders concepts with resolved relations and language tags", () => {
    const { content, dropped } = renderOne("skos", "terms.jsonld");
    expect(content).toBe(golden("terms.golden.jsonld"));
    expect(dropped).toEqual([
      { id: "progressive-lens", field: "abstract" },
      { id: "kubernetes", field: "see" },
    ]);
  });

  it("parses back as JSON-LD with a SKOS context", () => {
    const { content } = renderOne("skos", "terms.jsonld");
    const parsed = JSON.parse(content) as { "@context": Record<string, string>; "@graph": { "@type": string }[] };
    expect(parsed["@context"]["skos"]).toBe("http://www.w3.org/2004/02/skos/core#");
    expect(parsed["@context"]["dcterms"]).toBe("http://purl.org/dc/terms/");
    expect(parsed["@graph"].filter((n) => n["@type"] === "skos:Concept")).toHaveLength(6);
  });

  it("does not resolve a relation to the term itself", () => {
    const render = writer("skos").render(
      [term("loop", { label: "loop", broader: ["loop"] })],
      fileTarget("x.jsonld"),
      NO_EXISTING,
    );
    expect(render.files[0]?.content).not.toContain("skos:broader");
    expect(render.dropped).toEqual([]);
  });
});

describe("tbx writer", () => {
  it("renders one termEntry per term with a tig per designation", () => {
    const { content, dropped } = renderOne("tbx", "terms.tbx");
    expect(content).toBe(golden("terms.golden.tbx"));
    expect(dropped).toEqual([
      { id: "progressive-lens", field: "abstract" },
      { id: "progressive-lens", field: "broader" },
      { id: "progressive-lens", field: "related-terms" },
      { id: "progressive-lens", field: "scope-note" },
      { id: "spectacle-lens", field: "narrower" },
      { id: "kubernetes", field: "see" },
      { id: "cpp", field: "related-terms" },
    ]);
  });

  it("is well-formed XML with the TBX structure", () => {
    const { content } = renderOne("tbx", "terms.tbx");
    const errors: string[] = [];
    const doc = new DOMParser({
      onError: (level, msg) => {
        if (level === "error" || level === "fatalError") errors.push(msg);
      },
    }).parseFromString(content, "text/xml");
    expect(errors).toEqual([]);
    const root = doc.documentElement;
    expect(root?.tagName).toBe("martif");
    expect(root?.getAttribute("type")).toBe("TBX");
    expect(root?.getAttribute("xml:lang")).toBe("en");
    const entries = doc.getElementsByTagName("termEntry");
    expect(entries.length).toBe(6);
    expect(entries.item(3)?.getAttribute("id")).toBe("api");
    expect(entries.item(3)?.getElementsByTagName("descrip").item(0)?.textContent).toBe(
      "A contract <between> programs & their callers.",
    );
    expect(entries.item(5)?.getElementsByTagName("langSet").item(0)?.getAttribute("xml:lang")).toBe("de");
    expect(entries.item(0)?.getElementsByTagName("tig").length).toBe(4);
  });

  it("tbx3 renders the same entries as TBX v3", () => {
    const { content, dropped } = renderOne("tbx3", "terms.tbx");
    expect(content).toBe(golden("terms-v3.golden.tbx"));
    expect(dropped).toEqual(renderOne("tbx", "terms.tbx").dropped);
  });

  it("tbx3 is well-formed XML in the TBX v3 namespace", () => {
    const { content } = renderOne("tbx3", "terms.tbx");
    const doc = new DOMParser().parseFromString(content, "text/xml");
    const root = doc.documentElement;
    expect(root?.tagName).toBe("tbx");
    expect(root?.namespaceURI).toBe("urn:iso:std:iso:30042:ed-2");
    expect(root?.getAttribute("type")).toBe("TBX-Basic");
    expect(root?.getAttribute("style")).toBe("dca");
    expect(doc.getElementsByTagName("conceptEntry").length).toBe(6);
    expect(doc.getElementsByTagName("termSec").length).toBe(14);
  });

  it("tbx3 is TBX-Linguist when a designation carries a Linguist-only field", () => {
    const linguist = term("save", { label: "Save", designations: [{ term: "Save", register: "neutralRegister" }] });
    const content = writer("tbx3").render([linguist], fileTarget("x.tbx"), NO_EXISTING).files[0]?.content ?? "";
    expect(content).toContain('<tbx type="TBX-Linguist" style="dca" xml:lang="en" xmlns="urn:iso:std:iso:30042:ed-2">');
    expect(content).toContain('<termNote type="register">neutralRegister</termNote>');
  });

  it.each(["tbx", "tbx3"] as const)("%s joins terms on id, one language section each, and reports where they differ", (format) => {
    const terms = [
      term("pal", { label: "progressive lens", "concept-entry": { definition: "A lens.", "subject-field": "optics" } }, "en"),
      term("pal", { label: "Gleitsichtglas", "concept-entry": { "subject-field": "Optik" } }, "de"),
      term("lens", { label: "lens" }, "en"),
    ];
    const render = writer(format).render(terms, fileTarget("x.tbx"), NO_EXISTING);
    const content = render.files[0]?.content ?? "";
    const [entryTag, languageTag] = format === "tbx" ? ["termEntry", "langSet"] : ["conceptEntry", "langSec"];
    const doc = new DOMParser().parseFromString(content, "text/xml");
    expect(doc.getElementsByTagName(entryTag).length).toBe(2);
    expect(doc.getElementsByTagName(entryTag).item(0)?.getElementsByTagName(languageTag).length).toBe(2);
    // A concept-level definition stays at the entry, before its languages.
    expect(content).toContain(
      [
        `      <${entryTag} id="pal">`,
        '        <descrip type="definition">A lens.</descrip>',
        '        <descrip type="subjectField">optics</descrip>',
        `        <${languageTag} xml:lang="en">`,
      ].join("\n"),
    );
    expect(render.conflicts).toEqual([{ id: "pal", field: "concept-entry.subject-field" }]);
  });

  it.each(["tbx", "tbx3"] as const)("%s writes a designation's own status over its label kind", (format) => {
    const t = term("x", {
      label: "x",
      "hidden-labels": ["old x"],
      designations: [{ term: "old x", "administrative-status": "superseded" }],
    });
    const content = writer(format).render([t], fileTarget("x.tbx"), NO_EXISTING).files[0]?.content ?? "";
    expect(content).toContain('<termNote type="administrativeStatus">supersededTerm-admn-sts</termNote>');
  });

  it.each(["tbx", "tbx3"] as const)("%s reports what TBX-Basic has no category for as dropped", (format) => {
    const t = term("x", { label: "x", see: "y", "transfer-comments": ["keep"], "subject-field": "optics" });
    const render = writer(format).render([t], fileTarget("x.tbx"), NO_EXISTING);
    expect(render.dropped).toEqual([
      { id: "x", field: "see" },
      { id: "x", field: "transfer-comments" },
    ]);
    expect(render.droppedHeaders).toEqual([]);
  });

  it("escapes attribute values", () => {
    const render = writer("tbx").render(
      [term('a"b<c', { label: "a" }, 'x"y')],
      fileTarget("x.tbx"),
      NO_EXISTING,
    );
    const content = render.files[0]?.content ?? "";
    expect(content).toContain('<termEntry id="a&quot;b&lt;c">');
    expect(content).toContain('xml:lang="x&quot;y"');
  });
});
