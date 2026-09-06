/**
 * One broken eval must not erase its siblings (ADR 01042).
 *
 * The engine grouped deterministic targets by grader *kind* and wrapped the
 * whole `grade()` call in one try/catch — while batch graders loop
 * `groupTargetsByEval` **inside** `grade()`
 * (`src/graders/tools/markdownlint.ts`, `src/graders/tools/docmeta.ts`,
 * `src/graders/tools/vale.ts`, `src/graders/native/differentiation.ts`). So a
 * throw while processing the second group unwound the entire function and
 * discarded the first group's already-computed findings.
 *
 * Reproduced against `tool:docmeta` with two evals, one pointing at a schema
 * file that does not exist: both evals reported the *bad* one's message, and
 * the good eval's 26 genuine findings vanished. Run alone, the good eval
 * worked perfectly. The catch block's own comment said "Error its own targets
 * and carry on" — and "its own targets" was every target of the grader kind.
 *
 * Everything here drives a fake grader through the real engine, so the pin is
 * on the engine's isolation boundary rather than on any one adapter.
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runEvals } from "../../../src/docevals/core/engine.js";
import { registerGrader, graderFor } from "../../../src/docevals/graders/registry.js";
import type { Finding } from "../../../src/docevals/types.js";
import type { Grader } from "../../../src/docevals/graders/types.js";

const BODY = "\n# Install\n\nRun the installer.\n";

/** The kinds registered by a test, torn down so nothing leaks between files. */
const registered = new Set<string>();

/**
 * A grader that throws for the evals named in `explodeOn` and reports a
 * finding for every other target. `calls` records the eval names in each
 * `grade()` invocation, which is how the per-group boundary is observed.
 */
function fakeGrader(
  kind: string,
  explodeOn: string[],
  mode: Grader["mode"] = "batch",
): { grader: Grader; calls: string[][] } {
  const calls: string[][] = [];
  const grader: Grader = {
    kind,
    mode,
    grade(ctx) {
      calls.push(ctx.targets.map((t) => t.eval.name));
      const findings: Finding[] = [];
      // Deliberately shaped like the real batch adapters: accumulate across
      // targets, then throw part-way. Whatever was accumulated before the
      // throw is what a per-kind catch used to discard.
      for (const t of ctx.targets) {
        if (explodeOn.includes(t.eval.name)) {
          // Deliberately does NOT name the eval: only the engine adding it
          // can satisfy the attribution assertion below.
          return Promise.reject(new Error("schema file not found"));
        }
        findings.push({
          evalName: t.eval.name,
          file: t.plan.page.file,
          message: `finding from ${t.eval.name}`,
          severity: "error",
        });
      }
      return Promise.resolve(findings);
    },
  };
  registerGrader(grader);
  registered.add(kind);
  return { grader, calls };
}

afterEach(() => {
  for (const kind of registered) {
    // The registry has no delete; neutralize instead, so a leaked kind cannot
    // silently satisfy another test.
    registerGrader({
      kind,
      mode: "batch",
      grade: () => Promise.reject(new Error(`${kind} was torn down`)),
    });
  }
  registered.clear();
});

/**
 * One page carrying `evals`, against a config that defines them. Both evals
 * share a grader kind, which is the whole point.
 */
function scaffold(kind: string, evalNames: string[]): string {
  const root = mkdtempSync(join(tmpdir(), "manni-docevals-isolation-"));
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(
    join(root, "docs", "install.md"),
    [
      "---",
      "title: Install",
      "evals:",
      ...evalNames.map((n) => `  - use: ${n}`),
      "---",
      BODY,
    ].join("\n"),
  );
  writeFileSync(
    join(root, "manni.config.yaml"),
    [
      "docevals:",
      "  version: 1",
      "  files:",
      '    include: ["docs/**/*.md"]',
      "  evals:",
      ...evalNames.flatMap((n) => [
        `    ${n}:`,
        `      assertion: Assertion for ${n}.`,
        `      grader: ${kind}`,
        "      options:",
        `        marker: ${n}`,
        "      severity: error",
      ]),
      "  suites:",
      "    s:",
      "      target-pass-rate: 1.0",
      `      evals: [${evalNames.join(", ")}]`,
      "",
    ].join("\n"),
  );
  return root;
}

