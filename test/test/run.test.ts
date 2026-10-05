/**
 * The `manni test run` command core, with Doc Detective replaced by an
 * injected spawn. The results the fake writes are the fixtures under
 * `fixtures/`, which are a real Doc Detective 4.26 run over `pass.md` and
 * `fail.md` with the absolute paths rewritten to `__CWD__`. Each test
 * substitutes its own working directory back in, so the paths are absolute,
 * as Doc Detective writes them.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExecResult } from "@hawkeyexl/inference";
import { TestError } from "../../src/test/errors.js";
import { runTest } from "../../src/test/commands/run.js";
import type { DocDetectiveSpawn } from "../../src/test/core/doc-detective.js";

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures");

interface Call {
  args: string[];
  cwd: string;
  progress: boolean;
}

/** A fake Doc Detective that writes `fixture` into its `-o` directory. */
function fakeSpawn(
  fixture: string | null,
  calls: Call[],
  result: Partial<ExecResult> = {},
): DocDetectiveSpawn {
  return (args, opts) => {
    calls.push({ args, ...opts });
    const out = args[args.indexOf("-o") + 1];
    if (fixture !== null && out !== undefined) {
      const text = readFileSync(join(FIXTURES, fixture), "utf8").replaceAll(
        "__CWD__",
        opts.cwd.replace(/\\/g, "/"),
      );
      writeFileSync(join(out, "testResults-2026-10-05-000000.json"), text);
    }
    return Promise.resolve({ code: 0, stdout: "", stderr: "", timedOut: false, ...result });
  };
}

let cwd: string;
let calls: Call[];

