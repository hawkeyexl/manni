/**
 * The rewrite against the repository's own template file and sample documents,
 * kept under `examples/lint/`.
 *
 * Unit tests pin each rule in isolation; this pins the combination that the
 * pre-rewrite project shipped and demonstrated in its README. `Sample` and the
 * sample document exercise the matcher's hard parts together - adjacent
 * unconstrained sections, a `$ref` component, `additionalSections`, and content
 * rules at three heading levels - so a regression here means the tool no longer
 * does what it always claimed to do, whatever the unit tests say.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { markdownParser } from "../../../src/lint/parsers/markdown.js";
import { validateDocument } from "../../../src/lint/core/validator.js";
import {
  loadTemplate,
  loadTemplateFile,
  resolveExtends,
} from "../../../src/lint/core/template-registry.js";
import type { Template } from "../../../src/lint/core/template.js";
import { at, defined } from "../helpers.js";

const here = dirname(fileURLToPath(import.meta.url));
const examples = join(here, "..", "..", "..", "examples", "lint");
const TEMPLATES = join(examples, "templates.yaml");
const sample = (name: string): string => join(examples, name);

// `$ref` only survives to be seen dereferenced: `loadTemplateFile` resolves
// every same-document pointer before validating, which a raw `parse()` does
// not. Loaded once, in `beforeAll`, since every `it` below reads from it.
let templates: Record<string, Template>;

beforeAll(async () => {
  const file = await loadTemplateFile(TEMPLATES);
  templates = file.templates ?? {};
});

const lint = (docPath: string, templateName: string) =>
  validateDocument(
    markdownParser.parse(readFileSync(docPath, "utf8"), docPath),
    defined(templates[templateName], `template "${templateName}"`),
  );

describe("the repository's own templates", () => {
  it("lints the sample document clean against Sample", () => {
    expect(lint(sample("sample_markdown.md"), "Sample")).toEqual([]);
  });

  // Two adjacent unconstrained sections, `Setup` and `Usage`. A slot that
  // repeated by default consumed both and reported `Usage` missing, which is
  // why repetition is opt-in.
  it("gives adjacent unconstrained sections one section each", () => {
    const findings = lint(sample("sample_markdown.md"), "Sample");
    expect(findings.filter((f) => f.type === "missing_section")).toEqual([]);
  });

  // A how-to is a genuinely different shape from the sample, so this must
  // report - but as three precise heading mismatches, not a cascade. The
  // pre-rewrite index-based matcher turned one early mismatch into noise for
  // every section after it.
  it("reports a mismatched template as heading mismatches, not a cascade", () => {
    const findings = lint(sample("sample_markdown.md"), "how-to");
    // v1 split this into `heading_const_error`/`heading_pattern_error`; v2
    // collapses every form into one `heading_error`, and the message says
    // which form failed.
    expect(findings.map((f) => f.type)).toEqual([
      "heading_error",
      "heading_error",
      "heading_error",
    ]);
    expect(findings.map((f) => f.heading)).toEqual([
      "Prerequisites",
      "Setup",
      "Next steps",
    ]);
  });

  // The headless sample is the shape Docusaurus, Hugo, and Starlight produce:
  // the title lives in frontmatter and the body starts at `##`. Read literally
  // it has no top-level section and every doctype template misaligns against it.
  it("takes the H1 from frontmatter when the body has none", () => {
    const tree = markdownParser.parse(
      readFileSync(sample("sample_markdown_headless.md"), "utf8"),
      sample("sample_markdown_headless.md"),
    );
    expect(tree.frontmatter).toMatchObject({ title: "Sample" });

    const root = at(tree.sections, 0, "top-level section");
    expect(root.level).toBe(1);
    expect(root.title).toBe("Sample");
    // Anchored on the frontmatter, which is where the title actually is.
    expect(root.titlePosition?.start.line).toBe(1);
    expect(root.sections.map((s) => s.title)).toContain("Prerequisites");
  });

  it("still uses the implicit lead section when there is no title anywhere", () => {
    const tree = markdownParser.parse(
      "Intro prose.\n\n## Prerequisites\n\nMore.\n",
      "headless.md",
    );
    const lead = at(tree.sections, 0, "implicit lead section");
    expect(lead.level).toBe(0);
    expect(lead.sections.map((s) => s.title)).toEqual([
      "Prerequisites",
    ]);
  });

  // `templates.yaml` is the file the README teaches from, so its worked
  // examples of the two headline affordances have to actually work.
  it("declares the doctypes its examples serve", async () => {
    const file = await loadTemplateFile(TEMPLATES);
    expect(file.templates?.["api-operation-guide"]?.types).toEqual([
      "api-operation",
    ]);
    expect(file.templates?.["house-how-to"]?.types).toEqual(["how-to"]);
  });

  // TGDP does not mark "See also" optional, so the built-in requires it. The
  // point of `extends` is disagreeing with a vetted template in one place
  // instead of copying it and drifting.
  it("relaxes a built-in through extends while inheriting the rest", async () => {
    const page = "# Do it\n\n## Overview\n\nWhy.\n\n## Install it\n\nHow.\n";
    const tree = markdownParser.parse(page, "page.md");

    const builtin = await loadTemplate("tgdp:how-to:1.6");
    expect(validateDocument(tree, builtin).map((f) => f.message)).toEqual([
      'Missing section "See also"',
    ]);

    const house = await resolveExtends(
      await loadTemplate(`${TEMPLATES}#house-how-to`),
    );
    expect(validateDocument(tree, house)).toEqual([]);
    // Inherited, not restated: the child names only `see-also`. The template
    // *is* the page in v2, so `sections` is house's own list directly - no
    // `title` wrapper to index through first.
    const inherited = house.sections ?? [];
    expect(inherited.map((rule) => rule.id)).toEqual([
      "overview",
      "before-you-start",
      "task",
      "see-also",
    ]);
  });

  it("resolves a $ref component into the section that uses it", () => {
    // `Sample` reaches its trailing section through
    // `$ref: "#/components/nextSteps"`. Read raw (undereferenced) here: the
    // registry dereferences on load, so this asserts the fixture still
    // exercises the feature. `sections` is a list in v2, so the ref is found
    // by id rather than by map key.
    const raw = parse(readFileSync(TEMPLATES, "utf8")) as {
      templates: { Sample: { sections: { id?: string; $ref?: string }[] } };
    };
    const nextSteps = raw.templates.Sample.sections.find(
      (rule) => rule.id === "next-steps",
    );
    expect(nextSteps).toEqual({
      id: "next-steps",
      $ref: "#/components/nextSteps",
    });
  });
});
