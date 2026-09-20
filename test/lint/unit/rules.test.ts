import { describe, expect, it } from "vitest";

import { LintError } from "../../../src/lint/types.js";
import type {
  AdmonitionNode,
  BlockquoteNode,
  CodeNode,
  ContentNode,
  DefinitionItemNode,
  DefinitionListNode,
  ElementNode,
  ImageNode,
  ListItemNode,
  ListNode,
  ParagraphNode,
  Position,
  SectionNode,
  TableCellNode,
  TableNode,
  TableRowNode,
} from "../../../src/lint/types.js";
import {
  checkAdmonitions,
  checkBlockquotes,
  checkCodeBlocks,
  checkContains,
  checkContainsIn,
  checkDefinitionLists,
  checkElements,
  checkHeading,
  checkImages,
  checkLists,
  checkParagraphs,
  checkSequence,
  checkTables,
  clearPatternCache,
  codeBlocksOf,
  compilePattern,
  groupRuns,
  listsOf,
  paragraphsOf,
} from "../../../src/lint/rules/index.js";
import type { BlockRule } from "../../../src/lint/rules/index.js";

/* -------------------------------------------------------------------------- *
 * Fixtures
 *
 * No parser exists yet, so trees are built by hand. Every node gets a distinct
 * line so findings can be traced back to the node that produced them.
 * -------------------------------------------------------------------------- */

const SECTION_LINE = 1;
const HEADING_LINE = 2;

function pos(line: number): Position {
  return {
    start: { line, column: 1, offset: line * 100 },
    end: { line, column: 20, offset: line * 100 + 19 },
  };
}

function paragraph(text: string, line = 10): ParagraphNode {
  return { kind: "paragraph", text, position: pos(line) };
}

function code(
  text = "npm install",
  line = 20,
  language: string | undefined = "bash",
  fenceInfo?: string,
): CodeNode {
  return { kind: "codeBlock", text, language, fenceInfo, position: pos(line) };
}

function listItem(
  text: string,
  line = 30,
  children: ContentNode[] = [],
): ListItemNode {
  return { kind: "listItem", text, position: pos(line), children };
}

function list(items: ListItemNode[], line = 30, ordered = false): ListNode {
  return {
    kind: "list",
    ordered,
    items,
    text: items.map((item) => item.text).join("\n"),
    position: pos(line),
  };
}

function tableCell(text: string, line = 40): TableCellNode {
  return { kind: "tableCell", text, children: [], position: pos(line) };
}

function tableRow(cells: string[], header: boolean, line = 40): TableRowNode {
  return {
    kind: "tableRow",
    header,
    children: cells.map((cell) => tableCell(cell, line)),
    text: cells.join(" | "),
    position: pos(line),
  };
}

function table(rows: TableRowNode[], line = 40): TableNode {
  return {
    kind: "table",
    children: rows,
    text: rows.map((row) => row.text).join("\n"),
    position: pos(line),
  };
}

function admonition(
  variant: AdmonitionNode["variant"],
  line = 50,
  children: ContentNode[] = [],
): AdmonitionNode {
  return { kind: "admonition", variant, children, text: "", position: pos(line) };
}

function image(
  url: string,
  alt = "",
  line = 60,
): ImageNode {
  return { kind: "image", url, alt, text: alt, position: pos(line) };
}

function blockquote(line = 70, children: ContentNode[] = []): BlockquoteNode {
  return { kind: "blockquote", children, text: "", position: pos(line) };
}

function definitionItem(term: string, line = 80): DefinitionItemNode {
  return { kind: "definitionItem", term, definition: [], text: term, position: pos(line) };
}

function definitionList(items: DefinitionItemNode[], line = 80): DefinitionListNode {
  return { kind: "definitionList", children: items, text: "", position: pos(line) };
}

function element(
  name: string,
  line = 90,
  attributes?: Record<string, string | true>,
  children: ContentNode[] = [],
): ElementNode {
  return { kind: "element", name, attributes, children, text: "", position: pos(line) };
}

function section(
  children: ContentNode[],
  overrides: Partial<SectionNode> = {},
): SectionNode {
  return {
    slug: "install",
    title: "Install",
    level: 2,
    order: 1,
    parentSlug: null,
    titlePosition: pos(HEADING_LINE),
    position: pos(SECTION_LINE),
    children,
    sections: [],
    ...overrides,
  };
}

/** Messages only, for assertions that care about which rules fired. */
function messages(findings: { message: string }[]): string[] {
  return findings.map((finding) => finding.message);
}

function types(findings: { type: string }[]): string[] {
  return findings.map((finding) => finding.type);
}

/* -------------------------------------------------------------------------- *
 * Content queries
 * -------------------------------------------------------------------------- */

