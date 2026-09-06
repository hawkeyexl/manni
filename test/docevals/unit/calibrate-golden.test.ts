/**
 * The golden set's human-confirmation gate (ADR 01016).
 *
 * The golden set is the instrument that measures the judge, so it cannot be
 * assembled by the judge and it cannot be assembled by an agent. `--seed` turns
 * recorded human reviews into *candidates*; a person flips `reviewed` before
 * they mean anything.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  loadGoldenCases,
  renderCalibration,
  runCalibrate,
  seedGoldenCases,
  SEEDED_GOLDEN_FILE,
} from "../../../src/docevals/commands/calibrate.js";
import { recordReview, contentHash } from "../../../src/docevals/core/reviews.js";
import type { EvalResult } from "../../../src/docevals/types.js";

const PAGE_BODY = "\n# Install\n\nRun `npm i -g doc-detective`.\n";

/** A repo with one page, one ai eval, and a config that resolves it. */
function scaffold(): string {
  const root = mkdtempSync(join(tmpdir(), "manni-docevals-golden-"));
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(
    join(root, "docs", "install.md"),
    ["---", "title: Install", "evals:", "  - use: no-future-promises", "---", PAGE_BODY].join("\n"),
  );
  writeFileSync(
    join(root, "manni.config.yaml"),
    [
      "docevals:",
      "  version: 1",
      "  files:",
      '    include: ["docs/**/*.md"]',
      "  evals:",
      "    no-future-promises:",
      "      assertion: The page makes no claims about unreleased functionality.",
      "      grader: ai",
      "      examples: { pass: Describes shipped behavior., fail: Says coming soon. }",
    ].join("\n"),
  );
  return root;
}

function writeGolden(root: string, name: string, body: string): string {
  const dir = join(root, ".manni/docevals", "golden");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), body);
  return dir;
}

/** A judge that always agrees with the page passing, without a provider. */
const alwaysPass = async (targets: { plan: { page: { file: string } }; eval: { name: string } }[]) =>
  targets.map(
    (t) =>
      ({
        evalName: t.eval.name,
        type: "regression",
        grader: "ai",
        file: t.plan.page.file,
        outcome: "pass",
        consensus: {
          verdict: "pass",
          agreement: 1,
          meanConfidence: 0.95,
          votes: { pass: 3, fail: 0, partial: 0, error: 0 },
          runs: [],
          zone: "auto-pass",
        },
        durationMs: 0,
      }) as unknown as EvalResult,
  );

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("loadGoldenCases: the reviewed gate", () => {
  it("treats an absent `reviewed` as false", () => {
    const root = scaffold();
    const dir = writeGolden(
      root,
      "cases.yaml",
      "- file: docs/install.md\n  eval: no-future-promises\n  expected: pass\n",
    );
    // Not back-compatible on purpose: defaulting to true would silently bless
    // every case that already exists, which is exactly what the bit is for.
    expect(loadGoldenCases(dir)[0]?.reviewed).toBe(false);
  });

  it("reads the kebab-case file keys into camelCase", () => {
    const root = scaffold();
    const dir = writeGolden(
      root,
      "cases.yaml",
      [
        "- file: docs/install.md",
        "  eval: no-future-promises",
        "  expected: pass",
        "  reviewed: true",
        "  content-hash: abc123",
        "  source: review",
        "  reviewed-by: priya",
        "",
      ].join("\n"),
    );
    const [c] = loadGoldenCases(dir);
    expect(c?.reviewed).toBe(true);
    expect(c?.contentHash).toBe("abc123");
    expect(c?.source).toBe("review");
    expect(c?.reviewedBy).toBe("priya");
  });
});

