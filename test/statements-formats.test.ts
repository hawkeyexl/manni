/**
 * Inline `meta` statements in every format (proposal 0099): the same cases in
 * Markdown, MDX, HTML, AsciiDoc and reStructuredText, read by cite's anchor
 * rule, and in XML and DITA, anchored to elements.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { runValidate } from "../src/meta/commands/validate.js";
import { pinOf, readStatements, type PageStatement } from "../src/meta/core/statements.js";
import { anchoredLines, parseStatements } from "../src/shared/statements.js";
import { hashRange, spellLines, splitLines } from "../src/shared/pin.js";
import type { FieldError } from "../src/meta/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const fixture = (name: string): string => `test/fixtures/statements/${name}`;
const read = (name: string): string => readFileSync(resolve(root, fixture(name)), "utf8");

/** The 1-based line of the first line holding `needle`. */
function lineOf(text: string, needle: string): number {
  const at = splitLines(text).findIndex((l) => l.includes(needle));
  if (at === -1) throw new Error(`no "${needle}"`);
  return at + 1;
}

async function errorsOf(name: string): Promise<FieldError[]> {
  const { results } = await runValidate({ inputs: [fixture(name)], cwd: root, noConfig: true });
  return results[0]?.errors ?? [];
}

const LINE_RULE = [
  { name: "markdown.md", format: "markdown", lineForm: true, heading: "## Install on Windows" },
  { name: "mdx.mdx", format: "mdx", lineForm: true, heading: "## Install on Windows" },
  { name: "html.html", format: "html", lineForm: false, heading: undefined },
  { name: "asciidoc.adoc", format: "asciidoc", lineForm: true, heading: "== Install on Windows" },
  { name: "rst.rst", format: "rst", lineForm: true, heading: "Install on Windows" },
] as const;

describe.each(LINE_RULE)("statements in $format", ({ name, format, lineForm, heading }) => {
  const content = read(name);
  const statements = readStatements(content, format).statements;
  /** The statement whose anchor starts on the line holding `needle`. */
  const over = (needle: string): PageStatement | undefined =>
    statements.find((s) => s.anchor?.start === lineOf(content, needle));
  const rulesOver = async (needle: string): Promise<string[]> => {
    const line = String(lineOf(content, needle));
    return (await errorsOf(name))
      .filter((e) => e.statement?.anchor?.split("-")[0] === line)
      .map((e) => `${e.keyword} ${e.severity ?? "error"}`);
  };

  it("reads a current pin and reports nothing about it", async () => {
    expect(over("whose pin is current")?.status).toBe("current");
    expect(await rulesOver("whose pin is current")).toEqual([]);
  });

  it("files an unpinned statement as a notice", async () => {
    expect(await rulesOver("An unpinned")).toContain("statement-unpinned notice");
  });

  it("files a changed block as a warning that names last-verified", async () => {
    const errors = await errorsOf(name);
    const changed = errors.find((e) => e.keyword === "statement-changed");
    expect(changed?.severity).toBe("warning");
    expect(changed?.message).toContain("so its last-verified may no longer hold");
    expect(changed?.statement?.anchor).toBe(String(lineOf(content, "edited after it was pinned")));
  });

  it("files a statement inside a paragraph as misplaced", async () => {
    expect(await rulesOver("inside it.")).toContain("statement-misplaced warning");
  });

  it("anchors a stacked cite marker and meta statement to the same paragraph, with the same pin", () => {
    const marker = parseStatements(content, format).find((m) => m.payload.kind === "ref");
    const cite = anchoredLines(content, marker?.end ?? 0, format);
    const s = over("stacked cite marker");
    expect(s?.anchor).toEqual(cite);
    const lines = splitLines(content);
    expect(pinOf(lines.slice((cite?.start ?? 1) - 1, cite?.end))).toBe(hashRange(content, cite));
  });

  it("skips a statement in code", () => {
    expect(statements.some((s) => s.data !== undefined && "not" in s.data)).toBe(false);
  });

  it("refuses a payload that is not one JSON object, and an unknown field", async () => {
    expect(await rulesOver("payload that is not JSON")).toContain("statement-invalid error");
    expect(await rulesOver("under an unknown field")).toContain("statement-unknown-field error");
  });

  it.runIf(lineForm)("refuses a ) in a line form's payload", async () => {
    expect(await rulesOver("holding a parenthesis")).toContain("statement-line-form-paren error");
  });

  it("files a statement with nothing after it as an orphan", async () => {
    const orphan = (await errorsOf(name)).find((e) => e.keyword === "statement-orphan");
    expect(orphan?.message).toMatch(/anchors nothing: no paragraph or block follows it\.$/);
    expect(orphan?.statement?.anchor).toBeNull();
  });

  it.runIf(heading !== undefined)("scopes a heading statement to its section and pins the heading line only", () => {
    const title = lineOf(content, heading ?? "");
    const s = statements.find((x) => x.scope === "section");
    expect(s?.anchor).toEqual({ start: title, end: title });
    expect(s?.section).toBe("install-on-windows");
    expect(s?.status).toBe("current");
    // A body edit leaves it current; a title edit changes it.
    const body = content.replace("Body text that a section statement", "Body text, edited, that a section statement");
    expect(readStatements(body, format).statements.find((x) => x.scope === "section")?.status).toBe("current");
    const retitled = content.replace("Install on Windows", "Install on Windows 11");
    expect(readStatements(retitled, format).statements.find((x) => x.scope === "section")?.status).toBe("changed");
  });

  it.runIf(heading !== undefined)("validates graph in a heading statement against sectionMetadata", async () => {
    const bad = content.replace(`"type":"task"`, `"type":"recipe"`);
    const { results } = await runValidate({
      inputs: ["-"],
      as: format,
      stdinContent: bad,
      cwd: root,
      noConfig: true,
    });
    const finding = results[0]?.errors.find((e) => e.instancePath === "/graph/type");
    expect(finding?.message).toMatch(/^must be one of: "task"/);
    expect(finding?.statement?.line).toBe(lineOf(content, '"type":"task"'));
  });
});

