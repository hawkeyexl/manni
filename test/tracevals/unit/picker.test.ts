import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { pickTrace } from "../../../src/tracevals/trace/picker.js";
import { TracevalsError } from "../../../src/tracevals/types.js";

const fixtureHome = fileURLToPath(new URL("../fixtures/home", import.meta.url));

describe("pickTrace", () => {
  it("prompts with discovered traces and returns the selection", async () => {
    let seenChoices: { name: string; value: string }[] = [];
    const picked = await pickTrace(
      { allProjects: true, env: { MOOSE_TRACEVALS_HOME: fixtureHome } },
      async ({ choices }) => {
        seenChoices = choices;
        return choices[0]!.value;
      },
    );
    expect(seenChoices.length).toBe(2);
    expect(picked.endsWith(".jsonl")).toBe(true);
  });

  it("falls back to all projects when the current project has none", async () => {
    const picked = await pickTrace(
      {
        project: "C:\\work\\nonexistent",
        env: { MOOSE_TRACEVALS_HOME: fixtureHome },
      },
      async ({ choices }) => choices[0]!.value,
    );
    expect(picked.endsWith(".jsonl")).toBe(true);
  });

  it("errors operationally when nothing exists at all", async () => {
    await expect(
      pickTrace(
        {
          allProjects: true,
          env: { MOOSE_TRACEVALS_HOME: "C:\\definitely\\missing" },
        },
        async ({ choices }) => choices[0]!.value,
      ),
    ).rejects.toThrow(TracevalsError);
  });
});