describe("calibrate --seed", () => {
  it("writes one unreviewed candidate per recorded review", async () => {
    const root = scaffold();
    recordReview(root, {
      file: "docs/install.md",
      evalName: "no-future-promises",
      contentHash: contentHash(PAGE_BODY),
      verdict: "pass",
      reviewer: "priya",
    });

    const written = seedGoldenCases({ cwd: root });
    expect(written.added).toBe(1);

    const raw = parseYaml(
      readFileSync(join(root, ".manni/docevals", "golden", SEEDED_GOLDEN_FILE), "utf8"),
    ) as Record<string, unknown>[];
    expect(raw).toHaveLength(1);
    expect(raw[0]).toMatchObject({
      file: "docs/install.md",
      eval: "no-future-promises",
      expected: "pass",
      reviewed: false,
      source: "review",
      "content-hash": contentHash(PAGE_BODY),
    });
  });

  it("is idempotent on (file, eval) rather than duplicating", () => {
    const root = scaffold();
    const entry = {
      file: "docs/install.md",
      evalName: "no-future-promises",
      contentHash: contentHash(PAGE_BODY),
      verdict: "pass" as const,
    };
    recordReview(root, entry);
    seedGoldenCases({ cwd: root });
    recordReview(root, { ...entry, verdict: "fail" });
    const second = seedGoldenCases({ cwd: root });

    expect(second.added).toBe(0);
    expect(second.updated).toBe(1);
    const cases = loadGoldenCases(join(root, ".manni/docevals", "golden"));
    expect(cases).toHaveLength(1);
    expect(cases[0]?.expected).toBe("fail");
  });

  // `updated` fired whenever the key already existed, so a re-seed with no
  // new reviews reported "N updated" having changed nothing. ADR 01016 keeps
  // the two counts separate so the difference between runs is visible; a
  // number that moves when nothing moved shows no difference.
  it("counts nothing as updated when a re-seed changes no case", () => {
    const root = scaffold();
    recordReview(root, {
      file: "docs/install.md",
      evalName: "no-future-promises",
      contentHash: contentHash(PAGE_BODY),
      verdict: "pass",
    });
    expect(seedGoldenCases({ cwd: root })).toMatchObject({ added: 1, updated: 0 });
    expect(seedGoldenCases({ cwd: root })).toMatchObject({
      added: 0,
      updated: 0,
      total: 1,
    });
  });

  // Seeding judges nothing, so it must not construct a provider. This is what
  // lets it run in CI, where there is no API key.
  it("needs no provider", () => {
    const root = scaffold();
    recordReview(root, {
      file: "docs/install.md",
      evalName: "no-future-promises",
      contentHash: contentHash(PAGE_BODY),
      verdict: "pass",
    });
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(() => seedGoldenCases({ cwd: root })).not.toThrow();
  });

  it("reports when there is nothing to seed", () => {
    const root = scaffold();
    expect(seedGoldenCases({ cwd: root })).toMatchObject({ added: 0, updated: 0 });
  });
});