const run = (root: string) => runEvals({ cwd: root, generate: false });

describe("a grader that throws for one eval", () => {
  it("leaves its sibling's findings intact", async () => {
    const kind = "tool:isolation-a";
    fakeGrader(kind, ["broken"]);
    const report = await run(scaffold(kind, ["good", "broken"]));

    const good = report.evalResults.find((r) => r.evalName === "good");
    expect(good?.outcome).toBe("fail");
    expect(good?.findings?.[0]?.message).toBe("finding from good");
  });

  it("errors only its own targets", async () => {
    const kind = "tool:isolation-b";
    fakeGrader(kind, ["broken"]);
    const report = await run(scaffold(kind, ["good", "broken"]));

    const broken = report.evalResults.find((r) => r.evalName === "broken");
    expect(broken?.outcome).toBe("error");
    expect(
      report.evalResults.filter((r) => r.outcome === "error"),
    ).toHaveLength(1);
  });

  // The reported message used to be the bad eval's, attached to the good
  // eval's result — so the name in the result and the name in the message
  // disagreed, and the reader chased the wrong eval.
  it("names the eval that actually failed", async () => {
    const kind = "tool:isolation-c";
    fakeGrader(kind, ["broken"]);
    const report = await run(scaffold(kind, ["good", "broken"]));

    const broken = report.evalResults.find((r) => r.evalName === "broken");
    expect(broken?.skipReason).toMatch(/broken/);
    expect(broken?.skipReason).toMatch(/schema file not found/);
    expect(broken?.skipReason).toMatch(new RegExp(kind));
  });

  // Order independence: the group that throws must not matter, and neither
  // must whether it came first.
  it("survives the failing group coming first", async () => {
    const kind = "tool:isolation-d";
    fakeGrader(kind, ["broken"]);
    const report = await run(scaffold(kind, ["broken", "good"]));

    expect(
      report.evalResults.find((r) => r.evalName === "good")?.outcome,
    ).toBe("fail");
    expect(
      report.evalResults.find((r) => r.evalName === "broken")?.outcome,
    ).toBe("error");
  });

  it("still errors every eval when every group throws", async () => {
    const kind = "tool:isolation-e";
    fakeGrader(kind, ["one", "two"]);
    const report = await run(scaffold(kind, ["one", "two"]));

    expect(report.evalResults.map((r) => r.outcome)).toEqual([
      "error",
      "error",
    ]);
    expect(report.exitCode).toBe(1);
  });
});

describe("the engine's invocation boundary", () => {
  // The mechanism behind all of the above: one `grade()` call per eval
  // configuration, so a throw can only reach one group's targets. Asserted
  // directly, because the outcomes above could also be produced by a
  // per-target boundary that broke batch invocation.
  it("invokes a grader once per eval group, not once per kind", async () => {
    const kind = "tool:isolation-f";
    const { calls } = fakeGrader(kind, []);
    await run(scaffold(kind, ["alpha", "beta"]));

    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.join(","))).toEqual(["alpha", "beta"]);
  });

  // ...and a group is still a *group*: two pages carrying one eval reach the
  // grader in a single call, which is what "batch" means and what a naive
  // per-target boundary would have destroyed.
  it("keeps every page of one eval in a single call", async () => {
    const kind = "tool:isolation-g";
    const { calls } = fakeGrader(kind, []);
    const root = scaffold(kind, ["alpha"]);
    writeFileSync(
      join(root, "docs", "second.md"),
      ["---", "title: Second", "evals:", "  - use: alpha", "---", BODY].join(
        "\n",
      ),
    );
    await run(root);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(["alpha", "alpha"]);
  });

  // A corpus grader's population is every page carrying that eval, and the
  // exemption ADR 01040 depends on. Grouping must not have narrowed it.
  it("hands a corpus grader every page carrying its eval at once", async () => {
    const kind = "tool:isolation-h";
    const { calls } = fakeGrader(kind, [], "corpus");
    const root = scaffold(kind, ["alpha"]);
    writeFileSync(
      join(root, "docs", "second.md"),
      ["---", "title: Second", "evals:", "  - use: alpha", "---", BODY].join(
        "\n",
      ),
    );
    await run(root);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveLength(2);
    expect(graderFor(kind)?.mode).toBe("corpus");
  });
});
