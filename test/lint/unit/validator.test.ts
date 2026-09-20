/**
 * The validator: the page itself as the template's subject, the rules a
 * parser's format cannot answer, and the order findings come back in.
 *
 * Trees are built by hand rather than parsed. Every test here is about what
 * the validator does with a tree, and a parsed one would tie the assertion to
 * whichever format happened to produce it - which is what the cross-format
 * integration suite is for. The one exception is the exit-code test, which
 * has to go through `runLint` because the exit code is `summary.failed`.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runLint } from "../../../src/lint/commands/lint.js";
import { occurrenceRange } from "../../../src/lint/core/template.js";
import type { Template } from "../../../src/lint/core/template.js";
import { validateDocument } from "../../../src/lint/core/validator.js";
import type {
  CodeNode,
  ContentKind,
  ContentNode,
  DocumentTree,
  Finding,
  ListItemNode,
  ListNode,
  ParagraphNode,
  Position,
  SectionNode,
} from "../../../src/lint/types.js";
import { at } from "../helpers.js";

/* -------------------------------------------------------------------------- *
 * Fixtures
 * -------------------------------------------------------------------------- */

function pos(line: number): Position {
  return {
    start: { line, column: 1, offset: line * 100 },
    end: { line, column: 20, offset: line * 100 + 19 },
  };
}

function paragraph(text: string, line = 10): ParagraphNode {
  return { kind: "paragraph", text, position: pos(line) };
}

function code(text = "npm install", line = 20): CodeNode {
  return { kind: "codeBlock", text, language: "bash", position: pos(line) };
}

function list(line = 30): ListNode {
  const item: ListItemNode = {
    kind: "listItem",
    text: "one",
    position: pos(line),
    children: [],
  };
  return {
    kind: "list",
    ordered: true,
    items: [item],
    text: "one",
    position: pos(line),
  };
}

interface SectionInput {
  title?: string;
  level?: number;
  line?: number;
  children?: ContentNode[];
  sections?: SectionNode[];
}

/** A section with a heading of its own. */
function section(input: SectionInput = {}): SectionNode {
  const line = input.line ?? 1;
  const title = input.title ?? "Section";
  return {
    slug: title.toLowerCase().replace(/\s+/g, "-"),
    title,
    level: input.level ?? 2,
    order: 1,
    parentSlug: null,
    titlePosition: pos(line),
    position: pos(line),
    children: input.children ?? [],
    sections: input.sections ?? [],
  };
}

/** The implicit lead section `sectionize` opens for a page with no heading. */
function lead(input: Omit<SectionInput, "title" | "level"> = {}): SectionNode {
  const line = input.line ?? 1;
  return {
    slug: "lead",
    title: "",
    level: 0,
    order: 0,
    parentSlug: null,
    titlePosition: null,
    position: pos(line),
    children: input.children ?? [],
    sections: input.sections ?? [],
  };
}

function tree(sections: SectionNode[], format = "markdown"): DocumentTree {
  return {
    format,
    filePath: `page.${format}`,
    frontmatter: null,
    frontmatterPosition: null,
    sections,
  };
}

const messages = (findings: Finding[]): string[] => findings.map((f) => f.message);
const types = (findings: Finding[]): string[] => findings.map((f) => f.type);

/** Kinds every parser emits today. */
const BASIC: ContentKind[] = ["paragraph", "codeBlock", "list"];

/* -------------------------------------------------------------------------- *
 * The page itself
 * -------------------------------------------------------------------------- */

