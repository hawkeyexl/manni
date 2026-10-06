/**
 * `check`, `prepare` and `release` through the built CLI (proposal 0079).
 * Each run works on a copy of the conformance fixture project with an empty
 * home, so the caches it writes stay out of the committed tree and no user's
 * own CLAUDE.md is read. The mock provider extracts and judges, offline.
 * Requires `npm run build` first.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const cli = fileURLToPath(new URL("../../../dist/cli.js", import.meta.url));
const built = existsSync(cli);
const FIXTURE = fileURLToPath(new URL("../fixtures/conformance", import.meta.url));
const trace = (name: string): string => join(FIXTURE, "traces", `${name}.jsonl`);

let dir: string;
let project: string;
let home: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "conformance-cli-"));
  project = join(dir, "project");
  home = join(dir, "home");
  await cp(join(FIXTURE, "project"), project, { recursive: true });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Run from the project copy, so its config is the one discovered. */
function manni(
  args: string[],
  stdin = "",
  env: Record<string, string> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = execFile("node", [cli, "tracevals", ...args], {
    cwd: project,
    env: {
      ...process.env,
      CLAUDE_CONFIG_DIR: join(home, ".claude"),
      HOME: home,
      USERPROFILE: home,
      MANNI_TRACEVALS_JUDGE: "",
      MANNI_TRACEVALS_REASONING: "",
      ...env,
    },
  });
  child.stdin?.end(stdin);
  return new Promise((settle) => {
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => (stdout += String(d)));
    child.stderr?.on("data", (d) => (stderr += String(d)));
    child.on("close", (code) => {
      settle({ code: code ?? 0, stdout, stderr });
    });
  });
}

describe.skipIf(!built)("tracevals check", () => {
  it("exits 1 on a broken rule, grouping findings under their file", async () => {
    const { code, stdout } = await manni(["check", trace("breaks"), "--project", project]);
    expect(code).toBe(1);
    expect(stdout).toContain("CLAUDE.md\n  ? run-npm-ci-first  Run `npm ci` before `npm test` in a fresh worktree.");
    expect(stdout).toContain("  ✖ no-force-push  Never run `git push --force`.");
    expect(stdout).toContain(".cursor/rules/web.mdc\n  ✖ never-use-innerhtml-in-components");
    expect(stdout).not.toContain("console.log");
    expect(stdout.trimEnd().split("\n").at(-1)).toBe(
      "Last turn of 3b265d00: 7 rules from 5 files. 2 broken, 1 needs review.",
    );
  });

  it("writes the JSON report to stdout and to -o", async () => {
    const out = join(dir, "turn.json");
    const { code, stdout } = await manni([
      "check", trace("breaks"), "--project", project, "-f", "json", "-o", out,
    ]);
    expect(code).toBe(1);
    const report = JSON.parse(stdout) as Record<string, unknown>;
    expect(JSON.parse(await readFile(out, "utf-8")) as unknown).toEqual(report);
    expect(report).toMatchObject({
      sessionId: "3b265d00-0000-4000-8000-000000000001",
      agentId: null,
      judge: { provider: "mock", model: "mock-model", mode: "generative", runs: 3 },
      extraction: { provider: "mock", model: "mock-model" },
      summary: { sources: 5, rules: 7, fail: 2, needsReview: 1 },
      skipped: null,
      exitCode: 1,
    });
    expect(Object.keys(report)).toEqual([
      "trace", "sessionId", "agentId", "turn", "judge", "extraction",
      "sources", "findings", "summary", "skipped", "warnings", "exitCode",
    ]);
  });

  it("carries the judge's reasoning under MANNI_TRACEVALS_REASONING=1", async () => {
    const { code, stdout } = await manni(
      ["check", trace("breaks"), "--project", project, "-f", "json"],
      "",
      { MANNI_TRACEVALS_REASONING: "1" },
    );
    expect(code).toBe(1);
    const { findings } = JSON.parse(stdout) as { findings: { observed: string; reasoning?: string }[] };
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.reasoning).toBe("Scored by the mock judge.");
      expect(f.observed.endsWith(". Scored by the mock judge.")).toBe(true);
    }
  });

  it("exits 0 when every rule was followed", async () => {
    const { code, stdout } = await manni(["check", trace("follows"), "--project", project]);
    expect(code).toBe(0);
    expect(stdout.trim()).toBe("Last turn of 3b265d00: 4 rules from 2 files. None broken.");
  });

  it("exits 0 when no rule applies, and when the turn is empty", async () => {
    const narrow = await manni([
      "check", trace("untouched"), "--project", project, "-c", "narrow.config.yaml",
    ]);
    expect(narrow.code).toBe(0);
    expect(narrow.stdout.trim()).toBe(
      "Last turn of 3b265d00: 2 rules from 1 file, none apply to this turn.",
    );
    const empty = await manni(["check", trace("empty-turn"), "--project", project, "-f", "json"]);
    expect(empty.code).toBe(0);
    expect(JSON.parse(empty.stdout).skipped).toBe("empty-turn");
  });

  it("judges with --provider and --model, while extraction keeps the configured model", async () => {
    const { stdout } = await manni([
      "check", trace("breaks"), "--project", project, "--provider", "mock",
      "--model", "other-model", "--runs", "3", "--no-cache", "-f", "json",
    ]);
    const report = JSON.parse(stdout);
    expect(report.judge).toMatchObject({ provider: "mock", model: "other-model" });
    expect(report.extraction).toEqual({ provider: "mock", model: "mock-model" });
  });

  it("refuses a missing trace, two traces, a bad --runs and a missing file, exit 2", async () => {
    const none = await manni(["check"]);
    expect(none.code).toBe(2);
    expect(none.stderr).toBe("manni: no trace given; pass a trace file or run manni tracevals list\n");
    const two = await manni(["check", trace("breaks"), trace("follows")]);
    expect(two.code).toBe(2);
    expect(two.stderr).toBe("manni: tracevals check takes one trace, got 2\n");
    const runs = await manni(["check", trace("breaks"), "--runs", "0"]);
    expect(runs.code).toBe(2);
    expect(runs.stderr).toBe("manni: --runs must be a whole number of at least 1, got 0\n");
    const missing = await manni(["check", "nope.jsonl"]);
    expect(missing.code).toBe(2);
    expect(missing.stderr).toMatch(/^manni: cannot read trace nope\.jsonl: ENOENT/);
  });

  it("names jev's missing key, and refuses jev out of the loop for run and fill", async () => {
    const env = process.env["TYPESAFE_API_KEY"];
    delete process.env["TYPESAFE_API_KEY"];
    try {
      const key = await manni(["check", trace("breaks"), "--project", project, "--provider", "jev"]);
      expect(key.code).toBe(2);
      expect(key.stderr).toBe("manni: jev needs an API key in TYPESAFE_API_KEY\n");
    } finally {
      if (env !== undefined) process.env["TYPESAFE_API_KEY"] = env;
    }
    const jev =
      "manni: jev answers decisions only, so it cannot extract rules or write verdicts. Use it as tracevals.conformance.hook.provider.\n";
    const run = await manni(["run", trace("breaks"), "--provider", "jev"]);
    expect(run.code).toBe(2);
    expect(run.stderr).toBe(jev);
    const fill = await manni(["fill", "--provider", "jev", "--dry-run"]);
    expect(fill.code).toBe(2);
    expect(fill.stderr).toBe(jev);
  });
});

