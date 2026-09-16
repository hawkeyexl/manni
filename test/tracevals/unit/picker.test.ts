import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { pickTrace } from "../../../src/tracevals/trace/picker.js";
import { TracevalsError } from "../../../src/tracevals/types.js";
import { must } from "../helpers.js";

const claudeDir = fileURLToPath(new URL("../fixtures/home/.claude", import.meta.url));

describe("pickTrace", () => {
  it("prompts with discovered traces and returns the selection", async () => {
    let seenChoices: { name: string; value: string }[] = [];
    const picked = await pickTrace(
      { allProjects: true, env: { CLAUDE_CONFIG_DIR: claudeDir } },
      ({ choices }) => {
        seenChoices = choices;
        return Promise.resolve(must(choices[0], "the first choice").value);
      },
    );
    expect(seenChoices.length).toBe(2);
    expect(picked.endsWith(".jsonl")).toBe(true);
  });

  it("falls back to all projects when the current project has none", async () => {
    const picked = await pickTrace(
      {
        project: "C:\\work\\nonexistent",
        env: { CLAUDE_CONFIG_DIR: claudeDir },
      },
      ({ choices }) => Promise.resolve(must(choices[0], "the first choice").value),
    );
    expect(picked.endsWith(".jsonl")).toBe(true);
  });

  it("errors operationally when nothing exists at all", async () => {
    await expect(
      pickTrace(
        {
          allProjects: true,
          env: { CLAUDE_CONFIG_DIR: "C:\\definitely\\missing/.claude" },
        },
        ({ choices }) => Promise.resolve(must(choices[0], "the first choice").value),
      ),
    ).rejects.toThrow(TracevalsError);
  });
});
