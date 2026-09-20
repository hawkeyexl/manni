/**
 * The matcher is an alignment, so these tests are written as rule-list
 * literals rather than template files: what is under test is which section each
 * rule ends up describing, and at what cost, not how a template is loaded.
 *
 * Every behaviour the pre-alignment matcher pinned by hand is re-expressed
 * here, because the mechanism changed completely and the behaviours did not.
 * Each such test names the bug it prevents, as the old ones did.
 */
import { describe, expect, it } from "vitest";
import { markdownParser } from "../../../src/lint/parsers/markdown.js";
import {
  ALIGNMENT_COSTS,
  STATE_LIMIT,
  TIE_BREAKS,
  matchSections,
} from "../../../src/lint/core/match.js";
import type { Rule } from "../../../src/lint/core/template.js";
import { LintError } from "../../../src/lint/types.js";
import { at } from "../helpers.js";

/** Sibling sections one level below a single H1, the common template shape. */
function subsectionsOf(md: string) {
  const tree = markdownParser.parse(md, "t.md");
  return at(tree.sections, 0, "top-level section").sections;
}

/** The whole top-level section, for tests that need a parent to anchor on. */
function topOf(md: string) {
  return at(markdownParser.parse(md, "t.md").sections, 0, "top-level section");
}

/** `[rule id or heading, section title]` for each pair, in document order. */
function paired(md: string, rules: Rule[]): [string, string][] {
  return matchSections(subsectionsOf(md), rules).matches.map((m) => [
    m.rule.id ?? (typeof m.rule.heading === "string" ? m.rule.heading : "?"),
    m.section.title,
  ]);
}

/** A rule that names its heading exactly and claims one section. */
const one = (heading: string, extra: Partial<Rule> = {}): Rule => ({
  heading,
  max: 1,
  ...extra,
});

describe("the cost model is interface", () => {
  // These four weights and this tie-break order decide which findings a
  // document produces. Changing one changes the report for documents nobody
  // edited, so they are asserted here rather than left implicit in the code.
  it("pins the edit weights", () => {
    expect(ALIGNMENT_COSTS).toEqual({
      match: 0,
      coerce: 1,
      skipRule: 2,
      skipSection: 2,
    });
  });

  it("pins the tie-break order", () => {
    expect(TIE_BREAKS).toEqual([
      "a rule that names its heading beats a wildcard taking the same section",
      "a repeating rule prefers its sections adjacent",
      "earliest rule, then the smallest edit sequence under match < coerce < skip-rule < skip-section",
    ]);
  });

  it("pins the state limit", () => {
    expect(STATE_LIMIT).toBe(2000);
  });
});

