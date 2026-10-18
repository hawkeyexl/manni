/**
 * TBX in both directions (proposal 0084 § 5), over every readable fixture in
 * `test/fixtures/term/readers/tbx/` and both writer goldens:
 *
 * 1. an in-place write with no edits is byte-identical, LF and CRLF. The
 *    reader fixtures are covered by `apply.test.ts`'s no-op cases; the
 *    goldens, which sit outside the directories it walks, are covered here;
 * 2. read, write `-f tbx` or `-f tbx3`, read again: the same records;
 * 3. a golden exports byte-identical to itself;
 * 4. a third-party file exports, at its own version, XML-equivalent to the
 *    input (and, because unchanged entries are copied, byte-identical).
 */
import { DOMParser, type Node } from "@xmldom/xmldom";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { tbxInput } from "../../src/term/core/load-set.js";
import { readerForConstruct } from "../../src/term/core/readers/index.js";
import { tbxSourceOf } from "../../src/term/core/readers/tbx-model.js";
import { writerFor } from "../../src/term/core/writers/index.js";
import type { Term, TermReader, TermRender } from "../../src/term/types.js";
import { WRITERS_FIXTURES, term as manifestTerm } from "./writer-fixture.js";

const DIR = resolve(__dirname, "../fixtures/term/readers/tbx");
const NO_EXISTING = { existing: new Map<string, string>() };
const TARGET = { path: resolve("out", "x.tbx"), shape: "file" as const };

/** Every fixture whose terms the reader tests pin: the readable ones. */
const THIRD_PARTY = readdirSync(DIR)
  .filter((name) => name.endsWith(".expected.json"))
  .map((name) => name.slice(0, -".expected.json".length));

const GOLDENS = [
  { name: "terms.golden.tbx", format: "tbx" },
  { name: "terms-v3.golden.tbx", format: "tbx3" },
] as const;

type TbxWriteFormat = "tbx" | "tbx3";

function reader(): TermReader {
  const found = readerForConstruct("tbx-entry");
  if (found === undefined) throw new Error("no tbx-entry reader");
  return found;
}

function fixturePath(name: string): string {
  return name.endsWith(".golden.tbx") ? join(WRITERS_FIXTURES, name) : join(DIR, `${name}.tbx`);
}

function read(content: string, file: string): Term[] {
  return reader().read(tbxInput(content, file, resolve(file))).terms;
}

function readFixture(name: string): { content: string; terms: Term[]; file: string } {
  const content = readFileSync(fixturePath(name), "utf8");
  const file = name.endsWith(".tbx") ? name : `${name}.tbx`;
  return { content, terms: read(content, file), file };
}

function render(terms: readonly Term[], format: TbxWriteFormat): TermRender {
  const writer = writerFor(format);
  if (writer === undefined) throw new Error(`no ${format} writer`);
  return writer.render(terms, TARGET, NO_EXISTING);
}

function write(terms: readonly Term[], format: TbxWriteFormat): string {
  return render(terms, format).files[0]?.content ?? "";
}

/** What must survive a round trip: each term's id, language and whole record, in order. */
function records(terms: readonly Term[]): unknown[] {
  return terms.map((t) => ({ id: t.id, language: t.language, record: t.record }));
}

/**
 * A document as a list of tokens that ignores inter-element whitespace,
 * attribute order and quote style: element names with their namespace and
 * sorted attributes, text that is not whitespace alone, comments and PIs.
 */
function xmlTokens(content: string): string[] {
  const tokens: string[] = [];
  const walk = (node: Node): void => {
    switch (node.nodeType) {
      case 1: {
        const el = node as unknown as import("@xmldom/xmldom").Element;
        const attributes: string[] = [];
        for (let i = 0; i < el.attributes.length; i++) {
          const a = el.attributes.item(i);
          if (a !== null) attributes.push(`${a.name}=${a.value}`);
        }
        tokens.push(`<{${el.namespaceURI ?? ""}}${el.localName ?? el.nodeName} ${attributes.sort().join(" ")}>`);
        for (let i = 0; i < el.childNodes.length; i++) {
          const child = el.childNodes.item(i);
          if (child !== null) walk(child);
        }
        tokens.push("</>");
        return;
      }
      case 3:
      case 4:
        if ((node.nodeValue ?? "").trim() !== "") tokens.push(`text:${node.nodeValue ?? ""}`);
        return;
      case 7:
        tokens.push(`pi:${node.nodeName} ${node.nodeValue ?? ""}`);
        return;
      case 8:
        tokens.push(`comment:${node.nodeValue ?? ""}`);
        return;
      default:
        return;
    }
  };
  const doc = new DOMParser().parseFromString(content, "text/xml");
  for (let i = 0; i < doc.childNodes.length; i++) {
    const child = doc.childNodes.item(i);
    if (child !== null) walk(child);
  }
  return tokens;
}