describe("runCalibrate: unreviewed and stale cases", () => {
  it("counts an unreviewed case toward the rate, and says so", async () => {
    const root = scaffold();
    writeGolden(
      root,
      "cases.yaml",
      [
        "- file: docs/install.md",
        "  eval: no-future-promises",
        "  expected: pass",
        "  reviewed: false",
        "",
      ].join("\n"),
    );

    const report = await runCalibrate({ cwd: root, judge: alwaysPass });
    // Counted: the decision is warn-and-include, so the loop keeps moving
    // rather than producing a red build before anyone has done anything wrong.
    expect(report.total).toBe(1);
    expect(report.agreements).toBe(1);
    expect(report.agreementRate).toBe(1);
    expect(report.unreviewed).toBe(1);
    expect(report.cases[0]?.reviewed).toBe(false);
  });

  it("flags a case whose page has changed since it was verified", async () => {
    const root = scaffold();
    writeGolden(
      root,
      "cases.yaml",
      [
        "- file: docs/install.md",
        "  eval: no-future-promises",
        "  expected: pass",
        "  reviewed: true",
        "  content-hash: staleaaaa",
        "",
      ].join("\n"),
    );

    const report = await runCalibrate({ cwd: root, judge: alwaysPass });
    expect(report.stale).toBe(1);
    expect(report.cases[0]?.stale).toBe(true);
  });

  it("does not flag a case whose hash still matches the page", async () => {
    const root = scaffold();
    writeGolden(
      root,
      "cases.yaml",
      [
        "- file: docs/install.md",
        "  eval: no-future-promises",
        "  expected: pass",
        "  reviewed: true",
        `  content-hash: ${contentHash(PAGE_BODY)}`,
        "",
      ].join("\n"),
    );

    const report = await runCalibrate({ cwd: root, judge: alwaysPass });
    expect(report.stale).toBe(0);
    expect(report.unreviewed).toBe(0);
  });

  // One judge call for the whole set, not one per case (ADR 01016). Without
  // this the concurrency pool inside makeJudge never has more than one target,
  // and a --max-turns here would silently mean per case.
  it("judges the whole set in a single call", async () => {
    const root = scaffold();
    writeFileSync(
      join(root, "docs", "second.md"),
      ["---", "title: Second", "evals:", "  - use: no-future-promises", "---", PAGE_BODY].join("\n"),
    );
    writeGolden(
      root,
      "cases.yaml",
      [
        "- file: docs/install.md",
        "  eval: no-future-promises",
        "  expected: pass",
        "  reviewed: true",
        "- file: docs/second.md",
        "  eval: no-future-promises",
        "  expected: pass",
        "  reviewed: true",
        "",
      ].join("\n"),
    );

    const judge = vi.fn(alwaysPass);
    const report = await runCalibrate({ cwd: root, judge });
    expect(judge).toHaveBeenCalledTimes(1);
    expect(report.total).toBe(2);
  });
});

describe("calibrate --seed: the confirmed bit across a re-review", () => {
  it("keeps a confirmed bit when the verdict is unchanged", () => {
    const root = scaffold();
    const entry = {
      file: "docs/install.md",
      evalName: "no-future-promises",
      contentHash: contentHash(PAGE_BODY),
      verdict: "pass" as const,
    };
    recordReview(root, entry);
    seedGoldenCases({ cwd: root });

    const dir = join(root, ".manni/docevals", "golden");
    const path = join(dir, SEEDED_GOLDEN_FILE);
    writeFileSync(path, readFileSync(path, "utf8").replace("reviewed: false", "reviewed: true"));

    recordReview(root, entry);
    seedGoldenCases({ cwd: root });
    expect(loadGoldenCases(dir)[0]?.reviewed).toBe(true);
  });

  // A confirmed bit describes a verdict, not a filename. Carrying it across a
  // flip would let `expected` change under a human's signature.
  it("clears the confirmed bit when the recorded verdict flips", () => {
    const root = scaffold();
    const entry = {
      file: "docs/install.md",
      evalName: "no-future-promises",
      contentHash: contentHash(PAGE_BODY),
      verdict: "pass" as const,
    };
    recordReview(root, entry);
    seedGoldenCases({ cwd: root });

    const dir = join(root, ".manni/docevals", "golden");
    const path = join(dir, SEEDED_GOLDEN_FILE);
    writeFileSync(path, readFileSync(path, "utf8").replace("reviewed: false", "reviewed: true"));

    recordReview(root, { ...entry, verdict: "fail" });
    const result = seedGoldenCases({ cwd: root });

    const [c] = loadGoldenCases(dir);
    expect(c?.expected).toBe("fail");
    expect(c?.reviewed).toBe(false);
    expect(result.unreviewed).toBe(1);
  });
});

