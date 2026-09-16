import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderList, runList } from "../../../src/tracevals/commands/list.js";

const fixtureHome = fileURLToPath(
  new URL("../fixtures/home", import.meta.url),
);

describe("runList", () => {
  it("returns discovered traces for --all-projects", async () => {
    const run = await runList({
      allProjects: true,
      env: { MOOSE_TRACEVALS_HOME: fixtureHome },
    });
    expect(run.traces.length).toBe(2);
    const ids = run.traces.map((t) => t.sessionId);
    expect(ids).toContain("11111111-1111-1111-1111-111111111111");
    expect(ids).toContain("22222222-2222-2222-2222-222222222222");
  });
});

describe("renderList", () => {
  it("renders one line per trace with prompt and project", async () => {
    const run = await runList({
      allProjects: true,
      env: { MOOSE_TRACEVALS_HOME: fixtureHome },
    });
    const out = renderList(run, { color: false });
    expect(out).toContain("Fix the crash in src/app.ts.");
    expect(out).toContain("C:\\work\\demo-project");
  });

  it("says so when nothing is found", () => {
    const out = renderList({ traces: [] }, { color: false });
    expect(out).toContain("No traces found");
  });
});
