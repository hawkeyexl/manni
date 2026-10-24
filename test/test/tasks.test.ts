/**
 * The `manni test tasks` command core, with Claude Code replaced by a fake
 * spawn that replays a recorded stream and the judge by a fake that returns
 * the evals a test names. The repo is `fixtures/tasks/repo`, copied fresh for
 * each test: a docs collection, a strategy collection holding journeys t1
 * (golden) and m1, and personas theo and maya.
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExecResult } from "@hawkeyexl/inference";
import { runTasks, type RunTasksOptions } from "../../src/test/commands/tasks.js";
import type { ClaudeCodeSpawn } from "../../src/test/core/claude-code.js";
import type { JudgeRun, RunEvidence, TaskEval } from "../../src/test/core/task-types.js";
import { TestError } from "../../src/test/errors.js";
import { recordedStream } from "./task-run.js";

// The real `rm`, wrapped so one test can make it fail the way Windows does
// when a process the synthetic user started still holds a file.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, rm: vi.fn(actual.rm) };
});
const { rm } = await import("node:fs/promises");

const REPO = join(import.meta.dirname, "fixtures", "tasks", "repo");

interface Call {
  args: string[];
  cwd: string;
  stdin: string;
  env: Record<string, string | undefined>;
  /** What the run's temp directory held while Claude Code ran. */
  tree: string[];
}

let cwd: string;
let calls: Call[];
let judged: RunEvidence[];
let stderr: string[];

beforeEach(() => {
  cwd = realpathSync.native(mkdtempSync(join(tmpdir(), "manni-test-tasks-")));
  cpSync(REPO, cwd, { recursive: true });
  calls = [];
  judged = [];
  stderr = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
    stderr.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(cwd, { recursive: true, force: true });
});

function walk(dir: string, prefix = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name), `${prefix}${e.name}/`) : [`${prefix}${e.name}`],
  );
}

/**
 * A fake Claude Code: replays `fixture` with `__RUN__` as its temp directory,
 * after `edit` has had the workspace.
 */
function fakeSpawn(
  fixture = "stream-pass.jsonl",
  extra: Partial<ExecResult> = {},
  edit?: (workspace: string) => void,
): ClaudeCodeSpawn {
  return (args, opts) => {
    const root = dirname(opts.cwd);
    calls.push({ args, cwd: opts.cwd, stdin: opts.stdin, env: opts.env, tree: walk(root).sort() });
    edit?.(opts.cwd);
    const stdout = extra.spawnError === undefined ? recordedStream(fixture, root) : "";
    // Two chunks split mid-line, as a pipe delivers them.
    const half = Math.floor(stdout.length / 2);
    opts.onStdout(stdout.slice(0, half));
    opts.onStdout(stdout.slice(half));
    return Promise.resolve({ code: 0, stdout, stderr: "", timedOut: false, ...extra });
  };
}

const passEval = (id: string, over: Partial<TaskEval> = {}): TaskEval => ({
  id,
  grader: "ai",
  severity: "error",
  outcome: "pass",
  location: null,
  ...over,
});

/** A fake judge: every golden eval passes, and a run with none gets `completed`. */
function fakeJudge(extra: TaskEval[] = []): JudgeRun {
  return (evidence) => {
    judged.push(evidence);
    // The docs copy is still on disk while the judge reads it.
    expect(evidence.startCopy === null || existsSync(evidence.startCopy)).toBe(true);
    const golden = evidence.spec.journey?.evals.map((e) => passEval(e.entry.id, { grader: e.entry.grader })) ?? [];
    const evals = golden.length > 0 ? golden : [passEval("completed", { assertion: "The reader completed the task." })];
    return Promise.resolve({ evals: [...evals, ...extra], docs: ["fix/index.md"] });
  };
}

function run(opts: RunTasksOptions = {}, judge: JudgeRun = fakeJudge()) {
  return runTasks({
    cwd,
    spawn: fakeSpawn(),
    judge,
    now: () => new Date("2026-10-23T14:02:11.500Z"),
    ...opts,
  });
}

const TASK = "The docs check fails. Make it pass.";

