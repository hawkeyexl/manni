/**
 * Writing edited terms back to the files they came from (proposal 0052 § 5).
 * A no-op write changes no byte, whatever the file's formatting; an edit
 * rewrites only the entry it is about, as the same text a render writes.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractorForExtension } from "../../src/meta/internal.js";
import { MANIFEST_FORMAT } from "../../src/term/core/load-set.js";
import { TERM_READERS, readerForConstruct } from "../../src/term/core/readers/index.js";
import { DOCUMENT_WRITERS } from "../../src/term/core/writers/documents.js";
import { writerFor } from "../../src/term/core/writers/index.js";
import { TermError } from "../../src/term/errors.js";
import type {
  Term,
  TermConstruct,
  TermInput,
  TermReader,
  TermRecord,
  TermShape,
  TermWriteFormat,
} from "../../src/term/types.js";
import { term } from "./writer-fixture.js";

const TERM_FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "term");
const HERE = join(TERM_FIXTURES, "writers-documents");

function isManifest(path: string): boolean {
  const name = basename(path);
  return basename(dirname(path)) === "manifest" || name === "terms.yaml" || name === "terms.json";
}

function inputOf(content: string, path: string): TermInput {
  const file = relative(TERM_FIXTURES, path).replaceAll("\\", "/");
  if (isManifest(path)) {
    return { content, file, path, format: MANIFEST_FORMAT, metadata: {}, lineFor: () => undefined };
  }
  const extractor = extractorForExtension(extname(path));
  if (extractor === undefined) throw new Error(`no extractor for ${path}`);
  const extracted = extractor.extract(content, path);
  return { content, file, path, format: extractor.name, metadata: extracted.data, lineFor: extracted.lineFor };
}

function fixture(name: string, crlf = false): TermInput {
  const path = join(HERE, name);
  const content = readFileSync(path, "utf8");
  return inputOf(crlf ? content.replace(/\r?\n/g, "\r\n") : content, path);
}

function reader(construct: TermConstruct): TermReader {
  const found = readerForConstruct(construct);
  if (found === undefined) throw new Error(`no ${construct} reader`);
  return found;
}

function applyOf(r: TermReader): NonNullable<TermReader["apply"]> {
  if (r.apply === undefined) throw new Error(`${r.construct} has no apply`);
  return r.apply;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** Every reader fixture and every write-back fixture, with each reader that holds entries in it. */
function noOpCases(): { name: string; path: string; construct: TermConstruct }[] {
  const dirs = ["readers", "readers-text", "writers-documents"].map((d) => join(TERM_FIXTURES, d));
  const cases: { name: string; path: string; construct: TermConstruct }[] = [];
  for (const path of dirs.flatMap(walk)) {
    if (!isManifest(path) && extractorForExtension(extname(path)) === undefined) continue;
    let input: TermInput;
    try {
      input = inputOf(readFileSync(path, "utf8"), path);
    } catch {
      continue;
    }
    for (const r of TERM_READERS) {
      if (r.apply === undefined || !r.formats.includes(input.format)) continue;
      let terms: Term[];
      try {
        terms = r.read(input).terms;
      } catch {
        continue;
      }
      if (terms.length > 0) cases.push({ name: `${input.file} (${r.construct})`, path, construct: r.construct });
    }
  }
  return cases;
}

function withDefinition(t: Term, definition: string): Term {
  return { ...t, record: { ...t.record, definition } };
}

function byId(terms: readonly Term[], id: string): Term {
  const found = terms.find((t) => t.id === id);
  if (found === undefined) throw new Error(`no ${id} in ${terms.map((t) => t.id).join(", ")}`);
  return found;
}

describe("in-place write-back", () => {
  it("every reader writes in place except html-dfn", () => {
    expect(TERM_READERS.filter((r) => r.apply === undefined).map((r) => r.construct)).toEqual(["html-dfn"]);
  });

  const cases = noOpCases();

  it("finds a no-op case for every writable construct", () => {
    const constructs = new Set(cases.map((c) => c.construct));
    for (const r of TERM_READERS) {
      if (r.apply !== undefined) expect(constructs, r.construct).toContain(r.construct);
    }
  });

  it.each(cases)("a no-op write leaves $name byte-identical", ({ path, construct }) => {
    const r = reader(construct);
    for (const crlf of [false, true]) {
      const content = readFileSync(path, "utf8");
      const input = inputOf(crlf ? content.replace(/\r?\n/g, "\r\n") : content, path);
      expect(applyOf(r)(input, r.read(input).terms)).toBe(input.content);
    }
  });
});