describe("pairing", () => {
  it("pairs rules with their sections in order", () => {
    const doc = subsectionsOf("# T\n\n## Overview\n\n## See also\n");
    const { matches, findings } = matchSections(doc, [
      one("Overview"),
      one("See also"),
    ]);
    expect(findings).toEqual([]);
    expect(matches.map((m) => m.section.title)).toEqual([
      "Overview",
      "See also",
    ]);
    expect(matches.map((m) => m.coerced)).toEqual([false, false]);
  });

  // The pre-rewrite matcher paired rule[i] with section[i], so one absent
  // optional section shifted every later comparison by one and produced a
  // cascade of bogus findings. This is the regression that made published
  // doctype templates - which are full of optional sections - unusable.
  it("keeps later sections aligned when an optional rule is absent", () => {
    expect(
      paired("# T\n\n## Overview\n\n## See also\n", [
        one("Overview"),
        one("Background", { min: 0 }),
        one("See also"),
      ]),
    ).toEqual([
      ["Overview", "Overview"],
      ["See also", "See also"],
    ]);
  });

  it("reports a required rule that matches nothing as missing", () => {
    const doc = subsectionsOf("# T\n\n## Overview\n\n## See also\n");
    const { findings } = matchSections(doc, [
      one("Overview"),
      { heading: "Before you start" },
      one("See also"),
    ]);
    expect(findings.map((f) => f.type)).toEqual(["missing_section"]);
    expect(at(findings, 0, "finding").message).toBe(
      'Missing section "Before you start"',
    );
  });

  it("matches a rule by pattern", () => {
    const doc = subsectionsOf("# T\n\n## Request Parameters\n");
    const { matches, findings } = matchSections(doc, [
      { heading: { pattern: "^(Request )?Parameters$" }, max: 1 },
    ]);
    expect(findings).toEqual([]);
    expect(matches).toHaveLength(1);
  });

  it("matches any one of a list of headings", () => {
    const doc = subsectionsOf("# T\n\n## References\n");
    const { matches, findings } = matchSections(doc, [
      { heading: ["See also", "References", "Next steps"], max: 1 },
    ]);
    expect(findings).toEqual([]);
    expect(matches).toHaveLength(1);
  });

  it("matches the section with no heading of its own when heading is false", () => {
    // Content before any heading becomes the implicit lead section, which is
    // the only section a document has that carries no heading.
    const roots = markdownParser.parse("intro\n\n# T\n", "t.md").sections;
    const { matches, findings } = matchSections(roots, [
      { heading: false, max: 1 },
    ]);
    expect(findings).toEqual([]);
    expect(matches).toHaveLength(1);
  });

  it("says nothing at all when the rule list is absent", () => {
    const doc = subsectionsOf("# T\n\n## Anything\n");
    expect(matchSections(doc, undefined)).toEqual({
      matches: [],
      findings: [],
    });
  });
});

describe("unexpected sections", () => {
  it("flags sections the template does not describe", () => {
    const doc = subsectionsOf("# T\n\n## Overview\n\n## Surprise\n");
    const { findings } = matchSections(doc, [one("Overview")]);
    expect(findings.map((f) => f.type)).toEqual(["unexpected_section"]);
    expect(at(findings, 0, "finding").message).toBe(
      'Unexpected section "Surprise". Add a trailing rule with min: 0 to allow sections the template does not describe.',
    );
  });

  it("allows them when a trailing rule with min 0 is there to take them", () => {
    const doc = subsectionsOf(
      "# T\n\n## Overview\n\n## Surprise\n\n## Another\n",
    );
    const { matches, findings } = matchSections(doc, [
      one("Overview"),
      { id: "rest", min: 0 },
    ]);
    expect(findings).toEqual([]);
    expect(matches.map((m) => m.section.title)).toEqual([
      "Overview",
      "Surprise",
      "Another",
    ]);
  });
});

describe("coercion", () => {
  // Degrading a simple one-for-one mismatch into missing + unexpected would
  // make the reader reconstruct what happened. The matcher pairs them and the
  // heading rule reports the mismatch, so there is nothing to report here.
  it("pairs a lone wrong heading rather than reporting missing + unexpected", () => {
    const doc = subsectionsOf("# T\n\n## Prerequisites\n\n## See also\n");
    const { matches, findings } = matchSections(doc, [
      one("Overview"),
      one("See also"),
    ]);
    expect(findings).toEqual([]);
    expect(matches.map((m) => [m.section.title, m.coerced])).toEqual([
      ["Prerequisites", true],
      ["See also", false],
    ]);
  });

  // Coercion is right when the document has a section for every rule and named
  // one wrong. It is wrong when the document is short: pairing the survivors up
  // shifts every later rule by one, which is the misalignment this matcher
  // exists to eliminate. The alignment cost tells the two apart - coercing here
  // would cost a coercion plus a missing section, and simply reporting the one
  // absent section costs less.
  it("does not coerce when the document is too short to fill the rules", () => {
    const doc = subsectionsOf("# T\n\n## Install it\n\n## See also\n");
    const { matches, findings } = matchSections(doc, [
      one("Overview"),
      { id: "task", max: 1 },
      one("See also"),
    ]);
    expect(findings.map((f) => f.type)).toEqual(["missing_section"]);
    expect(at(findings, 0, "finding").message).toBe('Missing section "Overview"');
    expect(matches.map((m) => [m.rule.id ?? m.rule.heading, m.section.title])).toEqual(
      [
        ["task", "Install it"],
        ["See also", "See also"],
      ],
    );
  });

  // Coercion is open only to a rule that claims exactly one section. Without
  // that restriction a repeating rule adopts any stray section for 1 instead of
  // letting it report as unexpected for 2, and a template that says "one or
  // more Symptom sections" silently swallows everything after them.
  it("never coerces a rule that may claim more than one section", () => {
    const doc = subsectionsOf("# T\n\n## Surprise\n");
    const { matches, findings } = matchSections(doc, [{ heading: "Symptom" }]);
    expect(matches).toEqual([]);
    expect(findings.map((f) => f.type)).toEqual([
      "missing_section",
      "unexpected_section",
    ]);
  });
});

