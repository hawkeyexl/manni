/**
 * `--eval` / `--suite` selection (ADR 01018).
 *
 * The flags are easy; what they do to the exit code is not. `summarizeSuites`
 * computes a pass rate over the results *present in the run*, and `hasFailure`
 * fails a run whose suite misses its target — so a run filtered to one passing
 * eval out of twelve would compute 1/1, meet a target of 1.0, and exit 0 on
 * evidence it never gathered. These tests exist mostly to pin that it cannot.
 */
import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runEvals } from "../../../src/docevals/core/engine.js";
import { runList } from "../../../src/docevals/commands/list.js";
import { DocevalsError } from "../../../src/docevals/types.js";

const BODY = "\n# Install\n\nRun the installer.\n";

/**
 * A corpus with one page in a suite of two deterministic evals: one that
 * always passes and one that always fails. Both are freshness checks against
 * fixed dates, so nothing here needs a provider or a subprocess.
 */
function scaffold(): string {
  const root = mkdtempSync(join(tmpdir(), "manni-docevals-select-"));
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(
    join(root, "docs", "install.md"),
    [
      "---",
      "title: Install",
      "last-reviewed: 2020-01-01",
      "evals:",
      "  - use: always-passes",
      "  - use: always-fails",
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
      "  defaults:",
      "    suite: reference",
      "  evals:",
      "    always-passes:",
      "      assertion: The page was reviewed within the last century.",
      "      grader: tool:freshness",
      "      options:",
      "        max-age-days: 100000",
      "      severity: error",
      "    always-fails:",
      "      assertion: The page was reviewed in the last day.",
      "      grader: tool:freshness",
      "      options:",
      "        max-age-days: 1",
      "      severity: error",
      "  suites:",
      "    reference:",
      "      target-pass-rate: 1.0",
      "      evals: [always-passes, always-fails]",
      // A second suite no page resolves to, so `--eval x --suite solo` has an
      // empty intersection while each filter alone matches something.
      "    solo:",
      "      target-pass-rate: 1.0",
      "      evals: [always-fails]",
      "",
    ].join("\n"),
  );
  return root;
}

const run = (root: string, options: Record<string, unknown> = {}) =>
  runEvals({ cwd: root, generate: false, ...options });

describe("selection: the unfiltered baseline", () => {
  it("runs both evals and fails the suite", async () => {
    const report = await run(scaffold());
    expect(report.evalResults).toHaveLength(2);
    expect(report.suites[0]?.meetsTarget).toBe(false);
    expect(report.exitCode).toBe(1);
  });
});

describe("selection: --eval", () => {
  it("runs only the named eval", async () => {
    const report = await run(scaffold(), { evalNames: ["always-fails"] });
    expect(report.evalResults).toHaveLength(1);
    expect(report.evalResults[0]?.evalName).toBe("always-fails");
  });

  it("accepts more than one name", async () => {
    const report = await run(scaffold(), {
      evalNames: ["always-passes", "always-fails"],
    });
    expect(report.evalResults).toHaveLength(2);
  });

  // Never a green run over zero evals — the same contract `discoverPages`
  // already enforces for an empty input set.
  it("is a usage error when it matches nothing", async () => {
    await expect(run(scaffold(), { evalNames: ["no-such-eval"] })).rejects.toThrow(
      DocevalsError,
    );
    await expect(run(scaffold(), { evalNames: ["no-such-eval"] })).rejects.toThrow(
      /no-such-eval/,
    );
  });

  // The whole point of the ADR. Selecting the one eval that passes must not
  // let the run report that the suite's target was met.
  it("does not report a suite as meeting target on partial evidence", async () => {
    const report = await run(scaffold(), { evalNames: ["always-passes"] });

    expect(report.evalResults).toHaveLength(1);
    expect(report.evalResults[0]?.outcome).toBe("pass");
    // 1/1 would be 100% against a target of 1.0. It must not count.
    expect(report.suites[0]?.partial).toBe(true);
    expect(report.suites[0]?.meetsTarget).toBe(false);
  });

  it("still exits 1 when a selected eval actually fails", async () => {
    const report = await run(scaffold(), { evalNames: ["always-fails"] });
    expect(report.exitCode).toBe(1);
  });

  // A filtered run that finds nothing wrong is not a passing gate, but it is
  // also not a failure: exit 0 with the suite marked partial.
  it("exits 0 when every selected eval passes", async () => {
    const report = await run(scaffold(), { evalNames: ["always-passes"] });
    expect(report.exitCode).toBe(0);
  });
});

