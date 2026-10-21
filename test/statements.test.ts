/**
 * Inline `meta` statements (proposal 0099): read, anchored, pinned, and
 * validated against the page's own schemas, field by field.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { runValidate } from "../src/meta/commands/validate.js";
import { pinOf, pinStatements, readStatements } from "../src/meta/core/statements.js";
import { anchoredLines, parseStatements } from "../src/shared/statements.js";
import { hashRange } from "../src/shared/pin.js";
import type { FieldError } from "../src/meta/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const fixture = (name: string): string => `test/fixtures/statements/${name}`;
const read = (name: string): string => readFileSync(resolve(root, fixture(name)), "utf8");

/** The statement findings of one page, as `rule severity line: message`. */
async function findingsOf(name: string, cwd = root): Promise<string[]> {
  const { results } = await runValidate({ inputs: [fixture(name)], cwd, noConfig: true });
  return (results[0]?.errors ?? [])
    .filter((e: FieldError) => e.statement !== undefined || e.keyword.startsWith("statement-"))
    .map((e) => `${e.keyword} ${e.severity ?? "error"} ${String(e.line)}: ${e.message}`);
}

describe("reading statements in Markdown", () => {
  const statements = readStatements(read("markdown.md"), "markdown").statements;
  const at = (line: number) => statements.find((s) => s.line === line);

  it("anchors the next paragraph, and skips one in a code fence", () => {
    expect(statements.map((s) => s.line)).not.toContain(27);
    expect(at(11)?.anchor).toEqual({ start: 12, end: 13 });
    expect(at(11)?.scope).toBe("block");
  });

  it("reads a current pin, a changed pin and a missing one", () => {
    expect(at(8)?.status).toBe("current");
    expect(at(15)?.status).toBe("changed");
    expect(at(11)?.status).toBe("unpinned");
  });

  it("anchors a stacked cite marker and meta statement to the same paragraph", () => {
    const content = read("markdown.md");
    const marker = parseStatements(content, "markdown").find((m) => m.line === 22);
    expect(marker).toBeDefined();
    const cite = anchoredLines(content, marker?.end ?? 0, "markdown");
    expect(at(23)?.anchor).toEqual(cite);
  });

  it("scopes a heading statement to its section and pins the heading line only", () => {
    const s = at(45);
    expect(s?.scope).toBe("section");
    expect(s?.anchor).toEqual({ start: 46, end: 46 });
    expect(s?.section).toBe("install-on-windows");
    expect(s?.heading).toBe("Install on Windows");
  });

  it("names the section a block statement sits in", () => {
    expect(at(50)?.section).toBe("install-on-windows");
    expect(at(8)?.section).toBe("statements-in-markdown");
  });

  it("pins with the citations hashing rule, equal to cite's for the same paragraph", () => {
    const content = read("markdown.md");
    expect(at(8)?.pin).toBe(hashRange(content, { start: 9, end: 9 }));
    expect(pinOf(["A paragraph whose pin is current."])).toBe(at(8)?.pin);
    expect(pinOf(["a\r", "b"])).toBe(pinOf(["a", "b"]));
  });
});

describe("meta validate reads statements", () => {
  it("reports every rule with its severity, line and message", async () => {
    expect(await findingsOf("markdown.md")).toEqual([
      "statement-unpinned notice 11: the meta statement at line 11 has no pin; run manni meta derive to pin it to the block below.",
      "statement-changed warning 15: the block under the meta statement at line 15 changed since it was pinned, so its last-verified may no longer hold. Run its checks again, or remove the pin and run manni meta derive.",
      "statement-unpinned notice 19: the meta statement at line 19 has no pin; run manni meta derive to pin it to the block below.",
      "statement-misplaced warning 19: the meta statement at line 19 sits inside a paragraph; move it above the paragraph's first line.",
      "statement-unpinned notice 23: the meta statement at line 23 has no pin; run manni meta derive to pin it to the block below.",
      expect.stringMatching(
        /^statement-invalid error 30: the meta statement at line 30 is not one JSON object: .+\.$/,
      ) as unknown as string,
      "statement-unpinned notice 30: the meta statement at line 30 has no pin; run manni meta derive to pin it to the block below.",
      "statement-unpinned notice 33: the meta statement at line 33 has no pin; run manni meta derive to pin it to the block below.",
      "statement-unpinned notice 36: the meta statement at line 36 has no pin; run manni meta derive to pin it to the block below.",
      'statement-line-form-paren error 39: the meta statement at line 39 uses a line comment form, and its payload contains ")"; use <!-- --> or {/* */}.',
      "statement-unpinned notice 39: the meta statement at line 39 has no pin; run manni meta derive to pin it to the block below.",
      "statement-unpinned notice 42: the meta statement at line 42 has no pin; run manni meta derive to pin it to the block below.",
      "statement-unpinned notice 50: the meta statement at line 50 has no pin; run manni meta derive to pin it to the block below.",
      "statement-orphan error 53: the meta statement at line 53 anchors nothing: no paragraph or block follows it.",
      'statement-unknown-field error 33: the meta statement at line 33 sets "verifed-by", which none of this page\'s schemas define.',
      'statement-external-field error 36: the meta statement at line 36 sets "personas", which lives in the manifest (x-manni-location: external); set it there.',
      expect.stringMatching(/^pattern error 42: /) as unknown as string,
      'statement-graph-not-section error 50: the meta statement at line 50 sets "graph", which only a statement on a heading may set; move it above the section\'s heading.',
    ]);
  });

  it("checks a value against its own definition, at the statement's line", async () => {
    const { results } = await runValidate({ inputs: [fixture("markdown.md")], cwd: root, noConfig: true });
    const bad = results[0]?.errors.find((e) => e.instancePath === "/verified-by/0/passed");
    expect(bad?.schema).toBe("manni:stewardship:1.2.0");
    expect(bad?.statement).toEqual({ line: 42, anchor: "43" });
    expect(bad?.guidance?.rule).toBe("verified-by/passed");
  });

  it("never merges a statement's fields into the page's metadata", async () => {
    const { results } = await runValidate({ inputs: [fixture("markdown.md")], cwd: root, noConfig: true });
    // `required` never applies: no statement finding asks for a title.
    expect(results[0]?.errors.some((e) => e.statement !== undefined && e.keyword === "required")).toBe(false);
  });

  it("refuses a section field set both inline and in graph.sections", async () => {
    expect(await findingsOf("conflicts.md")).toContain(
      'statement-conflicts-sections error 10: the statement on heading "Install on Windows" (line 11) and graph.sections.install-on-windows (line 6) both set graph.type; keep one.',
    );
  });
});

describe("pinning", () => {
  it("pins every unpinned statement, never a changed one, and is idempotent", () => {
    const content = read("markdown.md");
    const once = pinStatements(content, "markdown");
    const after = readStatements(once.content, "markdown").statements;
    expect(after.find((s) => s.line === 15)?.status).toBe("changed");
    expect(after.filter((s) => s.anchor !== undefined && s.status === "unpinned")).toEqual([]);
    expect(once.pinned).toBe(
      readStatements(content, "markdown").statements.filter((s) => s.anchor !== undefined && s.pin === undefined).length,
    );
    expect(pinStatements(once.content, "markdown")).toEqual({ content: once.content, pinned: 0 });
  });
});