describe("wildcards", () => {
  it("claims exactly one section when max is 1", () => {
    expect(
      paired("# T\n\n## Setup\n\n## Usage\n\n## Next steps\n", [
        { id: "setup", max: 1 },
        { id: "usage", max: 1 },
        one("Next steps"),
      ]),
    ).toEqual([
      ["setup", "Setup"],
      ["usage", "Usage"],
      ["Next steps", "Next steps"],
    ]);
  });

  // Adjacent wildcards are ordinary in hand-written templates - TGDP writes
  // "{Task name}" then "{Next task}" - and a greedy first one swallows the
  // second one's section, reporting it missing.
  it("does not let one wildcard swallow the next wildcard's section", () => {
    const doc = subsectionsOf("# T\n\n## Setup\n\n## Usage\n");
    const { findings } = matchSections(doc, [
      { id: "setup", max: 1 },
      { id: "usage", max: 1 },
    ]);
    expect(findings).toEqual([]);
  });

  // Tie-break 1. Both alignments cost the same: the wildcard is optional, so
  // whichever rule stands aside pays nothing. A rule that names its heading
  // describes the section better, so it gets it.
  it("yields a section a later rule names, at equal cost", () => {
    expect(
      paired("# T\n\n## Overview\n", [
        { id: "any", min: 0, max: 1 },
        one("Overview", { min: 0 }),
      ]),
    ).toEqual([["Overview", "Overview"]]);
  });

  it("claims the run up to the next rule that can take a section", () => {
    expect(
      paired(
        "# T\n\n## Overview\n\n## Install it\n\n## Configure it\n\n## See also\n",
        [one("Overview"), { id: "task", min: 0 }, one("See also")],
      ),
    ).toEqual([
      ["Overview", "Overview"],
      ["task", "Install it"],
      ["task", "Configure it"],
      ["See also", "See also"],
    ]);
  });
});