describe("an edited entry", () => {
  it.each([
    { name: "deflist.md", construct: "markdown-deflist", id: "command-line-interface", crlf: false },
    { name: "deflist.md", construct: "markdown-deflist", id: "apple", crlf: true },
    { name: "glossary.adoc", construct: "asciidoc-glossary", id: "jam", crlf: false },
    { name: "glossary.rst", construct: "rst-glossary", id: "source-directory", crlf: false },
    { name: "glossary.rst", construct: "rst-glossary", id: "environment", crlf: true },
    { name: "glossgroup.dita", construct: "dita-glossgroup", id: "pal", crlf: false },
    { name: "glossentry.dita", construct: "dita-glossentry", id: "pal", crlf: false },
    { name: "glossary.xml", construct: "docbook-glossary", id: "bifocal", crlf: false },
    { name: "dl.html", construct: "html-dl", id: "bifocal", crlf: false },
    { name: "dl.html", construct: "html-dl", id: "pal", crlf: true },
  ] as const)("$construct rewrites only $id in $name (crlf $crlf)", ({ name, construct, id, crlf }) => {
    const r = reader(construct);
    const input = fixture(name, crlf);
    const before = r.read(input).terms;
    const target = byId(before, id);
    const span = target.location.span;
    if (span === undefined) throw new Error("no span");

    const edited = before.map((t) => (t.id === id ? withDefinition(t, "Edited here.\n\nA second paragraph.") : t));
    const next = applyOf(r)(input, edited);

    const tail = input.content.length - span.end;
    expect(next.slice(0, span.start)).toBe(input.content.slice(0, span.start));
    expect(next.slice(next.length - tail)).toBe(input.content.slice(span.end));
    expect(next.slice(span.start, next.length - tail)).not.toContain(crlf ? "\n\n" : "\r");

    const after = r.read(inputOf(next, input.path ?? "")).terms;
    expect(byId(after, id).record.definition).toBe("Edited here.\n\nA second paragraph.");
    expect(after.map((t) => t.id)).toEqual(before.map((t) => t.id));
    for (const t of before.filter((b) => b.id !== id)) {
      expect(byId(after, t.id).record).toEqual(t.record);
    }
  });

  const RENDERED: { format: TermWriteFormat; shape: TermShape; construct: TermConstruct; extension: string }[] = [
    { format: "markdown", shape: "file", construct: "markdown-deflist", extension: ".md" },
    { format: "mdx", shape: "file", construct: "markdown-deflist", extension: ".mdx" },
    { format: "asciidoc", shape: "file", construct: "asciidoc-glossary", extension: ".adoc" },
    { format: "rst", shape: "file", construct: "rst-glossary", extension: ".rst" },
    { format: "html", shape: "file", construct: "html-dl", extension: ".html" },
    { format: "dita", shape: "file", construct: "dita-glossgroup", extension: ".dita" },
    { format: "dita", shape: "directory", construct: "dita-glossentry", extension: ".dita" },
    { format: "docbook", shape: "file", construct: "docbook-glossary", extension: ".xml" },
  ];

  it.each(RENDERED)(
    "$construct splices the same bytes a $format $shape render writes",
    ({ format, shape, construct, extension }) => {
      const writer = writerFor(format, DOCUMENT_WRITERS);
      if (writer === undefined) throw new Error(`no ${format} writer`);
      const set = [
        term("apple", { label: "apple", definition: "A fruit." }, "en"),
        term("cli", { label: "command-line interface", definition: "A program.", "alt-labels": ["CLI"] }, "en"),
      ];
      const holds = writer.holds(shape);
      const edit = (record: TermRecord): TermRecord => ({
        ...record,
        definition: "Typed at a prompt.\n\nIt prints text.",
        "alt-labels": ["CLI", "command line"],
        ...(holds.includes("scope-note") ? { "scope-note": "Terminals." } : {}),
      });
      const edited = set.map((t) => (t.id === "cli" ? { ...t, record: edit(t.record) } : t));

      const root = join(TERM_FIXTURES, "rendered");
      const target = shape === "file" ? { path: join(root, `glossary${extension}`), shape } : { path: root, shape };
      const [original] = writer.render(shape === "file" ? set : set.slice(1), target, { existing: new Map() }).files;
      const [expected] = writer.render(shape === "file" ? edited : edited.slice(1), target, { existing: new Map() }).files;
      if (original === undefined || expected === undefined) throw new Error("nothing rendered");

      const r = reader(construct);
      const input = inputOf(original.content, original.path);
      const read = r.read(input).terms;
      const next = applyOf(r)(
        input,
        read.map((t) => (t.id === "cli" || t.id === "command-line-interface" ? { ...t, record: edit(t.record) } : t)),
      );
      expect(next).toBe(expected.content);
    },
  );

  it("refuses an entry with no span", () => {
    const r = reader("markdown-deflist");
    const input = fixture("deflist.md");
    const terms = r.read(input).terms.map((t): Term => {
      if (t.id !== "apple") return t;
      const { span: _span, ...location } = t.location;
      return { ...withDefinition(t, "Changed."), location };
    });
    expect(() => applyOf(r)(input, terms)).toThrow(
      new TermError(
        'writers-documents/deflist.md: term "apple" cannot be written in place, because its entry has no position in the file.',
      ),
    );
  });

  it("refuses an entry whose span no longer matches the file", () => {
    const r = reader("html-dl");
    const input = fixture("dl.html");
    const terms = r.read(input).terms.map((t): Term =>
      t.id === "pal" ? { ...withDefinition(t, "Changed."), location: { ...t.location, span: { start: 1, end: 2 } } } : t,
    );
    expect(() => applyOf(r)(input, terms)).toThrow(
      new TermError('writers-documents/dl.html: term "pal" does not match an entry in the file. Read the file again before writing it.'),
    );
  });
});

