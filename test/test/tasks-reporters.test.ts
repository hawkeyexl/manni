/**
 * `manni test tasks`'s pretty, json and github output (plan §4.8), on
 * reports built inline.
 */
import { describe, expect, it } from "vitest";
import type { TaskRun, TasksReport } from "../../src/test/commands/tasks.js";
import type { TaskEval } from "../../src/test/core/task-types.js";
import { renderTasks } from "../../src/test/reporters/tasks.js";

const AT = { file: "docs/src/content/docs/meta/fix/index.mdx", line: 1 };

const evals: TaskEval[] = [
  {
    id: "completed",
    grader: "ai",
    severity: "error",
    outcome: "fail",
    assertion: "The reader completed the task: make the docs check pass.",
    message: "The reader edited the file and stopped. No check ran after the edit.",
    location: AT,
    consensus: { votes: { pass: 0, fail: 3, partial: 0, error: 0 }, meanConfidence: 0.88 },
  },
  { id: "followed-the-docs", grader: "ai", severity: "warning", outcome: "pass", location: AT },
  {
    id: "constraint",
    grader: "ai",
    severity: "warning",
    outcome: "fail",
    assertion: "Reads only what the fix needs, never the full documentation.",
    message: "Opened the configuration reference.",
    location: { file: "docs/content-strategy/personas/theo.md", line: 12 },
    consensus: { votes: { pass: 0, fail: 3, partial: 0, error: 0 }, meanConfidence: 0.81 },
  },
];

const taskRun: TaskRun = {
  id: "20261023T140211Z-task-theo",
  journey: null,
  task: "The docs check on my pull request fails with: docs/install.md: must have required property 'description'. Make it pass.",
  persona: "theo",
  start: "docs/src/content/docs/meta/fix/index.mdx",
  workspace: "test/test/fixtures/tasks/red-pr",
  kept: null,
  trace: ".manni/test/tasks/20261023T140211Z-task-theo/trace.jsonl",
  turns: 9,
  durationMs: 91000,
  stoppedAtLimit: false,
  maxTurns: 50,
  usage: { inputTokens: 48211, outputTokens: 3120, costUsd: 0.21 },
  docs: ["meta/fix/index.mdx", "meta/reference/configuration.mdx"],
  changes: { added: [], changed: ["docs/install.md"], removed: [] },
  account: "The table on the fix page took me from the error to the field quickly.",
  evals,
  outcome: "fail",
};

const report: TasksReport = {
  runs: [taskRun],
  summary: { runs: 1, passed: 0, failed: 1, warnings: 1 },
  exitCode: 1,
};