describe("runCalibrate: a truncated run cannot certify the judge", () => {
  /** A judge that skips every target the way the turn budget does. */
  const budgetExhausted = async (targets: { plan: { page: { file: string } }; eval: { name: string } }[]) =>
    targets.map(
      (t) =>
        ({
          evalName: t.eval.name,
          type: "regression",
          grader: "ai",
          file: t.plan.page.file,
          outcome: "skipped",
          skipReason: "judge turn budget exhausted (3)",
          durationMs: 0,
        }) as unknown as EvalResult,
    );

  // Budget-skipped cases carry no consensus, so they used to drop out of the
  // denominator: one case judged and agreeing reported 100% and exit 0, a
  // trust gate passing on a sample.
  it("does not meet the threshold when cases went unjudged", async () => {
    const root = scaffold();
    writeGolden(
      root,
      "cases.yaml",
      [
        "- file: docs/install.md",
        "  eval: no-future-promises",
        "  expected: pass",
        "  reviewed: true",
        "",
      ].join("\n"),
    );

    const report = await runCalibrate({ cwd: root, judge: budgetExhausted });
    expect(report.budgetSkipped).toBe(1);
    expect(report.meetsThreshold).toBe(false);
    expect(renderCalibration(report)).toMatch(/never judged: the turn budget ran out/);
  });

  it("names the budget rather than blaming the judge", async () => {
    const root = scaffold();
    writeGolden(
      root,
      "cases.yaml",
      ["- file: docs/install.md", "  eval: no-future-promises", "  expected: pass", ""].join("\n"),
    );
    const report = await runCalibrate({ cwd: root, judge: budgetExhausted });
    expect(report.cases[0]?.error).toMatch(/turn budget/);
  });

  it("still certifies a complete run", async () => {
    const root = scaffold();
    writeGolden(
      root,
      "cases.yaml",
      [
        "- file: docs/install.md",
        "  eval: no-future-promises",
        "  expected: pass",
        "  reviewed: true",
        "",
      ].join("\n"),
    );
    const report = await runCalibrate({ cwd: root, judge: alwaysPass });
    expect(report.budgetSkipped).toBe(0);
    expect(report.meetsThreshold).toBe(true);
  });
});

describe("calibrate --seed: a hand-written rationale survives", () => {
  it("keeps a rationale the review does not supply", () => {
    const root = scaffold();
    const entry = {
      file: "docs/install.md",
      evalName: "no-future-promises",
      contentHash: contentHash(PAGE_BODY),
      verdict: "pass" as const,
    };
    recordReview(root, entry);
    seedGoldenCases({ cwd: root });

    const dir = join(root, ".manni/docevals", "golden");
    const path = join(dir, SEEDED_GOLDEN_FILE);
    writeFileSync(
      path,
      readFileSync(path, "utf8")
        .replace("reviewed: false", "reviewed: true")
        .concat("  rationale: The deprecation banner is present.\n"),
    );

    recordReview(root, entry);
    seedGoldenCases({ cwd: root });
    expect(loadGoldenCases(dir)[0]?.rationale).toBe("The deprecation banner is present.");
  });

  it("lets a newer review note replace it", () => {
    const root = scaffold();
    const entry = {
      file: "docs/install.md",
      evalName: "no-future-promises",
      contentHash: contentHash(PAGE_BODY),
      verdict: "pass" as const,
    };
    recordReview(root, { ...entry, note: "first" });
    seedGoldenCases({ cwd: root });
    recordReview(root, { ...entry, note: "second" });
    seedGoldenCases({ cwd: root });
    const dir = join(root, ".manni/docevals", "golden");
    expect(loadGoldenCases(dir)[0]?.rationale).toBe("second");
  });
});