describe.skipIf(!built)("tracevals prepare", () => {
  it("extracts the always sources once, then finds them cached", async () => {
    const first = await manni(["prepare"]);
    expect(first.code).toBe(0);
    expect(first.stdout.trim()).toBe("Extracted 2 rules from 1 file that applies to every session.");
    const second = await manni(["prepare", "-f", "json"]);
    expect(JSON.parse(second.stdout)).toEqual({
      models: [
        { role: "hook", provider: "mock", model: "mock-model", state: "hosted", bytes: null },
        { role: "extraction", provider: "mock", model: "mock-model", state: "hosted", bytes: null },
      ],
      extraction: { provider: "mock", model: "mock-model", extracted: 0, cached: 1, rules: 0 },
      warnings: [],
      exitCode: 0,
    });
    const forced = await manni(["prepare", "--no-cache", "--project", ".", "-c", "manni.config.yaml"]);
    expect(forced.stdout.trim()).toBe("Extracted 2 rules from 1 file that applies to every session.");
  });

  it("writes nothing to stdout under a SessionStart envelope", async () => {
    const { code, stdout, stderr } = await manni(
      ["prepare"],
      JSON.stringify({ session_id: "s1", cwd: project, hook_event_name: "SessionStart", source: "startup" }),
    );
    expect(code).toBe(0);
    expect(stdout).toBe("");
    expect(stderr).toBe("manni: Extracted 2 rules from 1 file that applies to every session.\n");
  });

  it("says when conformance is not set up", async () => {
    await writeFile(join(project, "manni.config.yaml"), "tracevals:\n  provider: mock\n");
    const { code, stdout } = await manni(["prepare"]);
    expect(code).toBe(0);
    expect(stdout).toBe("tracevals conformance is not set up; nothing to prepare.\n");
  });
});

describe.skipIf(!built)("tracevals release", () => {
  it("says no host is running, in both formats", async () => {
    const pretty = await manni(["release", "--all"]);
    expect(pretty.code).toBe(0);
    expect(pretty.stdout).toBe("No model host is running.\n");
    const json = await manni(["release", "--all", "-f", "json"]);
    expect(JSON.parse(json.stdout)).toEqual({
      released: [],
      unloaded: [],
      hostStopped: false,
      exitCode: 0,
    });
  });

  it("releases the SessionEnd session silently, and needs a session or --all", async () => {
    const hook = await manni(["release"], JSON.stringify({ session_id: "s1", hook_event_name: "SessionEnd" }));
    expect(hook.code).toBe(0);
    expect(hook.stdout).toBe("");
    const bare = await manni(["release"]);
    expect(bare.code).toBe(2);
    expect(bare.stderr).toBe("manni: release needs a session from a SessionEnd hook, or --all\n");
  });
});
