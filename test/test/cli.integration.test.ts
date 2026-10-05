/**
 * `manni test run` against the built `dist/cli.js` and a real Doc Detective.
 *
 * Every other test injects the spawn, which proves the results are read and
 * reported but not that Doc Detective is invoked in a way it still accepts.
 * Doc Detective 4.26 has no `run` subcommand and exits 0 when tests fail, so
 * an invocation that drifted would read as a clean pass. This pins it.
 *
 * Skipped unless `doc-detective` is on PATH (`npm install -g doc-detective`).
 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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

describe.skipIf(!available)("manni test run, against the real Doc Detective", () => {
  const TIMEOUT = 300_000;

  it(
    "exits 0 for a passing page",
    () => {
      const r = run(["test", "run", "test/test/fixtures/pass.md", "--no-progress"]);
      expect(r.stderr).toBe("");
      expect(r.code).toBe(0);
      expect(r.stdout).toMatch(/^\d+ tests?: \d+ passed, 0 failed/m);
    },
    TIMEOUT,
  );

  it(
    "exits 1 for a failing page, naming the file and the line",
    () => {
      const r = run(["test", "run", "test/test/fixtures/fail.md", "--no-progress"]);
      expect(r.code).toBe(1);
      expect(r.stdout).toMatch(/^test\/test\/fixtures\/fail\.md$/m);
      expect(r.stdout).toMatch(/^\s+4\s+FAIL\s+/m);
    },
    TIMEOUT,
  );

  it(
    "annotates the failing line in the github format",
    () => {
      const r = run(["test", "run", "test/test/fixtures/fail.md", "-f", "github", "--no-progress"]);
      expect(r.code).toBe(1);
      expect(r.stdout).toMatch(
        /^::error file=test\/test\/fixtures\/fail\.md,line=4,title=Doc Detective::/m,
      );
    },
    TIMEOUT,
  );
});

describe("manni test run, usage errors", () => {
  it.each([
    [["test", "run", "-"], "manni: test run reads files; Doc Detective has no stdin. Pass a path."],
    [["test", "run", "docs/", "-f", "sarif"], 'manni: Unknown --format "sarif". Use pretty | json | github.'],
    [
      ["test", "run", "docs/", "--collection", "site"],
      "manni: --collection selects a configured collection; it cannot be combined with paths.",
    ],
  ])("%j exits 2 with one line", (args, line) => {
    const r = run(args);
    expect(r.code).toBe(2);
    expect(r.stderr).toBe(`${line}\n`);
    expect(r.stdout).toBe("");
  });

  it("mounts run under test, with no default command", () => {
    expect(run(["test", "--help"]).stdout).toMatch(/^\s+run \[options\] \[paths\.\.\.\]/m);
  });
});