function versionOf(content: string): TbxWriteFormat {
  return /<martif[\s>]/.test(content) ? "tbx" : "tbx3";
}

describe("the XML comparer", () => {
  it("ignores inter-element whitespace, attribute order and quote style, and nothing else", () => {
    const a = '<a x="1" y="2">\n  <b>t</b>\n</a>';
    expect(xmlTokens(a)).toEqual(xmlTokens("<a y='2' x='1'><b>t</b></a>"));
    expect(xmlTokens(a)).not.toEqual(xmlTokens('<a x="1" y="2"><b>u</b></a>'));
    expect(xmlTokens(a)).not.toEqual(xmlTokens('<a x="1"><b>t</b></a>'));
    expect(xmlTokens(a)).not.toEqual(xmlTokens('<a x="1" y="2"><b>t</b><!-- c --></a>'));
  });
});

describe("TBX round trip", () => {
  it("finds the readable fixtures", () => {
    expect(THIRD_PARTY).toContain("tbx-basic-v2");
    expect(THIRD_PARTY).toContain("dct-style-v3");
  });

  it.each(GOLDENS)("an in-place write leaves $name byte-identical", ({ name }) => {
    const apply = reader().apply;
    if (apply === undefined) throw new Error("no apply");
    for (const crlf of [false, true]) {
      const raw = readFileSync(fixturePath(name), "utf8");
      const input = tbxInput(crlf ? raw.replace(/\n/g, "\r\n") : raw, name, fixturePath(name));
      expect(apply(input, reader().read(input).terms)).toBe(input.content);
    }
  });

  const ALL = [...THIRD_PARTY, ...GOLDENS.map((g) => g.name)];
  const BOTH = ALL.flatMap((name) => (["tbx", "tbx3"] as const).map((format) => ({ name, format })));

  it.each(BOTH)("$name reads back as the same records after -f $format", ({ name, format }) => {
    const { terms, file } = readFixture(name);
    expect(records(read(write(terms, format), file))).toEqual(records(terms));
  });

  it.each(ALL)("%s reads back as the same records after -f tbx3 then -f tbx", (name) => {
    const { terms, file } = readFixture(name);
    const v3 = read(write(terms, "tbx3"), "v3.tbx");
    expect(records(read(write(v3, "tbx"), file))).toEqual(records(terms));
  });

  it.each(GOLDENS)("$name exports byte-identical to itself", ({ name, format }) => {
    const { content, terms } = readFixture(name);
    expect(write(terms, format)).toBe(content);
  });

  it.each(THIRD_PARTY)("%s exports XML-equivalent, and byte-identical, at its own version", (name) => {
    const { content, terms } = readFixture(name);
    const out = write(terms, versionOf(content));
    expect(xmlTokens(out)).toEqual(xmlTokens(content));
    expect(out).toBe(content);
  });

  it("changes only the edited entry", () => {
    const { content, terms } = readFixture("tbx-basic-v2");
    const at = terms.findIndex((t) => t.id === "spectacle-lens" && t.language === "de");
    const edited = terms.map((t, i) => (i === at ? { ...t, record: { ...t.record, label: "Brillenglas, mineralisch" } } : t));
    const span = edited[at]?.location.span;
    if (span === undefined) throw new Error("no span");
    const out = write(edited, "tbx");
    expect(out.slice(0, span.start)).toBe(content.slice(0, span.start));
    expect(out.endsWith(content.slice(span.end))).toBe(true);
    const entry = out.slice(span.start, out.length - (content.length - span.end));
    expect(entry).toMatch(/^<termEntry id="spectacle-lens">[\s\S]*<term>Brillenglas, mineralisch<\/term>[\s\S]*<\/termEntry>$/);
    expect(records(read(out, "x.tbx"))).toEqual(records(edited));
  });

  it("leaves out the entry of a term no longer in the set", () => {
    const { content, terms } = readFixture("tbx-basic-v2");
    const out = write(
      terms.filter((t) => t.id !== "spectacle-lens"),
      "tbx",
    );
    const span = terms.find((t) => t.id === "spectacle-lens")?.location.span;
    if (span === undefined) throw new Error("no span");
    const lineStart = content.lastIndexOf("\n", span.start - 1) + 1;
    expect(out).toBe(content.slice(0, lineStart) + content.slice(span.end + 1));
    expect(read(out, "x.tbx").map((t) => t.id)).toEqual(["progressive-lens", "progressive-lens"]);
  });
});

