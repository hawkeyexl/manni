import { utimes } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  configDir,
  discoverTraces,
  slugFor,
} from "../../../src/tracevals/trace/discover.js";

const claudeDir = fileURLToPath(
  new URL("../fixtures/home/.claude", import.meta.url),
);
const demoTrace = fileURLToPath(
  new URL(
    "../fixtures/home/.claude/projects/C--work-demo-project/11111111-1111-1111-1111-111111111111.jsonl",
    import.meta.url,
  ),
);
const otherTrace = fileURLToPath(
  new URL(
    "../fixtures/home/.claude/projects/C--work-other-project/22222222-2222-2222-2222-222222222222.jsonl",
    import.meta.url,
  ),
);

describe("slugFor", () => {
  it("maps every non-alphanumeric character to a dash", () => {
    // Pinned against real observed session-store directory names.
    expect(
      slugFor(
        "C:\\Users\\hawkeyexl\\Documents\\Workspaces\\moose-tracevals\\.claude\\worktrees\\agent-evals-rework-5306e7",
      ),
    ).toBe(
      "C--Users-hawkeyexl-Documents-Workspaces-moose-tracevals--claude-worktrees-agent-evals-rework-5306e7",
    );
    expect(slugFor("C:\\Users\\hawkeyexl\\Documents\\Workspaces\\doc-detective")).toBe(
      "C--Users-hawkeyexl-Documents-Workspaces-doc-detective",
    );
  });

  it("handles POSIX paths", () => {
    expect(slugFor("/home/user/my.project")).toBe("-home-user-my-project");
  });
});

describe("configDir", () => {
  it("prefers CLAUDE_CONFIG_DIR when set", () => {
    expect(configDir({ CLAUDE_CONFIG_DIR: claudeDir })).toBe(claudeDir);
  });

  it("resolves a relative CLAUDE_CONFIG_DIR against the cwd", () => {
    const relative = "test/tracevals/fixtures/home/.claude";
    const resolved = configDir({ CLAUDE_CONFIG_DIR: relative });
    expect(isAbsolute(resolved)).toBe(true);
    expect(resolved).toBe(resolve(relative));
  });

  it("falls back to .claude under the OS home when it is unset", () => {
    expect(configDir({})).toBe(join(homedir(), ".claude"));
  });
});

describe("discoverTraces", () => {
  it("scans all projects, newest first", async () => {
    // mtimes are not preserved by git; set them explicitly.
    await utimes(demoTrace, new Date("2026-07-01"), new Date("2026-07-01"));
    await utimes(otherTrace, new Date("2026-07-02"), new Date("2026-07-02"));
    const traces = await discoverTraces({
      allProjects: true,
      env: { CLAUDE_CONFIG_DIR: claudeDir },
    });
    expect(traces).toHaveLength(2);
    expect(traces[0]?.sessionId).toBe("22222222-2222-2222-2222-222222222222");
    expect(traces[1]?.sessionId).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("scopes to one project via its cwd", async () => {
    const traces = await discoverTraces({
      project: "C:\\work\\demo-project",
      env: { CLAUDE_CONFIG_DIR: claudeDir },
    });
    expect(traces).toHaveLength(1);
    expect(traces[0]?.project).toBe("C:\\work\\demo-project");
    expect(traces[0]?.firstPrompt).toBe("Fix the crash in src/app.ts.");
  });

  it("applies the limit after sorting", async () => {
    const traces = await discoverTraces({
      allProjects: true,
      limit: 1,
      env: { CLAUDE_CONFIG_DIR: claudeDir },
    });
    expect(traces).toHaveLength(1);
  });

  it("returns an empty list for a project with no sessions", async () => {
    const traces = await discoverTraces({
      project: "C:\\work\\nonexistent",
      env: { CLAUDE_CONFIG_DIR: claudeDir },
    });
    expect(traces).toEqual([]);
  });
});
