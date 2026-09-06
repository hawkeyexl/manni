/**
 * Pre-run feasibility.
 *
 * ADRs 01020/01022 already refuse to call a missing verdict a pass — but they
 * decide that at grade time, which for an `ai` eval is after the judge has been
 * paid. Everything checked here is knowable from the config and the page, so it
 * is knowable for free.
 *
 * The headline case is a misspelled grader option. `options` is open in the
 * published vocabulary by design, so before this `max-age-day: 30` fell
 * straight through to the default of 365 and the eval quietly checked
 * something its author never wrote.
 */
import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runEvals } from "../../../src/docevals/core/engine.js";

const BODY = "\n# Install\n\nRun the installer.\n";

/** One page, one config-defined eval written exactly as `evalLines` says. */
function scaffold(evalLines: string[]): string {
  const root = mkdtempSync(join(tmpdir(), "manni-docevals-feasible-"));
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(
    join(root, "docs", "install.md"),
    [
      "---",
      "title: Install",
      "last-reviewed: 2020-01-01",
      "evals:",
      "  - use: subject",
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
      "    subject:",
      ...evalLines,
      "",
    ].join("\n"),
  );
  return root;
}

const errorsOf = async (root: string): Promise<string[]> => {
  const report = await runEvals({ cwd: root, generate: false });
  return report.problems.filter((p) => p.level === "error").map((p) => p.message);
};

describe("feasibility", () => {
  it("passes a correctly configured eval", async () => {
    const errors = await errorsOf(
      scaffold([
        "      assertion: Reviewed recently.",
        "      grader: tool:freshness",
        "      options:",
        "        max-age-days: 100000",
      ]),
    );
    expect(errors).toEqual([]);
  });

  it("names a misspelled option instead of silently defaulting", async () => {
    const root = scaffold([
      "      assertion: Reviewed recently.",
      "      grader: tool:freshness",
      "      options:",
      "        max-age-day: 30",
    ]);
    const errors = await errorsOf(root);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('unknown option "max-age-day"');
    // The message has to say what *is* accepted, or the author is left
    // guessing which of two plausible spellings was wrong.
    expect(errors[0]).toContain("max-age-days");
    // And it must fail the run, not merely mention it.
    const report = await runEvals({ cwd: root, generate: false });
    expect(report.exitCode).toBe(1);
  });

  it("rejects an out-of-range option value", async () => {
    const errors = await errorsOf(
      scaffold([
        "      assertion: Distinct enough.",
        "      grader: tool:differentiation",
        "      options:",
        "        max-similarity: 4",
      ]),
    );
    expect(errors[0]).toContain("max-similarity");
    expect(errors[0]).toContain("at most 1");
  });

  it("requires tool:docmeta to name its schema set (ADR 01013)", async () => {
    const errors = await errorsOf(
      scaffold([
        "      assertion: Frontmatter validates.",
        "      grader: tool:docmeta",
      ]),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("options.schemas is required");
  });

  // Not a feasibility check: both schemas already require an assertion on an
  // ai eval, and they reject it at parse time as a usage error (exit 2), which
  // is earlier and more precise than anything this pass could say. Pinned here
  // so the duplicate check is not "helpfully" re-added later.
  it("leaves an assertion-less ai eval to the config schema", async () => {
    await expect(
      runEvals({ cwd: scaffold(["      grader: ai"]), generate: false }),
    ).rejects.toThrow(/must have required property 'assertion'/);
  });
});
