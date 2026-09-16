/**
 * Integration tests against the built CLI (dist/cli.js) — what catches a
 * broken bin entry, a bad bundle, or a module that only resolves under
 * vitest. Requires `npm run build` first; CI builds before testing.
 */
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { must } from "../helpers.js";

const exec = promisify(execFile);

const root = fileURLToPath(new URL("../../..", import.meta.url));
const cli = fileURLToPath(new URL("../../../dist/cli.js", import.meta.url));
const built = existsSync(cli);

async function runCli(
  args: string[],
  env: Record<string, string> = {},
  // Defaults to the repo root. A different one is how a test reaches a
  // `manni.config.yaml` other than the repo's own: `configDir` is the working
  // directory and no flag overrides it.
  cwd: string = root,
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await exec("node", [cli, "tracevals", ...args], {
      cwd,
      env: { ...process.env, ...env },
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

describe.skipIf(!built)("built CLI", () => {
  it("deterministic-only run against the fixture corpus exits 1 with the engineered failure", async () => {
    const { code, stdout } = await runCli(
      [
        "run",
        "test/tracevals/fixtures/traces/claude-session.jsonl",
        "--project",
        "test/tracevals/fixtures/project",
        "--deterministic-only",
        "--format",
        "json",
      ],
      { CLAUDE_CONFIG_DIR: "test/tracevals/fixtures/home/.claude" },
    );
    expect(code).toBe(1);
    const report = JSON.parse(stdout);
    const find = (a: string, e: string) =>
      report.evalResults.find(
        (x: { artifact: string; evalName: string }) =>
          x.artifact.endsWith(a) && x.evalName === e,
      );
    expect(find("SKILL.md", "forbidden-tool")?.outcome).toBe("fail");
    expect(find("SKILL.md", "used-read")?.outcome).toBe("pass");
    expect(
      report.evalResults.filter(
        (x: { outcome: string }) => x.outcome === "skipped",
      ).length,
    ).toBeGreaterThan(0);
  });

  it("mock-judge run produces consensus objects with zero network", async () => {
    const { code, stdout } = await runCli(
      [
        "run",
        "test/tracevals/fixtures/traces/claude-session.jsonl",
        "--project",
        "test/tracevals/fixtures/project",
        "--provider",
        "mock",
        "--no-cache",
        "--format",
        "json",
      ],
      { CLAUDE_CONFIG_DIR: "test/tracevals/fixtures/home/.claude" },
    );
    expect(code).toBe(1); // the deterministic failure persists
    const report = JSON.parse(stdout);
    const judged = report.evalResults.filter(
      (x: { consensus?: unknown }) => x.consensus,
    );
    expect(judged.length).toBeGreaterThan(0);
  });

  it("list -f json enumerates the fixture session store", async () => {
    const { code, stdout } = await runCli(
      ["list", "--all-projects", "-f", "json", "--limit", "5"],
      { CLAUDE_CONFIG_DIR: "test/tracevals/fixtures/home/.claude" },
    );
    expect(code).toBe(0);
    const { traces } = JSON.parse(stdout);
    expect(Array.isArray(traces)).toBe(true);
    expect(traces.length).toBeGreaterThan(0);
  });

  /**
   * Proposal 0034 and the family's one format flag. Each of these is a rung of
   * the plan's usage ladder: the bare domain, the grandfathered default verb,
   * the renamed format, and `list`'s replaced `--json`.
   */
  describe("usage errors", () => {
    it("a bare domain prints help and exits 2", async () => {
      const { code, stdout, stderr } = await runCli([]);
      expect(code).toBe(2);
      expect(stdout).toBe("");
      expect(stderr).toMatch(/^Usage: manni tracevals /m);
      expect(stderr).toContain("run [options] [traces...]");
    });

    it("a trace path with no verb is an unknown command, not a default run", async () => {
      const { code, stderr } = await runCli([
        "test/tracevals/fixtures/traces/claude-session.jsonl",
      ]);
      expect(code).toBe(2);
      expect(stderr).toContain(
        "error: unknown command 'test/tracevals/fixtures/traces/claude-session.jsonl'",
      );
      expect(stderr).toContain("(add --help for usage)");
    });

    it("refuses the old `human` format on run", async () => {
      const { code, stderr } = await runCli([
        "run",
        "x.jsonl",
        "-f",
        "human",
      ]);
      expect(code).toBe(2);
      expect(stderr).toContain(
        'manni: --format must be one of pretty | json | markdown, got "human"',
      );
    });

    it("refuses the old `human` format on fill, capture and calibrate", async () => {
      for (const verb of ["fill", "capture", "calibrate"]) {
        const { code, stderr } = await runCli([verb, "-f", "human"]);
        expect(code).toBe(2);
        expect(stderr).toContain("--format must be one of");
        expect(stderr).toContain('got "human"');
      }
    });

    it("refuses list --json, which -f json replaced", async () => {
      const { code, stderr } = await runCli(["list", "--json"]);
      expect(code).toBe(2);
      expect(stderr).toContain("error: unknown option '--json'");
      expect(stderr).toContain("(add --help for usage)");
    });

    it("drops list's -p/-a/-l short forms, keeping the long ones", async () => {
      for (const short of ["-p", "-a", "-l"]) {
        const { code, stderr } = await runCli(["list", short]);
        expect(code).toBe(2);
        expect(stderr).toContain(`error: unknown option '${short}'`);
      }
    });
  });

  /**
   * `-c`/`--no-config` on every verb that reads config. `list` reads none, so
   * it has neither — asserted above by way of its short forms and here by the
   * flag's absence.
   */
  describe("config flags", () => {
    it("-c names the file `run` reads", async () => {
      const { code, stderr } = await runCli([
        "run",
        "test/tracevals/fixtures/traces/claude-session.jsonl",
        "-c",
        "does-not-exist.yaml",
        "--deterministic-only",
      ]);
      expect(code).toBe(2);
      expect(stderr).toContain('manni: Config file not found: "does-not-exist.yaml".');
    });

    // `capture` reads stdin before anything else, so its own `-c` is asserted
    // in the capture block below, where the runner closes stdin.
    it("-c is accepted by fill and calibrate too", async () => {
      for (const args of [
        ["fill", "test/tracevals/fixtures/project"],
        ["calibrate", "test/tracevals/fixtures/traces/claude-session.jsonl"],
      ]) {
        const { code, stderr } = await runCli([...args, "-c", "does-not-exist.yaml"]);
        expect(code).toBe(2);
        expect(stderr).toContain('manni: Config file not found: "does-not-exist.yaml".');
      }
    });

    it("--no-config runs on the built-in defaults", async () => {
      const { code, stdout } = await runCli(
        [
          "run",
          "test/tracevals/fixtures/traces/claude-session.jsonl",
          "--project",
          "test/tracevals/fixtures/project",
          "--deterministic-only",
          "--no-config",
          "-f",
          "json",
        ],
        { CLAUDE_CONFIG_DIR: "test/tracevals/fixtures/home/.claude" },
      );
      expect(code).toBe(1);
      expect(JSON.parse(stdout).evalResults.length).toBeGreaterThan(0);
    });

    it("list takes neither -c nor --no-config", async () => {
      for (const flag of [["-c", "x.yaml"], ["--no-config"]]) {
        const { code, stderr } = await runCli(["list", ...flag]);
        expect(code).toBe(2);
        expect(stderr).toMatch(/error: unknown option '(-c|--no-config)'/);
      }
    });
  });

  it("exits 2 with guidance when no trace is given off-TTY", async () => {
    const { code, stderr } = await runCli(["run"]);
    expect(code).toBe(2);
    expect(stderr).toContain("no trace given");
  });

  it("fill --dry-run reports proposals without touching the corpus", async () => {
    const { code, stdout } = await runCli(
      // --no-cache keeps this hermetic: without it the run writes into
      // <repo>/.manni/tracevals/cache/fill and a later run replays it.
      [
        "fill",
        "test/tracevals/fixtures/project",
        "--provider",
        "mock",
        "--dry-run",
        "--no-cache",
        "--format",
        "json",
      ],
      { CLAUDE_CONFIG_DIR: "test/tracevals/fixtures/home/.claude" },
    );
    expect(code).toBe(0);
    const report = JSON.parse(stdout);

    const paths = report.results.map((r: { artifact: string }) =>
      r.artifact.replace(/\\/g, "/"),
    );
    expect(paths.some((p: string) => p.endsWith("fix-bug/SKILL.md"))).toBe(true);
    expect(paths.some((p: string) => p.endsWith("doc-writer.md"))).toBe(true);
    expect(paths.some((p: string) => p.endsWith("CLAUDE.md"))).toBe(true);
    // A plain doc is not an instruction artifact.
    expect(paths.some((p: string) => p.endsWith("README.md"))).toBe(false);

    expect(report.dryRun).toBe(true);
    // Project rules are proposed but never written, dry run or not.
    const rules = report.results.filter(
      (r: { type: string }) => r.type === "project-rules",
    );
    expect(rules.every((r: { status: string }) => r.status === "propose-only")).toBe(true);

    // Proves the gate ran rather than rubber-stamping the proposal.
    const reasons = report.results.flatMap((r: { rejected: { reason: string }[] }) =>
      r.rejected.map((x) => x.reason),
    );
    expect(reasons).toContain("low-confidence");
    expect(
      report.results.some(
        (r: { needsSharpening: unknown[] }) => r.needsSharpening.length > 0,
      ),
    ).toBe(true);
  });

  it("fill --exclude drops the artifacts it matches", async () => {
    const args = (extra: string[]) => [
      "fill",
      "test/tracevals/fixtures/project",
      "--provider",
      "mock",
      "--dry-run",
      "--no-cache",
      "-f",
      "json",
      ...extra,
    ];
    const home = { CLAUDE_CONFIG_DIR: "test/tracevals/fixtures/home/.claude" };
    const paths = (stdout: string): string[] =>
      JSON.parse(stdout).results.map((r: { artifact: string }) =>
        r.artifact.replace(/\\/g, "/"),
      );

    const before = paths((await runCli(args([]), home)).stdout);
    expect(before.some((p) => p.endsWith("fix-bug/SKILL.md"))).toBe(true);

    // Repeatable, one value per occurrence, and never split on commas.
    const { code, stdout } = await runCli(
      args(["--exclude", "**/skills/**", "--exclude", "**/agents/**"]),
      home,
    );
    expect(code).toBe(0);
    const after = paths(stdout);
    expect(after.some((p) => p.endsWith("fix-bug/SKILL.md"))).toBe(false);
    expect(after.some((p) => p.endsWith("doc-writer.md"))).toBe(false);
    expect(after.some((p) => p.endsWith("CLAUDE.md"))).toBe(true);
  });

  it("fill exits 2 for a path that does not exist", async () => {
    const { code, stderr } = await runCli(["fill", "does-not-exist-here"]);
    expect(code).toBe(2);
    expect(stderr).toContain("no such file or directory");
  });

  // The plugin path only really exists once it survives bundling: `dist/cli.js`
  // and `dist/index.js` are separate entries, and a side-effect plugin that
  // imports `@hawkeyexl/manni` is registering into whichever copy of the
  // registry that specifier resolves to. Only the built CLI can prove it is the
  // same one (ADR 01017).
  describe("grader plugins", () => {
    const pluginRun = (extra: string[]) => [
      "run",
      "test/tracevals/fixtures/traces/claude-session.jsonl",
      "--project",
      "test/tracevals/fixtures/plugin-project",
      "--deterministic-only",
      "--format",
      "json",
      ...extra,
    ];

    it("reports an unknown grader kind when no plugin is required", async () => {
      const { code, stdout } = await runCli(pluginRun([]), {
        CLAUDE_CONFIG_DIR: "test/tracevals/fixtures/plugin-project/.claude",
      });
      expect(code).toBe(1);
      const report = JSON.parse(stdout);
      const result = report.evalResults.find(
        (x: { evalName: string }) => x.evalName === "stayed-in-the-worktree",
      );
      expect(result.outcome).toBe("error");
      expect(result.error).toContain("unknown grader kind");
    });

    it("--require registers the kind and the same eval passes", async () => {
      const { code, stdout } = await runCli(
        pluginRun(["--require", "./test/tracevals/fixtures/plugins/stayed-in-scope.mjs"]),
        { CLAUDE_CONFIG_DIR: "test/tracevals/fixtures/plugin-project/.claude" },
      );
      expect(code).toBe(0);
      const report = JSON.parse(stdout);
      const result = report.evalResults.find(
        (x: { evalName: string }) => x.evalName === "stayed-in-the-worktree",
      );
      expect(result.outcome).toBe("pass");
    });

    it("accepts a plugin that registers by importing the package itself", async () => {
      // The side-effect form the extend guide documents. It registers a kind
      // no eval declares, so the assertion is the absence of the
      // registered-nothing warning: the import reached the CLI's own registry.
      const { stdout } = await runCli(
        pluginRun([
          "--require",
          "./test/tracevals/fixtures/plugins/side-effect-grader.mjs",
        ]),
        { CLAUDE_CONFIG_DIR: "test/tracevals/fixtures/plugin-project/.claude" },
      );
      const report = JSON.parse(stdout);
      expect(
        report.warnings.some((w: string) => /registered no grader kinds/.test(w)),
      ).toBe(false);
    });

    it("exits 2 with a message that is not the grader-not-found one", async () => {
      const { code, stderr } = await runCli(
        pluginRun(["--require", "./test/tracevals/fixtures/plugins/does-not-exist.mjs"]),
        { CLAUDE_CONFIG_DIR: "test/tracevals/fixtures/plugin-project/.claude" },
      );
      expect(code).toBe(2);
      expect(stderr).toContain("could not load grader plugin");
      expect(stderr).not.toContain("unknown grader kind");
    });
  });

  // ADR 01018. The shape of the report is decided by *how* traces were
  // selected, not by how many came back, so a script piping `--format json`
  // gets something stable.
  describe("batch runs", () => {
    const home = { CLAUDE_CONFIG_DIR: "test/tracevals/fixtures/home/.claude" };
    const both = [
      "test/tracevals/fixtures/traces/claude-session.jsonl",
      "test/tracevals/fixtures/traces/claude-session-sidecar.jsonl",
    ];

    it("one named trace still emits a single-trace RunReport", async () => {
      const { stdout } = await runCli(
        [
          "run",
          must(both[0], "the first of the two traces"),
          "--project",
          "test/tracevals/fixtures/project",
          "--deterministic-only",
          "--format",
          "json",
        ],
        home,
      );
      const report = JSON.parse(stdout);
      expect(report.trace).toBeDefined();
      expect(report.evalResults).toBeDefined();
      expect(report.traces).toBeUndefined();
    });

    it("two named traces emit an aggregate report and exit 1", async () => {
      const { code, stdout } = await runCli(
        [
          "run",
          ...both,
          "--project",
          "test/tracevals/fixtures/project",
          "--deterministic-only",
          "--format",
          "json",
        ],
        home,
      );
      expect(code).toBe(1);
      const report = JSON.parse(stdout);
      expect(report.summary.traces).toBe(2);
      expect(report.summary.tracesFailed).toBe(1);
      const forbidden = report.evals.find(
        (e: { evalName: string }) => e.evalName === "forbidden-tool",
      );
      expect(forbidden.passRate).toBe(0);
      expect(forbidden.failingTraces).toHaveLength(1);
    });

    it("a discovery selector emits an aggregate report even for one trace", async () => {
      const { code, stdout } = await runCli(
        [
          "run",
          "--all-projects",
          "--limit",
          "1",
          "--project",
          "test/tracevals/fixtures/project",
          "--deterministic-only",
          "--format",
          "json",
        ],
        home,
      );
      expect(code).toBe(0);
      const report = JSON.parse(stdout);
      expect(report.summary.traces).toBe(1);
      expect(Array.isArray(report.evals)).toBe(true);
    });

    it("exits 2 rather than green when a selector matches nothing", async () => {
      const { code, stderr } = await runCli(
        ["run", "--all-projects", "--deterministic-only"],
        { CLAUDE_CONFIG_DIR: "test/tracevals/fixtures/project/.claude" },
      );
      expect(code).toBe(2);
      expect(stderr).toMatch(/no traces matched/);
    });

    it("exits 2 when named traces are mixed with a selector", async () => {
      const { code, stderr } = await runCli(
        ["run", must(both[0], "the first of the two traces"), "--limit", "1", "--deterministic-only"],
        home,
      );
      expect(code).toBe(2);
      expect(stderr).toMatch(/not both/);
    });

    it("rejects a --since that is not a duration", async () => {
      const { code, stderr } = await runCli(
        ["run", "--since", "yesterday", "--deterministic-only"],
        home,
      );
      expect(code).toBe(2);
      expect(stderr).toMatch(/--since must be a duration/);
    });
  });

  // ADR 01022. The command surface, the report shape, and the exit-code
  // contract, through the built binary rather than the library.
  describe("calibrate", () => {
    const home = { CLAUDE_CONFIG_DIR: "test/tracevals/fixtures/home/.claude" };
    const corpus = [
      "test/tracevals/fixtures/traces/claude-session.jsonl",
      "test/tracevals/fixtures/traces/claude-session-sidecar.jsonl",
    ];
    const base = [
      "calibrate",
      ...corpus,
      "--project",
      "test/tracevals/fixtures/project",
      "--labels",
      "test/tracevals/fixtures/project/tracevals/labels.yaml",
      "--provider",
      "mock",
      "--no-cache",
    ];

    it("measures the corpus and exits 0 despite disagreeing", async () => {
      const { code, stdout } = await runCli(
        [...base, "--format", "json"],
        home,
      );
      expect(code).toBe(0);
      const report = JSON.parse(stdout);
      expect(report.counts.falsePass).toBe(1);
      expect(report.counts.falseFail).toBe(1);
      expect(report.counts.reviewVolume).toBe(1);
      // A calibration report is its own shape, distinguishable without
      // inspecting the contents.
      expect(report.evalResults).toBeUndefined();
      expect(report.evals).toBeUndefined();
      expect(report.batch.summary.traces).toBe(2);
    });

    it("exits 1 only when a threshold is asked for and missed", async () => {
      const { code, stdout } = await runCli(
        [...base, "--max-false-pass", "0", "--format", "json"],
        home,
      );
      expect(code).toBe(1);
      expect(JSON.parse(stdout).gates[0]).toEqual({
        name: "falsePass",
        limit: 0,
        actual: 1,
        exceeded: true,
      });
    });

    it("sweeps every axis and names the setting that removes the false pass", async () => {
      const { code, stdout } = await runCli(
        [...base, "--sweep", "--format", "json"],
        home,
      );
      expect(code).toBe(0);
      const report = JSON.parse(stdout);
      const strict = report.sweep.find(
        (c: { axis: string; value: number }) =>
          c.axis === "zones.autoPass" && c.value === 0.95,
      );
      expect(strict.counts.falsePass).toBe(0);
      // The claim is the conversion, not the count: a stricter auto-pass floor
      // turns the false pass into a deferral, so review volume rises above the
      // baseline row. An absolute number here breaks whenever the fixture
      // corpus gains a judged eval.
      const baseline = report.sweep.find(
        (c: { axis: string }) => c.axis === "baseline",
      );
      expect(strict.counts.reviewVolume).toBeGreaterThan(
        baseline.counts.reviewVolume as number,
      );
    });

    it("exits 2 with the corpus listed when a label names a foreign trace", async () => {
      const { code, stderr } = await runCli(
        [
          "calibrate",
          must(corpus[0], "the first trace of the corpus"),
          "--project",
          "test/tracevals/fixtures/project",
          "--labels",
          "test/tracevals/fixtures/project/tracevals/labels.yaml",
          "--deterministic-only",
        ],
        home,
      );
      expect(code).toBe(2);
      expect(stderr).toMatch(/not in the corpus/);
      expect(stderr).toMatch(/claude-session-sidecar\.jsonl/);
    });

    it("exits 2 when the labels file does not exist", async () => {
      const { code, stderr } = await runCli(
        [...base, "--labels", "test/tracevals/fixtures/project/tracevals/nope.yaml"],
        home,
      );
      expect(code).toBe(2);
      expect(stderr).toMatch(/could not read labels file/);
    });
  });

  /**
   * `capture` end to end (ADR 01024). The hook payload really arrives on
   * stdin, so this exercises the one path the unit tests inject around.
   */
  describe("capture", () => {
    async function runCliStdin(
      args: string[],
      stdin: string,
      env: Record<string, string> = {},
    ): Promise<{ code: number; stdout: string; stderr: string }> {
      const child = execFile("node", [cli, "tracevals", ...args], {
        cwd: root,
        env: { ...process.env, ...env },
      });
      child.stdin?.end(stdin);
      return new Promise((settle) => {
        let stdout = "";
        let stderr = "";
        child.stdout?.on("data", (d) => (stdout += String(d)));
        child.stderr?.on("data", (d) => (stderr += String(d)));
        child.on("close", (code) => { settle({ code: code ?? 0, stdout, stderr }); });
      });
    }

    it("writes a manifest from a hook payload on stdin, and keeps stdout empty", async () => {
      const dir = join(tmpdir(), `manni-tracevals-cli-capture-${process.pid}`);
      await mkdir(dir, { recursive: true });
      const out = join(dir, "s.json");
      const { code, stdout, stderr } = await runCliStdin(
        ["capture", "--out", out],
        JSON.stringify({
          session_id: "cli-session",
          hook_event_name: "SessionStart",
          how: "startup",
          cwd: "test/tracevals/fixtures/project",
        }),
      );
      try {
        expect(code).toBe(0);
        // A SessionStart hook's stdout becomes the model's context, so it must
        // stay empty however chatty the command is.
        expect(stdout).toBe("");
        expect(stderr).toContain("cli-session");
        const manifest = JSON.parse(await readFile(out, "utf-8"));
        expect(manifest.sessionId).toBe("cli-session");
        expect(manifest.hookEvent).toBe("SessionStart");
        expect(manifest.artifacts.length).toBeGreaterThan(0);
        expect(manifest.git?.sha).toMatch(/^[0-9a-f]{40}$/);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it("exits 2 rather than guessing when the payload names no session", async () => {
      const { code, stderr } = await runCliStdin(["capture"], "{}");
      expect(code).toBe(2);
      expect(stderr).toMatch(/no session id/);
    });

    it("takes -c, because it reads capture.dir", async () => {
      const { code, stderr } = await runCliStdin(
        ["capture", "--session-id", "x", "-c", "does-not-exist.yaml"],
        "{}",
      );
      expect(code).toBe(2);
      expect(stderr).toContain(
        'manni: Config file not found: "does-not-exist.yaml".',
      );
    });

    it("makes staleness exact for `run`, and does nothing to the verdicts", async () => {
      const dir = join(tmpdir(), `manni-tracevals-cli-sharpen-${process.pid}`);
      await mkdir(dir, { recursive: true });
      const trace = join(dir, "session.jsonl");
      await copyFile(
        join(root, "test/tracevals/fixtures/traces/claude-session.jsonl"),
        trace,
      );
      const home = { CLAUDE_CONFIG_DIR: "test/tracevals/fixtures/home/.claude" };
      const runArgs = [
        "run",
        trace,
        "--project",
        "test/tracevals/fixtures/project",
        "--deterministic-only",
        "--format",
        "json",
      ];
      try {
        const before = JSON.parse((await runCli(runArgs, home)).stdout);
        expect(before.manifest).toBeUndefined();

        await runCliStdin(
          ["capture", "--out", join(dir, "session.manifest.json")],
          JSON.stringify({
            session_id: "11111111-1111-1111-1111-111111111111",
            cwd: "test/tracevals/fixtures/project",
          }),
        );
        const after = JSON.parse((await runCli(runArgs, home)).stdout);

        expect(after.manifest?.changed).toBe(0);
        expect(after.manifest?.matched).toBeGreaterThan(0);
        // The mtime false positive a checkout manufactures is gone for every
        // artifact the manifest recorded, and nothing else moved.
        type Coverage = { coverage: { ref: string; stale?: boolean }[] };
        const staleRefs = (r: Coverage) =>
          r.coverage.filter((c) => c.stale === true).map((c) => c.ref);
        expect(staleRefs(before as Coverage).length).toBeGreaterThan(
          staleRefs(after as Coverage).length,
        );
        expect(after.summary).toEqual(before.summary);
        expect(after.exitCode).toBe(before.exitCode);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it("refuses --manifest against a corpus", async () => {
      const { code, stderr } = await runCli([
        "run",
        "test/tracevals/fixtures/traces/claude-session.jsonl",
        "test/tracevals/fixtures/traces/claude-session-sidecar.jsonl",
        "--manifest",
        "whatever.json",
        "--deterministic-only",
      ]);
      expect(code).toBe(2);
      expect(stderr).toMatch(/cannot be used with a corpus/);
    });
  });

  /**
   * ADR 01011's safety opt-out, exercised through the CLI rather than around
   * it.
   *
   * `--no-commands` was declared with no positive twin, so commander defaulted
   * `opts.commands` to `true`; `prepareRun`'s `options.commands ?? config` then
   * never saw `undefined`, and `graders.command.enabled: false` in a config was
   * unreachable from the command line. The unit tests hand `commands` straight
   * to `runRun`, which is exactly why they never caught it — only the built
   * binary exercises the flag declaration.
   */
  describe("command execution opt-out", () => {
    // A config directory whose only job is to turn command execution off.
    const noCommands = join(root, "test/tracevals/fixtures/no-commands");
    const home = { CLAUDE_CONFIG_DIR: join(root, "test/tracevals/fixtures/home/.claude") };
    const trace = join(root, "test/tracevals/fixtures/traces/claude-session.jsonl");
    const project = join(root, "test/tracevals/fixtures/project");
    const args = (extra: string[]) => [
      "run",
      trace,
      "--project",
      project,
      "--deterministic-only",
      "--format",
      "json",
      ...extra,
    ];
    const commandEval = (stdout: string) =>
      JSON.parse(stdout).evalResults.find(
        (r: { evalName: string }) => r.evalName === "no-force-push",
      );

    it("lets the config decide when neither flag is passed", async () => {
      const { stdout } = await runCli(args([]), home, noCommands);
      expect(commandEval(stdout)?.outcome).toBe("skipped");
      expect(commandEval(stdout)?.skipReason).toMatch(
        /command execution is disabled/,
      );
    });

    it("--commands overrides a config that disabled them", async () => {
      const { stdout } = await runCli(args(["--commands"]), home, noCommands);
      expect(commandEval(stdout)?.outcome).toBe("pass");
    });

    it("--no-commands still skips, and still states why", async () => {
      const { stdout } = await runCli(args(["--no-commands"]), home);
      expect(commandEval(stdout)?.outcome).toBe("skipped");
      expect(commandEval(stdout)?.skipReason).toMatch(
        /command execution is disabled/,
      );
    });

    it("runs the command by default against the repo's own config", async () => {
      const { stdout } = await runCli(args([]), home);
      expect(commandEval(stdout)?.outcome).toBe("pass");
    });

    // `calibrate` shares `run`'s flags, so it must share their behaviour. It
    // hand-copied the mapping and omitted `commands` entirely: the flag parsed,
    // printed in --help, and did nothing.
    it("calibrate acts on the flag it accepts", async () => {
      const { stdout } = await runCli(
        [
          "calibrate",
          trace,
          join(root, "test/tracevals/fixtures/traces/claude-session-sidecar.jsonl"),
          "--project",
          project,
          "--labels",
          join(root, "test/tracevals/fixtures/project/tracevals/labels.yaml"),
          "--provider",
          "mock",
          "--no-cache",
          "--no-commands",
          "--format",
          "json",
        ],
        home,
      );
      const row = JSON.parse(stdout).batch.evals.find(
        (e: { evalName: string }) => e.evalName === "no-force-push",
      );
      expect(row?.skipReasons ?? []).toContainEqual(
        expect.stringMatching(/command execution is disabled/),
      );
    });
  });

  /**
   * A flag that parses to NaN survives the `??` overlay, because `undefined` is
   * what defers to the config and NaN is not undefined. `spentUsd >= NaN` is
   * false forever, so the budget gate never trips while the report still claims
   * a budget; `--limit=-1` reaches `slice(0, -1)` and quietly evaluates every
   * trace except the oldest.
   */
  describe("numeric flag validation", () => {
    const home = { CLAUDE_CONFIG_DIR: "test/tracevals/fixtures/home/.claude" };
    const trace = "test/tracevals/fixtures/traces/claude-session.jsonl";
    const judged = ["--project", "test/tracevals/fixtures/project", "--provider", "mock"];

    it("rejects a --max-turns that is not a whole number above zero", async () => {
      for (const bad of ["abc", "0", "1.5", "-1"]) {
        const { code, stderr } = await runCli(
          ["run", trace, ...judged, `--max-turns=${bad}`],
          home,
        );
        expect(code).toBe(2);
        expect(stderr).toMatch(/--max-turns/);
      }
    });

    it("no longer accepts the dollar budget it replaced", async () => {
      const { code, stderr } = await runCli(
        ["run", trace, ...judged, "--max-cost-usd", "2"],
        home,
      );
      expect(code).toBe(2);
      expect(stderr).toMatch(/unknown option '--max-cost-usd'/);
    });

    it("rejects a --limit that would silently drop the oldest trace", async () => {
      const { code, stderr } = await runCli(
        [
          "run",
          "--all-projects",
          "--limit=-1",
          "--project",
          "test/tracevals/fixtures/project",
          "--deterministic-only",
        ],
        home,
      );
      expect(code).toBe(2);
      expect(stderr).toMatch(/--limit/);
    });

    it("rejects a --runs that is not a whole number above zero", async () => {
      for (const bad of ["abc", "0", "1.5"]) {
        const { code, stderr } = await runCli(
          ["run", trace, ...judged, "--runs", bad],
          home,
        );
        expect(code).toBe(2);
        expect(stderr).toMatch(/--runs/);
      }
    });

    it("guards the same flags on calibrate", async () => {
      const { code, stderr } = await runCli(
        ["calibrate", trace, "--project", "test/tracevals/fixtures/project", "--runs=-1"],
        home,
      );
      expect(code).toBe(2);
      expect(stderr).toMatch(/--runs/);
    });

    it("guards `list --limit` too", async () => {
      const { code, stderr } = await runCli(["list", "--limit=-1"], home);
      expect(code).toBe(2);
      expect(stderr).toMatch(/--limit/);
    });

    it("still accepts the values a user actually passes", async () => {
      const { code } = await runCli(
        [
          "run",
          trace,
          ...judged,
          "--no-cache",
          "--runs",
          "1",
          "--max-turns",
          "50",
          "--format",
          "json",
        ],
        home,
      );
      // 1 because of the engineered deterministic failure, never 2.
      expect(code).toBe(1);
    });
  });

  /**
   * Provider selection is the shared layer's (`src/shared/providers.ts`), so
   * what these pin is that every verb reaches it: the same refusals, the same
   * names offered, and no model id of tracevals' own.
   */
  describe("provider selection", () => {
    const home = { CLAUDE_CONFIG_DIR: "test/tracevals/fixtures/home/.claude" };
    const trace = "test/tracevals/fixtures/traces/claude-session.jsonl";

    it("refuses --local beside a hosted --provider, on every verb that takes both", async () => {
      for (const verb of ["run", "calibrate", "fill"]) {
        const { code, stderr } = await runCli(
          [verb, trace, "--local", "--provider", "anthropic"],
          home,
        );
        expect(code).toBe(2);
        expect(stderr).toContain(
          "--local and --provider anthropic contradict each other: --local runs " +
            "inference on this machine with llama-cpp. Drop one of them.",
        );
      }
    });

    it("refuses an unknown provider without offering the mock seam", async () => {
      const { code, stderr } = await runCli(["run", trace, "--provider", "gemini"], home);
      expect(code).toBe(2);
      expect(stderr).toContain(
        'Unknown provider "gemini". Available: anthropic, openai, claude-cli, llama-cpp, auto.',
      );
    });

    it("refuses a model with no provider to own it", async () => {
      const { code, stderr } = await runCli(["run", trace, "--model", "x"], home);
      expect(code).toBe(2);
      expect(stderr).toContain('Model "x" was given without a provider');
      expect(stderr).toContain("tracevals.provider");
    });

    it("offers --local and --max-turns in help, and neither mock nor a dollar budget", async () => {
      for (const verb of ["run", "calibrate", "fill"]) {
        const { stdout } = await runCli([verb, "--help"]);
        expect(stdout).toContain("--local");
        expect(stdout).toContain("--max-turns");
        expect(stdout).not.toContain("mock");
        expect(stdout).not.toContain("--max-cost-usd");
      }
    });
  });

  /**
   * A relocated artifact (proposal 0047): the whole `metadata` block lives in
   * the collection's manifest, and the skill's own front matter carries none.
   * Before this it graded as declaring nothing — a clean gate over an artifact
   * with three evals on it.
   */
  describe("the external trail", () => {
    const trace = "test/tracevals/fixtures/traces/claude-session.jsonl";
    const project = "test/tracevals/fixtures/relocated";

    it("grades the evals the manifest holds", async () => {
      const { code, stdout } = await runCli([
        "run",
        trace,
        "--project",
        project,
        "-c",
        `${project}/manni.config.yaml`,
        "--deterministic-only",
        "-f",
        "json",
      ]);
      const report = JSON.parse(stdout) as {
        evalResults: { evalName: string; outcome: string; artifactName: string }[];
      };
      // Scoped to the relocated artifact: the trace also uses a plugin skill,
      // whose own evals depend on what is installed on the machine.
      const outcome = (name: string) =>
        report.evalResults.find(
          (r) => r.artifactName === "fix-bug" && r.evalName === name,
        )?.outcome;
      expect(outcome("used-read")).toBe("pass");
      expect(outcome("stayed-out-of-the-shell")).toBe("fail");
      // The `ai` eval is planned and deferred, not missing.
      expect(outcome("followed-the-skill")).toBe("skipped");
      // Never the implicit fallback: that is what "declared nothing" looked like.
      expect(outcome("adheres-to-artifact")).toBeUndefined();
      expect(code).toBe(1);
    });

    it("reads no manifest under --no-config, so the artifact declares nothing", async () => {
      const { stdout } = await runCli([
        "run",
        trace,
        "--project",
        project,
        "--no-config",
        "--deterministic-only",
        "-f",
        "json",
      ]);
      const report = JSON.parse(stdout) as {
        evalResults: { evalName: string; artifactName: string }[];
      };
      const names = report.evalResults
        .filter((r) => r.artifactName === "fix-bug")
        .map((r) => r.evalName);
      expect(names).toContain("adheres-to-artifact");
      expect(names).not.toContain("used-read");
    });

    it("offers --offline on every verb that reads a manifest", async () => {
      for (const verb of ["run", "calibrate", "fill"]) {
        const { stdout } = await runCli([verb, "--help"]);
        expect(stdout).toContain("--offline");
      }
    });
  });

  it("legacy stream-json traces still parse", async () => {
    const { code, stdout } = await runCli(
      [
        "run",
        "test/tracevals/fixtures/traces/claude-stream.jsonl",
        "--project",
        "test/tracevals/fixtures/project",
        "--deterministic-only",
        "--format",
        "json",
      ],
      { CLAUDE_CONFIG_DIR: "test/tracevals/fixtures/home/.claude" },
    );
    const report = JSON.parse(stdout);
    expect(report.trace.source).toBe("claude-code");
    // The stream fixture invoked no skills; project rules still evaluate.
    expect([0, 1]).toContain(code);
  });
});