describe("TBX headers on export", () => {
  it("copies the header from the source at its own version, and reports none dropped", () => {
    const { content, terms } = readFixture("tbx-basic-v3");
    const rendered = render(terms, "tbx3");
    expect(rendered.files[0]?.content).toBe(content);
    expect(rendered.droppedHeaders).toEqual([]);
  });

  it("carries the header's children into the other version's header", () => {
    const { terms } = readFixture("tbx-basic-v2");
    const rendered = render(terms, "tbx3");
    const out = rendered.files[0]?.content ?? "";
    expect(out).toContain(
      [
        "  <tbxHeader>",
        "    <fileDesc>",
        "      <sourceDesc>",
        "        <p>A hand-written TBX-Basic sample.</p>",
        "      </sourceDesc>",
        "    </fileDesc>",
        "    <encodingDesc>",
        '      <p type="XCSURI">TBXBasicXCSV02.xcs</p>',
        "    </encodingDesc>",
        "  </tbxHeader>",
      ].join("\n"),
    );
    expect(out).not.toContain("DOCTYPE");
    expect(rendered.droppedHeaders).toEqual([]);
    const back = render(read(out, "v3.tbx"), "tbx").files[0]?.content ?? "";
    expect(back).toContain('  <martifHeader>\n    <fileDesc>\n      <sourceDesc>\n        <p>A hand-written TBX-Basic sample.</p>');
  });

  it("writes manni's header and names every TBX source whose header it left behind", () => {
    const v2 = readFixture("tbx-basic-v2").terms;
    const v3 = readFixture("tbx-basic-v3").terms;
    const both = render([...v2, ...v3], "tbx3");
    expect(both.files[0]?.content).toContain("<p>manni term write</p>");
    expect(both.droppedHeaders).toEqual(["tbx-basic-v2.tbx", "tbx-basic-v3.tbx"]);
    const mixed = render([...v2, manifestTerm("lens", { label: "lens" })], "tbx");
    expect(mixed.droppedHeaders).toEqual(["tbx-basic-v2.tbx"]);
  });

  it("finds each term's source after its record is edited", () => {
    const [first] = readFixture("tbx-basic-v2").terms;
    if (first === undefined) throw new Error("no terms");
    expect(tbxSourceOf({ ...first, record: { ...first.record, label: "x" } })).toBe(tbxSourceOf(first));
  });
});

/** The terms with one designation renamed, in its label field and its `designations` item alike. */
function rename(terms: readonly Term[], from: string, to: string): Term[] {
  const swap = (s: string): string => (s === from ? to : s);
  return terms.map((t) => {
    const { record } = t;
    if (![record.label, ...(record["alt-labels"] ?? []), ...(record["hidden-labels"] ?? [])].includes(from)) return t;
    return {
      ...t,
      record: {
        ...record,
        label: swap(record.label),
        ...(record["alt-labels"] === undefined ? {} : { "alt-labels": record["alt-labels"].map(swap) }),
        ...(record["hidden-labels"] === undefined ? {} : { "hidden-labels": record["hidden-labels"].map(swap) }),
        ...(record.designations === undefined
          ? {}
          : { designations: record.designations.map((d) => ({ ...d, term: swap(d.term) })) }),
      },
    };
  });
}

function applyInPlace(name: string, terms: readonly Term[]): string {
  const apply = reader().apply;
  if (apply === undefined) throw new Error("no apply");
  return apply(tbxInput(readFileSync(fixturePath(name), "utf8"), `${name}.tbx`, fixturePath(name)), terms);
}