describe("the template describes the page", () => {
  it("checks its heading against the page's own title", () => {
    const doc = tree([section({ title: "Do the thing", level: 1 })]);
    expect(validateDocument(doc, { heading: "Do the thing" })).toEqual([]);
  });

  it("reports the page title that does not match", () => {
    const doc = tree([section({ title: "Do the thing", level: 1 })]);
    const findings = validateDocument(doc, { heading: "Install it" });
    expect(types(findings)).toEqual(["heading_error"]);
    expect(messages(findings)).toEqual([
      'Expected title "Install it", but found "Do the thing"',
    ]);
  });

  it('matches "heading: false" against the implicit lead section', () => {
    const doc = tree([lead({ children: [paragraph("Why you would.")] })]);
    expect(validateDocument(doc, { heading: false })).toEqual([]);
  });

  it("refuses a named heading on a page that has none of its own", () => {
    const doc = tree([lead({ children: [paragraph("Why you would.")] })]);
    expect(messages(validateDocument(doc, { heading: "Overview" }))).toEqual([
      'Expected title "Overview", but found no heading',
    ]);
  });

  it("checks `contains` against what sits before the first heading", () => {
    const doc = tree([
      lead({
        children: [paragraph("Why you would.")],
        sections: [section({ title: "Install it", line: 5 })],
      }),
    ]);
    const template: Template = { contains: { paragraphs: { min: 2 } } };
    expect(messages(validateDocument(doc, template))).toEqual([
      "Expected at least 2 paragraphs, but found 1",
    ]);
  });

  it("checks `sequence` against what sits before the first heading", () => {
    const doc = tree([lead({ children: [paragraph("Why you would.")] })]);
    const template: Template = {
      sequence: [{ paragraphs: {} }, { codeBlocks: {} }],
    };
    expect(messages(validateDocument(doc, template))).toEqual([
      "Expected paragraph then code, but found paragraph",
    ]);
  });

  it("takes the page's sections from the root section's children", () => {
    const doc = tree([
      section({
        title: "Do the thing",
        level: 1,
        sections: [
          section({ title: "Overview", line: 3 }),
          section({ title: "See also", line: 5 }),
        ],
      }),
    ]);
    const template: Template = {
      heading: "Do the thing",
      sections: [{ heading: "Overview" }, { heading: "See also" }],
    };
    expect(validateDocument(doc, template)).toEqual([]);
  });

  it("reports a section the page is missing", () => {
    const doc = tree([
      section({
        title: "Do the thing",
        level: 1,
        sections: [section({ title: "Overview", line: 3 })],
      }),
    ]);
    const template: Template = {
      sections: [{ heading: "Overview" }, { heading: "See also" }],
    };
    expect(messages(validateDocument(doc, template))).toEqual([
      'Missing section "See also"',
    ]);
  });

  it("wraps several top-level sections in a page with no heading of its own", () => {
    const doc = tree([
      section({ title: "Overview", line: 1 }),
      section({ title: "See also", line: 5 }),
    ]);
    const template: Template = {
      heading: false,
      sections: [{ heading: "Overview" }, { heading: "See also" }],
    };
    expect(validateDocument(doc, template)).toEqual([]);
  });

  it("gives a page of several top-level sections no content of its own", () => {
    const doc = tree([
      section({ title: "Overview", line: 1, children: [paragraph("Why.")] }),
      section({ title: "See also", line: 5 }),
    ]);
    const template: Template = { contains: { paragraphs: { min: 1 } } };
    expect(messages(validateDocument(doc, template))).toEqual([
      "Expected at least 1 paragraph, but found 0",
    ]);
  });

  it("recurses into the subsections of a matched section", () => {
    const doc = tree([
      section({
        title: "Do the thing",
        level: 1,
        sections: [
          section({
            title: "Overview",
            line: 3,
            sections: [section({ title: "Details", level: 3, line: 4 })],
          }),
        ],
      }),
    ]);
    const template: Template = {
      sections: [
        {
          heading: "Overview",
          sections: [
            { heading: "Details", contains: { paragraphs: { min: 1 } } },
          ],
        },
      ],
    };
    const findings = validateDocument(doc, template);
    expect(types(findings)).toEqual(["paragraphs_count_error"]);
    expect(at(findings, 0, "finding").heading).toBe("Details");
  });

  it("returns findings in document order, not rule order", () => {
    const doc = tree([
      section({
        title: "Do the thing",
        level: 1,
        sections: [
          section({ title: "Overview", line: 3, children: [] }),
          section({ title: "Steps", line: 7, sections: [] }),
          section({ title: "See also", line: 9 }),
        ],
      }),
    ]);
    const template: Template = {
      sections: [
        { heading: "Overview", contains: { paragraphs: { min: 1 } } },
        { heading: "Steps", sections: [{ heading: "First" }] },
        { heading: "See also", contains: { lists: { min: 1 } } },
      ],
    };
    const findings = validateDocument(doc, template);
    const lines = findings.map((f) => f.position.start.line);
    expect(lines).toEqual([...lines].sort((a, b) => a - b));
    expect(messages(findings)).toEqual([
      "Expected at least 1 paragraph, but found 0",
      'Missing section "First"',
      "Expected at least 1 list, but found 0",
    ]);
  });
});

