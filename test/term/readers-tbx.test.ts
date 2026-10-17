/**
 * The TBX reader (proposal 0084): v2 and v3, DCA and DCT, one term per
 * language joined on the entry id. Each readable fixture's terms are pinned in
 * `<name>.expected.json` beside it, and every entry the canonical form writes
 * reads back as the same terms.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TBX_FORMAT, loadTermSet, tbxInput } from "../../src/term/core/load-set.js";
import { readerForConstruct } from "../../src/term/core/readers/index.js";
import { tbxEntryLines, tbxSourceOf } from "../../src/term/core/readers/tbx-model.js";
import { lineEnding } from "../../src/term/core/readers/splice.js";
import { reindent } from "../../src/term/core/writers/markup.js";
import { TermError } from "../../src/term/errors.js";
import type { Term, TermInput, TermReader, TermRun } from "../../src/term/types.js";

const DIR = resolve(__dirname, "../fixtures/term/readers/tbx");

const READABLE = [
  "tbx-basic-v2",
  "tbx-basic-v3",
  "linguist-v3",
  "dct-style-v3",
  "memoq-style",
  "microsoft-style",
  "iate-phrase-style",
  "structure-attributes",
  "inline-markup",
  "no-term",
] as const;

function reader(): TermReader {
  const found = readerForConstruct("tbx-entry");
  if (found === undefined) throw new Error("no tbx-entry reader");
  return found;
}

function input(name: string, crlf = false): TermInput {
  const path = join(DIR, `${name}.tbx`);
  const content = readFileSync(path, "utf8");
  return tbxInput(crlf ? content.replace(/\r?\n/g, "\r\n") : content, `${name}.tbx`, path);
}

/** What a fixture's expected file pins: each term without its absolute path. */
function pinned(terms: readonly Term[]): unknown[] {
  return terms.map((t) => ({
    id: t.id,
    ...(t.language === undefined ? {} : { language: t.language }),
    line: t.location.line,
    record: t.record,
  }));
}

function expected(name: string): { terms: unknown[]; notices: string[] } {
  return JSON.parse(readFileSync(join(DIR, `${name}.expected.json`), "utf8")) as { terms: unknown[]; notices: string[] };
}

describe("tbx-entry reader", () => {
  it("is registered for the tbx format", () => {
    expect(reader().label).toBe("TBX entry");
    expect(reader().formats).toEqual([TBX_FORMAT]);
    expect(reader().apply).toBeDefined();
  });

  it.each(READABLE)("reads %s.tbx as its expected terms", (name) => {
    const result = reader().read(input(name));
    expect({ terms: pinned(result.terms), notices: result.notices }).toEqual(expected(name));
  });

  it.each(READABLE)("reads %s.tbx the same with CRLF line endings", (name) => {
    expect(pinned(reader().read(input(name, true)).terms)).toEqual(pinned(reader().read(input(name)).terms));
  });

  it("refuses a file whose root is not TBX", () => {
    expect(() => reader().read(input("not-tbx"))).toThrow(
      new TermError("not-tbx.tbx: is not TBX: its root element is <glossary>, not <martif> or <tbx>."),
    );
  });

  it("refuses a file that does not parse", () => {
    expect(() => reader().read(input("malformed"))).toThrow(TermError);
    expect(() => reader().read(input("malformed"))).toThrow(/^malformed\.tbx: could not be read as tbx: /);
  });

  it("declares an outside namespace on the item that carries it", () => {
    const [first] = reader().read(input("dct-style-v3")).terms;
    expect(first?.record["concept-entry"]?.["tbx-elements"]).toEqual([
      '<acme:reviewed xmlns:acme="https://acme.example/tbx">yes</acme:reviewed>',
    ]);
  });

  it("keeps the source, version and entry span of each term for an export", () => {
    const terms = reader().read(input("tbx-basic-v3")).terms;
    const [first, second] = terms;
    if (first === undefined || second === undefined) throw new Error("no terms");
    const source = tbxSourceOf(first);
    expect(source?.document.version).toBe(3);
    expect(source?.document.style).toBe("dca");
    expect(source?.span).toEqual(first.location.span);
    expect(tbxSourceOf(second)?.span).toEqual(first.location.span);
    const body = source?.document.body;
    if (source === undefined || body === undefined) throw new Error("no body");
    expect(source.document.content.slice(body.start, body.end)).toContain("<conceptEntry");
    expect(source.document.content.slice(source.span.start, source.span.end)).toMatch(/^<conceptEntry[\s\S]*<\/conceptEntry>$/);
  });

  /** Every entry written in its canonical form, in place of its source text. */
  function canonical(file: TermInput, terms: readonly Term[]): string {
    const groups = new Map<number, Term[]>();
    for (const t of terms) {
      const span = t.location.span;
      if (span === undefined) throw new Error("no span");
      groups.set(span.start, [...(groups.get(span.start) ?? []), t]);
    }
    let next = file.content;
    for (const group of [...groups.values()].reverse()) {
      const [head] = group;
      const span = head?.location.span;
      const source = head === undefined ? undefined : tbxSourceOf(head);
      if (span === undefined || source === undefined) throw new Error("no source");
      const lineStart = next.lastIndexOf("\n", span.start - 1) + 1;
      const indent = next.slice(lineStart, span.start);
      const text = reindent(tbxEntryLines(group, source.document).join("\n"), indent, lineEnding(next));
      next = next.slice(0, span.start) + text + next.slice(span.end);
    }
    return next;
  }

  it.each(READABLE)("reads %s.tbx back unchanged after every entry is written canonically", (name) => {
    for (const crlf of [false, true]) {
      const file = input(name, crlf);
      const before = reader().read(file).terms;
      const rewritten = canonical(file, before);
      const after = reader().read(tbxInput(rewritten, file.file, file.path)).terms;
      expect(pinned(after).map((t) => ({ ...(t as object), line: 0 }))).toEqual(
        pinned(before).map((t) => ({ ...(t as object), line: 0 })),
      );
    }
  });
});

