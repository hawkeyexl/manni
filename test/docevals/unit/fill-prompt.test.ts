import { describe, it, expect } from "vitest";
import { Ajv2020 } from "ajv/dist/2020.js";
import {
  FILL_SYSTEM_PROMPT,
  PROPOSAL_SCHEMA,
  buildFillUser,
} from "../../../src/docevals/fill/prompt.js";

const ajv = new Ajv2020({ allErrors: true });
const validate = ajv.compile(PROPOSAL_SCHEMA as Record<string, unknown>);

const GOOD_EVAL = {
  id: "has-overview",
  assertion: "The page opens with an overview.",
  confidence: 0.9,
  examples: { pass: "Overview present.", fail: "No overview." },
};

describe("buildFillUser", () => {
  it("includes the page path, max count, and existing evals", () => {
    const user = buildFillUser(
      "docs/page.mdx",
      "body text",
      [{ id: "existing-check", assertion: "Something holds." }],
      3,
    );
    expect(user).toContain("docs/page.mdx");
    expect(user).toContain("3");
    expect(user).toContain("existing-check");
    expect(user).toContain("Something holds.");
    expect(user).toContain("body text");
  });

  it("says none when the page has no evals", () => {
    const user = buildFillUser("docs/page.mdx", "body", [], 3);
    expect(user).toMatch(/\(none\)/);
  });

  it("sends the whole body, however long", () => {
    // The old behavior truncated at 6000 characters and appended a marker, so
    // a long page was filled from its first half with nothing to say so. Long
    // pages are split across calls now; the prompt builder never drops bytes.
    const body = "x".repeat(20000);
    const user = buildFillUser("docs/page.mdx", body, [], 3);
    expect(user).toContain(body);
    expect(user).not.toContain("(truncated)");
  });

  it("names the part when a page was split", () => {
    const user = buildFillUser("docs/page.mdx", "body", [], 3, {
      index: 1,
      total: 3,
    });
    expect(user).toContain("part 2 of 3");
  });
});

describe("PROPOSAL_SCHEMA", () => {
  it("accepts a valid proposal", () => {
    expect(validate({ evals: [GOOD_EVAL] })).toBe(true);
    expect(validate({ evals: [] })).toBe(true);
  });

  it("rejects a proposal missing confidence or examples", () => {
    const { confidence: _c, ...noConfidence } = GOOD_EVAL;
    expect(validate({ evals: [noConfidence] })).toBe(false);
    const { examples: _e, ...noExamples } = GOOD_EVAL;
    expect(validate({ evals: [noExamples] })).toBe(false);
  });

  it("rejects bad names, out-of-range confidence, and stray keys", () => {
    expect(validate({ evals: [{ ...GOOD_EVAL, id: "Bad_Name" }] })).toBe(false);
    expect(validate({ evals: [{ ...GOOD_EVAL, confidence: 1.5 }] })).toBe(false);
    expect(validate({ evals: [{ ...GOOD_EVAL, grader: "command" }] })).toBe(false);
  });
});

describe("FILL_SYSTEM_PROMPT", () => {
  it("demands honest confidence and allows proposing nothing", () => {
    expect(FILL_SYSTEM_PROMPT).toMatch(/confidence/i);
    expect(FILL_SYSTEM_PROMPT).toMatch(/nothing/i);
  });
});