/* -------------------------------------------------------------------------- *
 * Rules the format cannot answer
 * -------------------------------------------------------------------------- */

describe("a rule about a kind the parser does not report", () => {
  const page = (children: ContentNode[] = []): DocumentTree =>
    tree([section({ title: "Overview", children })], "rst");

  it("is reported once, as a warning, naming the rule and the template", () => {
    const template: Template = {
      sections: [{ heading: "Overview", contains: { tables: { min: 1 } } }],
    };
    const findings = validateDocument(page(), template, {
      kinds: BASIC,
      template: "reference",
    });
    expect(findings).toHaveLength(1);
    const finding = at(findings, 0, "finding");
    expect(finding.type).toBe("unsupported_content_kind");
    expect(finding.severity).toBe("warning");
    expect(finding.message).toBe(
      'The rst parser does not report tables, so the "tables" rule in ' +
        'template "reference" is not checked for this file.',
    );
  });

  it("is not also reported as a count the document failed", () => {
    const template: Template = {
      sections: [{ heading: "Overview", contains: { tables: { min: 2 } } }],
    };
    const findings = validateDocument(page(), template, {
      kinds: BASIC,
      template: "reference",
    });
    expect(types(findings)).toEqual(["unsupported_content_kind"]);
  });

  it("names the sub-rule when the kind itself is reported but its parts are not", () => {
    const template: Template = {
      sections: [
        {
          heading: "Overview",
          contains: { tables: { min: 0, columns: ["Field"] } },
        },
      ],
    };
    const findings = validateDocument(page(), template, {
      kinds: [...BASIC, "table"],
      template: "reference",
    });
    expect(messages(findings)).toEqual([
      'The rst parser does not report table columns, so the "columns" rule ' +
        'in template "reference" is not checked for this file.',
    ]);
  });

  it("still checks `lists.items`, which rides on the list a parser reports", () => {
    const template: Template = {
      sections: [
        { heading: "Overview", contains: { lists: { items: { min: 2 } } } },
      ],
    };
    const findings = validateDocument(page([list()]), template, {
      kinds: BASIC,
      template: "reference",
    });
    expect(messages(findings)).toEqual([
      "Expected at least 2 items in a list, but found 1",
    ]);
  });

  it("reaches the kinds a list item holds", () => {
    const template: Template = {
      sections: [
        {
          heading: "Overview",
          contains: { lists: { items: { contains: { tables: { min: 1 } } } } },
        },
      ],
    };
    const findings = validateDocument(page([list()]), template, {
      kinds: BASIC,
      template: "reference",
    });
    expect(messages(findings)).toEqual([
      'The rst parser does not report tables, so the "tables" rule in ' +
        'template "reference" is not checked for this file.',
    ]);
  });

  it("is one finding per rule, however many sections ask about it", () => {
    const doc = tree(
      [
        section({ title: "Overview", line: 1 }),
        section({ title: "See also", line: 5 }),
      ],
      "rst",
    );
    const template: Template = {
      heading: false,
      sections: [
        { heading: "Overview", contains: { tables: { min: 1 } } },
        { heading: "See also", contains: { tables: { min: 1 } } },
      ],
    };
    const findings = validateDocument(doc, template, {
      kinds: BASIC,
      template: "reference",
    });
    expect(findings).toHaveLength(1);
  });

  it("drops the run from a `sequence` rather than failing its order", () => {
    const template: Template = {
      sections: [
        {
          heading: "Overview",
          sequence: [{ paragraphs: {} }, { tables: {} }],
        },
      ],
    };
    const findings = validateDocument(page([paragraph("Why.")]), template, {
      kinds: BASIC,
      template: "reference",
    });
    expect(types(findings)).toEqual(["unsupported_content_kind"]);
  });

  it("says nothing about a kind the parser does report", () => {
    const template: Template = {
      sections: [{ heading: "Overview", contains: { paragraphs: { min: 1 } } }],
    };
    expect(
      validateDocument(page([paragraph("Why.")]), template, {
        kinds: BASIC,
        template: "reference",
      }),
    ).toEqual([]);
  });

  it("leaves the rules alone when the format reports everything they ask", () => {
    const template: Template = {
      sections: [{ heading: "Overview", contains: { tables: { min: 1 } } }],
    };
    const findings = validateDocument(page(), template, {
      kinds: [...BASIC, "table", "tableRow", "tableCell"],
      template: "reference",
    });
    expect(messages(findings)).toEqual([
      "Expected at least 1 table, but found 0",
    ]);
  });

  // `definitionLists` rather than `tables`: the markdown parser reports GFM
  // tables, so a table rule against it now runs and finds nothing, which is a
  // real finding rather than an unanswered one. Markdown has no definition-list
  // syntax and declares none, so that is the rule this parser genuinely cannot
  // answer.
  it("takes the parser's kinds from the registry when none are passed", () => {
    const doc = tree([section({ title: "Overview" })], "markdown");
    const template: Template = {
      sections: [{ heading: "Overview", contains: { definitionLists: { min: 1 } } }],
    };
    const findings = validateDocument(doc, template, { template: "reference" });
    expect(messages(findings)).toEqual([
      'The markdown parser does not report definition lists, so the ' +
        '"definitionLists" rule in template "reference" is not checked for this file.',
    ]);
  });
});

