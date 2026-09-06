/**
 * Integration: full deterministic pipeline over the fixture corpus, with the
 * real command grader running the pre-generated fixture script via node.
 */
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { runEvals } from "../../../src/docevals/core/engine.js";

const ROOT = resolve(import.meta.dirname, "../../..");

describe("deterministic run over fixtures", () => {
  it("produces the expected outcomes", async () => {
    const report = await runEvals({
      cwd: ROOT,
      deterministicOnly: true,
      generate: false,
    });

    expect(report.pages).toBe(13);
    const byKey = new Map(
      report.evalResults.map((r) => [`${r.file} ${r.evalName}`, r] as const),
    );

    // Pre-generated script runs and passes.
    expect(
      byKey.get("test/docevals/fixtures/pages/docs/actions/find.mdx has-examples-heading")
        ?.outcome,
    ).toBe("pass");

    // Severity-overridden freshness fails at error level.
    const goTo = byKey.get("test/docevals/fixtures/pages/docs/actions/goTo.mdx fresh-enough");
    expect(goTo?.outcome).toBe("fail");
    expect(goTo?.findings?.[0]?.ruleId).toBe("freshness/stale");

    // Warning-severity freshness passes but carries the finding.
    const concepts = byKey.get(
      "test/docevals/fixtures/pages/docs/get-started/concepts.md fresh-enough",
    );
    expect(concepts?.outcome).toBe("pass");
    expect(concepts?.findings?.[0]?.severity).toBe("warning");

    // Missing command with generation disabled errors.
    expect(
      byKey.get(
        "test/docevals/fixtures/pages/docs/get-started/installation.mdx install-command-present",
      )?.outcome,
    ).toBe("error");

    // AI evals are skipped under --deterministic-only.
    expect(
      byKey.get("test/docevals/fixtures/pages/docs/get-started/concepts.md defines-core-terms")
        ?.outcome,
    ).toBe("skipped");

    // Per-page eval skip.
    expect(
      byKey.get("test/docevals/fixtures/pages/docs/tests/inline.mdx readable")?.outcome,
    ).toBe("skipped");

    // Suite summaries exist for configured suites; failures produce exit 1.
    expect(report.suites.map((s) => s.suite)).toContain("reference");
    expect(report.exitCode).toBe(1);
  }, 30000);

  it("skips frontmatter commands when disabled", async () => {
    const report = await runEvals({
      cwd: ROOT,
      deterministicOnly: true,
      generate: false,
      execution: false,
    });
    const finding = report.evalResults.find(
      (r) =>
        r.file === "test/docevals/fixtures/pages/docs/actions/find.mdx" &&
        r.evalName === "has-examples-heading",
    );
    expect(finding?.outcome).toBe("skipped");
    expect(finding?.skipReason).toMatch(/frontmatter commands not granted/);
  });
});