describe("a changed entry rewritten at its own version", () => {
  const WAYS = [
    { way: "in place", out: (name: string, terms: readonly Term[]) => applyInPlace(name, terms) },
    { way: "on export", out: (_name: string, terms: readonly Term[]) => write(terms, "tbx") },
  ];

  it.each(WAYS)("keeps ntig and termGrp $way, so only the edited text changes", ({ out }) => {
    const { content, terms } = readFixture("microsoft-style");
    const written = out("microsoft-style", rename(terms, "speichern", "sichern"));
    expect(written).toBe(content.replace("<term>speichern</term>", "<term>sichern</term>"));
  });

  it.each(WAYS)("keeps the attributes of the structural elements $way", ({ out }) => {
    const { terms } = readFixture("structure-attributes");
    const edited = rename(terms, "lens", "lenses");
    const written = out("structure-attributes", edited);
    expect(written).toContain('<langSet xml:lang="en" id="ls-en">');
    expect(written).toContain('<tig id="t1">');
    expect(written).toContain('<term id="term-1">lenses</term>');
    expect(records(read(written, "structure-attributes.tbx"))).toEqual(records(edited));
  });

  it("writes a new designation canonically beside the kept ones", () => {
    const { terms } = readFixture("microsoft-style");
    const edited = terms.map((t, i) => {
      if (i !== 1) return t;
      const designations = [...(t.record.designations ?? []), { term: "sichern" }];
      return { ...t, record: { ...t.record, "alt-labels": ["sichern"], designations } };
    });
    const written = applyInPlace("microsoft-style", edited);
    expect(written).toContain("<ntig>\n            <termGrp>\n              <term>speichern</term>");
    expect(written).toContain("<tig>\n            <term>sichern</term>");
    expect(records(read(written, "microsoft-style.tbx"))).toEqual(records(edited));
  });

  it("writes canonical structure at the other version", () => {
    const { terms } = readFixture("structure-attributes");
    const written = write(rename(terms, "lens", "lenses"), "tbx3");
    expect(written).not.toContain("ls-en");
    expect(written).not.toContain('id="t1"');
  });
});

describe("TBX back matter on export", () => {
  /** `<back>` through `</back>`. */
  function backOf(content: string): string {
    return content.slice(content.indexOf("<back>"), content.indexOf("</back>") + "</back>".length);
  }

  it("carries the back matter to v3 and back, renaming refObjectList to refObjectSec", () => {
    const { content, terms } = readFixture("back-matter");
    const v3 = write(terms, "tbx3");
    expect(v3).toContain(
      [
        "    </body>",
        "    <back>",
        '      <refObjectSec type="respPerson">',
        '        <refObject id="sara">',
        '          <item type="fn">Sara Ortiz</item>',
      ].join("\n"),
    );
    expect(v3).not.toContain("refObjectList");
    const v2 = write(read(v3, "v3.tbx"), "tbx");
    expect(backOf(v2)).toBe(backOf(content));
    expect(records(read(v2, "back-matter.tbx"))).toEqual(records(terms));
  });
});

describe("a DTD entity reference", () => {
  const ENTITY_DEFINITION = '<descrip type="definition">A lens made by &acme;.</descrip>';

  it("keeps an element whose value holds one whole in tbx-elements, and the term text as written", () => {
    const { terms } = readFixture("dtd-entity");
    const [lens, acme] = terms;
    expect(lens?.record.definition).toBeUndefined();
    expect(lens?.record["tbx-elements"]).toEqual([ENTITY_DEFINITION]);
    expect(acme?.record.label).toBe("&acme; lens");
    expect(acme?.record.definition).toBe("A lens & frame, model A.");
  });

  it("leaves the file byte-identical on a no-op write in place", () => {
    const { content, terms } = readFixture("dtd-entity");
    expect(applyInPlace("dtd-entity", terms)).toBe(content);
  });

  it("writes the references back unchanged when another field of their entry is edited", () => {
    const { content, terms } = readFixture("dtd-entity");
    const edited = terms.map((t) =>
      t.id === "acme-lens"
        ? { ...t, record: { ...t.record, definition: "A lens and frame." } }
        : { ...t, record: { ...t.record, "concept-entry": { "subject-field": "ophthalmic optics" } } },
    );
    const written = applyInPlace("dtd-entity", edited);
    expect(written).not.toBe(content);
    expect(written).toContain(">ophthalmic optics<");
    expect(written).toContain(">A lens and frame.<");
    expect(written).toContain(ENTITY_DEFINITION);
    expect(written).toContain("<term>&acme; lens</term>");
    expect(written).not.toContain("&amp;acme;");
    expect(records(read(written, "dtd-entity.tbx"))).toEqual(records(edited));
  });
});