/* -------------------------------------------------------------------------- *
 * `max: 0`
 * -------------------------------------------------------------------------- */

describe("max: 0 forbids, and is satisfiable", () => {
  it("defaults min to 0 when max is 0 and min is unstated", () => {
    expect(occurrenceRange({ max: 0 })).toEqual({ min: 0, max: 0 });
  });

  it("still defaults min to 1 everywhere else", () => {
    expect(occurrenceRange({})).toEqual({ min: 1, max: null });
    expect(occurrenceRange({ max: 2 })).toEqual({ min: 1, max: 2 });
    expect(occurrenceRange({ min: 0 })).toEqual({ min: 0, max: null });
  });

  it("says nothing about a page that has none of the forbidden section", () => {
    const doc = tree([section({ title: "Overview" })]);
    const template: Template = {
      heading: false,
      sections: [{ heading: "Overview" }, { heading: "Draft", max: 0 }],
    };
    expect(validateDocument(doc, template)).toEqual([]);
  });

  it("reports the forbidden section when the page carries one", () => {
    const doc = tree([
      section({ title: "Overview", line: 1 }),
      section({ title: "Draft", line: 5 }),
    ]);
    const template: Template = {
      heading: false,
      sections: [{ heading: "Overview" }, { heading: "Draft", max: 0 }],
    };
    expect(types(validateDocument(doc, template))).toEqual([
      "unexpected_section",
    ]);
  });

  it("forbids a content kind without demanding one of it", () => {
    const doc = tree([section({ title: "Overview", children: [paragraph("Why.")] })]);
    const template: Template = {
      heading: false,
      sections: [
        { heading: "Overview", contains: { codeBlocks: { max: 0 } } },
      ],
    };
    expect(validateDocument(doc, template)).toEqual([]);
  });

  it("reports the kind it forbids when the section holds one", () => {
    const doc = tree([
      section({ title: "Overview", children: [paragraph("Why."), code()] }),
    ]);
    const template: Template = {
      heading: false,
      sections: [
        { heading: "Overview", contains: { codeBlocks: { max: 0 } } },
      ],
    };
    expect(messages(validateDocument(doc, template))).toEqual([
      "Expected at most 0 code blocks, but found 1",
    ]);
  });
});

/* -------------------------------------------------------------------------- *
 * The exit code
 * -------------------------------------------------------------------------- */

describe("a warning never changes the exit code", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "manni-lint-validator-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // A definition list, not a table: markdown reports GFM tables now, so only a
  // kind it genuinely cannot see still produces the warning this test is about.
  const TEMPLATE = [
    "templates:",
    "  page:",
    "    heading: false",
    "    sections:",
    "      - heading: Overview",
    "        contains:",
    "          definitionLists:",
    "            min: 1",
    "",
  ].join("\n");

  it("counts a file whose only finding is a warning as passed", async () => {
    await writeFile(join(dir, "templates.yaml"), TEMPLATE);
    await writeFile(join(dir, "page.md"), "## Overview\n\nWhy you would.\n");

    const run = await runLint({
      inputs: [join(dir, "page.md")],
      cwd: dir,
      template: join(dir, "templates.yaml"),
      noConfig: true,
    });

    const result = at(run.results, 0, "result");
    expect(types(result.findings)).toEqual(["unsupported_content_kind"]);
    expect(result.success).toBe(true);
    expect(run.summary.failed).toBe(0);
  });
});
