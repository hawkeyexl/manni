import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runEvals } from "../../../src/tracevals/core/engine.js";
import { parseConfig } from "../../../src/tracevals/core/config.js";
import { buildManifest } from "../../../src/tracevals/capture/build.js";
import {
  siblingManifestPath,
  writeManifest,
} from "../../../src/tracevals/capture/manifest.js";
import { TracevalsError } from "../../../src/tracevals/types.js";
import type { TraceJudge } from "../../../src/tracevals/judge/trace-judge.js";

const sessionFixture = fileURLToPath(
  new URL("../fixtures/traces/claude-session.jsonl", import.meta.url),
);
const streamFixture = fileURLToPath(
  new URL("../fixtures/traces/claude-stream.jsonl", import.meta.url),
);
const fixtureProject = fileURLToPath(
  new URL("../fixtures/project", import.meta.url),
);
const fixtureHome = fileURLToPath(
  new URL("../fixtures/home", import.meta.url),
);

const config = parseConfig({});

const passJudge: TraceJudge = async (plans) =>
  plans.map((plan) => ({
    evalName: plan.evalName,
    artifact: plan.artifact.path,
    artifactName: plan.artifact.name,
    grader: plan.grader,
    implicit: plan.implicit,
    outcome: "pass" as const,
    costUsd: 0,
    durationMs: 1,
  }));

function run(overrides: Record<string, unknown> = {}) {
  return runEvals({
    tracePath: sessionFixture,
    projectDir: fixtureProject,
    env: { MOOSE_TRACEVALS_HOME: fixtureHome },
    config,
    judge: passJudge,
    ...overrides,
  });
}