describe("a page", () => {
  it("sets changed fields and removes absent ones through the extractor, and nothing else", () => {
    const r = reader("page");
    const input = fixture("term.md");
    const [page] = r.read(input).terms;
    if (page === undefined) throw new Error("no page term");
    const { "scope-note": _dropped, ...rest } = page.record;
    const next = applyOf(r)(input, [{ ...page, record: { ...rest, definition: "Edited." } }]);

    expect(next).toContain("# A hand-written term page.");
    expect(next).toContain("title: Progressive lens");
    expect(next).not.toContain("scope-note");
    expect(next.endsWith("\nProse stays.\n")).toBe(true);
    const [after] = r.read(inputOf(next, input.path ?? "")).terms;
    expect(after?.record).toEqual({ ...rest, definition: "Edited." });
  });

  it("names the file when its extractor cannot write a value", () => {
    const r = reader("page");
    const path = join(TERM_FIXTURES, "readers", "page", "term.html");
    const input = inputOf(readFileSync(path, "utf8"), path);
    const [page] = r.read(input).terms;
    if (page === undefined) throw new Error("no page term");
    expect(() => applyOf(r)(input, [{ ...page, record: { ...page.record, "alt-labels": ["A", "B"] } }])).toThrow(
      /^readers\/page\/term\.html: /,
    );
  });
});

describe("a manifest", () => {
  it("edits one YAML entry and keeps comments, key order and the other entries", () => {
    const r = reader("manifest");
    const input = fixture("terms.yaml");
    const before = r.read(input).terms;
    const bifocal = byId(before, "bifocal");
    const edited = before.map((t) =>
      t.id === "bifocal" ? { ...t, record: { label: "bifocal", definition: "Two powers.", broader: ["lens"] } } : t,
    );
    const next = applyOf(r)(input, edited);

    const block = (text: string, from: string, to: string): string => text.slice(text.indexOf(from), text.indexOf(to));
    expect(next.startsWith("# A hand-written manifest: comments, flow lists, quoting.\n")).toBe(true);
    expect(block(next, "progressive-lens:", "bifocal:")).toBe(block(input.content, "progressive-lens:", "bifocal:"));
    expect(next).toContain("\ntrifocal: {label: trifocal, definition: Three powers.}\n");
    expect(next).toContain("x-owner: optics team");
    expect(next.indexOf("definition: Two powers.")).toBeLessThan(next.indexOf("x-owner"));

    const after = r.read(inputOf(next, input.path ?? "")).terms;
    expect(byId(after, "bifocal").record).toEqual({ label: "bifocal", definition: "Two powers.", broader: ["lens"] });
    expect(byId(after, "progressive-lens").record).toEqual(byId(before, "progressive-lens").record);
    expect(bifocal.record.definition).toBe("Lenses with two powers.");
  });

  it("appends a new entry and leaves an entry it was not given alone", () => {
    const r = reader("manifest");
    const input = fixture("terms.yaml");
    const before = r.read(input).terms.filter((t) => t.id !== "trifocal");
    const next = applyOf(r)(input, [...before, term("monocle", { label: "monocle", definition: "One lens." })]);
    const after = r.read(inputOf(next, input.path ?? "")).terms;
    expect(after.map((t) => t.id)).toEqual(["progressive-lens", "bifocal", "trifocal", "monocle"]);
    expect(byId(after, "monocle").record).toEqual({ label: "monocle", definition: "One lens." });
  });

  it("rewrites a JSON manifest with two-space indentation", () => {
    const r = reader("manifest");
    const input = fixture("terms.json");
    const before = r.read(input).terms;
    const next = applyOf(r)(
      input,
      before.map((t) => (t.id === "bifocal" ? withDefinition(t, "Two powers.") : t)),
    );
    expect(next).toBe(
      `${JSON.stringify(
        {
          "progressive-lens": { label: "progressive lens", "alt-labels": ["PAL"], "x-owner": "optics" },
          bifocal: { label: "bifocal", definition: "Two powers." },
        },
        null,
        2,
      )}\n`,
    );
  });
});
