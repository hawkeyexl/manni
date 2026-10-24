/**
 * `manni test procedures` against the built `dist/cli.js` and a real Doc Detective.
 *
 * Every other test injects the spawn, which proves the results are read and
 * reported but not that Doc Detective is invoked in a way it still accepts.
 * Doc Detective 4.26 has no `run` subcommand and exits 0 when tests fail, so
 * an invocation that drifted would read as a clean pass. This pins it.
 *
 * Skipped unless `doc-detective` is on PATH (`npm install -g doc-detective`).
 */
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const manni = resolve(root, "dist", "cli.js");

/** Whether `doc-detective` answers `--version`, the way a person would start it. */
function docDetectiveOnPath(): boolean {
  const probe = spawnSync("doc-detective", ["--version"], {
    // The npm shim on Windows is a .cmd, which only a shell starts. The probe
    // takes no user input, so the shell is safe here.
    shell: process.platform === "win32",
    encoding: "utf8",
    timeout: 60_000,
  });
  return probe.status === 0;
}

const available = docDetectiveOnPath();

function run(args: string[]): { code: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [manni, ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 240_000,
    env: { ...process.env, NO_COLOR: "1" },
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe.skipIf(!available)("manni test procedures, against the real Doc Detective", () => {
  const TIMEOUT = 300_000;

  it(
    "exits 0 for a passing page",
    () => {
      const r = run(["test", "procedures", "test/test/fixtures/pass.md", "--no-progress"]);
      expect(r.stderr).toBe("");
      expect(r.code).toBe(0);
      expect(r.stdout).toMatch(/^\d+ tests?: \d+ passed, 0 failed/m);
    },
    TIMEOUT,
  );

  it(
    "exits 1 for a failing page, naming the file and the line",
    () => {
      const r = run(["test", "procedures", "test/test/fixtures/fail.md", "--no-progress"]);
      expect(r.code).toBe(1);
      expect(r.stdout).toMatch(/^test\/test\/fixtures\/fail\.md$/m);
      expect(r.stdout).toMatch(/^\s+4\s+FAIL\s+/m);
    },
    TIMEOUT,
  );

  it(
    "annotates the failing line in the github format",
    () => {
      const r = run(["test", "procedures", "test/test/fixtures/fail.md", "-f", "github", "--no-progress"]);
      expect(r.code).toBe(1);
      expect(r.stdout).toMatch(
        /^::error file=test\/test\/fixtures\/fail\.md,line=4,title=Doc Detective::/m,
      );
      expect(r.stdout).toContain(
        ". Fix the step, fix the procedure it documents, or report a product regression." +
          "%0ADoc Detective runShell%0AGuide: https://docs.doc-detective.com/docs/actions/runshell",
      );
    },
    TIMEOUT,
  );
});

describe("manni test procedures, usage errors", () => {
  it.each([
    [["test", "procedures", "-"], "manni: test procedures reads files; Doc Detective has no stdin. Pass a path."],
    [["test", "procedures", "docs/", "-f", "sarif"], 'manni: Unknown --format "sarif". Use pretty | json | github.'],
    [
      ["test", "procedures", "docs/", "--collection", "site"],
      "manni: --collection selects a configured collection; it cannot be combined with paths.",
    ],
  ])("%j exits 2 with one line", (args, line) => {
    const r = run(args);
    expect(r.code).toBe(2);
    expect(r.stderr).toBe(`${line}\n`);
    expect(r.stdout).toBe("");
  });

  it("mounts procedures under test, with no default command", () => {
    expect(run(["test", "--help"]).stdout).toMatch(/^\s+procedures \[options\] \[paths\.\.\.\]/m);
  });

  it("has no run verb: commander says so and exits 2", () => {
    const r = run(["test", "run"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("unknown command 'run'");
  });
});

/**
 * `manni test tasks` against the built bin, with a fake `claude` first on
 * PATH that replays a recorded stream, and the `mock` judge. No real Claude
 * Code and no network.
 */
describe("manni test tasks, against a fake Claude Code", () => {
  const FIXTURES = resolve(root, "test", "test", "fixtures", "tasks");
  let tmp: string;
  let repo: string;
  let bin: string;

  /** The fake: writes its argv beside the run, then the stream with `__RUN__` as its temp directory. */
  const FAKE = [
    'const { readFileSync, writeFileSync } = require("node:fs");',
    'const { dirname, join } = require("node:path");',
    "const root = dirname(process.cwd());",
    'writeFileSync(join(process.env.FAKE_CLAUDE_OUT, "argv.json"), JSON.stringify(process.argv.slice(2)));',
    'const raw = readFileSync(process.env.FAKE_CLAUDE_STREAM, "utf8");',
    'process.stdout.write(raw.replaceAll("__RUN__", JSON.stringify(root).slice(1, -1)));',
    "process.exitCode = Number(process.env.FAKE_CLAUDE_EXIT ?? 0);",
  ].join("\n");

  beforeAll(() => {
    tmp = realpathSync.native(mkdtempSync(join(tmpdir(), "manni-test-tasks-cli-")));
    repo = join(tmp, "repo");
    bin = join(tmp, "bin");
    cpSync(join(FIXTURES, "repo"), repo, { recursive: true });
    mkdirSync(bin);
    writeFileSync(join(bin, "fake-claude.cjs"), FAKE);
    if (process.platform === "win32") {
      // An npm-style shim: manni runs the script it names with node.
      writeFileSync(join(bin, "claude.cmd"), '@node "%~dp0\\fake-claude.cjs" %*\r\n');
    } else {
      writeFileSync(join(bin, "claude"), `#!${process.execPath}\n${FAKE}`);
      chmodSync(join(bin, "claude"), 0o755);
    }
  });

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function tasks(args: string[], env: Record<string, string> = {}, path = `${bin}${delimiter}${process.env["PATH"] ?? ""}`) {
    const r = spawnSync(process.execPath, [manni, "test", "tasks", ...args], {
      cwd: repo,
      encoding: "utf8",
      timeout: 120_000,
      env: {
        ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toUpperCase() !== "PATH")),
        PATH: path,
        NO_COLOR: "1",
        FAKE_CLAUDE_OUT: tmp,
        FAKE_CLAUDE_STREAM: join(FIXTURES, "stream-pass.jsonl"),
        ...env,
      },
    });
    return { code: r.status, stdout: r.stdout, stderr: r.stderr };
  }

  it("runs a plain-text task from a page, judges it on completion and adherence, and prints JSON", () => {
    const r = tasks(["docs/fix/index.md", "--task", "Make the check pass.", "--provider", "mock", "-f", "json", "--no-progress"]);
    expect(r.stderr).toBe("");
    const report = JSON.parse(r.stdout) as {
      runs: { journey: null; persona: null; turns: number; trace: string; evals: { id: string }[] }[];
      exitCode: number;
    };
    const [run] = report.runs;
    expect(run).toMatchObject({ journey: null, persona: null, turns: 7 });
    expect(run?.evals.map((e) => e.id)).toEqual(["completed", "followed-the-docs"]);
    expect(r.stdout).not.toContain("derived");
    expect(r.code).toBe(report.exitCode);
    expect(existsSync(join(repo, ...(run?.trace ?? "").split("/")))).toBe(true);
    const argv = JSON.parse(readFileSync(join(tmp, "argv.json"), "utf8")) as string[];
    expect(argv.slice(0, 5)).toEqual(["-p", "--output-format", "stream-json", "--verbose", "--no-session-persistence"]);
    expect(argv).toContain("--add-dir");
  });

  it("runs a golden journey, grading its deterministic evals in the workspace", () => {
    const r = tasks(["--journey", "t1", "--provider", "mock", "--no-progress"]);
    // The fake never edits the seed, so the regex eval on docs/install.md fails.
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/^t1 · Fix a failing metadata check fast · as theo$/m);
    expect(r.stdout).toMatch(/^ {2}FAIL\s+field-added\s+strategy\/journeys\/t1\.md:12$/m);
    expect(r.stdout).toMatch(/^1 run: 0 passed, 1 failed/m);
  });

  it("streams the synthetic user's actions under --progress", () => {
    const r = tasks(["--journey", "t1", "--provider", "mock", "-f", "json", "--progress"]);
    expect(r.stderr.split("\n")[0]).toBe("t1 as theo: starting in a fresh copy of seed");
    expect(r.stderr).toContain("  theo › Edit docs/install.md\n");
  });

  it("exits 2 when Claude Code stops without a result", () => {
    const r = tasks(["--journey", "t1", "--provider", "mock"], {
      FAKE_CLAUDE_STREAM: join(FIXTURES, "stream-signed-out.jsonl"),
      FAKE_CLAUDE_EXIT: "1",
    });
    expect(r.code).toBe(2);
    expect(r.stderr).toBe("manni: Claude Code stopped without a result for t1 as theo: Not logged in · Please run /login\n");
  });

  it("exits 2 when Claude Code is not on PATH", () => {
    const empty = join(tmp, "empty");
    mkdirSync(empty, { recursive: true });
    const r = tasks(["--journey", "t1", "--provider", "mock"], {}, empty);
    expect(r.code).toBe(2);
    expect(r.stderr).toBe(
      "manni: Claude Code is not on PATH. Install it with npm install -g @anthropic-ai/claude-code, sign in, and run again.\n",
    );
  });

  it.each([
    [["-f", "sarif"], 'manni: Unknown --format "sarif". Use pretty | json | github.'],
    [["--task", "Install it"], "manni: --task needs a page or URL to start from."],
    [["docs/fix/index.md"], 'manni: a start page needs a task. Pass --task "<what the reader wants>" or --journey <id>.'],
    [["--journey", "theo"], 'manni: "theo" is a persona; --journey takes a journey.'],
  ])("%j exits 2 with one line", (args, line) => {
    const r = tasks(args);
    expect(r.code).toBe(2);
    expect(r.stderr).toBe(`${line}\n`);
    expect(r.stdout).toBe("");
  });
});
