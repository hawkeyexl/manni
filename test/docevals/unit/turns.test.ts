/**
 * The judge turn budget (ADR 01019).
 *
 * A "turn" is one uncached inference call. The budget replaces the dollar
 * ceiling it supersedes, and the two properties it has to hold are the reasons
 * it replaced it: a cache hit costs nothing, and the cap is exact even when
 * several workers are dispatching at once.
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { MockProvider, mockVerdict } from "@hawkeyexl/inference";
import { makeJudge } from "../../../src/docevals/judge/judge.js";
import {
  isTurnBudgetSkip,
  turnBudgetSkipReason,
} from "../../../src/docevals/judge/budget.js";
import { runEvals } from "../../../src/docevals/core/engine.js";
import { parseDocevalsConfig } from "../helpers/config.js";
import { parseConfig } from "../../../src/docevals/core/config.js";
import { resolvePage } from "../../../src/docevals/core/resolve.js";
import { stripFrontmatterBlock, type PageFile } from "../../../src/docevals/core/discover.js";
import { extractFrontmatter } from "../../../src/meta/index.js";
import type { GraderTarget } from "../../../src/docevals/graders/types.js";

/** A judgeable target. Distinct bodies get distinct cache keys. */
function makeTarget(body: string, file = "docs/page.md"): GraderTarget {
  const content = [
    "---",
    "title: x",
    "evals:",
    "  - id: claim-check",
    "    assertion: The page satisfies the claim.",
    "    examples: { pass: yes, fail: no }",
    "---",
    body,
  ].join("\n");
  const page: PageFile = {
    file,
    absPath: `/fake/${file}`,
    content,
    body: stripFrontmatterBlock(content),
    frontmatter: extractFrontmatter(content, "markdown"),
  };
  const config = parseDocevalsConfig("version: 1\n", "/fake/manni.config.yaml");
  const plan = resolvePage(page, config);
  return { plan, eval: plan.evals[0]! };
}

const tempRoot = () => mkdtempSync(join(tmpdir(), "manni-docevals-turns-"));

const targets = (n: number): GraderTarget[] =>
  Array.from({ length: n }, (_, i) => makeTarget(`Body ${i}.`, `docs/page-${i}.md`));

const skipped = (r: { outcome: string }) => r.outcome === "skipped";

describe("judge turn budget", () => {
  const config = parseDocevalsConfig("version: 1\n");

  it("spends no turns on a fully cached ensemble", async () => {
    const root = tempRoot();
    const target = makeTarget("Cached body.");

    // Warm the cache with no budget in play.
    const first = new MockProvider([mockVerdict("pass", 0.95)]);
    await makeJudge({ provider: first, root })([target], config, {});
    expect(first.requests).toHaveLength(3);

    // The docs corpus replays committed cache fixtures with no API key. A
    // budget that counted cached runs would make `verify-docs` fail on a
    // number that describes work nobody did.
    const second = new MockProvider([mockVerdict("pass", 0.95)]);
    const results = await makeJudge({ provider: second, root })([target], config, {
      maxTurns: 1,
    });
    expect(second.requests).toHaveLength(0);
    expect(results[0]?.outcome).toBe("pass");
  });

  it("skips whole targets once the budget cannot cover another ensemble", async () => {
    const provider = new MockProvider([mockVerdict("pass", 0.95)]);
    const results = await makeJudge({ provider, root: tempRoot() })(
      targets(2),
      config,
      { maxTurns: 3 },
    );

    // 3 turns buys exactly one 3-run ensemble.
    expect(provider.requests).toHaveLength(3);
    expect(results.filter((r) => !skipped(r))).toHaveLength(1);

    const stopped = results.find(skipped);
    expect(stopped?.skipReason).toMatch(/turn budget/i);
  });

  it("never judges a partial ensemble", async () => {
    const provider = new MockProvider([mockVerdict("pass", 0.95)]);
    // 4 turns, 3 per ensemble: the second target cannot be covered, and a
    // consensus over 1 run is a different measurement, not a cheaper one.
    const results = await makeJudge({ provider, root: tempRoot() })(
      targets(2),
      config,
      { maxTurns: 4 },
    );

    expect(provider.requests).toHaveLength(3);
    for (const r of results.filter((x) => !skipped(x))) {
      expect(r.consensus?.runs).toHaveLength(3);
    }
  });

  // The defect the dollar ceiling had. It tested the budget before dispatch
  // and added the spend after, so N concurrent workers all cleared an
  // almost-exhausted budget and then all spent. Turns are known before the
  // call, so the budget is claimed synchronously and the cap is exact.
  it("holds the cap exactly under concurrent workers", async () => {
    const concurrent = parseDocevalsConfig(
      ["version: 1", "defaults:", "  concurrency: 4"].join("\n"),
    );
    const provider = new MockProvider([mockVerdict("pass", 0.95)]);
    const results = await makeJudge({ provider, root: tempRoot() })(
      targets(4),
      concurrent,
      { maxTurns: 3 },
    );

    expect(provider.requests).toHaveLength(3);
    expect(results.filter(skipped)).toHaveLength(3);
  });

  it("is unbounded when no budget is set", async () => {
    const provider = new MockProvider([mockVerdict("pass", 0.95)]);
    const results = await makeJudge({ provider, root: tempRoot() })(
      targets(3),
      config,
      {},
    );

    expect(provider.requests).toHaveLength(9);
    expect(results.filter(skipped)).toHaveLength(0);
  });

  it("falls back to judge.max-turns, and the option overrides it", async () => {
    const bounded = parseDocevalsConfig(
      ["version: 1", "judge:", "  max-turns: 3"].join("\n"),
    );

    const fromConfig = new MockProvider([mockVerdict("pass", 0.95)]);
    await makeJudge({ provider: fromConfig, root: tempRoot() })(
      targets(2),
      bounded,
      {},
    );
    expect(fromConfig.requests).toHaveLength(3);

    const overridden = new MockProvider([mockVerdict("pass", 0.95)]);
    await makeJudge({ provider: overridden, root: tempRoot() })(
      targets(2),
      bounded,
      { maxTurns: 6 },
    );
    expect(overridden.requests).toHaveLength(6);
  });
});

