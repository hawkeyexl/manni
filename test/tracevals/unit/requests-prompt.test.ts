import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { WHEN_CONDITIONS } from "../../../src/tracevals/graders/when.js";
import { RULES_SCHEMA } from "../../../src/tracevals/rules/prompt.js";
import {
  REQUIREMENTS_PROMPT_VERSION,
  REQUIREMENTS_SYSTEM_PROMPT,
  buildRequirementsUser,
} from "../../../src/tracevals/rules/requests-prompt.js";

describe("requirements prompt", () => {
  /** Same pin as `RULES_PROMPT_VERSION`: the text and the version move together. */
  it("moves REQUIREMENTS_PROMPT_VERSION with the prompt surface", () => {
    const surface = [REQUIREMENTS_SYSTEM_PROMPT, JSON.stringify(RULES_SCHEMA)].join("\n---\n");
    const digest = createHash("sha256").update(surface).digest("hex").slice(0, 12);
    expect({ version: REQUIREMENTS_PROMPT_VERSION, digest }).toEqual({
      version: 1,
      digest: "b1c06b24f924",
    });
  });

  it("names every `when` condition the grammar accepts", () => {
    for (const name of WHEN_CONDITIONS) {
      expect(REQUIREMENTS_SYSTEM_PROMPT).toContain(`\`${name}\``);
    }
  });

  it("keeps a spec's own ids, and reads prompts as the set that stands now", () => {
    for (const id of ["FR-001", "T014", "1.2"]) expect(REQUIREMENTS_SYSTEM_PROMPT).toContain(id);
    expect(REQUIREMENTS_SYSTEM_PROMPT).toMatch(/later prompt can/);
    expect(REQUIREMENTS_SYSTEM_PROMPT).toMatch(/question/);
    expect(REQUIREMENTS_SYSTEM_PROMPT).toMatch(/chat/);
  });

  it("sends the whole source, with its path and format", () => {
    const content = `1. Add a toggle.\n${"x".repeat(50_000)}\nlast line`;
    const user = buildRequirementsUser({ path: "prompt", format: "prompt", content });
    expect(user).toContain("path: prompt");
    expect(user).toContain("format: prompt");
    expect(user).toContain("last line");
  });
});