describe("content queries", () => {
  const mixed: ContentNode[] = [
    paragraph("first", 10),
    code("code", 11),
    list([listItem("item", 12)], 12),
    paragraph("second", 13),
  ];

  it("buckets a flat content array by kind, in document order", () => {
    expect(paragraphsOf(mixed).map((node) => node.text)).toEqual(["first", "second"]);
    expect(codeBlocksOf(mixed)).toHaveLength(1);
    expect(listsOf(mixed)).toHaveLength(1);
  });

  it("returns empty buckets for empty content", () => {
    expect(paragraphsOf([])).toEqual([]);
    expect(codeBlocksOf([])).toEqual([]);
    expect(listsOf([])).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- *
 * heading
 * -------------------------------------------------------------------------- */

describe("checkHeading", () => {
  it("returns nothing when the template has no heading rule", () => {
    expect(checkHeading(section([]), undefined)).toEqual([]);
  });

  it("accepts a title equal to a string rule", () => {
    expect(checkHeading(section([]), "Install")).toEqual([]);
  });

  it("reports a title that does not equal a string rule", () => {
    const findings = checkHeading(section([]), "Overview");

    expect(findings).toEqual([
      {
        type: "heading_error",
        heading: "Install",
        message: `Expected title "Overview", but found "Install"`,
        position: pos(HEADING_LINE),
        severity: "error",
      },
    ]);
  });

  it("accepts a title that is one of a list", () => {
    expect(checkHeading(section([]), ["Overview", "Install"])).toEqual([]);
  });

  it("reports a title that matches none of a list", () => {
    const findings = checkHeading(section([], { title: "Where to go" }), [
      "Next steps",
      "What's next",
    ]);

    expect(messages(findings)).toEqual([
      `Expected one of "Next steps", "What's next", but found "Where to go"`,
    ]);
    expect(types(findings)).toEqual(["heading_error"]);
  });

  it("accepts a title matching a pattern rule", () => {
    expect(checkHeading(section([]), { pattern: "^Inst" })).toEqual([]);
  });

  it("reports a title that does not match a pattern rule", () => {
    const findings = checkHeading(section([]), { pattern: "^Step \\d+" });

    expect(findings).toEqual([
      {
        type: "heading_error",
        heading: "Install",
        message: `Expected title matching /^Step \\d+/, but found "Install"`,
        position: pos(HEADING_LINE),
        severity: "error",
      },
    ]);
  });

  it("accepts a section with no heading of its own when heading is false", () => {
    const lead = section([], { titlePosition: null, title: "" });
    expect(checkHeading(lead, false)).toEqual([]);
  });

  it("reports a section that has a heading when heading is false", () => {
    const findings = checkHeading(section([], { title: "Overview" }), false);

    expect(findings).toEqual([
      {
        type: "heading_error",
        heading: "Overview",
        message: `Expected no heading of its own, but found "Overview"`,
        position: pos(HEADING_LINE),
        severity: "error",
      },
    ]);
  });

  it("anchors to the section, and reports 'no heading', for the implicit lead section", () => {
    const lead = section([], { titlePosition: null, title: "" });
    const findings = checkHeading(lead, "Overview");

    expect(findings).toEqual([
      {
        // `null`, not `""`. The lead section has no heading, and every other
        // findings path spells that `null`; the JSON reporter's `heading` is
        // parsed rather than validated downstream, so one nil is all it may
        // have.
        type: "heading_error",
        heading: null,
        message: `Expected title "Overview", but found no heading`,
        position: pos(SECTION_LINE),
        severity: "error",
      },
    ]);
  });
});

/* -------------------------------------------------------------------------- *
 * paragraphs
 * -------------------------------------------------------------------------- */

describe("checkParagraphs", () => {
  it("returns nothing when the template has no paragraphs rule", () => {
    expect(checkParagraphs(section([paragraph("one")]), undefined)).toEqual([]);
  });

  it("reports too few paragraphs, using the singular noun for a bound of 1", () => {
    const findings = checkParagraphs(section([]), { min: 1 });

    expect(findings).toEqual([
      {
        type: "paragraphs_count_error",
        heading: "Install",
        message: "Expected at least 1 paragraph, but found 0",
        position: pos(SECTION_LINE),
        severity: "error",
      },
    ]);
  });

  it("reports too few paragraphs, pluralized for a bound above 1", () => {
    const findings = checkParagraphs(section([paragraph("one", 10)]), { min: 2 });

    expect(messages(findings)).toEqual(["Expected at least 2 paragraphs, but found 1"]);
  });

  it("reports too many paragraphs", () => {
    const findings = checkParagraphs(
      section([paragraph("a", 10), paragraph("b", 11), paragraph("c", 12)]),
      { max: 2 },
    );

    expect(messages(findings)).toEqual(["Expected at most 2 paragraphs, but found 3"]);
  });

  it("counts only paragraphs, ignoring other content", () => {
    const findings = checkParagraphs(
      section([paragraph("only one", 10), code("npm install", 11), list([listItem("item", 12)], 12)]),
      { min: 2 },
    );

    expect(messages(findings)).toEqual(["Expected at least 2 paragraphs, but found 1"]);
  });

  it("defaults min to 1 when the rule is bare", () => {
    expect(messages(checkParagraphs(section([]), {}))).toEqual([
      "Expected at least 1 paragraph, but found 0",
    ]);
  });

  it("reports every paragraph that fails the pattern", () => {
    const findings = checkParagraphs(
      section([paragraph("Step 1", 10), paragraph("nope", 11), paragraph("Step 2", 12)]),
      { pattern: "^Step \\d+$" },
    );

    expect(findings).toEqual([
      {
        type: "paragraphs_pattern_error",
        heading: "Install",
        message: "Paragraph 2 does not match /^Step \\d+$/",
        position: pos(11),
        severity: "error",
      },
    ]);
  });

  it("accepts content that satisfies min, max, and pattern", () => {
    const findings = checkParagraphs(
      section([paragraph("Step 1", 10), paragraph("Step 2", 11)]),
      { min: 2, max: 2, pattern: "^Step \\d+$" },
    );

    expect(findings).toEqual([]);
  });

  it("reports every violated rule at once, counts before pattern", () => {
    const findings = checkParagraphs(section([paragraph("nope", 10)]), {
      min: 2,
      pattern: "^Step \\d+$",
    });

    expect(messages(findings)).toEqual([
      "Expected at least 2 paragraphs, but found 1",
      "Paragraph 1 does not match /^Step \\d+$/",
    ]);
  });

  // The v1 rules guarded min/max on truthiness, so `max: 0` was a silent
  // no-op and "no paragraphs allowed" was inexpressible. In v2 a bound of
  // zero is a bound - and `min: 0` alone must not require a paragraph either.
  it("enforces a zero maximum", () => {
    expect(messages(checkParagraphs(section([paragraph("a", 10)]), { max: 0 }))).toEqual([
      "Expected at most 0 paragraphs, but found 1",
    ]);
    expect(checkParagraphs(section([]), { max: 0 })).toEqual([]);
  });

  it("treats an explicit zero minimum as no requirement", () => {
    expect(checkParagraphs(section([]), { min: 0 })).toEqual([]);
  });

  it("treats an uncompilable pattern as a broken template, not a finding", () => {
    expect(() => checkParagraphs(section([paragraph("one")]), { pattern: "(" })).toThrow(LintError);
    expect(() => checkParagraphs(section([paragraph("one")]), { pattern: "(" })).toThrow(
      /Invalid pattern "\("/,
    );
  });
});

/* -------------------------------------------------------------------------- *
 * code blocks
 * -------------------------------------------------------------------------- */

describe("checkCodeBlocks", () => {
  it("returns nothing when the template has no codeBlocks rule", () => {
    expect(checkCodeBlocks(section([code()]), undefined)).toEqual([]);
  });

  it("reports too few code blocks", () => {
    const findings = checkCodeBlocks(section([paragraph("prose", 10)]), { min: 1 });

    expect(findings).toEqual([
      {
        type: "code_blocks_count_error",
        heading: "Install",
        message: "Expected at least 1 code block, but found 0",
        position: pos(SECTION_LINE),
        severity: "error",
      },
    ]);
  });

  it("reports too many code blocks", () => {
    const findings = checkCodeBlocks(
      section([code("a", 20), code("b", 21), code("c", 22)]),
      { max: 2 },
    );

    expect(messages(findings)).toEqual(["Expected at most 2 code blocks, but found 3"]);
  });

  it("accepts a count inside the range", () => {
    const findings = checkCodeBlocks(
      section([paragraph("prose", 10), code("a", 20), code("b", 21)]),
      { min: 1, max: 2 },
    );

    expect(findings).toEqual([]);
  });

  it("reports a block declaring an unaccepted language, one of a single value", () => {
    const findings = checkCodeBlocks(
      section([code("npm i", 20, "bash"), code("pip install", 21, "python")]),
      { language: "bash" },
    );

    expect(findings).toEqual([
      {
        type: "code_blocks_language_error",
        heading: "Install",
        message: 'Expected code block 2 to declare "bash", but found "python"',
        position: pos(21),
        severity: "error",
      },
    ]);
  });

  it("reports a block declaring none of a list of languages", () => {
    const findings = checkCodeBlocks(
      section([code("npm i", 20, "bash"), code("echo hi", 21, "yaml")]),
      { language: ["json", "bash"] },
    );

    expect(messages(findings)).toEqual([
      'Expected code block 2 to declare one of "json", "bash", but found "yaml"',
    ]);
  });

  it("reports a block with no language at all", () => {
    // Not `code("npm i", 20, undefined)`: an explicit `undefined` argument
    // still triggers that parameter's default in JS, so this builds the node
    // directly to get a genuinely languageless block.
    const languageless: CodeNode = { kind: "codeBlock", text: "npm i", position: pos(20) };
    const findings = checkCodeBlocks(section([languageless]), {
      language: ["json", "bash"],
    });

    expect(messages(findings)).toEqual([
      'Expected code block 1 to declare one of "json", "bash", but found no language',
    ]);
  });

  it("accepts every block declaring an accepted language", () => {
    const findings = checkCodeBlocks(
      section([code("npm i", 20, "bash"), code("{}", 21, "json")]),
      { language: ["json", "bash"] },
    );

    expect(findings).toEqual([]);
  });

  it("narrows the count by fenceInfo, with no finding of its own", () => {
    const findings = checkCodeBlocks(
      section([code("npm i", 20, "bash", "copy"), code("echo hi", 21, "bash", undefined)]),
      { min: 2, fenceInfo: "^copy$" },
    );

    expect(messages(findings)).toEqual([
      "Expected at least 2 code blocks, but found 1",
    ]);
  });

  it("enforces a zero maximum", () => {
    expect(messages(checkCodeBlocks(section([code()]), { max: 0 }))).toEqual([
      "Expected at most 0 code blocks, but found 1",
    ]);
    expect(checkCodeBlocks(section([]), { max: 0 })).toEqual([]);
  });

  it("treats an explicit zero minimum as no requirement", () => {
    expect(checkCodeBlocks(section([]), { min: 0 })).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- *
 * lists
 * -------------------------------------------------------------------------- */

describe("checkLists", () => {
  it("returns nothing when the template has no lists rule", () => {
    expect(checkLists(section([]), undefined)).toEqual([]);
  });

  it("reports too few lists", () => {
    const findings = checkLists(section([paragraph("prose", 10)]), { min: 1 });

    expect(findings).toEqual([
      {
        type: "lists_count_error",
        heading: "Install",
        message: "Expected at least 1 list, but found 0",
        position: pos(SECTION_LINE),
        severity: "error",
      },
    ]);
  });

  it("reports too many lists", () => {
    const findings = checkLists(
      section([list([listItem("a", 30)], 30), list([listItem("b", 31)], 31), list([listItem("c", 32)], 32)]),
      { max: 2 },
    );

    expect(messages(findings)).toEqual(["Expected at most 2 lists, but found 3"]);
  });

  it("enforces a zero maximum", () => {
    expect(messages(checkLists(section([list([listItem("a", 30)], 30)]), { max: 0 }))).toEqual([
      "Expected at most 0 lists, but found 1",
    ]);
    expect(checkLists(section([]), { max: 0 })).toEqual([]);
  });

  it("treats an explicit zero minimum as no requirement", () => {
    expect(checkLists(section([]), { min: 0 })).toEqual([]);
  });

  it("reports a bulleted list when ordered is required", () => {
    const findings = checkLists(section([list([listItem("a", 30)], 30, false)]), {
      ordered: true,
    });

    expect(findings).toEqual([
      {
        type: "lists_ordered_error",
        heading: "Install",
        message: "Expected a numbered list, but found a bulleted list",
        position: pos(30),
        severity: "error",
      },
    ]);
  });

  it("reports a numbered list when unordered is required", () => {
    const findings = checkLists(section([list([listItem("a", 30)], 30, true)]), {
      ordered: false,
    });

    expect(messages(findings)).toEqual([
      "Expected a bulleted list, but found a numbered list",
    ]);
  });

  it("accepts a list matching the required order", () => {
    expect(checkLists(section([list([listItem("a", 30)], 30, true)]), { ordered: true })).toEqual([]);
  });

  it("reports an over-long list once, anchored at the offending list, with the found count", () => {
    const findings = checkLists(
      section([
        list([listItem("a", 30), listItem("b", 31)], 30),
        list([listItem("c", 40), listItem("d", 41), listItem("e", 42), listItem("f", 43)], 40),
      ]),
      { items: { max: 3 } },
    );

    expect(findings).toEqual([
      {
        type: "lists_items_count_error",
        heading: "Install",
        message: "Expected at most 3 items in a list, but found 4",
        position: pos(40),
        severity: "error",
      },
    ]);
  });

  it("reports an under-filled list once, however many lists break the rule", () => {
    const findings = checkLists(
      section([list([listItem("a", 30)], 30), list([listItem("b", 40)], 40)]),
      { items: { min: 2 } },
    );

    expect(findings).toEqual([
      {
        type: "lists_items_count_error",
        heading: "Install",
        message: "Expected at least 2 items in a list, but found 1",
        position: pos(30),
        severity: "error",
      },
    ]);
  });

  it("does not require items.min by default, since a list always has at least one item", () => {
    expect(checkLists(section([list([listItem("a", 30)], 30)]), { items: {} })).toEqual([]);
  });

  it("accepts lists inside every bound", () => {
    const findings = checkLists(
      section([list([listItem("a", 30), listItem("b", 31)], 30)]),
      { min: 1, max: 2, items: { min: 1, max: 3 } },
    );

    expect(findings).toEqual([]);
  });

  it("runs item-level contains rules against each item's children", () => {
    const findings = checkLists(
      section([
        list(
          [listItem("has prose", 30, [paragraph("explanation", 31)]), listItem("bare", 32)],
          30,
        ),
      ]),
      { items: { contains: { paragraphs: { min: 1 } } } },
    );

    expect(findings).toEqual([
      {
        type: "paragraphs_count_error",
        heading: "Install",
        message: "Expected at least 1 paragraph, but found 0",
        position: pos(32),
        severity: "error",
      },
    ]);
  });

  it("runs item-level sequence rules against each item's children", () => {
    const findings = checkLists(
      section([listOfSequencedItems()]),
      {
        items: {
          sequence: [{ paragraphs: {} }, { codeBlocks: {} }],
        },
      },
    );

    expect(findings).toEqual([]);
  });

  function listOfSequencedItems(): ListNode {
    return list(
      [listItem("step", 30, [paragraph("explain", 31), code("npm i", 32)])],
      30,
    );
  }

  it("recurses into nested lists via items.contains", () => {
    const nested = list([listItem("only child", 33)], 32);
    const findings = checkLists(
      section([list([listItem("parent", 30, [nested])], 30)]),
      { items: { contains: { lists: { items: { min: 2 } } } } },
    );

    expect(findings).toEqual([
      {
        type: "lists_items_count_error",
        heading: "Install",
        message: "Expected at least 2 items in a list, but found 1",
        position: pos(32),
        severity: "error",
      },
    ]);
  });

  it("reports a missing nested list at the item that should hold it", () => {
    const findings = checkLists(
      section([list([listItem("no sublist", 30, [paragraph("x", 31)])], 30)]),
      { items: { contains: { lists: { min: 1 } } } },
    );

    expect(findings).toEqual([
      {
        type: "lists_count_error",
        heading: "Install",
        message: "Expected at least 1 list, but found 0",
        position: pos(30),
        severity: "error",
      },
    ]);
  });
});

/* -------------------------------------------------------------------------- *
 * tables
 * -------------------------------------------------------------------------- */

describe("checkTables", () => {
  it("returns nothing when the template has no tables rule", () => {
    expect(checkTables(section([]), undefined)).toEqual([]);
  });

  it("reports too few tables, singular noun", () => {
    const findings = checkTables(section([]), { min: 1 });

    expect(findings).toEqual([
      {
        type: "tables_count_error",
        heading: "Install",
        message: "Expected at least 1 table, but found 0",
        position: pos(SECTION_LINE),
        severity: "error",
      },
    ]);
  });

  it("enforces a zero maximum", () => {
    const oneTable = table([tableRow(["A"], true, 40)], 40);
    expect(messages(checkTables(section([oneTable]), { max: 0 }))).toEqual([
      "Expected at most 0 tables, but found 1",
    ]);
    expect(checkTables(section([]), { max: 0 })).toEqual([]);
  });

  it("treats an explicit zero minimum as no requirement", () => {
    expect(checkTables(section([]), { min: 0 })).toEqual([]);
  });

  it("reports a table whose columns do not match, without affecting the count", () => {
    const mismatched = table(
      [tableRow(["Field", "Type", "Description"], true, 40), tableRow(["a", "b", "c"], false, 41)],
      40,
    );
    const findings = checkTables(section([mismatched]), {
      min: 1,
      columns: ["Field", "Type", "Description", "Default"],
    });

    expect(findings).toEqual([
      {
        type: "tables_columns_error",
        heading: "Install",
        message:
          'Expected table columns "Field", "Type", "Description", "Default", but found "Field", "Type", "Description"',
        position: pos(40),
        severity: "error",
      },
    ]);
  });

  it("treats a table with no header row as having no columns", () => {
    const headerless = table([tableRow(["a", "b"], false, 40)], 40);
    const findings = checkTables(section([headerless]), { columns: ["Field"] });

    expect(messages(findings)).toEqual(['Expected table columns "Field", but found ']);
  });

  it("accepts a table whose columns match exactly, in order", () => {
    const matching = table([tableRow(["Field", "Type"], true, 40)], 40);
    expect(checkTables(section([matching]), { columns: ["Field", "Type"] })).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- *
 * admonitions
 * -------------------------------------------------------------------------- */

describe("checkAdmonitions", () => {
  it("returns nothing when the template has no admonitions rule", () => {
    expect(checkAdmonitions(section([]), undefined)).toEqual([]);
  });

  it("reports too few admonitions", () => {
    const findings = checkAdmonitions(section([]), { min: 1 });

    expect(messages(findings)).toEqual(["Expected at least 1 admonition, but found 0"]);
  });

  it("enforces a zero maximum", () => {
    expect(messages(checkAdmonitions(section([admonition("note", 50)]), { max: 0 }))).toEqual([
      "Expected at most 0 admonitions, but found 1",
    ]);
    expect(checkAdmonitions(section([]), { max: 0 })).toEqual([]);
  });

  it("treats an explicit zero minimum as no requirement", () => {
    expect(checkAdmonitions(section([]), { min: 0 })).toEqual([]);
  });

  it("reports an admonition of the wrong variant, without affecting the count", () => {
    const findings = checkAdmonitions(section([admonition("caution", 50)]), {
      min: 1,
      variant: "note",
    });

    expect(findings).toEqual([
      {
        type: "admonitions_variant_error",
        heading: "Install",
        message: "Expected a note admonition, but found a caution",
        position: pos(50),
        severity: "error",
      },
    ]);
  });

  it("accepts an admonition of the required variant", () => {
    expect(checkAdmonitions(section([admonition("tip", 50)]), { variant: "tip" })).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- *
 * images
 * -------------------------------------------------------------------------- */

describe("checkImages", () => {
  it("returns nothing when the template has no images rule", () => {
    expect(checkImages(section([]), undefined)).toEqual([]);
  });

  it("reports too few images", () => {
    expect(messages(checkImages(section([]), { min: 1 }))).toEqual([
      "Expected at least 1 image, but found 0",
    ]);
  });

  it("enforces a zero maximum", () => {
    expect(messages(checkImages(section([image("a.png")]), { max: 0 }))).toEqual([
      "Expected at most 0 images, but found 1",
    ]);
    expect(checkImages(section([]), { max: 0 })).toEqual([]);
  });

  it("treats an explicit zero minimum as no requirement", () => {
    expect(checkImages(section([]), { min: 0 })).toEqual([]);
  });

  it("narrows the count by url", () => {
    const findings = checkImages(
      section([image("/a.png", "", 60), image("/b.png", "", 61)]),
      { min: 1, url: "/a.png" },
    );

    expect(findings).toEqual([]);
  });

  it("reports too few when no image matches url", () => {
    expect(
      messages(checkImages(section([image("/b.png", "", 61)]), { min: 1, url: "/a.png" })),
    ).toEqual(["Expected at least 1 image, but found 0"]);
  });

  it("narrows the count by alt", () => {
    const matching = image("/a.png", "diagram", 60);
    const other = image("/b.png", "screenshot", 61);
    expect(checkImages(section([matching, other]), { min: 1, alt: "diagram" })).toEqual([]);
  });

  it("narrows the count by url and alt together", () => {
    expect(
      checkImages(section([image("/a.png", "diagram", 60)]), {
        min: 1,
        url: "/a.png",
        alt: "diagram",
      }),
    ).toEqual([]);
    expect(
      messages(
        checkImages(section([image("/a.png", "wrong", 60)]), {
          min: 1,
          url: "/a.png",
          alt: "diagram",
        }),
      ),
    ).toEqual(["Expected at least 1 image, but found 0"]);
  });

  // `ImageNode` carries no `attributes` of its own - the node model gave that
  // field to `element` only - so any non-empty `attributes` requirement here
  // can never be satisfied, and the image drops out of the count.
  it("narrows the count to nothing when attributes are required", () => {
    expect(
      messages(
        checkImages(section([image("/a.png", "diagram", 60)]), {
          min: 1,
          attributes: { loading: "lazy" },
        }),
      ),
    ).toEqual(["Expected at least 1 image, but found 0"]);
  });
});

/* -------------------------------------------------------------------------- *
 * blockquotes / definitionLists - plain counts
 * -------------------------------------------------------------------------- */

describe("checkBlockquotes", () => {
  it("returns nothing when the template has no blockquotes rule", () => {
    expect(checkBlockquotes(section([]), undefined)).toEqual([]);
  });

  it("reports too few blockquotes", () => {
    expect(messages(checkBlockquotes(section([]), { min: 1 }))).toEqual([
      "Expected at least 1 blockquote, but found 0",
    ]);
  });

  it("enforces a zero maximum", () => {
    expect(messages(checkBlockquotes(section([blockquote(70)]), { max: 0 }))).toEqual([
      "Expected at most 0 blockquotes, but found 1",
    ]);
    expect(checkBlockquotes(section([]), { max: 0 })).toEqual([]);
  });

  it("treats an explicit zero minimum as no requirement", () => {
    expect(checkBlockquotes(section([]), { min: 0 })).toEqual([]);
  });
});

describe("checkDefinitionLists", () => {
  it("returns nothing when the template has no definitionLists rule", () => {
    expect(checkDefinitionLists(section([]), undefined)).toEqual([]);
  });

  it("reports too few definition lists", () => {
    expect(messages(checkDefinitionLists(section([]), { min: 1 }))).toEqual([
      "Expected at least 1 definition list, but found 0",
    ]);
  });

  it("enforces a zero maximum", () => {
    const list1 = definitionList([definitionItem("Term", 80)], 80);
    expect(messages(checkDefinitionLists(section([list1]), { max: 0 }))).toEqual([
      "Expected at most 0 definition lists, but found 1",
    ]);
    expect(checkDefinitionLists(section([]), { max: 0 })).toEqual([]);
  });

  it("treats an explicit zero minimum as no requirement", () => {
    expect(checkDefinitionLists(section([]), { min: 0 })).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- *
 * elements
 * -------------------------------------------------------------------------- */

describe("checkElements", () => {
  it("returns nothing when the template has no elements rule", () => {
    expect(checkElements(section([]), undefined)).toEqual([]);
  });

  it("reports too few elements with the generic noun when no tag is given", () => {
    expect(messages(checkElements(section([]), { min: 1 }))).toEqual([
      "Expected at least 1 element, but found 0",
    ]);
  });

  it("reports too few elements naming the tag", () => {
    const findings = checkElements(section([]), { min: 1, tag: "Steps" });

    expect(findings).toEqual([
      {
        type: "elements_count_error",
        heading: "Install",
        message: 'Expected at least 1 "Steps" element, but found 0',
        position: pos(SECTION_LINE),
        severity: "error",
      },
    ]);
  });

  it("pluralizes the tagged noun for a bound above 1", () => {
    expect(messages(checkElements(section([]), { min: 2, tag: "Steps" }))).toEqual([
      'Expected at least 2 "Steps" elements, but found 0',
    ]);
  });

  it("narrows the count by tag, ignoring elements of other tags", () => {
    const findings = checkElements(
      section([element("Aside", 90), element("Steps", 91)]),
      { min: 1, tag: "Steps" },
    );

    expect(findings).toEqual([]);
  });

  it("narrows the count by an array of tags", () => {
    const findings = checkElements(
      section([element("Callout", 90)]),
      { min: 1, tag: ["Aside", "Callout"] },
    );

    expect(findings).toEqual([]);
  });

  it("enforces a zero maximum", () => {
    expect(messages(checkElements(section([element("Aside", 90)]), { max: 0 }))).toEqual([
      "Expected at most 0 elements, but found 1",
    ]);
    expect(checkElements(section([]), { max: 0 })).toEqual([]);
  });

  it("treats an explicit zero minimum as no requirement", () => {
    expect(checkElements(section([]), { min: 0 })).toEqual([]);
  });

  it("reports a required attribute the element carries with the wrong value", () => {
    const findings = checkElements(
      section([element("Aside", 90, { type: "caution" })]),
      { tag: "Aside", attributes: { type: "note" } },
    );

    expect(findings).toEqual([
      {
        type: "elements_attribute_error",
        heading: "Install",
        message: 'Expected the "Aside" element to carry type="note", but found type="caution"',
        position: pos(90),
        severity: "error",
      },
    ]);
  });

  it("reports a required attribute the element does not carry at all", () => {
    const findings = checkElements(
      section([element("Aside", 90, {})]),
      { tag: "Aside", attributes: { type: "note" } },
    );

    expect(messages(findings)).toEqual([
      'Expected the "Aside" element to carry type="note", but it carries no type',
    ]);
  });

  it("reports a required attribute whose value is a dynamic expression", () => {
    const findings = checkElements(
      section([element("Aside", 90, { type: true })]),
      { tag: "Aside", attributes: { type: "note" } },
    );

    expect(messages(findings)).toEqual([
      'Expected the "Aside" element to carry type="note", but its type is an expression',
    ]);
  });

  it("accepts a matching literal attribute", () => {
    expect(
      checkElements(section([element("Aside", 90, { type: "note" })]), {
        tag: "Aside",
        attributes: { type: "note" },
      }),
    ).toEqual([]);
  });

  it("accepts any value when the rule only requires presence", () => {
    expect(
      checkElements(section([element("Aside", 90, { type: "note" })]), {
        tag: "Aside",
        attributes: { type: true },
      }),
    ).toEqual([]);
    expect(
      checkElements(section([element("Aside", 90, { type: true })]), {
        tag: "Aside",
        attributes: { type: true },
      }),
    ).toEqual([]);
  });

  it("reports absence when the rule requires presence and the element has none", () => {
    expect(
      messages(
        checkElements(section([element("Aside", 90, {})]), {
          tag: "Aside",
          attributes: { type: true },
        }),
      ),
    ).toEqual(['Expected the "Aside" element to carry type, but it carries no type']);
  });

  it("reports carrying an attribute the rule forbids", () => {
    expect(
      messages(
        checkElements(section([element("Aside", 90, { type: "note" })]), {
          tag: "Aside",
          attributes: { type: false },
        }),
      ),
    ).toEqual(['Expected the "Aside" element not to carry type, but found type="note"']);
  });

  it("accepts an element that does not carry a forbidden attribute", () => {
    expect(
      checkElements(section([element("Aside", 90, {})]), {
        tag: "Aside",
        attributes: { type: false },
      }),
    ).toEqual([]);
  });

  it("runs contains against the element's own children, not the section's", () => {
    const findings = checkElements(
      section(
        [
          element("Steps", 90, undefined, [paragraph("inside", 91)]),
          paragraph("sibling, not counted", 95),
        ],
      ),
      { tag: "Steps", contains: { paragraphs: { min: 2 } } },
    );

    expect(findings).toEqual([
      {
        type: "paragraphs_count_error",
        heading: "Install",
        message: "Expected at least 2 paragraphs, but found 1",
        position: pos(90),
        severity: "error",
      },
    ]);
  });

  it("runs sequence against the element's own children", () => {
    const findings = checkElements(
      section([element("Steps", 90, undefined, [paragraph("a", 91), code("npm i", 92)])]),
      { tag: "Steps", sequence: [{ paragraphs: {} }, { codeBlocks: {} }] },
    );

    expect(findings).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- *
 * contains - the dispatcher
 * -------------------------------------------------------------------------- */

describe("checkContains", () => {
  it("returns nothing when the rule is absent", () => {
    expect(checkContains(section([]), undefined)).toEqual([]);
  });

  it("dispatches every listed kind against the same content", () => {
    // One paragraph satisfies `paragraphs: { min: 1 }`, so only the two
    // kinds this content actually lacks should fire.
    const findings = checkContains(section([paragraph("only", 10)]), {
      paragraphs: { min: 1 },
      codeBlocks: { min: 1 },
      tables: { min: 1 },
    });

    expect(types(findings).sort()).toEqual(
      ["code_blocks_count_error", "tables_count_error"].sort(),
    );
  });

  it("checks each listed kind independently, in a mixed-content section", () => {
    const content: ContentNode[] = [
      paragraph("intro", 10),
      code("npm i", 11, "bash"),
      table([tableRow(["A"], true, 12)], 12),
      admonition("note", 13),
      image("/a.png", "", 14),
      blockquote(15),
      definitionList([definitionItem("Term", 16)], 16),
      list([listItem("item", 17)], 17),
      element("Aside", 18),
    ];

    const rule: BlockRule = {
      paragraphs: { min: 1 },
      codeBlocks: { min: 1 },
      lists: { min: 1 },
      tables: { min: 1 },
      admonitions: { min: 1 },
      images: { min: 1 },
      blockquotes: { min: 1 },
      definitionLists: { min: 1 },
      elements: { min: 1 },
    };

    expect(checkContainsIn(content, rule, { heading: "Install", position: pos(SECTION_LINE) })).toEqual(
      [],
    );
  });
});

/* -------------------------------------------------------------------------- *
 * sequence
 * -------------------------------------------------------------------------- */

describe("groupRuns", () => {
  it("groups consecutive same-kind nodes and spans their positions", () => {
    const runs = groupRuns([
      paragraph("a", 10),
      paragraph("b", 11),
      code("npm i", 12),
      list([listItem("x", 13)], 13),
      list([listItem("y", 14)], 14),
    ]);

    expect(runs.map((run) => run.kind)).toEqual(["paragraph", "codeBlock", "list"]);
    expect(runs[0]?.nodes).toHaveLength(2);
    expect(runs[0]?.position).toEqual({ start: pos(10).start, end: pos(11).end });
    expect(runs[2]?.position).toEqual({ start: pos(13).start, end: pos(14).end });
  });

  it("starts a new run when the kind changes back", () => {
    const runs = groupRuns([paragraph("a", 10), code("npm i", 11), paragraph("b", 12)]);

    expect(runs.map((run) => run.kind)).toEqual(["paragraph", "codeBlock", "paragraph"]);
  });

  it("returns no runs for empty content", () => {
    expect(groupRuns([])).toEqual([]);
  });

  it("groups every one of the nine content kinds, not just the original three", () => {
    const runs = groupRuns([
      table([tableRow(["A"], true, 40)], 40),
      table([tableRow(["B"], true, 41)], 41),
      admonition("note", 50),
      image("/a.png", "", 60),
      blockquote(70),
      definitionList([definitionItem("T", 80)], 80),
      element("Aside", 90),
    ]);

    expect(runs.map((run) => run.kind)).toEqual([
      "table",
      "admonition",
      "image",
      "blockquote",
      "definitionList",
      "element",
    ]);
    expect(runs[0]?.nodes).toHaveLength(2);
  });
});

describe("checkSequence", () => {
  it("returns nothing when the template has no sequence rule", () => {
    expect(checkSequence(section([paragraph("a")]), undefined)).toEqual([]);
  });

  it("accepts content whose runs match the sequence in order", () => {
    const findings = checkSequence(
      section([
        paragraph("intro", 10),
        code("npm install", 11),
        list([listItem("a", 12), listItem("b", 13)], 12),
        paragraph("outro", 14),
      ]),
      [
        { paragraphs: { min: 1 } },
        { codeBlocks: { max: 1 } },
        { lists: { min: 1 } },
        { paragraphs: { min: 1 } },
      ],
    );

    expect(findings).toEqual([]);
  });

  it("reports a length mismatch as a single content_order_error", () => {
    const findings = checkSequence(section([paragraph("a", 10)]), [
      { paragraphs: {} },
      { codeBlocks: {} },
      { lists: {} },
    ]);

    expect(findings).toEqual([
      {
        type: "content_order_error",
        heading: "Install",
        message: "Expected paragraph then code then list, but found paragraph",
        position: pos(SECTION_LINE),
        severity: "error",
      },
    ]);
  });

  it("reports content whose runs are in the wrong order, using the short kind labels", () => {
    const findings = checkSequence(
      section([paragraph("intro", 10), code("npm install", 11)]),
      [{ codeBlocks: {} }, { paragraphs: {} }],
    );

    expect(findings).toEqual([
      {
        type: "content_order_error",
        heading: "Install",
        message: "Expected code then paragraph, but found paragraph then code",
        position: pos(SECTION_LINE),
        severity: "error",
      },
    ]);
  });

  it("treats consecutive same-kind nodes as one run", () => {
    const findings = checkSequence(
      section([paragraph("a", 10), paragraph("b", 11), paragraph("c", 12), code("npm install", 13)]),
      [{ paragraphs: { min: 3 } }, { codeBlocks: { min: 1 } }],
    );

    expect(findings).toEqual([]);
  });

  it("reports a kind present in the document but absent from the rule as an order mismatch", () => {
    // The rule expects paragraph then code; the document also has a table.
    // A kind the rule never names cannot silently pass - the whole sequence
    // is wrong, exactly as if a required kind were simply missing.
    const findings = checkSequence(
      section([paragraph("a", 10), code("npm i", 11), table([tableRow(["A"], true, 12)], 12)]),
      [{ paragraphs: {} }, { codeBlocks: {} }],
    );

    expect(findings).toEqual([
      {
        type: "content_order_error",
        heading: "Install",
        message: "Expected paragraph then code, but found paragraph then code then table",
        position: pos(SECTION_LINE),
        severity: "error",
      },
    ]);
  });

  it("reports an empty section against a non-empty sequence as 'found nothing'", () => {
    const findings = checkSequence(section([]), [{ paragraphs: {} }]);

    expect(messages(findings)).toEqual(["Expected paragraph, but found nothing"]);
  });

  it("applies each run's rule to that run only, anchored at its span", () => {
    const findings = checkSequence(
      section([paragraph("a", 10), paragraph("b", 11), code("npm install", 12), paragraph("c", 13)]),
      [{ paragraphs: { min: 3 } }, { codeBlocks: { min: 1 } }, { paragraphs: { min: 1 } }],
    );

    expect(findings).toEqual([
      {
        type: "paragraphs_count_error",
        heading: "Install",
        message: "Expected at least 3 paragraphs, but found 2",
        position: { start: pos(10).start, end: pos(11).end },
        severity: "error",
      },
    ]);
  });

  it("checks paragraph patterns inside a run", () => {
    const findings = checkSequence(
      section([paragraph("Step 1", 10), paragraph("nope", 11), code("x", 12)]),
      [{ paragraphs: { pattern: "^Step \\d+$" } }, { codeBlocks: {} }],
    );

    expect(findings).toEqual([
      {
        type: "paragraphs_pattern_error",
        heading: "Install",
        message: "Paragraph 2 does not match /^Step \\d+$/",
        position: pos(11),
        severity: "error",
      },
    ]);
  });

  it("checks list item rules inside a run", () => {
    const findings = checkSequence(
      section([paragraph("intro", 10), list([listItem("only", 30)], 30)]),
      [{ paragraphs: {} }, { lists: { items: { min: 2 } } }],
    );

    expect(messages(findings)).toEqual([
      "Expected at least 2 items in a list, but found 1",
    ]);
  });

  it("checks any of the nine kinds inside a run, e.g. a table's columns", () => {
    const mismatched = table([tableRow(["Field", "Type"], true, 40)], 40);
    const findings = checkSequence(section([mismatched]), [
      { tables: { columns: ["Field", "Type", "Description"] } },
    ]);

    expect(messages(findings)).toEqual([
      'Expected table columns "Field", "Type", "Description", but found "Field", "Type"',
    ]);
  });
});

describe("compilePattern", () => {
  // Heading matching is quadratic by nature - every rule is asked about every
  // section - so the same handful of patterns were recompiled hundreds of times
  // over one page. Identity is the observable part of the memo.
  it("returns one instance per pattern", () => {
    expect(compilePattern("^Step ")).toBe(compilePattern("^Step "));
    expect(compilePattern("^Step ")).not.toBe(compilePattern("^Other "));
  });

  // Sharing an instance is only safe while these carry no `g` or `y`, which are
  // the flags that make `lastIndex` persist between calls. If this ever fails,
  // the memo has to go, not the assertion.
  it("compiles without the flags that would make sharing stateful", () => {
    const regex = compilePattern("^Step ");
    expect(regex.global).toBe(false);
    expect(regex.sticky).toBe(false);
    expect(regex.test("Step one")).toBe(true);
    expect(regex.test("Step one")).toBe(true);
  });

  it("still names the template's own bad pattern, and does not memo it", () => {
    expect(() => compilePattern("Step (")).toThrow(LintError);
    expect(() => compilePattern("Step (")).toThrow(/Invalid pattern "Step \("/);
  });

  it("recompiles after the cache is cleared", () => {
    const before = compilePattern("^Cleared ");
    clearPatternCache();
    expect(compilePattern("^Cleared ")).not.toBe(before);
  });
});