describe("selection: --suite", () => {
  it("restricts the run to that suite's members", async () => {
    const report = await run(scaffold(), { suite: "reference" });
    expect(report.evalResults).toHaveLength(2);
  });

  it("is a usage error when the suite is not defined", async () => {
    await expect(run(scaffold(), { suite: "nope" })).rejects.toThrow(/nope/);
  });

  // Selecting a whole suite still runs every one of its evals, so the
  // measurement is complete — but the run saw only part of the corpus, so the
  // same suspension applies rather than a special case nobody would remember.
  it("marks the suite partial like any other filter", async () => {
    const report = await run(scaffold(), { suite: "reference" });
    expect(report.suites[0]?.partial).toBe(true);
  });
});

describe("selection: an unfiltered run is unchanged", () => {
  it("leaves suites unmarked and enforced", async () => {
    const report = await run(scaffold());
    expect(report.suites[0]?.partial).toBeUndefined();
    expect(report.suites[0]?.meetsTarget).toBe(false);
  });
});

describe("selection: a filter that matches only skipped work", () => {
  // `matched` counted evals on pages that never run, so the empty-match usage
  // error did not fire and the run exited 0 having executed nothing — one
  // character away from the typo that correctly exits 2.
  it("is a usage error when every matching page is skipped", async () => {
    const root = scaffold();
    writeFileSync(
      join(root, "docs", "install.md"),
      readFileSync(join(root, "docs", "install.md"), "utf8").replace(
        "title: Install",
        "title: Install\neval-skip: true",
      ),
    );
    await expect(run(root, { evalNames: ["always-passes"] })).rejects.toThrow(
      /matched no evals that would run/,
    );
  });
});

describe("selection: list answers what run refuses", () => {
  /** A skipped page that still declares the eval. */
  function skippedButDeclared(): string {
    const root = scaffold();
    writeFileSync(
      join(root, "docs", "install.md"),
      readFileSync(join(root, "docs", "install.md"), "utf8").replace(
        "title: Install",
        "title: Install\neval-skip: true",
      ),
    );
    return root;
  }

  // `run` must refuse: executing nothing and exiting 0 is the hazard.
  it("run still refuses a filter that would grade nothing", async () => {
    await expect(
      run(skippedButDeclared(), { evalNames: ["always-passes"] }),
    ).rejects.toThrow(/matched no evals that would run/);
  });

  // `list` must not: it executes nothing by design, and showing that the eval
  // resolves but is skipped is the answer the user came for — it is also the
  // command run's own error message points at.
  it("list shows the resolved plan instead of throwing", () => {
    const run_ = runList([], { cwd: skippedButDeclared(), evalNames: ["always-passes"] });
    expect(run_.plans).toHaveLength(1);
    expect(run_.plans[0]?.skip).toBe(true);
    expect(run_.plans[0]?.evals.map((e) => e.name)).toEqual(["always-passes"]);
  });

  it("list still errors on a name that resolves nowhere", () => {
    expect(() => runList([], { cwd: scaffold(), evalNames: ["no-such-eval"] })).toThrow(
      /no-such-eval/,
    );
  });
});

describe("selection: --eval and --suite combined", () => {
  // `byName && bySuite` is simple, but it is the invariant the ADR is built
  // around, so the intersection is worth pinning rather than inferring from
  // the two filters tested in isolation.
  it("intersects the two filters", async () => {
    const report = await run(scaffold(), {
      evalNames: ["always-passes"],
      suite: "reference",
    });
    expect(report.evalResults.map((r) => r.evalName)).toEqual(["always-passes"]);
  });

  it("still suspends the suite target", async () => {
    const report = await run(scaffold(), {
      evalNames: ["always-passes"],
      suite: "reference",
    });
    expect(report.suites[0]?.partial).toBe(true);
    expect(report.suites[0]?.meetsTarget).toBe(false);
    expect(report.exitCode).toBe(0);
  });

  // An empty intersection is still a usage error, not a green run over zero
  // evals — the two filters can each match while their overlap does not.
  it("is a usage error when the intersection is empty", async () => {
    await expect(
      run(scaffold(), { evalNames: ["always-passes"], suite: "solo" }),
    ).rejects.toThrow(/matched no evals/);
  });
});