describe("runTasks: a plain-text task from a page", () => {
  it("runs one newcomer in an empty workspace beside a copy of the page's collection", async () => {
    const report = await run({ targets: ["docs/fix/index.md"], task: TASK });
    expect(report.runs).toHaveLength(1);
    const [call] = calls;
    expect(call?.cwd.endsWith("workspace")).toBe(true);
    expect(call?.tree).toEqual(["docs/fix/index.md", "docs/reference/config.md", "role.md"]);
    expect(call?.stdin).toBe(`${TASK}\nStart here: ../docs/fix/index.md\n`);
    const spec = judged[0]?.spec;
    expect(spec?.journey).toBeNull();
    expect(spec?.persona).toBeNull();
    expect(spec?.start).toEqual({ kind: "path", display: "docs/fix/index.md", abs: join(cwd, "docs", "fix", "index.md") });
    const role = readFileSync(join(cwd, ".manni", "test", "tasks", "20261023T140211Z-task-newcomer", "role.md"), "utf8");
    expect(role).toContain("Who you are:\nSomeone new to this product, with the task below and no other context.\n");
  });

  it("gives Claude Code the docs copy, the role prompt and the run's npm prefix", async () => {
    await run({ targets: ["docs/fix/index.md"], task: TASK });
    const call = calls[0];
    const root = dirname(call?.cwd ?? "");
    expect(call?.args[call.args.indexOf("--add-dir") + 1]).toBe(join(root, "docs"));
    expect(call?.args[call.args.indexOf("--append-system-prompt-file") + 1]).toBe(join(root, "role.md"));
    expect(call?.args[call.args.indexOf("--max-turns") + 1]).toBe("50");
    expect(call?.env["NPM_CONFIG_PREFIX"]).toBe(join(root, "global"));
  });

  it("starts at a URL with no docs copy", async () => {
    await run({ targets: ["http://127.0.0.1:4321/manni/"], task: TASK });
    expect(calls[0]?.stdin).toBe(`${TASK}\nStart here: http://127.0.0.1:4321/manni/\n`);
    expect(calls[0]?.args).not.toContain("--add-dir");
    expect(calls[0]?.tree).toEqual(["role.md"]);
  });

  it("copies the page's own directory when no collection holds it", async () => {
    writeFileSync(join(cwd, "loose.md"), "# Loose\n");
    rmSync(join(cwd, "manni.config.yaml"));
    await run({ targets: ["loose.md"], task: TASK });
    expect(calls[0]?.stdin).toContain("Start here: ../docs/loose.md");
  });

  it("copies --workspace fresh and plays each --persona", async () => {
    const report = await run({ targets: ["docs/fix/index.md"], task: TASK, workspace: "seed", personas: ["theo", "maya"] });
    expect(report.runs.map((r) => r.persona)).toEqual(["theo", "maya"]);
    expect(calls.map((c) => c.tree.filter((p) => p.startsWith("workspace/")))).toEqual([
      ["workspace/docs/install.md"],
      ["workspace/docs/install.md"],
    ]);
    expect(report.runs[0]?.workspace).toBe("seed");
    // Two runs in one second get distinct ids.
    expect(report.runs.map((r) => r.id)).toEqual(["20261023T140211Z-task-theo", "20261023T140211Z-task-maya"]);
  });
});

