/**
 * Integration: fill over a copy of the fixture corpus, proving the round trip
 * — proposals land in every frontmatter shape the corpus contains, and the
 * rewritten pages resolve cleanly. The real corpus is never mutated.
 */
import { describe, it, expect } from "vitest";
import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runFill } from "../../../src/docevals/commands/fill.js";
import { MockProvider } from "@hawkeyexl/inference";
import { loadConfig } from "../../../src/docevals/core/config.js";
import { discoverPages } from "../../../src/docevals/core/discover.js";
import { resolvePages } from "../../../src/docevals/core/resolve.js";

const REPO = resolve(import.meta.dirname, "../../..");

/** The corpus, with the showcase config that sits beside its pages. */
const CORPUS = join(REPO, "test/docevals/fixtures/pages");

const PROPOSAL = {
  id: "fill-added-check",
  assertion: "The page states what problem it solves before how to solve it.",
  confidence: 0.9,
  examples: {
    pass: "The intro motivates the feature before instructions.",
    fail: "The page opens with bare syntax.",
  },
};

/**
 * A writable copy of the corpus. The copy carries the config beside it, so a
 * run started there discovers it and reads its `collections:` as the paths.
 */
function copyCorpus(): string {
  const root = mkdtempSync(join(tmpdir(), "manni-docevals-fill-int-"));
  cpSync(CORPUS, root, { recursive: true });
  return root;
}

describe("fill over the fixture corpus", () => {
  it("appends proposals across every frontmatter shape and stays resolvable", async () => {
    const root = copyCorpus();
    const provider = new MockProvider([{ json: { evals: [PROPOSAL] } }]);
    const report = await runFill([], {
      cwd: root,
      providerInstance: provider,
      noCache: true,
    });

    expect(report.exitCode).toBe(0);
    const byFile = new Map(report.results.map((r) => [r.file, r] as const));

    // Page-level skip is honored without an LLM call.
    expect(byFile.get("index.mdx")?.status).toBe("skipped");
    // Every other page got the proposal appended.
    for (const r of report.results) {
      if (r.file === "index.mdx") continue;
      expect(r.status, r.file).toBe("filled");
      expect(r.written.map((p) => p.id)).toEqual(["fill-added-check"]);
    }

    const page = (rel: string) =>
      readFileSync(join(root, rel), "utf8");

    // No evals key -> array shorthand created.
    expect(page("docs/tests/overview.mdx")).toContain("evals:");
    // Object form with a nested seq -> appended, suite preserved.
    const inline = page("docs/tests/inline.mdx");
    expect(inline).toContain("suite: reference");
    expect(inline).toContain("fill-added-check");
    // Object form without a nested seq -> seq created, suite preserved.
    const click = page("docs/actions/click.mdx");
    expect(click).toContain("suite: reference");
    expect(click).toContain("fill-added-check");
    // Skipped page untouched.
    expect(page("index.mdx")).toBe(
      readFileSync(join(CORPUS, "index.mdx"), "utf8"),
    );

    // The rewritten corpus still resolves without errors, and every filled
    // page's plan now includes the new eval with grader ai.
    const config = loadConfig(undefined, root);
    const plans = resolvePages(discoverPages(config, { paths: [] }, root), config);
    for (const plan of plans) {
      expect(
        plan.problems.filter((p) => p.level === "error"),
        plan.page.file,
      ).toEqual([]);
      if (plan.skip) continue;
      const added = plan.evals.find((e) => e.name === "fill-added-check");
      expect(added, plan.page.file).toBeDefined();
      expect(added?.grader).toBe("ai");
      expect(added?.type).toBe("regression");
    }
  });
});
