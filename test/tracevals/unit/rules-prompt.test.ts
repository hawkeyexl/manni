import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  RULES_PROMPT_VERSION,
  RULES_SCHEMA,
  RULES_SYSTEM_PROMPT,
  buildRulesUser,
  isValidRules,
} from "../../../src/tracevals/rules/prompt.js";
import { WHEN_CONDITIONS } from "../../../src/tracevals/graders/when.js";

describe("rules prompt", () => {
  /** Same pin as `FILL_PROMPT_VERSION`: the text and the version move together. */
  it("moves RULES_PROMPT_VERSION with the prompt surface", () => {
    const surface = [RULES_SYSTEM_PROMPT, JSON.stringify(RULES_SCHEMA)].join(
      "\n---\n",
    );
    const digest = createHash("sha256")
      .update(surface)
      .digest("hex")
      .slice(0, 12);
    expect({ version: RULES_PROMPT_VERSION, digest }).toEqual({
      version: 1,
      digest: "eeb89385f095",
    });
  });

  it("names every `when` condition the grammar accepts", () => {
    for (const name of WHEN_CONDITIONS) {
      expect(RULES_SYSTEM_PROMPT).toContain(`\`${name}\``);
    }
  });

  it("states what is not a rule", () => {
    expect(RULES_SYSTEM_PROMPT).toMatch(/end users/);
    expect(RULES_SYSTEM_PROMPT).toMatch(/examples/);
    expect(RULES_SYSTEM_PROMPT).toMatch(/quotes/);
    expect(RULES_SYSTEM_PROMPT).toContain("prefer boring code");
  });

  it("sends the whole file, however long", () => {
    const content = `- Run npm ci first.\n${"x".repeat(50_000)}\nlast line`;
    const user = buildRulesUser({ path: "CLAUDE.md", format: "markdown", content });
    expect(user).toContain("path: CLAUDE.md");
    expect(user).toContain("last line");
    expect(user).not.toContain("truncated");
  });

  it("validates the response shape", () => {
    expect(isValidRules({ rules: [] })).toBe(true);
    expect(
      isValidRules({
        rules: [
          { id: "ci-first", text: "Run npm ci first.", when: { "tool-used": "Bash" } },
        ],
      }),
    ).toBe(true);
    expect(isValidRules({ rules: [{ id: "x" }] })).toBe(false);
    expect(isValidRules({ rules: [], extra: 1 })).toBe(false);
    expect(isValidRules({})).toBe(false);
  });
});