describe("repetition", () => {
  // "One or more sections named `Symptom N`" is a real doctype shape, and
  // writing it as a bare wildcard would trade away checking the heading text to
  // buy the repetition. An absent `max` is unbounded, so this is the default.
  it("repeats a named rule over the run of sections that satisfy it", () => {
    expect(
      paired("# T\n\n## Symptom 1\n\n## Symptom 2\n\n## For more information\n", [
        { id: "symptom", heading: { pattern: "^Symptom \\d+$" } },
        one("For more information"),
      ]),
    ).toEqual([
      ["symptom", "Symptom 1"],
      ["symptom", "Symptom 2"],
      ["For more information", "For more information"],
    ]);
  });

  // A stray section ahead of a repeating rule used to demote it to a single
  // match, because the repeat loop lived only on the matches-at-the-cursor
  // path. The sections it should have claimed then became `unexpected_section`
  // - and, worse, were never descended into, so real errors inside them went
  // unreported.
  it("keeps repeating past an extra section before the run", () => {
    const doc = subsectionsOf("# T\n\n## Overview\n\n## Symptom 1\n\n## Symptom 2\n");
    const { matches, findings } = matchSections(doc, [
      { id: "symptom", heading: { pattern: "^Symptom" } },
    ]);
    expect(matches.map((m) => m.section.title)).toEqual([
      "Symptom 1",
      "Symptom 2",
    ]);
    expect(findings.map((f) => f.type)).toEqual(["unexpected_section"]);
    expect(at(findings, 0, "finding").message).toContain("Overview");
  });

  it("stops the run at the first heading the rule does not match", () => {
    expect(
      paired("# T\n\n## Symptom 1\n\n## Notes\n\n## Symptom 2\n", [
        { id: "symptom", heading: { pattern: "^Symptom \\d+$" } },
        { id: "rest", min: 0 },
      ]),
    ).toEqual([
      ["symptom", "Symptom 1"],
      ["rest", "Notes"],
      ["rest", "Symptom 2"],
    ]);
  });

  it("caps the run at max and reports the surplus", () => {
    const doc = subsectionsOf("# T\n\n## Step 1\n\n## Step 2\n\n## Step 3\n");
    const { matches, findings } = matchSections(doc, [
      { id: "step", heading: { pattern: "^Step" }, min: 1, max: 2 },
    ]);
    expect(matches.map((m) => m.section.title)).toEqual(["Step 1", "Step 2"]);
    expect(findings.map((f) => f.type)).toEqual(["unexpected_section"]);
    expect(at(findings, 0, "finding").message).toContain("Step 3");
  });

  it("accepts an empty run when min is 0", () => {
    const doc = subsectionsOf("# T\n\n## Overview\n\n## See also\n");
    const { findings } = matchSections(doc, [
      one("Overview"),
      { id: "task", min: 0 },
      one("See also"),
    ]);
    expect(findings).toEqual([]);
  });

  it("reports an empty required run as missing", () => {
    const doc = subsectionsOf("# T\n\n## Overview\n\n## See also\n");
    const { findings } = matchSections(doc, [
      one("Overview"),
      { id: "task", min: 1, max: 1 },
      one("See also"),
    ]);
    expect(findings.map((f) => f.type)).toEqual(["missing_section"]);
    expect(at(findings, 0, "finding").message).toBe('Missing section "task"');
  });
});

describe("repeat groups", () => {
  const group: Rule = {
    id: "symptom-cause",
    repeat: [one("Symptom"), one("Cause")],
    min: 1,
    max: 2,
  };

  it("matches the members of each copy in order", () => {
    expect(
      paired("# T\n\n## Symptom\n\n## Cause\n\n## Symptom\n\n## Cause\n", [group]),
    ).toEqual([
      ["Symptom", "Symptom"],
      ["Cause", "Cause"],
      ["Symptom", "Symptom"],
      ["Cause", "Cause"],
    ]);
  });

  it("accepts one copy when max allows two", () => {
    const doc = subsectionsOf("# T\n\n## Symptom\n\n## Cause\n");
    expect(matchSections(doc, [group]).findings).toEqual([]);
  });

  // One finding for the group, not one per member. A reader told "Missing
  // section Symptom" and "Missing section Cause" has to work out that the two
  // belong together and go in that order.
  it("reports an absent required copy once, for the group", () => {
    const doc = subsectionsOf("# T\n\n## Overview\n");
    const { findings } = matchSections(doc, [one("Overview"), group]);
    expect(findings.map((f) => f.type)).toEqual(["missing_group"]);
    expect(at(findings, 0, "finding").message).toBe(
      'Missing group "symptom-cause": expected "Symptom" followed by "Cause"',
    );
  });

  it("reports the absent members of a partially present copy normally", () => {
    const doc = subsectionsOf("# T\n\n## Overview\n\n## Symptom\n");
    const { matches, findings } = matchSections(doc, [one("Overview"), group]);
    expect(matches.map((m) => m.section.title)).toEqual(["Overview", "Symptom"]);
    expect(findings.map((f) => f.type)).toEqual(["missing_section"]);
    expect(at(findings, 0, "finding").message).toBe('Missing section "Cause"');
  });

  it("reports a group below its min once per absent copy", () => {
    const doc = subsectionsOf("# T\n\n## Symptom\n\n## Cause\n");
    const { findings } = matchSections(doc, [
      { ...group, min: 2, max: 2 },
    ]);
    expect(findings.map((f) => f.type)).toEqual(["missing_group"]);
  });
});