describe("runTasks: journeys", () => {
  it("takes the task, start, persona and workspace from the journey", async () => {
    const report = await run({ journeys: ["t1"] });
    const [only] = report.runs;
    expect(only).toMatchObject({ journey: "t1", persona: "theo", start: "docs/fix/index.md", workspace: "seed" });
    expect(calls[0]?.stdin).toBe(
      [
        "Fix a failing metadata check fast",
        "What started this: The docs check failed with: docs/install.md: must have required property 'description'",
        "You're done when: The check passes, and the only change is the missing field.",
        "Start here: ../docs/fix/index.md",
        "",
      ].join("\n"),
    );
    const journey = judged[0]?.spec.journey;
    expect(journey?.evals.map((e) => [e.entry.id, e.entry.grader, e.location])).toEqual([
      ["field-added", "regex", { file: "strategy/journeys/t1.md", line: 12 }],
      ["confirmed-locally", "tool-order", { file: "strategy/journeys/t1.md", line: 17 }],
    ]);
    expect(journey?.successCriteria?.location).toEqual({ file: "strategy/journeys/t1.md", line: 9 });
    expect(journey?.titleLocation).toEqual({ file: "strategy/journeys/t1.md", line: 4 });
  });

  it("tells the synthetic user the persona's fields and never its body", async () => {
    await run({ journeys: ["t1"] });
    const role = readFileSync(join(cwd, ".manni", "test", "tasks", "20261023T140211Z-t1-theo", "role.md"), "utf8");
    expect(role).toContain(
      [
        "Who you are:",
        "Theo, Doc Contributor. Theo is a developer who opened a PR.",
        "Role: Developer",
        "Wants:",
        "- Fix the field his check named and move on.",
        "Frustrated by:",
        "- He doesn't know which schema fired.",
        "Your constraints:",
        "- Reads only what the fix needs.",
        "- Won't install anything globally.",
        "",
        "How to work:",
      ].join("\n"),
    );
    expect(role).not.toContain("SECRET-BODY");
    expect(judged[0]?.spec.persona?.constraints).toEqual([
      { text: "Reads only what the fix needs.", location: { file: "strategy/personas/theo.md", line: 13 } },
      { text: "Won't install anything globally.", location: { file: "strategy/personas/theo.md", line: 14 } },
    ]);
  });

  it("runs every combination of start, task and persona, one after another", async () => {
    const report = await run({
      targets: ["docs/fix/index.md", "docs/reference/config.md"],
      journeys: ["t1"],
      personas: ["theo", "maya"],
    });
    expect(report.runs.map((r) => `${r.start} ${r.persona ?? ""}`)).toEqual([
      "docs/fix/index.md theo",
      "docs/fix/index.md maya",
      "docs/reference/config.md theo",
      "docs/reference/config.md maya",
    ]);
  });

  it("runs the golden set, every journey declaring evals:, when nothing is named", async () => {
    const report = await run();
    expect(report.runs.map((r) => r.journey)).toEqual(["t1"]);
  });

  it("lets --workspace replace the journey's", async () => {
    writeFileSync(join(cwd, "other.md"), "x");
    await run({ journeys: ["t1"], workspace: "docs" });
    expect(calls[0]?.tree.filter((p) => p.startsWith("workspace/"))).toEqual([
      "workspace/fix/index.md",
      "workspace/reference/config.md",
    ]);
  });
});

