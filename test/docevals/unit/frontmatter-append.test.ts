import { describe, it, expect } from "vitest";
import { parse as parseYaml } from "yaml";
import { Ajv2020 } from "ajv/dist/2020.js";
import {
  appendPageEvals,
  type NewEvalEntry,
} from "../../../src/docevals/core/frontmatter-edit.js";
import { frontmatterSchema } from "../../../src/docevals/schema.js";
import { DocevalsError } from "../../../src/docevals/types.js";

const PATH = "docs/page.mdx";

const ENTRY: NewEvalEntry = {
  id: "has-overview",
  assertion: "The page opens with a short overview paragraph.",
  type: "regression",
  grader: "ai",
  examples: {
    pass: "An intro paragraph summarizes the feature before any heading.",
    fail: "The page jumps straight into reference tables.",
  },
};

const SECOND: NewEvalEntry = {
  id: "links-resolve",
  assertion: "All relative links point at existing pages.",
  grader: "ai",
  examples: { pass: "Links resolve.", fail: "A link 404s." },
};

const ajv = new Ajv2020({ allErrors: true });
const validateFrontmatter = ajv.compile(frontmatterSchema);

/** Parse the frontmatter block of `content` and validate it against the published schema. */
function frontmatterOf(content: string): Record<string, unknown> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(content);
  const block = match?.[1];
  if (block === undefined) throw new Error("output has no frontmatter block");
  const data = parseYaml(block) as Record<string, unknown>;
  expect(
    validateFrontmatter(data),
    JSON.stringify(validateFrontmatter.errors),
  ).toBe(true);
  return data;
}

const idsOf = (data: Record<string, unknown>): unknown[] =>
  (data.evals as Record<string, unknown>[]).map((e) => e.id);

describe("appendPageEvals", () => {
  it("appends to an existing evals list, preserving body and comments", () => {
    const page = [
      "---",
      "title: Page # keep me",
      "evals:",
      "  - id: existing",
      "    assertion: Something.",
      "---",
      "",
      "# Body",
      "",
    ].join("\n");
    const out = appendPageEvals(page, PATH, [ENTRY]);
    expect(out.endsWith("# Body\n")).toBe(true);
    expect(out).toContain("# keep me");
    const data = frontmatterOf(out);
    expect(idsOf(data)).toEqual(["existing", "has-overview"]);
    expect((data.evals as Record<string, unknown>[])[1]).toEqual({
      id: "has-overview",
      assertion: ENTRY.assertion,
      type: "regression",
      grader: "ai",
      examples: ENTRY.examples,
    });
  });

  it("leaves a flat eval-suite assignment alone while appending", () => {
    // The settings are page-level keys now, not an enclosing object, so
    // appending to the list must not disturb them.
    const page = [
      "---",
      "eval-suite: reference",
      "evals:",
      "  - id: existing",
      "    assertion: Something.",
      "---",
      "body",
      "",
    ].join("\n");
    const data = frontmatterOf(appendPageEvals(page, PATH, [ENTRY]));
    expect(data["eval-suite"]).toBe("reference");
    expect(idsOf(data)).toEqual(["existing", "has-overview"]);
  });

  it("creates the evals list when a page carries only a suite assignment", () => {
    const page = ["---", "eval-suite: reference", "---", "body", ""].join("\n");
    const data = frontmatterOf(appendPageEvals(page, PATH, [ENTRY]));
    expect(data["eval-suite"]).toBe("reference");
    expect(idsOf(data)).toEqual(["has-overview"]);
  });

  it("creates an evals key when the page has none", () => {
    const page = ["---", "title: Page", "---", "", "# Body", ""].join("\n");
    const out = appendPageEvals(page, PATH, [ENTRY, SECOND]);
    expect(out.endsWith("# Body\n")).toBe(true);
    const data = frontmatterOf(out);
    expect(data.title).toBe("Page");
    expect(idsOf(data)).toEqual(["has-overview", "links-resolve"]);
  });

  it("synthesizes a frontmatter block when the page has none", () => {
    const page = "# Just a body\n\nSome prose.\n";
    const out = appendPageEvals(page, PATH, [ENTRY]);
    expect(out.endsWith("# Just a body\n\nSome prose.\n")).toBe(true);
    expect(idsOf(frontmatterOf(out))).toEqual(["has-overview"]);
  });

  it("refuses to append to the single-assertion string shorthand", () => {
    // Appending would have to rewrite the existing declaration into a list.
    // That is the author's call, not a silent side effect of adding one eval.
    const page = ["---", "evals: One durable claim.", "---", "body", ""].join(
      "\n",
    );
    expect(() => appendPageEvals(page, PATH, [ENTRY])).toThrow(
      /string shorthand/,
    );
  });

  it("preserves CRLF line endings", () => {
    const page = "---\r\ntitle: Page\r\n---\r\nbody\r\n";
    const out = appendPageEvals(page, PATH, [ENTRY]);
    expect(out.endsWith("body\r\n")).toBe(true);
    expect(/(?<!\r)\n/.test(out.slice(0, out.lastIndexOf("---")))).toBe(false);
  });

  it("omits undefined optional fields", () => {
    const page = ["---", "title: Page", "---", "body", ""].join("\n");
    const data = frontmatterOf(appendPageEvals(page, PATH, [SECOND]));
    expect((data.evals as Record<string, unknown>[])[0]).toEqual({
      id: "links-resolve",
      assertion: SECOND.assertion,
      grader: "ai",
      examples: SECOND.examples,
    });
  });

  it("throws on a duplicate inline eval id", () => {
    const page = [
      "---",
      "evals:",
      "  - id: has-overview",
      "    assertion: Something.",
      "---",
      "body",
      "",
    ].join("\n");
    expect(() => appendPageEvals(page, PATH, [ENTRY])).toThrow(DocevalsError);
  });

  it("refuses non-YAML frontmatter instead of prepending a second block", () => {
    const toml = ["+++", 'title = "Page"', "+++", "", "body", ""].join("\n");
    expect(() => appendPageEvals(toml, PATH, [ENTRY])).toThrow(/only YAML/i);
    const json = [";;;", '{ "title": "Page" }', ";;;", "", "body", ""].join("\n");
    expect(() => appendPageEvals(json, PATH, [ENTRY])).toThrow(/only YAML/i);
  });
});