describe("the state cap", () => {
  it("refuses a template that expands past the limit", () => {
    const doc = subsectionsOf("# T\n\n## A\n");
    const rules: Rule[] = [
      { id: "pair", repeat: [one("A"), one("B")], min: 0, max: 1500 },
    ];
    expect(() =>
      matchSections(doc, rules, { source: "tpl.yaml", template: "how-to" }),
    ).toThrow(LintError);
    expect(() =>
      matchSections(doc, rules, { source: "tpl.yaml", template: "how-to" }),
    ).toThrow(
      "tpl.yaml: how-to expands to 3001 states; the limit is 2000. Cap a max, or split the template.",
    );
  });

  it("accepts one that stops just short of it", () => {
    const doc = subsectionsOf("# T\n\n## A\n");
    expect(() =>
      matchSections(doc, [{ heading: "A", min: 0, max: 1999 }]),
    ).not.toThrow();
  });
});

describe("cost ties", () => {
  interface Case {
    /** Why this alignment wins, in the words the docs page carries. */
    reason: string;
    md: string;
    rules: Rule[];
    matches: [string, string][];
    findings: string[];
  }

  const cases: Case[] = [
    {
      reason: "a rule that names its heading beats a wildcard taking the same section",
      md: "# T\n\n## Overview\n",
      rules: [
        { id: "any", min: 0, max: 1 },
        { id: "overview", heading: "Overview", min: 0, max: 1 },
      ],
      matches: [["overview", "Overview"]],
      findings: [],
    },
    {
      reason: "a repeating rule prefers its sections adjacent",
      // Both alignments skip two sections, so both cost 4. Taking Symptom 2 and
      // Symptom 3 keeps the run together; taking Symptom 1 and Symptom 3 would
      // step over Other in the middle of the run.
      md: "# T\n\n## Symptom 1\n\n## Other\n\n## Symptom 2\n\n## Symptom 3\n",
      rules: [{ id: "symptom", heading: { pattern: "^Symptom" }, min: 2, max: 2 }],
      matches: [
        ["symptom", "Symptom 2"],
        ["symptom", "Symptom 3"],
      ],
      findings: ["unexpected_section", "unexpected_section"],
    },
    {
      reason: "earliest rule, then the smallest edit sequence",
      // One rule, two sections it could take, one of them left over either way.
      md: "# T\n\n## Step 1\n\n## Step 2\n",
      rules: [{ id: "step", heading: { pattern: "^Step" }, min: 1, max: 1 }],
      matches: [["step", "Step 1"]],
      findings: ["unexpected_section"],
    },
    {
      reason: "a coercion costs less than a missing section plus an unexpected one",
      md: "# T\n\n## Overvew\n",
      rules: [{ id: "overview", heading: "Overview", max: 1 }],
      matches: [["overview", "Overvew"]],
      findings: [],
    },
  ];

  for (const testCase of cases) {
    it(testCase.reason, () => {
      const { matches, findings } = matchSections(
        subsectionsOf(testCase.md),
        testCase.rules,
      );
      expect(
        matches.map((m) => [m.rule.id ?? "?", m.section.title]),
      ).toEqual(testCase.matches);
      expect(findings.map((f) => f.type)).toEqual(testCase.findings);
    });
  }

  // The pre-alignment matcher scanned forward for a rule's section and had to
  // stop before any section a later rule named exactly, or a loose `^Symptom`
  // rule took "Symptom summary" and left the rule that named it missing. The
  // alignment gets this from the weights instead: taking that section costs the
  // later rule a missing section (2), while standing aside costs a coercion (1).
  it("does not take a section a later rule names exactly", () => {
    expect(
      paired("# T\n\n## Overview\n\n## Symptom summary\n", [
        { id: "symptom", heading: { pattern: "^Symptom" }, max: 1 },
        { id: "summary", heading: "Symptom summary", max: 1 },
      ]),
    ).toEqual([
      ["symptom", "Overview"],
      ["summary", "Symptom summary"],
    ]);
  });

  // The same question where the section sits at the cursor rather than further
  // on. The old code had a fast path there that skipped the lookahead entirely,
  // so a loose rule took the section whenever it happened to be first.
  it("does not take one at the cursor either", () => {
    expect(
      paired("# T\n\n## Symptom summary\n", [
        { id: "symptom", heading: { pattern: "^Symptom" }, min: 0, max: 1 },
        { id: "summary", heading: "Symptom summary", min: 1, max: 1 },
      ]),
    ).toEqual([["summary", "Symptom summary"]]);
  });
});