describe("runTasks: messages", () => {
  const refuses = async (opts: RunTasksOptions, message: string): Promise<void> => {
    await expect(run(opts)).rejects.toThrow(new TestError(message));
    expect(calls).toHaveLength(0);
  };

  it.each<[string, RunTasksOptions, string]>([
    ["stdin", { targets: ["-"], task: TASK }, "manni test tasks reads no stdin. Pass a page path or URL."],
    ["task and journey", { targets: ["docs/fix/index.md"], task: TASK, journeys: ["t1"] }, "--task and --journey both name the task. Pass one."],
    ["task with no start", { task: TASK }, "--task needs a page or URL to start from."],
    ["start with no task", { targets: ["docs/fix/index.md"] }, 'a start page needs a task. Pass --task "<what the reader wants>" or --journey <id>.'],
    [
      "missing page",
      { targets: ["docs/nope.md"], task: TASK },
      'File not found: "docs/nope.md". Check the path. Named paths resolve from the working directory.',
    ],
    ["missing --workspace", { targets: ["docs/fix/index.md"], task: TASK, workspace: "test/x" }, '--workspace "test/x" does not exist.'],
    ["unknown id", { journeys: ["t9"] }, 'no record "t9". 4 records; did you mean "t1"?'],
    ["a persona as --journey", { journeys: ["theo"] }, '"theo" is a persona; --journey takes a journey.'],
    ["a journey as --persona", { journeys: ["t1"], personas: ["m1"] }, '"m1" is a journey; --persona takes a persona.'],
    [
      "no entry-point",
      { journeys: ["m1"] },
      'journey "m1" has no entry-point:. Add one to strategy/journeys/m1.md, or pass the page to start from.',
    ],
  ])("refuses %s", async (_label, opts, message) => {
    await refuses(opts, message);
  });

  const journey = (front: string): void => {
    writeFileSync(join(cwd, "strategy", "journeys", "t3.md"), `---\ntype: journey\nid: t3\ntitle: T3\n${front}---\n`);
  };

  it("refuses a journey naming a persona with no record", async () => {
    journey("personas: [tim]\nentry-point: docs/fix/index.md\n");
    await refuses({ journeys: ["t3"] }, 'journey "t3" names persona "tim", which has no record.');
  });

  it("refuses a journey entry-point that does not exist", async () => {
    journey("entry-point: docs/gone.md\n");
    await refuses({ journeys: ["t3"] }, 'strategy/journeys/t3.md:5: entry-point "docs/gone.md" does not exist.');
  });

  it("refuses a journey workspace that does not exist", async () => {
    journey("entry-point: docs/fix/index.md\nworkspace: test/x\n");
    await refuses({ journeys: ["t3"] }, 'strategy/journeys/t3.md:6: workspace "test/x" does not exist.');
  });

  // A seed that moved is recovered by naming the new one, not by editing the record first.
  it("lets --workspace stand in for a journey workspace that does not exist", async () => {
    journey("entry-point: docs/fix/index.md\nworkspace: test/x\n");
    const report = await run({ journeys: ["t3"], workspace: "seed" });
    expect(report.runs[0]?.workspace).toBe("seed");
  });

  it("lets a page target stand in for a journey entry-point that does not exist", async () => {
    journey("entry-point: docs/gone.md\n");
    const report = await run({ targets: ["docs/fix/index.md"], journeys: ["t3"] });
    expect(report.runs[0]?.start).toBe("docs/fix/index.md");
  });

  it.each<[string, string, string]>([
    [
      "a grader that cannot grade a task",
      "evals:\n  - id: a\n    assertion: A.\n  - id: b\n    assertion: B.\n    grader: human\n",
      'strategy/journeys/t3.md:11: evals[1].grader "human" cannot grade a task. Use ai, command, regex, file-access, tool-usage, tool-order, turn-count or cost.',
    ],
    ["an eval with no id", "evals:\n  - assertion: A.\n", "strategy/journeys/t3.md:7: evals[0] needs an id."],
    [
      "a repeated id",
      "evals:\n  - id: a\n    assertion: A.\n  - id: a\n    assertion: B.\n",
      'strategy/journeys/t3.md:9: evals[1].id "a" repeats evals[0].',
    ],
    [
      "options the grader refuses",
      "evals:\n  - id: a\n    grader: tool-order\n    options: { before: Edit }\n",
      "strategy/journeys/t3.md:9: evals[0] options.after is required",
    ],
  ])("refuses %s", async (_label, front, message) => {
    journey(`entry-point: docs/fix/index.md\n${front}`);
    await refuses({ journeys: ["t3"] }, message);
  });

  it("refuses an entry the artifact-evals vocabulary refuses, at its line", async () => {
    journey("entry-point: docs/fix/index.md\nevals:\n  - id: a\n    assertion: A.\n    severity: loud\n");
    await expect(run({ journeys: ["t3"] })).rejects.toThrow(/^strategy\/journeys\/t3\.md:9: evals\[0\]\.severity /);
  });

  it("refuses a bare run with an empty golden set, or passes it under --allow-empty", async () => {
    rmSync(join(cwd, "strategy", "journeys", "t1.md"));
    await refuses({}, "nothing to run: no journey declares evals:. Pass --task with a page or URL, or --journey <id>.");
    expect(await run({ allowEmpty: true })).toEqual({
      runs: [],
      summary: { runs: 0, passed: 0, failed: 0, warnings: 0 },
      exitCode: 0,
    });
  });

  it("refuses a test: section and a missing mcpConfig", async () => {
    writeFileSync(join(cwd, "manni.config.yaml"), "test:\n  x: 1\n");
    await refuses(
      { journeys: ["t1"] },
      "manni.config.yaml: test has no keys. Doc Detective's settings live under tools.doc-detective, and Claude Code's under tools.claude-cli.",
    );
    writeFileSync(join(cwd, "manni.config.yaml"), "tools:\n  claude-cli:\n    mcpConfig: .mcp.tasks.json\n");
    await refuses(
      { targets: ["docs/fix/index.md"], task: TASK },
      'manni.config.yaml: tools.claude-cli.mcpConfig ".mcp.tasks.json" does not exist.',
    );
  });

  it("says Claude Code is missing, and when it stopped without a result", async () => {
    await expect(
      run({ targets: ["docs/fix/index.md"], task: TASK, spawn: fakeSpawn("stream-pass.jsonl", { spawnError: "ENOENT" }) }),
    ).rejects.toThrow(
      "Claude Code is not on PATH. Install it with npm install -g @anthropic-ai/claude-code, sign in, and run again.",
    );
    await expect(run({ journeys: ["t1"], spawn: fakeSpawn("stream-signed-out.jsonl", { code: 1 }) })).rejects.toThrow(
      "Claude Code stopped without a result for t1 as theo: Not logged in · Please run /login",
    );
  });
});

