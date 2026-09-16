/**
 * The `type` -> `ruleId` table, pinned exhaustively.
 *
 * A rule id is the durable half of a finding: it is the SARIF `ruleId`, the
 * JUnit `<failure type>`, and the GitHub annotation's `title`, so a consumer
 * files alerts under it and correlates them across runs. A silent rename
 * closes every historical alert and opens the same findings as new ones.
 *
 * So the mapping is stated here for **every** `type` the rules, the matcher
 * and the command layer can emit, rather than for a sample. The
 * `EMITTED_TYPES` guard is what keeps the table honest: grep `type: "` under
 * `src/lint` and the list below must account for all of it.
 */
import { describe, expect, it } from "vitest";
import {
  RULE_ID_PREFIX,
  ruleId,
  ruleName,
} from "../../../src/lint/core/rule-id.js";

/**
 * Every finding `type` the tool produces today, with the id it reports under.
 *
 * Sources, in the order a run reaches them:
 *   commands/lint.ts  parse_error, unknown_type, template_error
 *   core/match.ts     missing_section, unexpected_section
 *   rules/*.ts        the remaining nine
 */
const TABLE: Record<string, string> = {
  parse_error: "manni:lint/structure/parse",
  unknown_type: "manni:lint/structure/unknown-type",
  template_error: "manni:lint/structure/template",
  missing_section: "manni:lint/structure/missing-section",
  unexpected_section: "manni:lint/structure/unexpected-section",
  code_blocks_count_error: "manni:lint/structure/code-blocks-count",
  heading_const_error: "manni:lint/structure/heading-const",
  heading_pattern_error: "manni:lint/structure/heading-pattern",
  lists_count_error: "manni:lint/structure/lists-count",
  list_items_count_error: "manni:lint/structure/list-items-count",
  paragraphs_count_error: "manni:lint/structure/paragraphs-count",
  paragraph_pattern_error: "manni:lint/structure/paragraph-pattern",
  sequence_length_error: "manni:lint/structure/sequence-length",
  sequence_order_error: "manni:lint/structure/sequence-order",
};

describe("ruleId", () => {
  for (const [type, expected] of Object.entries(TABLE)) {
    it(`maps ${type} to ${expected}`, () => {
      expect(ruleId(type)).toBe(expected);
    });
  }

  it("namespaces every id under manni:lint and a job segment", () => {
    for (const id of Object.values(TABLE)) {
      expect(id.startsWith(`${RULE_ID_PREFIX}/`)).toBe(true);
      expect(id.split("/")).toHaveLength(3);
    }
  });

  // The job is a segment of its own so a second job's rules cannot collide
  // with structure's - `manni:lint/prose/Google.Passive` is the shape the
  // proposal names, and it keeps the tool's own rule name verbatim.
  it("takes the job it reports under", () => {
    expect(ruleId("missing_section", "structure")).toBe(
      "manni:lint/structure/missing-section",
    );
  });
});

describe("ruleName", () => {
  // Only a *trailing* `_error`, and only one. `template_error` is the rule
  // "template", but a type that merely contains the word keeps it.
  it("drops one trailing _error and kebab-cases the rest", () => {
    expect(ruleName("heading_pattern_error")).toBe("heading-pattern");
    expect(ruleName("parse_error")).toBe("parse");
    expect(ruleName("missing_section")).toBe("missing-section");
    expect(ruleName("error_budget")).toBe("error-budget");
  });

  it("leaves a name that is already kebab-case alone", () => {
    expect(ruleName("Google.Passive")).toBe("Google.Passive");
  });
});
