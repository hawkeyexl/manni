/**
 * `init` scaffolds the config a new user starts from, so a mistake here is
 * invisible: a config the loader does not recognize yields a defaults-only run
 * with no named evals and no suites — and passes. These tests load what `init`
 * writes rather than matching its text.
 */
import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import { runInit } from "../../../src/docevals/commands/init.js";
import { loadConfig } from "../../../src/docevals/core/config.js";
import { runEvals } from "../../../src/docevals/core/engine.js";
import { runList } from "../../../src/docevals/commands/list.js";
import { DocevalsError } from "../../../src/docevals/types.js";

const dir = () => mkdtempSync(join(tmpdir(), "manni-docevals-init-"));

/** A page in the shape the scaffold's `files.include` looks for. */
function page(root: string, name: string, frontmatter: string[] = []): void {
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(
    join(root, "docs", name),
    [
      "---",
      "title: Sample",
      "last-reviewed: 2026-08-01",
      ...frontmatter,
      "---",
      "",
      "# Sample",
      "",
      "Body text.",
      "",
    ].join("\n"),
  );
}

describe("runInit", () => {
  it("writes manni.config.yaml", () => {
    const root = dir();
    const path = runInit(root);
    expect(basename(path)).toBe("manni.config.yaml");
    expect(existsSync(path)).toBe(true);
  });

  it("nests the starter config under the docevals namespace", () => {
    const root = dir();
    const text = readFileSync(runInit(root), "utf8");
    expect(text).toMatch(/^docevals:$/m);
  });

  // The whole point of the scaffold: what it writes must survive a round-trip
  // through the real loader with its evals and suites intact.
  it("scaffolds a config the loader reads back with its evals and suites", () => {
    const root = dir();
    runInit(root);
    const config = loadConfig(undefined, root);
    expect(Object.keys(config.evals)).toContain("no-future-promises");
    expect(config.suites.default?.evals).toContain("fresh-enough");
    expect(config.judge.ensembleRuns).toBe(3);
  });

  // The defect this pins: the scaffold defined a suite named `default` and
  // then set `defaults.suite: null`, so nothing selected it. On a corpus whose
  // pages carry no eval frontmatter — every corpus on day one — that resolved
  // zero evals, and `run` exited 0 having checked nothing (ADR 01041).
  //
  // Asserted through resolution rather than against the file's text, for the
  // reason the whole file exists: what matters is what the loader does with
  // it, not which characters it contains.
  it("attaches its own suite to a page carrying no eval frontmatter", () => {
    const root = dir();
    runInit(root);
    page(root, "sample.md");
    const { plans } = runList([], { cwd: root });
    expect(plans).toHaveLength(1);
    expect(plans[0]?.suite).toBe("default");
    expect(plans[0]?.evals.map((e) => e.name).sort()).toEqual([
      "fresh-enough",
      "no-future-promises",
    ]);
  });

  // ...and end to end: a freshly scaffolded project must not be able to reach
  // the empty-plan usage error on its first run.
  it("scaffolds a project whose first run actually grades something", async () => {
    const root = dir();
    runInit(root);
    page(root, "sample.md");
    const report = await runEvals({ cwd: root, generate: false });
    expect(report.evalResults.length).toBeGreaterThan(0);
    // The ai eval is skipped with no provider; the freshness one is real work.
    expect(report.evalResults.some((r) => r.outcome !== "skipped")).toBe(true);
  });

  it("refuses to overwrite an existing config", () => {
    const root = dir();
    runInit(root);
    expect(() => runInit(root)).toThrow(DocevalsError);
  });
});