describe("runTasks: config", () => {
  it("passes tools.claude-cli's model, turn limit and MCP servers", async () => {
    writeFileSync(
      join(cwd, "manni.config.yaml"),
      "tools:\n  claude-cli:\n    model: sonnet\n    maxTurns: 7\n    mcpConfig: .mcp.tasks.json\n",
    );
    writeFileSync(join(cwd, ".mcp.tasks.json"), JSON.stringify({ mcpServers: { playwright: { command: "npx" } } }));
    await run({ targets: ["docs/fix/index.md"], task: TASK });
    const args = calls[0]?.args ?? [];
    expect(args[args.indexOf("--model") + 1]).toBe("sonnet");
    expect(args[args.indexOf("--max-turns") + 1]).toBe("7");
    expect(args[args.indexOf("--mcp-config") + 1]).toBe(join(cwd, ".mcp.tasks.json"));
    expect(args[args.indexOf("--allowedTools") + 1]).toMatch(/,mcp__playwright$/);
  });

  it("hands the judge its flags and the config's providers", async () => {
    writeFileSync(join(cwd, "manni.config.yaml"), "providers:\n  provider: mock\n");
    let seen: unknown;
    await run({
      targets: ["docs/fix/index.md"],
      task: TASK,
      provider: "anthropic",
      model: "m",
      judge: (evidence, options) => {
        seen = options;
        return fakeJudge()(evidence, options);
      },
    });
    expect(seen).toMatchObject({ provider: "anthropic", model: "m", providers: { provider: "mock" } });
  });
});

