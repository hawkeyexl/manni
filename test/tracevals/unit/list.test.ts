import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renderList, runList } from "../../../src/tracevals/commands/list.js";

const claudeDir = fileURLToPath(
  new URL("../fixtures/home/.claude", import.meta.url),
);

describe("runList", () => {
  it("returns discovered traces for --all-projects", async () => {
    const run = await runList({
      allProjects: true,
      env: { CLAUDE_CONFIG_DIR: claudeDir },
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
      env: { CLAUDE_CONFIG_DIR: claudeDir },
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

/**
 * `list --newer-than` keeps the traces `run --newer-than` would evaluate, so
 * a reader can see the selection before paying for it.
 */
describe("runList --newer-than", () => {
  let storeRoot: string;
  const DAY = 86_400_000;

  beforeAll(async () => {
    storeRoot = await mkdtemp(join(tmpdir(), "manni-tracevals-list-newer-"));
    const proj = join(storeRoot, ".claude", "projects", "C--work-demo");
    await mkdir(proj, { recursive: true });
    for (const [i, days] of [1, 30].entries()) {
      const file = join(proj, `s${String(i)}.jsonl`);
      const record = {
        type: "user",
        sessionId: `s${String(i)}`,
        cwd: "/w",
        message: { role: "user", content: "hi" },
      };
      await writeFile(file, JSON.stringify(record) + "\n", "utf-8");
      const at = new Date(Date.now() - days * DAY);
      await utimes(file, at, at);
    }
  });

  afterAll(async () => {
    await rm(storeRoot, { recursive: true, force: true });
  });

  it("lists only the traces modified inside the window", async () => {
    const run = await runList({
      allProjects: true,
      newerThan: "7d",
      env: { CLAUDE_CONFIG_DIR: join(storeRoot, ".claude") },
    });
    expect(run.traces.map((t) => t.sessionId)).toEqual(["s0"]);
  });

  it("lists every trace without it", async () => {
    const run = await runList({
      allProjects: true,
      env: { CLAUDE_CONFIG_DIR: join(storeRoot, ".claude") },
    });
    expect(run.traces).toHaveLength(2);
  });
});