describe("statements in XML and DITA", () => {
  const task = read("dita/task.dita");
  const statements = readStatements(task, "xml").statements;
  const at = (needle: string): PageStatement | undefined =>
    statements.find((s) => s.line === lineOf(task, needle));

  it("anchors a first-child instruction to its whole element, start tag to end tag", () => {
    const s = at('"check":"install-the-tool"');
    expect(s?.anchor).toEqual({ start: lineOf(task, "<step><?manni"), end: lineOf(task, "<step><?manni") + 3 });
    expect(s?.status).toBe("current");
  });

  it("anchors a comment-form statement to the next element", () => {
    const s = at("<!-- meta");
    expect(s?.anchor).toEqual({ start: lineOf(task, "<!-- meta") + 1, end: lineOf(task, "<!-- meta") + 3 });
  });

  it("reads the <data> carrier and anchors its element", () => {
    const s = at('name="manni-meta"');
    expect(s?.token.form).toBe("data");
    expect(s?.anchor).toEqual({ start: lineOf(task, 'name="manni-meta"'), end: lineOf(task, 'name="manni-meta"') });
    expect(s?.data).toEqual({ concepts: ["install"] });
    expect(s?.status).toBe("current");
  });

  it("leaves the statement's own text out of a pin that covers it", () => {
    const s = at('"check":"install-the-tool"');
    const lines = splitLines(task).slice((s?.anchor?.start ?? 1) - 1, s?.anchor?.end);
    lines[0] = "      <step>";
    expect(s?.pin).toBe(pinOf(lines));
  });

  it("scopes a statement on a topic or a section, and pins the title", () => {
    const concept = read("dita/concept.dita");
    const found = readStatements(concept, "xml").statements;
    expect(found.map((s) => [s.scope, s.anchor && spellLines(s.anchor), s.section, s.status])).toEqual([
      ["section", String(lineOf(concept, "<title>How statements anchor")), "how-statements-anchor", "current"],
      ["section", String(lineOf(concept, "<title>Sections")), "sections", "current"],
    ]);
  });

  it("validates the DTD-valid fixtures with no statement finding", async () => {
    for (const name of ["dita/task.dita", "dita/concept.dita"]) {
      expect((await errorsOf(name)).filter((e) => e.statement !== undefined)).toEqual([]);
    }
  });

  it("files a <cmd> edit inside an anchored step as changed", async () => {
    const changed = (await errorsOf("dita/changed.dita")).find((e) => e.keyword === "statement-changed");
    expect(changed?.message).toBe(
      "the block under the meta statement at line 7 changed since it was pinned, so its last-verified may no longer hold. Run its checks again, or remove the pin and run manni meta derive.",
    );
  });

  it("files -- in a comment-form payload beside the parse error it causes", async () => {
    const errors = await errorsOf("dita/dashes.dita");
    expect(errors.map((e) => e.keyword)).toEqual(["parse", "statement-xml-comment-dashes"]);
    expect(errors[1]?.message).toBe(
      'the meta statement at line 7 is an XML comment, and its payload contains "--", which XML forbids in a comment; use <?manni meta …?>.',
    );
  });

  it("files a statement with no element after it as an orphan", async () => {
    const orphan = (await errorsOf("dita/orphan.dita")).find((e) => e.keyword === "statement-orphan");
    expect(orphan?.message).toBe(
      "the meta statement at line 10 anchors nothing: no element follows it, and it is not an element's first child.",
    );
  });
});