describe("runTasks: the report", () => {
  it("reports the run from its stream, its workspace and its judge", async () => {
    const report = await run({
      journeys: ["t1"],
      spawn: fakeSpawn("stream-pass.jsonl", {}, (ws) => {
        writeFileSync(join(ws, "docs", "install.md"), "---\ntitle: x\ndescription: y\n---\n");
        writeFileSync(join(ws, "notes.txt"), "n");
      }),
    });
    const [only] = report.runs;
    expect(only).toMatchObject({
      id: "20261023T140211Z-t1-theo",
      task: "Fix a failing metadata check fast",
      kept: null,
      trace: ".manni/test/tasks/20261023T140211Z-t1-theo/trace.jsonl",
      turns: 7,
      durationMs: 28426,
      stoppedAtLimit: false,
      docs: ["fix/index.md"],
      changes: { added: ["notes.txt"], changed: ["docs/install.md"], removed: [] },
      outcome: "pass",
    });
    expect(only?.usage.costUsd).toBeCloseTo(0.160573);
    expect(only?.account).toMatch(/^It passes now\./);
    expect(report.summary).toEqual({ runs: 1, passed: 1, failed: 0, warnings: 0 });
    expect(report.exitCode).toBe(0);
  });

  it("saves the stream as it arrived, and the prompts", async () => {
    await run({ targets: ["docs/fix/index.md"], task: TASK });
    const dir = join(cwd, ".manni", "test", "tasks", "20261023T140211Z-task-newcomer");
    expect(readdirSync(dir).sort()).toEqual(["brief.md", "role.md", "trace.jsonl"]);
    expect(readFileSync(join(dir, "trace.jsonl"), "utf8")).toBe(recordedStream("stream-pass.jsonl", dirname(calls[0]?.cwd ?? "")));
    expect(readFileSync(join(dir, "brief.md"), "utf8")).toBe(calls[0]?.stdin);
  });

  it("writes no derived.json, for a write-in task or a journey", async () => {
    await run({ targets: ["docs/fix/index.md"], task: TASK });
    await run({ journeys: ["t1"] });
    const root = join(cwd, ".manni", "test", "tasks");
    for (const name of readdirSync(root)) {
      expect(existsSync(join(root, name, "derived.json"))).toBe(false);
    }
  });

  it("judges a run stopped at the turn limit, and says so", async () => {
    const report = await run({ journeys: ["t1"], spawn: fakeSpawn("stream-max-turns.jsonl", { code: 1 }) });
    expect(report.runs[0]).toMatchObject({ stoppedAtLimit: true, maxTurns: 50, durationMs: 10749 });
    expect(judged).toHaveLength(1);
  });

  it.each<[string, Partial<TaskEval>, "pass" | "fail", number]>([
    ["an error eval that failed", { outcome: "fail" }, "fail", 0],
    ["an error eval that errored", { outcome: "error" }, "fail", 0],
    ["an error eval that needs review", { outcome: "needs-review" }, "fail", 0],
    ["a warning eval that failed", { outcome: "fail", severity: "warning" }, "pass", 1],
    ["a skipped eval", { outcome: "skipped" }, "pass", 0],
  ])("decides the outcome on %s", async (_label, over, outcome, warnings) => {
    const report = await run({ journeys: ["t1"] }, fakeJudge([passEval("extra", over)]));
    expect(report.runs[0]?.outcome).toBe(outcome);
    expect(report.summary).toEqual({
      runs: 1,
      passed: outcome === "pass" ? 1 : 0,
      failed: outcome === "pass" ? 0 : 1,
      warnings,
    });
    expect(report.exitCode).toBe(outcome === "pass" ? 0 : 1);
  });

  it("removes the run's temp directory, or keeps it and says where under --keep", async () => {
    await run({ journeys: ["t1"] });
    expect(existsSync(dirname(calls[0]?.cwd ?? ""))).toBe(false);

    const report = await run({ journeys: ["t1"], keep: true });
    const kept = report.runs[0]?.kept ?? "";
    expect(kept).toBe(calls[1]?.cwd);
    expect(existsSync(join(kept, "docs", "install.md"))).toBe(true);
    expect(stderr).toContain(`manni: kept t1 as theo's workspace: ${kept}\n`);
    rmSync(dirname(kept), { recursive: true, force: true });
  });

  it("streams each action to stderr under --progress", async () => {
    await run({ journeys: ["t1"], progress: true });
    const lines = stderr.join("").split("\n");
    expect(lines[0]).toBe("t1 as theo: starting in a fresh copy of seed");
    expect(lines[1]).toBe("  theo › Read ../docs/meta/fix/index.mdx");
    expect(lines[2]).toBe("  theo › Bash find . -maxdepth 3 -not -path '*/node_modules*' | head -50");
    expect(lines.filter((l) => l.startsWith("  theo › "))).toHaveLength(6);

    stderr.length = 0;
    await run({ targets: ["docs/fix/index.md"], task: TASK, progress: true });
    expect(stderr.join("").split("\n")[0]).toBe("task as newcomer: starting in an empty directory");
  });

  it("says nothing on stderr without --progress", async () => {
    await run({ journeys: ["t1"] });
    expect(stderr).toEqual([]);
  });

  // Two processes started in the same second must never share a run directory,
  // or their streams interleave in one trace.jsonl.
  it("gives runs started in the same second their own directories, even at once", async () => {
    const [a, b] = await Promise.all([run({ journeys: ["t1"] }), run({ journeys: ["t1"] })]);
    const ids = [a.runs[0]?.id, b.runs[0]?.id];
    expect(new Set(ids).size).toBe(2);
    expect(ids.sort()).toEqual(["20261023T140211Z-t1-theo", "20261023T140211Z-t1-theo-2"]);
  });

  // The Doc Detective stress test lost a whole report this way: a browser the
  // synthetic user started still held the run's npm prefix when manni cleaned up.
  it("keeps the report and warns when the run's temp directory cannot be removed", async () => {
    const busy = Object.assign(new Error("EBUSY: resource busy or locked, rmdir 'global'"), { code: "EBUSY" });
    vi.mocked(rm).mockRejectedValueOnce(busy);
    const report = await run({ journeys: ["t1"] });
    expect(report.runs[0]?.outcome).toBe("pass");
    const root = dirname(calls[0]?.cwd ?? "");
    expect(stderr).toContain(
      `manni: could not remove ${root} after t1 as theo: EBUSY: resource busy or locked, rmdir 'global'. ` +
        "A process the synthetic user started may still hold it; remove it by hand.\n",
    );
    rmSync(root, { recursive: true, force: true });
  });
});