describe("runEvals", () => {
  it("grades declared deterministic evals against the trace", async () => {
    const report = await run();
    const byName = Object.fromEntries(
      report.evalResults.map((r) => [r.evalName, r]),
    );
    // The fixture trace uses Read (pass) and Bash (violating forbidden-tool).
    expect(byName["used-read"]?.outcome).toBe("pass");
    expect(byName["forbidden-tool"]?.outcome).toBe("fail");
    expect(byName["forbidden-tool"]?.findings?.[0]?.message).toContain("Bash");
  });

  it("routes ai evals through the injected judge", async () => {
    const report = await run();
    // An artifact carrying `metadata.eval-skip` also plans under the `ai`
    // grader, so exclude the skipped placeholder: what this pins is that the
    // evals actually handed to the judge come back with its verdict.
    const judged = report.evalResults.filter(
      (r) => r.grader === "ai" && r.outcome !== "skipped",
    );
    expect(judged.length).toBeGreaterThan(0);
    expect(judged.every((r) => r.outcome === "pass")).toBe(true);
  });

  it("skips ai evals under deterministicOnly", async () => {
    const report = await run({ deterministicOnly: true, judge: undefined });
    const ai = report.evalResults.filter((r) => r.grader === "ai");
    expect(ai.every((r) => r.outcome === "skipped")).toBe(true);
  });

  it("exits 1 when any eval fails", async () => {
    const report = await run();
    expect(report.exitCode).toBe(1);
    expect(report.summary.fail).toBeGreaterThan(0);
  });

  it("carries coverage and warnings into the report", async () => {
    const report = await run();
    expect(report.coverage.some((c) => c.ref === "Explore")).toBe(true);
    expect(report.warnings.some((w) => w.includes("unparseable"))).toBe(true);
  });

  it("treats an explicit projectDir as the walk ceiling", async () => {
    const report = await run();
    // Only the fixture project's rules, not this repo's own CLAUDE.md.
    const rules = report.evalResults.filter(
      (r) => r.artifactType === "project-rules",
    );
    for (const rule of rules) {
      expect(rule.artifact).toContain("fixtures");
    }
  });

  it("respects failOnNeedsReview", async () => {
    const reviewJudge: TraceJudge = async (plans) =>
      plans.map((plan) => ({
        evalName: plan.evalName,
        artifact: plan.artifact.path,
        artifactName: plan.artifact.name,
        grader: plan.grader,
        implicit: plan.implicit,
        outcome: "needs-review" as const,
        costUsd: 0,
        durationMs: 1,
      }));
    // Neutralize the deterministic failure by only judging ai evals: use a
    // config that fails on needs-review (default) vs one that does not.
    const strict = await run({ judge: reviewJudge });
    expect(strict.summary.needsReview).toBeGreaterThan(0);
    expect(strict.exitCode).toBe(1);

    const lax = await run({
      judge: reviewJudge,
      config: parseConfig({ failOnNeedsReview: false }),
    });
    // Deterministic forbidden-tool still fails, so isolate: needs-review alone
    // must not force failure — check summary accounting instead.
    expect(lax.summary.needsReview).toBeGreaterThan(0);
  });
  it("never hands the judge an eval whose window is empty", async () => {
    // `doc-writer` is spawned by the fixture trace but records no branch, so
    // the agent governed nothing. A passing judge would otherwise turn that
    // into a confident pass over the parent session's work.
    const report = await run();
    const docWriter = report.evalResults.filter((r) =>
      r.artifactName === "doc-writer",
    );
    expect(docWriter.length).toBeGreaterThan(0);
    for (const result of docWriter) {
      expect(result.outcome).toBe("skipped");
      expect(result.skipReason).toContain("no subagent turns");
    }
  });

  it("grades an agent artifact against its own branch", async () => {
    const report = await run();
    const byName = Object.fromEntries(
      report.evalResults.map((r) => [r.evalName, r]),
    );
    // The parent session ran Edit; the reviewer branch only read. Without
    // windowing this is a fail.
    expect(byName["reviewer-is-read-only"]?.outcome).toBe("pass");
    expect(byName["reviewer-read-something"]?.outcome).toBe("pass");
  });

  it("counts only in-window tool calls against a skill's eval", async () => {
    const report = await run();
    const forbidden = report.evalResults.find(
      (r) => r.evalName === "forbidden-tool",
    );
    // Two Bash calls in the session; one before the skill was invoked.
    expect(forbidden?.outcome).toBe("fail");
    expect(forbidden?.findings?.[0]?.message).toContain("used 1 time(s)");
  });

  describe("the command opt-out", () => {
    const disabled = parseConfig({ graders: { command: { enabled: false } } });

    it("runs command evals by default (ADR 01011 is unchanged)", async () => {
      const report = await run();
      const cmd = report.evalResults.find((r) => r.evalName === "no-force-push");
      expect(cmd?.grader).toBe("command");
      expect(cmd?.outcome).toBe("pass");
    });

    it("skips them with a stated reason when disabled — never passes them", async () => {
      const report = await run({ config: disabled });
      const cmd = report.evalResults.find((r) => r.evalName === "no-force-push");
      expect(cmd?.outcome).toBe("skipped");
      expect(cmd?.skipReason).toMatch(/command execution is disabled/);
    });

    it("changes nothing else about the run", async () => {
      const on = await run();
      const off = await run({ config: disabled });
      const outcomes = (r: Awaited<ReturnType<typeof run>>) =>
        Object.fromEntries(
          r.evalResults
            .filter((x) => x.evalName !== "no-force-push")
            .map((x) => [`${x.artifactName}/${x.evalName}`, x.outcome]),
        );
      expect(outcomes(off)).toEqual(outcomes(on));
      // A skipped check must not turn a failing run green, nor a green one red.
      expect(off.exitCode).toBe(on.exitCode);
    });
  });

  /**
   * `run` consuming a manifest (ADR 01024). The fixture corpus deliberately
   * ships **without** one, so the absent case is the default here and the
   * present case is built at test time.
   */
  describe("session manifests", () => {
    it("says nothing about a manifest when there is none", async () => {
      const report = await run();
      expect(report.manifest).toBeUndefined();
      // Every hash check still reports, so the absence is machine-readable
      // rather than merely invisible.
      const resolved = report.coverage.filter((c) => c.resolved && c.path);
      expect(resolved.length).toBeGreaterThan(0);
      for (const entry of resolved) {
        expect(entry.contentCheck?.status).toBe("skipped");
        expect(entry.contentCheck?.reason).toMatch(/manifest/i);
      }
    });

    it("errors rather than shrugging when --manifest names one that cannot be used", async () => {
      await expect(
        run({ manifest: join(".tmp", "definitely-not-here.json") }),
      ).rejects.toThrow(TracevalsError);
    });

    it("consumes one written beside the trace, and never moves an outcome", async () => {
      await mkdir(".tmp", { recursive: true });
      const dir = await mkdtemp(join(".tmp", "engine-manifest-"));
      const trace = join(dir, "session.jsonl");
      await copyFile(sessionFixture, trace);
      const manifest = await buildManifest({
        sessionId: "11111111-1111-1111-1111-111111111111",
        root: fixtureProject,
      });
      await writeManifest(siblingManifestPath(trace), manifest);

      const before = await run();
      const after = await run({ tracePath: trace });
      try {
        expect(after.manifest?.sessionId).toBe(
          "11111111-1111-1111-1111-111111111111",
        );
        expect(after.manifest?.matched).toBeGreaterThan(0);
        expect(after.manifest?.changed).toBe(0);
        // A checkout rewrote every mtime, so `before` flags everything. The
        // manifest answers mtime's own question for every artifact inside the
        // project and those flags clear — while every verdict, the summary, and
        // the exit code stay identical.
        expect(before.coverage.some((c) => c.stale === true)).toBe(true);
        const inProject = after.coverage.filter(
          (c) => c.contentCheck?.status === "match",
        );
        expect(inProject.length).toBeGreaterThan(0);
        expect(inProject.every((c) => c.stale === false)).toBe(true);
        // `capture` is project-scoped, so the plugin skill from the fixture
        // home was never recordable — it keeps the guess, and says why.
        const outside = after.coverage.find(
          (c) => c.ref === "writing-toolkit:identify-ai-tells",
        );
        expect(outside?.contentCheck?.status).toBe("skipped");
        expect(outside?.contentCheck?.reason).toMatch(/outside the project root/);
        expect(outside?.stale).toBe(true);
        expect(after.summary).toEqual(before.summary);
        expect(after.exitCode).toBe(before.exitCode);
        expect(after.evalResults.map((r) => r.outcome)).toEqual(
          before.evalResults.map((r) => r.outcome),
        );
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it("refuses a manifest captured for another session", async () => {
      await mkdir(".tmp", { recursive: true });
      const dir = await mkdtemp(join(".tmp", "engine-wrong-"));
      const trace = join(dir, "session.jsonl");
      await copyFile(sessionFixture, trace);
      await writeManifest(
        siblingManifestPath(trace),
        await buildManifest({ sessionId: "somebody-elses", root: fixtureProject }),
      );
      try {
        const report = await run({ tracePath: trace });
        // Evidence about another session is not evidence about this one.
        expect(report.manifest).toBeUndefined();
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    /**
     * The guard has to hold for every trace format, not only the ones that
     * happen to record an id. A legacy `claude -p` stream-json transcript
     * carries the session id on its `system`/`init` record and nowhere the
     * parser reads, so one captured without that record — filtered, truncated,
     * or resumed mid-stream — parses fine and records no id at all. A sibling
     * manifest beside such a trace could belong to any session on the machine.
     */
    async function idlessTrace(prefix: string): Promise<string> {
      await mkdir(".tmp", { recursive: true });
      const dir = await mkdtemp(join(".tmp", prefix));
      const trace = join(dir, "stream.jsonl");
      const raw = await readFile(streamFixture, "utf-8");
      const lines = raw.split("\n").filter((l) => l.trim() !== "");
      const stripped = lines.map((line) => {
        const record = JSON.parse(line) as Record<string, unknown>;
        // Only the init record's id is read, so only it has to go; the others
        // keep theirs, which is what the format sniffer keys on.
        if (record.type !== "system") return line;
        delete record.session_id;
        return JSON.stringify(record);
      });
      await writeFile(trace, `${stripped.join("\n")}\n`, "utf-8");
      return trace;
    }

    it("refuses a discovered manifest it cannot verify against the trace", async () => {
      const trace = await idlessTrace("engine-unverifiable-");
      await writeManifest(
        siblingManifestPath(trace),
        await buildManifest({ sessionId: "anybody", root: fixtureProject }),
      );
      try {
        const report = await run({ tracePath: trace });
        expect(report.trace.sessionId).toBeUndefined();
        expect(report.manifest).toBeUndefined();
        // Refused, and it says so: a manifest that silently does nothing is
        // indistinguishable from one that was never captured.
        expect(report.warnings.some((w) => /records no session id/.test(w))).toBe(
          true,
        );
      } finally {
        await rm(dirname(trace), { recursive: true, force: true });
      }
    });

    it("uses an explicitly named manifest for a trace that records no session id", async () => {
      const trace = await idlessTrace("engine-named-");
      const named = join(dirname(trace), "named.json");
      await writeManifest(
        named,
        await buildManifest({ sessionId: "anybody", root: fixtureProject }),
      );
      try {
        // Naming the file is the caller's own assertion of provenance, and the
        // only one available for a format that records no id.
        const report = await run({ tracePath: trace, manifest: named });
        expect(report.manifest?.sessionId).toBe("anybody");
      } finally {
        await rm(dirname(trace), { recursive: true, force: true });
      }
    });
  });
  describe("vanity-metric warning", () => {
    /**
     * A project whose one skill carries `evals` verbatim, so each test states
     * the eval set it is about and nothing else varies.
     */
    async function projectWithEvals(evals: string[]): Promise<string> {
      await mkdir(".tmp", { recursive: true });
      const dir = await mkdtemp(join(".tmp", "engine-vanity-"));
      const skill = join(dir, ".claude", "skills", "fix-bug");
      await mkdir(skill, { recursive: true });
      await writeFile(
        join(skill, "SKILL.md"),
        [
          "---",
          "name: fix-bug",
          "description: Fix a reported bug.",
          "metadata:",
          "  evals:",
          ...evals,
          "---",
          "",
          "# Fix Bug",
          "",
        ].join("\n"),
      );
      return dir;
    }

    const invoked = [
      "    - id: skill-fired",
      "      assertion: The fix-bug skill was invoked.",
      "      grader: skill-invoked",
      "      options:",
      "        skill: fix-bug",
      "        expect: invoked",
    ];
    const behavioral = [
      "    - id: used-read",
      "      assertion: The session read a source file before editing.",
      "      grader: tool-usage",
      "      options:",
      "        tool: Read",
      "        expect: used",
    ];
    const vanity = (w: string[]) =>
      w.filter((m) => m.includes("which checks that the skill fired"));

    it("warns when every eval on an artifact is skill-invoked", async () => {
      const dir = await projectWithEvals(invoked);
      try {
        const report = await run({ projectDir: dir });
        expect(vanity(report.warnings)).toHaveLength(1);
        expect(vanity(report.warnings)[0]).toContain("SKILL.md");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it("stays silent when one eval is about behavior", async () => {
      // The rule is about the *suite*, not the grader: one behavioral eval is
      // enough to make the trigger check a supporting fact rather than the
      // whole claim, so the same skill-invoked eval must not warn here.
      const dir = await projectWithEvals([...invoked, ...behavioral]);
      try {
        const report = await run({ projectDir: dir });
        expect(vanity(report.warnings)).toHaveLength(0);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it("does not warn about an artifact carrying no evals of its own", async () => {
      // No `metadata.evals` at all, so the artifact is planned implicitly.
      // The warning is about an authoring choice, and there is none here.
      //
      // The `plan.implicit` guard this walks through is defensive rather than
      // load-bearing today: an implicit plan is only created when nothing was
      // declared, and it is always `ai`-graded, so it could not satisfy
      // "every eval is skill-invoked" anyway. It keeps the rule true — the
      // warning is about what an author wrote — if implicit planning ever
      // learns to emit another grader.
      await mkdir(".tmp", { recursive: true });
      const dir = await mkdtemp(join(".tmp", "engine-vanity-implicit-"));
      const skill = join(dir, ".claude", "skills", "fix-bug");
      await mkdir(skill, { recursive: true });
      await writeFile(
        join(skill, "SKILL.md"),
        [
          "---",
          "name: fix-bug",
          "description: Fix a reported bug.",
          "---",
          "",
          "# Fix Bug",
          "",
        ].join("\n"),
      );
      try {
        const report = await run({ projectDir: dir });
        // The artifact was planned — the run saw it — and still did not warn.
        expect(
          report.evalResults.some((r) => r.artifact.includes("SKILL.md")),
        ).toBe(true);
        expect(vanity(report.warnings)).toHaveLength(0);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it("names each affected artifact rather than warning once", async () => {
      const dir = await projectWithEvals(invoked);
      try {
        const other = join(dir, ".claude", "skills", "ship-it");
        await mkdir(other, { recursive: true });
        await writeFile(
          join(other, "SKILL.md"),
          [
            "---",
            "name: ship-it",
            "description: Ship the change.",
            "metadata:",
            "  evals:",
            "    - id: ship-fired",
            "      assertion: The ship-it skill was invoked.",
            "      grader: skill-invoked",
            "      options:",
            "        skill: ship-it",
            "        expect: invoked",
            "---",
            "",
            "# Ship It",
            "",
          ].join("\n"),
        );
        const report = await run({ projectDir: dir });
        const messages = vanity(report.warnings);
        expect(messages).toHaveLength(2);
        expect(messages.some((m) => m.includes("fix-bug"))).toBe(true);
        expect(messages.some((m) => m.includes("ship-it"))).toBe(true);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });
});

describe("weight in the run's pass rate", () => {
  /** A judge that fails exactly the evals named, and passes the rest. */
  const failing = (names: string[]): TraceJudge => async (plans) =>
    plans.map((plan) => ({
      evalName: plan.evalName,
      artifact: plan.artifact.path,
      artifactName: plan.artifact.name,
      grader: plan.grader,
      implicit: plan.implicit,
      outcome: names.includes(plan.evalName)
        ? ("fail" as const)
        : ("pass" as const),
      costUsd: 0,
      durationMs: 1,
    }));

  it("stamps a weight on every result, defaulting to 1", async () => {
    const report = await run();
    expect(report.evalResults.every((r) => r.weight === 1)).toBe(true);
  });

  it("is inert at the default weight: the rate is plain pass over graded", async () => {
    const report = await run();
    const graded = report.evalResults.filter(
      (r) => r.outcome === "pass" || r.outcome === "fail" || r.outcome === "error",
    );
    const passed = graded.filter((r) => r.outcome === "pass").length;
    expect(report.summary.passRate).toBeCloseTo(
      graded.length > 0 ? passed / graded.length : 1,
      10,
    );
  });

  it("leaves needs-review and skipped out of both halves of the rate", async () => {
    // A session awaiting review neither helps nor hurts — the same membership
    // the counts have always reported, now weighted.
    const report = await run();
    const graded = report.evalResults.filter(
      (r) => r.outcome === "pass" || r.outcome === "fail" || r.outcome === "error",
    );
    expect(graded.length).toBe(
      report.summary.pass + report.summary.fail + report.summary.error,
    );
  });

  it("never lets a weight change an eval's own outcome", async () => {
    const first = await run({ judge: passJudge });
    // An ai-graded eval specifically: the injected judge only decides those,
    // and picking the first result of any kind lands on a deterministic one.
    // An ai eval the judge actually decided: some are skipped for their own
    // reasons, and picking one of those proves nothing about weight.
    const name = first.evalResults.find(
      (r) => r.grader === "ai" && r.outcome === "pass",
    )?.evalName;
    expect(name, "fixture has a judged ai eval").toBeDefined();
    const failed = await run({ judge: failing([name!]) });
    // The judge decides the outcome; weight only decides how much it moves the
    // rate. Counts stay unweighted for the same reason.
    expect(failed.evalResults.find((r) => r.evalName === name)?.outcome).toBe(
      "fail",
    );
    expect(failed.summary.fail).toBeGreaterThan(0);
  });
});