describe("loading TBX", () => {
  let work: string | undefined;
  afterEach(() => {
    if (work !== undefined) rmSync(work, { recursive: true, force: true });
    work = undefined;
  });

  function runFor(base: string, inputs: string[], extra: Partial<TermRun> = {}): TermRun {
    return { config: null, inputs, base, collections: [], fromCollections: false, manifests: [], tools: {}, ...extra };
  }

  it("reads a named .tbx file", async () => {
    const set = await loadTermSet({ run: runFor(DIR, ["tbx-basic-v2.tbx"]) });
    expect(set.terms.map((t) => `${t.id} ${t.language ?? ""}`)).toEqual([
      "progressive-lens en",
      "progressive-lens de",
      "spectacle-lens en",
      "spectacle-lens de",
    ]);
  });

  it("walks .tbx files in a directory, and leaves them out under --ext", async () => {
    work = mkdtempSync(join(tmpdir(), "manni-tbx-"));
    writeFileSync(join(work, "glossary.tbx"), readFileSync(join(DIR, "tbx-basic-v3.tbx"), "utf8"));
    writeFileSync(join(work, "page.md"), "---\ntype: term\nlabel: lens\ndefinition: A lens.\n---\n");
    const set = await loadTermSet({ run: runFor(work, ["."]) });
    expect(set.terms.map((t) => t.record.label)).toEqual(["progressive lens", "Gleitsichtglas", "bifocal", "lens"]);
    const md = await loadTermSet({ run: runFor(work, ["."]), exts: ["md"] });
    expect(md.terms.map((t) => t.record.label)).toEqual(["lens"]);
  });

  it("reads stdin with --as tbx", async () => {
    const set = await loadTermSet({
      run: runFor(DIR, ["-"]),
      stdin: readFileSync(join(DIR, "linguist-v3.tbx"), "utf8"),
      as: "tbx",
    });
    expect(set.terms.map((t) => t.location.file)).toEqual(["<stdin>", "<stdin>", "<stdin>"]);
    expect(set.terms.map((t) => t.record.label)).toEqual(["Save", "Speichern", "保存"]);
  });

  it("reads a .tbx listed under term.manifests", async () => {
    const path = join(DIR, "tbx-basic-v3.tbx");
    const set = await loadTermSet({
      run: runFor(DIR, [], { manifests: [{ path, written: "tbx-basic-v3.tbx" }] }),
    });
    expect(set.terms).toHaveLength(3);
  });

  it("says when a TBX entry has no term", async () => {
    const set = await loadTermSet({ run: runFor(DIR, ["no-term.tbx"]) });
    expect(set.notices).toEqual(["no-term.tbx:18: skipped a TBX entry with no term."]);
  });
});
