/**
 * `runRun` is where CLI options meet the resolved config. The engine's own
 * `failOnNeedsReview` handling is covered in engine.test.ts; what is covered
 * here is the overlay — that `--fail-on-needs-review` and `--require` actually
 * reach it, and that the flag composes with the config rather than erasing it.
 */
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { listGraderKinds } from "../../../src/tracevals/graders/registry.js";
import { runRun } from "../../../src/tracevals/commands/run.js";
import { TracevalsError, type RunReport } from "../../../src/tracevals/types.js";

const sessionFixture = fileURLToPath(
  new URL("../fixtures/traces/claude-session.jsonl", import.meta.url),
);
// One `human` eval and nothing else, so needs-review alone decides the exit.
const reviewOnly = fileURLToPath(
  new URL("../fixtures/review-only", import.meta.url),
);
// One eval, graded by a kind only a plugin provides, so plugin loading alone
// decides between `pass` and `unknown grader kind`.
const pluginProject = fileURLToPath(
  new URL("../fixtures/plugin-project", import.meta.url),
);
const pluginsDir = fileURLToPath(
  new URL("../fixtures/plugins", import.meta.url),
);

function run(overrides: Record<string, unknown> = {}) {
  return runRun({
    tracePath: sessionFixture,
    project: reviewOnly,
    deterministicOnly: true,
    env: { MOOSE_TRACEVALS_HOME: reviewOnly },
    ...overrides,
  });
}

describe("runRun needs-review policy", () => {
  it("fails the run on needs-review by default", async () => {
    const { report } = await run();
    expect(report.summary.needsReview).toBe(1);
    expect(report.summary.fail + report.summary.error).toBe(0);
    expect(report.exitCode).toBe(1);
  });

  it("passes the run when the flag turns the policy off", async () => {
    const { report } = await run({ failOnNeedsReview: false });
    expect(report.summary.needsReview).toBe(1);
    expect(report.exitCode).toBe(0);
  });

  it("leaves the config value in force when the flag is absent", async () => {
    const { report } = await run({ failOnNeedsReview: undefined });
    expect(report.exitCode).toBe(1);
  });
});

describe("runRun grader plugins", () => {
  function runPlugins(overrides: Record<string, unknown> = {}) {
    return runRun({
      tracePath: sessionFixture,
      project: pluginProject,
      deterministicOnly: true,
      env: { MOOSE_TRACEVALS_HOME: pluginProject },
      ...overrides,
    });
  }

  const custom = (report: RunReport) =>
    report.evalResults.find((r) => r.evalName === "stayed-in-the-worktree");

  // Order is load-bearing in this block. A plugin loads once per process, so
  // the first two cases have to run against a registry that has not seen one
  // yet; vitest runs a file's tests in declaration order.
  //
  // That premise is asserted rather than assumed: if something earlier in the
  // process registers the kind, the first case would find it already present
  // and pass for the wrong reason — reporting no error because the grader
  // exists, not because the loader wired it. Fail loudly there instead.
  beforeAll(() => {
    expect(
      listGraderKinds(),
      "a prior test already registered stayed-in-scope; this block asserts the " +
        "kind is unknown until a plugin loads it, so it must run first",
    ).not.toContain("stayed-in-the-worktree");
  });

  it("errors on the custom kind when nothing loads the plugin", async () => {
    // The gap this exists to close. Without it there is no way to reach a
    // registered grader from the CLI at all.
    const { report } = await runPlugins({ configDir: reviewOnly });
    expect(custom(report)?.outcome).toBe("error");
    expect(custom(report)?.error).toMatch(/unknown grader kind/);
  });

  it("appends --require to the config list rather than replacing it", async () => {
    // Both halves in one call, and the assertion separates them: the eval is
    // graded by the *config's* plugin, and the warning comes from the flag's.
    // Were --require a replacement, this would be the `unknown grader kind`
    // error above — a one-off flag silently unregistering a repo's house
    // graders.
    const { report } = await runPlugins({
      configDir: pluginProject,
      require: [join(pluginsDir, "registers-nothing.mjs")],
    });
    expect(custom(report)?.outcome).toBe("pass");
    expect(
      report.warnings.some((w) => /registers-nothing\.mjs/.test(w)),
    ).toBe(true);
    expect(
      report.warnings.some((w) => /registered no grader kinds/.test(w)),
    ).toBe(true);
  });

  it("loads plugins named in the config, resolved against the config directory", async () => {
    // `plugins: [../plugins/stayed-in-scope.mjs]` is nonsense relative to the
    // cwd this suite runs in; it only resolves against the config's own dir.
    const { report } = await runPlugins({ configDir: pluginProject });
    expect(custom(report)?.outcome).toBe("pass");
    expect(report.exitCode).toBe(0);
  });

  it("fails the run operationally when a named plugin cannot be loaded", async () => {
    await expect(
      runPlugins({
        configDir: reviewOnly,
        require: ["./nope-not-here.mjs"],
      }),
    ).rejects.toThrow(TracevalsError);
  });
});
/**
 * The three coverage states end to end against the committed corpus
 * (ADR 01016). The fixture roster offers `fix-bug` and the plugin skill (used),
 * three more skills and one agent that are never used, and deliberately omits
 * `doc-writer` — which the session spawns anyway.
 */
