/**
 * `--explain`'s alignment block: which rule claimed which section, and why.
 * Pins `explainAlignment`/`formatAlignment` (`src/lint/reporters/alignment.ts`)
 * directly, against real parsed trees, rather than through `renderExplain` -
 * the seam that attaches a tree and a template to a `LintFileResult` lives in
 * `commands/lint.ts`, outside this chunk's files, so `renderExplain` itself is
 * covered separately for the case where that data is absent.
 *
 * Assertions match on the label and the arrow's own text rather than on exact
 * column widths, since the padding is a display detail and not part of what
 * the block promises.
 */
import { describe, expect, it } from "vitest";
import { markdownParser } from "../../../src/lint/parsers/markdown.js";
import {
  explainAlignment,
  formatAlignment,
} from "../../../src/lint/reporters/alignment.js";
import type { Rule, Template } from "../../../src/lint/core/template.js";
import { at } from "../helpers.js";

function lines(md: string, template: Template): string[] {
  const tree = markdownParser.parse(md, "t.md");
  return formatAlignment(explainAlignment(tree, template));
}

/** Find the one row containing every fragment, asserting there is exactly one. */
function rowWith(out: string[], ...fragments: string[]): string {
  const matches = out.filter((line) => fragments.every((f) => line.includes(f)));
  expect(matches, `expected exactly one row with ${JSON.stringify(fragments)} in:\n${out.join("\n")}`).toHaveLength(1);
  return at(matches, 0, "matching row");
}

const HOW_TO = `# How to do it

## Before you start

Text.

## Steps

Text.

## Next steps

Text.
`;

describe("the page row", () => {
  it("shows the page's own heading, literal, when it is one H1", () => {
    const out = lines(HOW_TO, { sections: [] });
    expect(out[0]).toContain("(page)");
    expect(out[0]).toContain('← "How to do it"');
    expect(out[0]).not.toContain("synthesized");
  });

  it("synthesizes the title from frontmatter when the page opens at ##", () => {
    const md = `---\ntitle: manni lint\n---\n\n## Before you start\n\nText.\n`;
    const out = lines(md, { sections: [] });
    expect(out[0]).toContain('"manni lint"');
    expect(out[0]).toContain("(synthesized from frontmatter)");
  });

  it("says so when the page has no heading at all", () => {
    const md = `Text with no heading anywhere.\n`;
    const out = lines(md, { sections: [] });
    expect(out[0]).toContain("(page)");
    expect(out[0]).toContain("← (no heading)");
  });
});

describe("matched rules", () => {
  it("names a rule by its id, arrow to the section it took", () => {
    const rules: Rule[] = [
      { id: "before-you-start", heading: "Before you start", max: 1 },
      { id: "steps", heading: "Steps", max: 1 },
      { id: "closer", heading: "Next steps", max: 1 },
    ];
    const out = lines(HOW_TO, { sections: rules });
    rowWith(out, "before-you-start", '← "Before you start"');
    rowWith(out, "closer", '← "Next steps"');
  });

  it("falls back to the literal heading, then to (any) for a wildcard", () => {
    const rules: Rule[] = [
      { heading: "Before you start", max: 1 },
      { max: 3 },
      { id: "closer", heading: "Next steps", max: 1 },
    ];
    const out = lines(HOW_TO, { sections: rules });
    rowWith(out, "Before you start", '← "Before you start"');
    // The wildcard swallows "Steps" - the only section left once the named
    // rules take theirs - as a run of one, so it does not yet collapse.
    rowWith(out, "(any)", '← "Steps"');
  });

  it("collapses a run of several matches of the same rule to ×N, first … last", () => {
    const md = `## A\n\nText.\n\n## B\n\nText.\n\n## C\n\nText.\n`;
    const rules: Rule[] = [{}];
    const out = lines(md, { sections: rules });
    rowWith(out, "(any) ×3", '"A" … "C"');
  });

  it("marks a coerced match, never a collapsed run", () => {
    // A required, max:1 rule for "Prep" is the only rule; "Intro" has no rule
    // of its own, so coercion is cheaper than reporting it missing-and-extra.
    const md = `## Intro\n\nText.\n`;
    const rules: Rule[] = [{ heading: "Prep", max: 1 }];
    const out = lines(md, { sections: rules });
    rowWith(out, "Prep", '← "Intro" (coerced)');
  });
});