describe("renderTasks: pretty", () => {
  it("prints a block per run and the total, with no derivation header", () => {
    expect(renderTasks(report, "pretty", { color: false })).toBe(
      [
        "task · The docs check on my pull request fails with: docs/install.m… · as theo",
        "  start     docs/src/content/docs/meta/fix/index.mdx",
        "  docs      meta/fix/index.mdx, meta/reference/configuration.mdx",
        "  changed   docs/install.md",
        "  9 turns · 1m 31s",
        "  FAIL completed             docs/src/content/docs/meta/fix/index.mdx:1",
        "       The reader completed the task: make the docs check pass.",
        "       AI judge: fail (confidence 0.88). The reader edited the file and",
        "       stopped. No check ran after the edit.",
        "  PASS followed-the-docs     docs/src/content/docs/meta/fix/index.mdx:1",
        "  WARN constraint            docs/content-strategy/personas/theo.md:12",
        "       Reads only what the fix needs, never the full documentation.",
        "       AI judge: fail (confidence 0.81). Opened the configuration reference.",
        "  Account",
        "    The table on the fix page took me from the error to the field quickly.",
        "  trace     .manni/test/tasks/20261023T140211Z-task-theo/trace.jsonl",
        "",
        "1 run: 0 passed, 1 failed · 1 warning",
      ].join("\n"),
    );
  });

  it("names a journey by its title, says where it stopped and what was kept, and drops zero counts", () => {
    const golden: TaskRun = {
      ...taskRun,
      journey: "t1",
      task: "Fix a failing metadata check fast",
      evals: [
        { id: "cost", grader: "cost", severity: "notice", outcome: "skipped", message: "no cost recorded", location: { file: "j.md", line: 3 } },
      ],
      changes: { added: ["a.md"], changed: [], removed: ["b.md"] },
      docs: [],
      stoppedAtLimit: true,
      kept: "/tmp/manni-task-1/workspace",
      outcome: "pass",
    };
    const out = renderTasks(
      { runs: [golden, { ...golden, persona: null }], summary: { runs: 2, passed: 2, failed: 0, warnings: 0 }, exitCode: 0 },
      "pretty",
      { color: false },
    );
    const lines = out.split("\n");
    expect(lines[0]).toBe("t1 · Fix a failing metadata check fast · as theo");
    expect(lines).toContain("  added     a.md");
    expect(lines).toContain("  removed   b.md");
    expect(out).not.toContain("derived");
    expect(lines).toContain("  SKIP cost     j.md:3");
    expect(lines).toContain("  stopped at the 50-turn limit");
    expect(lines).toContain("  kept      /tmp/manni-task-1/workspace");
    expect(lines).toContain("t1 · Fix a failing metadata check fast · as newcomer");
    expect(lines.at(-1)).toBe("2 runs: 2 passed");
  });

  it("prints NOTE, ERROR and REVIEW, and (no location) for a URL start", () => {
    const run: TaskRun = {
      ...taskRun,
      evals: [
        { id: "a", grader: "regex", severity: "notice", outcome: "fail", message: "m", location: null },
        { id: "b", grader: "command", severity: "error", outcome: "error", message: "boom", location: null },
        { id: "c", grader: "ai", severity: "error", outcome: "needs-review", location: null },
      ],
    };
    const lines = renderTasks({ ...report, runs: [run] }, "pretty", { color: false }).split("\n");
    expect(lines).toContain("  NOTE   a     (no location)");
    expect(lines).toContain("  ERROR  b     (no location)");
    expect(lines).toContain("  REVIEW c     (no location)");
  });

  it("says so when there is nothing to run", () => {
    const empty: TasksReport = { runs: [], summary: { runs: 0, passed: 0, failed: 0, warnings: 0 }, exitCode: 0 };
    expect(renderTasks(empty, "pretty", { color: false })).toBe("No tasks to run.");
  });
});

describe("renderTasks: json", () => {
  it("is the report in §4.8's shape", () => {
    const parsed = JSON.parse(renderTasks(report, "json", { color: false })) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(["runs", "summary", "exitCode"]);
    const [run] = parsed["runs"] as Record<string, unknown>[];
    expect(Object.keys(run ?? {})).toEqual([
      "id",
      "journey",
      "task",
      "persona",
      "start",
      "workspace",
      "kept",
      "trace",
      "turns",
      "durationMs",
      "stoppedAtLimit",
      "usage",
      "docs",
      "changes",
      "account",
      "evals",
      "outcome",
    ]);
    expect((run?.["evals"] as TaskEval[])[0]).toEqual(evals[0]);
    expect(parsed["summary"]).toEqual({ runs: 1, passed: 0, failed: 1, warnings: 1 });
  });
});

describe("renderTasks: github", () => {
  it("prints a workflow command per eval that did not pass, then the total", () => {
    expect(renderTasks(report, "github", { color: false }).split("\n")).toEqual([
      "::error file=docs/src/content/docs/meta/fix/index.mdx,line=1,title=manni test tasks::task as theo: completed failed. The reader edited the file and stopped. No check ran after the edit.",
      '::warning file=docs/content-strategy/personas/theo.md,line=12,title=manni test tasks::task as theo: constraint "Reads only what the fix needs, never the full documentation." not honored. Opened the configuration reference.',
      "1 run: 0 passed, 1 failed · 1 warning",
    ]);
  });

  it("drops file= with no location, and prints needs-review as an error", () => {
    const run: TaskRun = {
      ...taskRun,
      evals: [{ id: "c", grader: "ai", severity: "error", outcome: "needs-review", message: "unsure", location: null }],
    };
    expect(renderTasks({ ...report, runs: [run] }, "github", { color: false }).split("\n")[0]).toBe(
      "::error title=manni test tasks::task as theo: c needs review. unsure",
    );
  });
});