describe("where findings land", () => {
  // A trailing gap used to anchor at `sections[cursor] ?? parent`, and with no
  // section left that is the parent, whose span starts at its own heading. The
  // finding therefore sorted to the top of a report about something at the
  // bottom of the file.
  it("anchors a trailing missing section at the end of the parent", () => {
    const top = topOf("# T\n\npara\n\n## A\n\ntext\n");
    const { findings } = matchSections(top.sections, [one("A"), { heading: "Z" }], {
      parent: top,
    });
    expect(findings.map((f) => f.type)).toEqual(["missing_section"]);
    const finding = at(findings, 0, "finding");
    expect(finding.heading).toBe("T");
    expect(finding.position.start.offset).toBe(top.position.end.offset);
    expect(finding.position.start.offset).toBeGreaterThan(
      at(top.sections, 0, "section").position.start.offset,
    );
  });

  it("anchors a missing section on the section that stands where it should be", () => {
    const doc = subsectionsOf("# T\n\n## Install it\n\n## See also\n");
    const { findings } = matchSections(doc, [
      { heading: "Overview" },
      { id: "task", max: 1 },
      one("See also"),
    ]);
    expect(at(findings, 0, "finding").heading).toBe("Install it");
  });

  // A missing rule is reported where it should have been, so it lands on the
  // section standing in its place and ties with that section's own finding. The
  // property that matters is that nothing sorts backwards: a reader scans the
  // report top to bottom against the file.
  it("reports findings in document order", () => {
    const doc = subsectionsOf("# T\n\n## X\n\n## B\n\n## Y\n");
    const { findings } = matchSections(doc, [one("B"), { heading: "C" }]);
    expect(findings.map((f) => f.type)).toEqual([
      "unexpected_section",
      "missing_section",
      "unexpected_section",
    ]);
    expect(findings.map((f) => f.heading)).toEqual(["X", "Y", "Y"]);
    const offsets = findings.map((f) => f.position.start.offset);
    expect([...offsets].sort((x, y) => x - y)).toEqual(offsets);
  });
});

describe("determinism", () => {
  it("aligns the same input identically every run", () => {
    const md =
      "# T\n\n## Overview\n\n## Symptom 1\n\n## Other\n\n## Symptom 2\n\n## See also\n";
    const rules: Rule[] = [
      one("Overview", { min: 0 }),
      { id: "symptom", heading: { pattern: "^Symptom" }, min: 1 },
      { id: "any", min: 0, max: 1 },
      one("See also"),
    ];
    const first = matchSections(subsectionsOf(md), rules);
    const second = matchSections(subsectionsOf(md), rules);
    expect(second.findings).toEqual(first.findings);
    expect(second.matches.map((m) => [m.rule.id, m.section.title])).toEqual(
      first.matches.map((m) => [m.rule.id, m.section.title]),
    );
  });
});