describe("runCalibrate: coverage is separate from agreement", () => {
  // ADR 01018's pattern: the verdict stays a statement about agreement, and
  // coverage is reported beside it. Folding both into meetsThreshold made the
  // renderer print "refine your assertions" at 100% agreement.
  it("keeps the verdict truthful when the budget truncates", async () => {
    const root = scaffold();
    writeGolden(
      root,
      "cases.yaml",
      ["- file: docs/install.md", "  eval: no-future-promises", "  expected: pass", "  reviewed: true", ""].join("\n"),
    );
    const budgetOnly = async (targets: { plan: { page: { file: string } }; eval: { name: string } }[]) =>
      targets.map(
        (t) =>
          ({
            evalName: t.eval.name, type: "regression", grader: "ai",
            file: t.plan.page.file, outcome: "skipped",
            skipReason: "judge turn budget exhausted (3)", durationMs: 0,
          }) as unknown as EvalResult,
      );
    const report = await runCalibrate({ cwd: root, judge: budgetOnly });
    expect(report.budgetSkipped).toBe(1);
    expect(report.unjudged).toBe(1);
    // No case was measured, so there is no agreement to report either way.
    expect(renderCalibration(report)).not.toMatch(/Refine the eval criteria/);
  });

  // A stale golden file used to certify on whatever still resolved: the
  // budget was guarded, a renamed page was not.
  it("counts a case whose page is gone as unjudged", async () => {
    const root = scaffold();
    writeGolden(
      root,
      "cases.yaml",
      [
        "- file: docs/install.md",
        "  eval: no-future-promises",
        "  expected: pass",
        "  reviewed: true",
        "- file: docs/renamed-away.md",
        "  eval: no-future-promises",
        "  expected: pass",
        "  reviewed: true",
        "",
      ].join("\n"),
    );
    const report = await runCalibrate({ cwd: root, judge: alwaysPass });

    expect(report.agreementRate).toBe(1);
    expect(report.meetsThreshold).toBe(true);
    // ...but one of two cases never reached a verdict, so the gate must not pass.
    expect(report.unjudged).toBe(1);
    expect(report.budgetSkipped).toBe(0);
    expect(renderCalibration(report)).toMatch(/never reached a verdict/);
  });
});

describe("runCalibrate: a one-sided golden set cannot certify", () => {
  // The measured form of the floor invariant "at least one should-NOT-fire
  // case stays in the suite". Without an `expected: fail` case, a judge that
  // answers "pass" unconditionally scores 100% agreement and zero false
  // negatives — a perfect score for an instrument that detects nothing.
  it("meets the threshold but is not balanced when every case expects pass", async () => {
    const root = scaffold();
    writeGolden(
      root,
      "cases.yaml",
      [
        "- file: docs/install.md",
        "  eval: no-future-promises",
        "  expected: pass",
        "  reviewed: true",
        "",
      ].join("\n"),
    );
    const report = await runCalibrate({ cwd: root, judge: alwaysPass });

    // Agreement is genuinely 100% — the verdict about the rate stays true.
    expect(report.agreementRate).toBe(1);
    expect(report.meetsThreshold).toBe(true);
    expect(report.unjudged).toBe(0);
    // ...and it still must not certify: nothing here could have disagreed.
    expect(report.expectedPass).toBe(1);
    expect(report.expectedFail).toBe(0);
    expect(report.balanced).toBe(false);
    expect(renderCalibration(report)).toMatch(/No `expected: fail` cases/);
  });

  it("is balanced once both classes are present", async () => {
    const root = scaffold();
    writeGolden(
      root,
      "cases.yaml",
      [
        "- file: docs/install.md",
        "  eval: no-future-promises",
        "  expected: pass",
        "  reviewed: true",
        "- file: docs/install.md",
        "  eval: no-future-promises",
        "  expected: fail",
        "  reviewed: true",
        "",
      ].join("\n"),
    );
    const report = await runCalibrate({ cwd: root, judge: alwaysPass });

    expect(report.expectedPass).toBe(1);
    expect(report.expectedFail).toBe(1);
    expect(report.balanced).toBe(true);
    // The always-pass judge now visibly misses the fail case.
    expect(report.falseNegatives).toBe(1);
    expect(report.meetsThreshold).toBe(false);
    expect(renderCalibration(report)).not.toMatch(/No `expected: fail` cases/);
  });
});