describe("runRun availability reporting", () => {
  const fixtureProject = fileURLToPath(
    new URL("../fixtures/project", import.meta.url),
  );
  const fixtureHome = fileURLToPath(
    new URL("../fixtures/home", import.meta.url),
  );

  function cover(overrides: Record<string, unknown> = {}) {
    return runRun({
      tracePath: sessionFixture,
      project: fixtureProject,
      deterministicOnly: true,
      env: { MOOSE_TRACEVALS_HOME: fixtureHome },
      ...overrides,
    });
  }

  it("summarises the roster without listing it by default", async () => {
    const { report } = await cover();
    expect(report.availability).toEqual({
      recorded: true,
      skills: { offered: 5, used: 2, unused: 3 },
      agents: { offered: 3, used: 2, unused: 1 },
      listed: false,
    });
    expect(
      report.coverage.some((c) => c.availability === "offered-not-used"),
    ).toBe(false);
  });

  it("distinguishes offered-and-used from not-offered", async () => {
    const { report } = await cover();
    const byRef = new Map(report.coverage.map((c) => [c.ref, c.availability]));
    expect(byRef.get("fix-bug")).toBe("offered-and-used");
    expect(byRef.get("reviewer")).toBe("offered-and-used");
    // Spawned, resolved on disk, and never on the menu — a configuration bug,
    // not an adherence failure.
    expect(byRef.get("doc-writer")).toBe("not-offered");
    // Project rules are always in force, so the roster says nothing about them.
    expect(byRef.get("project rules")).toBeUndefined();
  });

  it("lists offered-but-unused artifacts when the flag is passed", async () => {
    const { report } = await cover({ reportUnusedArtifacts: true });
    expect(report.availability.listed).toBe(true);
    const unused = report.coverage.filter(
      (c) => c.availability === "offered-not-used",
    );
    expect(unused.map((c) => c.ref)).toEqual([
      "deep-research",
      "bare-listing",
      "tdd-coverage",
      "researcher",
    ]);
  });

  it("never lets availability move the exit code", async () => {
    // `not-offered` and three unused skills are observations, so the exit code
    // is exactly what the evals decided.
    const plain = await cover();
    const listed = await cover({ reportUnusedArtifacts: true });
    expect(listed.report.exitCode).toBe(plain.report.exitCode);
    expect(listed.report.summary).toEqual(plain.report.summary);
  });

  it("arms one conditional eval and leaves the other unarmed", async () => {
    const { report } = await cover();
    const byName = new Map(report.evalResults.map((r) => [r.evalName, r]));
    expect(byName.get("source-edits-use-the-fix-bug-skill")?.outcome).toBe("pass");
    const unarmed = byName.get("docs-work-uses-the-writing-skill");
    expect(unarmed?.outcome).toBe("skipped");
    expect(unarmed?.skipReason).toContain("trigger not met");
  });
});

describe("runRun command opt-out", () => {
  const fixtureProject = fileURLToPath(
    new URL("../fixtures/project", import.meta.url),
  );
  const fixtureHome = fileURLToPath(new URL("../fixtures/home", import.meta.url));
  // A config that disables commands, so the flagless path can be checked too.
  const noCommandsProject = fileURLToPath(
    new URL("../fixtures/no-commands", import.meta.url),
  );

  function runCommands(overrides: Record<string, unknown> = {}) {
    return runRun({
      tracePath: sessionFixture,
      project: fixtureProject,
      deterministicOnly: true,
      env: { MOOSE_TRACEVALS_HOME: fixtureHome },
      ...overrides,
    });
  }

  const cmd = (report: RunReport) =>
    report.evalResults.find((r) => r.evalName === "no-force-push");

  it("runs the declared command when no flag is passed", async () => {
    const { report } = await runCommands();
    expect(cmd(report)?.outcome).toBe("pass");
  });

  it("reaches the engine from `--no-commands`", async () => {
    const { report } = await runCommands({ commands: false });
    expect(cmd(report)?.outcome).toBe("skipped");
    expect(cmd(report)?.skipReason).toMatch(/command execution is disabled/);
  });

  it("leaves the config value in force when the flag is absent", async () => {
    // configDir points at a fixture whose config disables commands; without an
    // overlay bug the flagless run must honour it.
    const { report } = await runCommands({ configDir: noCommandsProject });
    expect(cmd(report)?.outcome).toBe("skipped");
  });
});