/**
 * The engine's half of the budget contract. Skipped evals are excluded from a
 * suite's pass rate (`graded = passed + failed + errored`), so a run that
 * exhausts its budget would otherwise exit 0 having judged less than it was
 * asked to -- green, with coverage quietly missing.
 *
 * Driven off the repo's own config, like the full-run integration test: a bare
 * config resolves none of the fixture pages' `use:` references, which yields
 * error-level problems of its own and no ai targets to skip.
 */
describe("a run truncated by its turn budget", () => {
  const REPO = resolve(import.meta.dirname, "../../..");

  async function reportWith(skipReason: string) {
    const config = parseConfig(
      readFileSync(join(REPO, "manni.config.yaml"), "utf8"),
      join(REPO, "manni.config.yaml"),
    );
    return runEvals({
      cwd: REPO,
      config,
      globs: ["test/docevals/fixtures/pages/docs/actions/goTo.mdx"],
      generate: false,
      judge: async (aiTargets) =>
        aiTargets.map((t) => ({
          evalName: t.eval.name,
          type: t.eval.type,
          grader: t.eval.grader,
          file: t.plan.page.file,
          outcome: "skipped" as const,
          skipReason,
          durationMs: 0,
        })),
    });
  }

  it("says so, naming how many evals went unjudged", async () => {
    const report = await reportWith("judge turn budget exhausted (3)");
    const warning = report.problems.find((p) => p.message.includes("turn budget"));

    expect(warning, "a budget-truncated run reports it").toBeDefined();
    expect(warning?.level).toBe("warning");
    expect(warning?.message).toMatch(/\d+ eval\(s\) were not judged/);
  });

  // Warning, not error: the cap was asked for, so tripping it is expected and
  // must not fail an otherwise-clean build. Going quiet is the part that would
  // be wrong -- so it must also not raise the exit code by itself.
  it("does not raise an error-level problem", async () => {
    const report = await reportWith("judge turn budget exhausted (3)");
    const fromBudget = report.problems.filter((p) =>
      p.message.includes("turn budget"),
    );
    expect(fromBudget.every((p) => p.level === "warning")).toBe(true);
  });

  it("stays silent when evals were skipped for another reason", async () => {
    const report = await reportWith("judge skipped (--deterministic-only)");
    expect(report.problems.some((p) => p.message.includes("turn budget"))).toBe(
      false,
    );
  });
});

// The marker was a bare string produced in one file and matched with
// `.includes("turn budget")` in two others. A rename in the producer would
// have left both detectors quietly matching nothing, and no test would have
// failed — the tests that exercise truncation write the skip reason themselves.
// Producer and detector now share a module, and this pins that they agree.
describe("the turn-budget skip marker", () => {
  it("is recognized by the predicate its callers use", () => {
    expect(isTurnBudgetSkip(turnBudgetSkipReason(3))).toBe(true);
  });

  it("names the cap that was hit, so the message is actionable", () => {
    expect(turnBudgetSkipReason(7)).toContain("7");
  });

  it("does not claim an unrelated skip", () => {
    expect(isTurnBudgetSkip("skipped by --deterministic-only")).toBe(false);
    expect(isTurnBudgetSkip(undefined)).toBe(false);
  });
});