beforeEach(() => {
  cwd = realpathSync(mkdtempSync(join(tmpdir(), "manni-test-run-")));
  mkdirSync(join(cwd, "docs"));
  writeFileSync(join(cwd, "docs", "pass.md"), "# Pass\n");
  writeFileSync(join(cwd, "docs", "fail.md"), "# Fail\n");
  calls = [];
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

function write(rel: string, text: string): void {
  mkdirSync(dirname(join(cwd, rel)), { recursive: true });
  writeFileSync(join(cwd, rel), text);
}

describe("runTest: what Doc Detective is given", () => {
  it("passes the inputs as one comma-joined -i, a json reporter and a temp output", async () => {
    await runTest({ paths: ["docs/pass.md", "docs"], cwd, spawn: fakeSpawn("results-pass.json", calls) });
    const [call] = calls;
    expect(call?.args.slice(0, 2)).toEqual(["-i", "docs/pass.md,docs"]);
    expect(call?.args).toContain("-r");
    expect(call?.args[call.args.indexOf("-r") + 1]).toBe("json");
    expect(call?.args).not.toContain("run");
    expect(call?.args).not.toContain("--exit-on-fail");
    expect(call?.args).not.toContain("-c");
    expect(call?.cwd).toBe(cwd);
  });

  it("removes its output directory afterwards, whatever the verdict", async () => {
    await runTest({ paths: ["docs/fail.md"], cwd, spawn: fakeSpawn("results-fail.json", calls) });
    const out = calls[0]?.args[calls[0].args.indexOf("-o") + 1];
    expect(out).toBeDefined();
    expect(existsSync(out ?? "")).toBe(false);
  });

  it("removes it when the run fails too", async () => {
    await expect(
      runTest({ paths: ["docs/fail.md"], cwd, spawn: fakeSpawn(null, calls, { code: 3 }) }),
    ).rejects.toThrow(TestError);
    const out = calls[0]?.args[calls[0].args.indexOf("-o") + 1];
    expect(existsSync(out ?? "")).toBe(false);
  });

  it("expands a glob itself and passes plain paths as typed", async () => {
    await runTest({ paths: ["docs/*.md"], cwd, spawn: fakeSpawn("results-pass.json", calls) });
    const inputs = calls[0]?.args[1]?.split(",") ?? [];
    expect(inputs.sort()).toEqual(["docs/fail.md", "docs/pass.md"]);
  });

  it("passes no -i when there are no paths, so Doc Detective reads its config's input", async () => {
    write(".doc-detective.json", "{}");
    await runTest({ cwd, spawn: fakeSpawn("results-pass.json", calls) });
    expect(calls[0]?.args).not.toContain("-i");
  });

  it("passes tools.doc-detective.config as -c, resolved against the manni config", async () => {
    write("ci/manni.config.yaml", "tools:\n  doc-detective:\n    config: dd.json\n");
    write("ci/dd.json", "{}");
    await runTest({
      configPath: "ci/manni.config.yaml",
      cwd,
      spawn: fakeSpawn("results-pass.json", calls),
    });
    const args = calls[0]?.args ?? [];
    expect(args[args.indexOf("-c") + 1]).toBe(join(cwd, "ci", "dd.json"));
  });

  it("forwards the progress choice to the spawn", async () => {
    await runTest({ paths: ["docs"], cwd, progress: true, spawn: fakeSpawn("results-pass.json", calls) });
    expect(calls[0]?.progress).toBe(true);
  });
});

describe("runTest: --collection", () => {
  beforeEach(() => {
    write(
      "manni.config.yaml",
      [
        "collections:",
        "  - name: site",
        "    paths: [\"docs/**/*.md\"]",
        "    exclude: [\"docs/fail.md\"]",
        "  - name: empty",
        "    paths: [\"nowhere/**/*.md\"]",
        "",
      ].join("\n"),
    );
  });

  it("expands the collection's paths minus its exclude", async () => {
    await runTest({ collection: ["site"], cwd, spawn: fakeSpawn("results-pass.json", calls) });
    expect(calls[0]?.args.slice(0, 2)).toEqual(["-i", "docs/pass.md"]);
  });

  it("names the inputs relative to the working directory, not the config's", async () => {
    // Discovery walks up only inside a repository.
    mkdirSync(join(cwd, ".git"));
    const sub = join(cwd, "docs");
    await runTest({ collection: ["site"], cwd: sub, spawn: fakeSpawn("results-pass.json", calls) });
    expect(calls[0]?.args.slice(0, 2)).toEqual(["-i", "pass.md"]);
  });

  it("refuses a collection that matches no files", async () => {
    await expect(
      runTest({ collection: ["empty"], cwd, spawn: fakeSpawn("results-pass.json", calls) }),
    ).rejects.toThrow(
      new TestError("--collection matched no files. Pass --allow-empty if that is expected."),
    );
    expect(calls).toHaveLength(0);
  });

  it("passes with --allow-empty and starts no Doc Detective", async () => {
    const result = await runTest({
      collection: ["empty"],
      allowEmpty: true,
      cwd,
      spawn: fakeSpawn("results-pass.json", calls),
    });
    expect(result.exitCode).toBe(0);
    expect(result.results).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("gives each empty run its own result, so one caller's edit reaches no other", async () => {
    const opts = { collection: ["empty"], allowEmpty: true, cwd, spawn: fakeSpawn(null, calls) };
    const first = await runTest(opts);
    first.findings.push({ file: "x.md", result: "FAIL", description: "x" });
    first.tests.fail += 1;
    const second = await runTest(opts);
    expect(second.findings).toEqual([]);
    expect(second.tests.fail).toBe(0);
  });

  it("refuses an unknown name with the shared message", async () => {
    await expect(
      runTest({ collection: ["Site"], cwd, spawn: fakeSpawn(null, calls) }),
    ).rejects.toThrow(
      'no collection named "Site" in manni.config.yaml. Configured: site, empty. Names are case-sensitive; did you mean "site"?',
    );
  });

  it("refuses to combine with paths", async () => {
    await expect(
      runTest({ collection: ["site"], paths: ["docs"], cwd, spawn: fakeSpawn(null, calls) }),
    ).rejects.toThrow(
      "--collection selects a configured collection; it cannot be combined with paths.",
    );
  });

  it("does not read collections without --collection", async () => {
    write(".doc-detective.json", "{}");
    await runTest({ cwd, spawn: fakeSpawn("results-pass.json", calls) });
    expect(calls[0]?.args).not.toContain("-i");
  });
});

describe("runTest: the verdict", () => {
  it("is 1 when a step failed, with the failing step's file and line", async () => {
    const result = await runTest({ paths: ["docs"], cwd, spawn: fakeSpawn("results-fail.json", calls) });
    expect(result.exitCode).toBe(1);
    expect(result.findings).toContainEqual(
      expect.objectContaining({ file: "docs/fail.md", line: 4, result: "FAIL" }),
    );
    expect(result.findings.every((f) => f.result !== "FAIL" || f.file === "docs/fail.md")).toBe(true);
    expect(result.tests.fail).toBeGreaterThan(0);
  });

  it("is 0 when everything passed, with no findings", async () => {
    const result = await runTest({ paths: ["docs"], cwd, spawn: fakeSpawn("results-pass.json", calls) });
    expect(result.exitCode).toBe(0);
    expect(result.findings).toEqual([]);
    expect(result.tests.pass).toBeGreaterThan(0);
  });

  it("is 0 for a warning, which is listed", async () => {
    const result = await runTest({ paths: ["docs"], cwd, spawn: fakeSpawn("results-warning.json", calls) });
    expect(result.exitCode).toBe(0);
    expect(result.findings).toContainEqual(
      expect.objectContaining({ file: "docs/warn.md", result: "WARNING" }),
    );
  });

  it("keeps Doc Detective's results object as it wrote it", async () => {
    const result = await runTest({ paths: ["docs"], cwd, spawn: fakeSpawn("results-fail.json", calls) });
    expect(result.results).toHaveProperty("runId");
    expect(result.results).toHaveProperty("specs");
  });
});

describe("runTest: refusals", () => {
  const spawn = (): DocDetectiveSpawn => fakeSpawn("results-pass.json", calls);

  it.each([
    [
      "stdin",
      { paths: ["-"] },
      "test run reads files; Doc Detective has no stdin. Pass a path.",
    ],
    [
      "a missing path, in meta's words",
      { paths: ["docs/nope.md"] },
      'File not found: "docs/nope.md".',
    ],
    [
      "a glob that matches nothing",
      { paths: ["nowhere/*.md"] },
      'No files matched. Patterns tried: "nowhere/*.md". Pass --allow-empty if that is expected.',
    ],
    [
      "no paths and no Doc Detective config",
      {},
      "test run needs paths or a Doc Detective config. Pass paths, or add .doc-detective.json.",
    ],
    [
      "--collection with no manni config",
      { collection: ["site"] },
      "--collection needs a config file to select from.",
    ],
  ])("refuses %s", async (_label, opts, message) => {
    await expect(runTest({ ...opts, cwd, spawn: spawn() })).rejects.toThrow(new TestError(message));
    expect(calls).toHaveLength(0);
  });

  it("refuses a configured Doc Detective config that does not exist", async () => {
    write("manni.config.yaml", "tools:\n  doc-detective:\n    config: nowhere.json\n");
    await expect(runTest({ paths: ["docs"], cwd, spawn: spawn() })).rejects.toThrow(
      new TestError('manni.config.yaml: tools.doc-detective.config "nowhere.json" does not exist.'),
    );
  });

  it("accepts a Doc Detective config in YAML", async () => {
    write(".doc-detective.yaml", "input: docs\n");
    await expect(runTest({ cwd, spawn: spawn() })).resolves.toHaveProperty("exitCode", 0);
  });

  it("says Doc Detective is not on PATH", async () => {
    await expect(
      runTest({
        paths: ["docs"],
        cwd,
        spawn: fakeSpawn(null, calls, { code: null, spawnError: "spawn doc-detective ENOENT" }),
      }),
    ).rejects.toThrow(
      new TestError(
        "doc-detective is not on PATH. Install Doc Detective (npm install -g doc-detective) to run doc tests.",
      ),
    );
  });

  it("reports a non-zero exit with the tail of its output", async () => {
    const err = await runTest({
      paths: ["docs"],
      cwd,
      spawn: fakeSpawn(null, calls, { code: 3, stderr: "Invalid config: input is required" }),
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TestError);
    const lines = (err as TestError).message.split("\n");
    expect(lines[0]).toBe("Doc Detective failed (exit 3):");
    expect(lines.slice(1).join("\n")).toContain("Invalid config: input is required");
  });

  it.each([
    ["no results file", null],
    ["a results file that does not parse", "garbage"],
  ])("refuses %s", async (_label, text) => {
    const writeGarbage: DocDetectiveSpawn = (args, opts) => {
      const out = args[args.indexOf("-o") + 1];
      if (text !== null && out !== undefined) writeFileSync(join(out, "testResults-1.json"), text);
      return fakeSpawn(null, calls)(args, opts);
    };
    await expect(runTest({ paths: ["docs"], cwd, spawn: writeGarbage })).rejects.toThrow(
      new TestError("Doc Detective wrote no results to read. Run doc-detective directly to see why."),
    );
  });

  it("refuses finding no tests", async () => {
    await expect(
      runTest({ paths: ["docs"], cwd, spawn: fakeSpawn("results-empty.json", calls) }),
    ).rejects.toThrow(
      new TestError("Doc Detective found no tests in the inputs. Pass --allow-empty if that is expected."),
    );
  });

  it("passes finding no tests with --allow-empty, counting zero", async () => {
    const result = await runTest({
      paths: ["docs"],
      allowEmpty: true,
      cwd,
      spawn: fakeSpawn("results-empty.json", calls),
    });
    expect(result.exitCode).toBe(0);
    expect(result.results).toBeNull();
    expect(result.tests).toEqual({ pass: 0, fail: 0, warning: 0, skipped: 0 });
  });
});