/**
 * `meta-provenance` is the durable machine-proposal trail (proposal 0046).
 * `appendPageEvals` writes the list it is handed in the same edit as the evals;
 * the merge by `generated-by` is the caller's, shared with `manni meta fill`.
 */
describe("appendPageEvals: meta-provenance", () => {
  const LIST = [
    {
      "generated-by": "claude-fable-5",
      evals: ["has-overview"],
      confidence: { "has-overview": 0.88 },
    },
  ];

  it("writes the list beside the evals", () => {
    const page = ["---", "title: Page", "---", "body", ""].join("\n");
    const data = frontmatterOf(appendPageEvals(page, PATH, [ENTRY], LIST));
    expect(data["meta-provenance"]).toEqual(LIST);
    expect(idsOf(data)).toEqual(["has-overview"]);
  });

  it("writes it into a synthesized block too", () => {
    const data = frontmatterOf(appendPageEvals("body\n", PATH, [ENTRY], LIST));
    expect(data["meta-provenance"]).toEqual(LIST);
  });

  it("replaces the page's list, leaving every other key", () => {
    const page = [
      "---",
      "title: Page",
      "meta-provenance:",
      "  - generated-by: gpt-5",
      "    fields: [/title]",
      "---",
      "body",
      "",
    ].join("\n");
    const next = [{ "generated-by": "gpt-5", fields: ["/title"] }, ...LIST];
    const data = frontmatterOf(appendPageEvals(page, PATH, [ENTRY], next));
    expect(data["meta-provenance"]).toEqual(next);
    expect(data.title).toBe("Page");
  });

  it("writes no record when none is supplied", () => {
    const page = ["---", "title: Page", "---", "body", ""].join("\n");
    const data = frontmatterOf(appendPageEvals(page, PATH, [ENTRY]));
    expect(data["meta-provenance"]).toBeUndefined();
  });
});