describe("gaps", () => {
  // `faq` is `min: 0`, deliberately: a *required* max:1 rule is a coercion
  // candidate for a stray section (`ALIGNMENT_COSTS.coerce` is cheaper than
  // `skipRule` + `skipSection` together), so it would claim "Steps" instead of
  // reporting itself absent. An optional rule carries no such incentive.
  //
  // Which is also why it prints `(none)` rather than `(missing)`. The page
  // below lints clean, and a clean page must not carry a row saying something
  // is missing from it.
  it("prints (none) for an optional rule that matched nothing", () => {
    const rules: Rule[] = [
      { id: "before-you-start", heading: "Before you start", max: 1 },
      { id: "faq", heading: "FAQ", min: 0, max: 1 },
    ];
    const out = lines(HOW_TO, { sections: rules });
    rowWith(out, "faq", "← (none)");
  });

  // The other half: `(missing)` means what produces a `missing_section`
  // finding. Every section here is claimed by a rule that names it, so the
  // required `see-also` has nothing left to coerce onto and must report itself
  // absent.
  it("prints (missing) for a required rule that matched nothing", () => {
    const rules: Rule[] = [
      { id: "before-you-start", heading: "Before you start", max: 1 },
      { id: "steps", heading: "Steps", max: 1 },
      { id: "closer", heading: "Next steps", max: 1 },
      { id: "see-also", heading: "See also", max: 1 },
    ];
    const out = lines(HOW_TO, { sections: rules });
    rowWith(out, "see-also", "← (missing)");
    expect(out.join("\n")).not.toContain("(none)");
  });

  it("prints (unexpected) for a section no rule took", () => {
    const rules: Rule[] = [
      { id: "before-you-start", heading: "Before you start", min: 0, max: 1 },
    ];
    const out = lines(HOW_TO, { sections: rules });
    rowWith(out, "(unexpected)", '"Steps"');
    rowWith(out, "(unexpected)", '"Next steps"');
  });
});

describe("nesting and repeat groups", () => {
  it("follows the section tree: a matched rule's own sections indent one level further", () => {
    const md = `## Steps\n\n### First\n\nText.\n`;
    const rules: Rule[] = [
      {
        id: "steps",
        heading: "Steps",
        max: 1,
        sections: [{ id: "first", heading: "First", max: 1 }],
      },
    ];
    const out = lines(md, { sections: rules });
    const stepsIndex = out.findIndex((l) => l.includes("steps"));
    const firstIndex = out.findIndex((l) => l.includes("first"));
    expect(firstIndex).toBeGreaterThan(stepsIndex);
    // Indented two more spaces than "steps" itself, since it is one level
    // further from the page row.
    const stepsIndent = at(out, stepsIndex, "steps row").match(/^ */)?.[0].length ?? 0;
    const firstIndent = at(out, firstIndex, "first row").match(/^ */)?.[0].length ?? 0;
    expect(firstIndent).toBe(stepsIndent + 2);
  });

  it("prints a repeat group's own row, then its members indented under it", () => {
    const md = `## Symptom\n\nText.\n\n## Cause\n\nText.\n`;
    const rules: Rule[] = [
      {
        id: "symptom-cause",
        repeat: [
          { id: "symptom", heading: "Symptom", max: 1 },
          { id: "cause", heading: "Cause", max: 1 },
        ],
      },
    ];
    const out = lines(md, { sections: rules });
    const groupIndex = out.findIndex((l) => l.trim() === "symptom-cause");
    expect(groupIndex).toBeGreaterThanOrEqual(0);
    expect(out[groupIndex + 1]).toContain("symptom");
    expect(out[groupIndex + 1]).toContain('← "Symptom"');
    expect(out[groupIndex + 2]).toContain("cause");
    expect(out[groupIndex + 2]).toContain('← "Cause"');
    // Both nested one level deeper than the group's own row.
    const groupIndent = at(out, groupIndex, "group row").match(/^ */)?.[0].length ?? 0;
    const memberIndent = at(out, groupIndex + 1, "member row").match(/^ */)?.[0].length ?? 0;
    expect(memberIndent).toBe(groupIndent + 2);
  });

  it("prints a missing repeat group's members each on their own row, all missing", () => {
    const rules: Rule[] = [
      {
        id: "symptom-cause",
        repeat: [
          { id: "symptom", heading: "Symptom", max: 1 },
          { id: "cause", heading: "Cause", max: 1 },
        ],
      },
    ];
    // No headings at all, so `pageSections` gives the group nothing to coerce
    // onto - otherwise a required max:1 member is exactly the coercion case
    // the test above documents, and "symptom" would claim a stray section
    // instead of reporting itself absent.
    const out = lines(`Just some text.\n`, { sections: rules });
    expect(out.some((l) => l.trim() === "symptom-cause")).toBe(true);
    rowWith(out, "symptom", "← (missing)");
    rowWith(out, "cause", "← (missing)");
  });

  it("marks only the member a partial occurrence never reached, not the group", () => {
    const md = `## Symptom\n\nText.\n`;
    const rules: Rule[] = [
      {
        id: "symptom-cause",
        repeat: [
          { id: "symptom", heading: "Symptom", max: 1 },
          { id: "cause", heading: "Cause", max: 1 },
        ],
      },
    ];
    const out = lines(md, { sections: rules });
    rowWith(out, "symptom", '← "Symptom"');
    rowWith(out, "cause", "← (missing)");
    // The group itself is not reported missing: it took a section.
    expect(out.filter((l) => l.trim() === "symptom-cause")).toHaveLength(1);
  });
});
