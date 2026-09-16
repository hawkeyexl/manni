/**
 * Joining labels to results, and re-scoring cached verdicts (ADR 01022).
 *
 * The two load-bearing claims live here: the join never turns "no evidence"
 * into agreement, and a sweep cell is computed from the `JudgeRun[]` a run
 * already produced rather than from a fresh model call.
 */
import { describe, expect, it } from "vitest";
import type { JudgeRun } from "@hawkeyexl/inference";
import { classify, joinLabels, rescore, score } from "../../../src/tracevals/calibrate/score.js";
import { parseLabels } from "../../../src/tracevals/calibrate/labels.js";
import type { EvalResult } from "../../../src/tracevals/types.js";

const run = (match: "pass" | "fail" | "partial", confidence: number): JudgeRun => ({
  provider: "mock",
  model: "mock-model",
  cached: false,
  durationMs: 0,
  verdict: { claim: "c", observed: "o", match, confidence, reasoning: "r" },
});

const errored = (): JudgeRun => ({
  provider: "mock",
  model: "mock-model",
  cached: false,
  durationMs: 0,
  error: "invalid JSON",
});

function judged(runs: JudgeRun[], overrides: Partial<EvalResult> = {}): EvalResult {
  const votes = { pass: 0, fail: 0, partial: 0, error: 0 };
  for (const r of runs) {
    if (r.verdict === undefined) votes.error += 1;
    else votes[r.verdict.match] += 1;
  }
  return {
    evalName: "e",
    artifact: "/p/SKILL.md",
    artifactName: "fix-bug",
    artifactType: "skill",
    grader: "ai",
    implicit: false,
    outcome: "pass",
    consensus: {
      runs,
      votes,
      verdict: "pass",
      agreement: 1,
      meanConfidence: 0.9,
      zone: "auto-pass",
    },
    durationMs: 0,
    ...overrides,
  };
}

const deterministic = (overrides: Partial<EvalResult> = {}): EvalResult => ({
  evalName: "forbidden-tool",
  artifact: "/p/SKILL.md",
  artifactName: "fix-bug",
  artifactType: "skill",
  grader: "tool-usage",
  implicit: false,
  outcome: "fail",
  durationMs: 0,
  ...overrides,
});

const zones = (autoPass: number, autoFail = 0.8) => ({ autoPass, autoFail });

describe("classify", () => {
  it("names the two expensive errors apart from every other disagreement", () => {
    expect(classify("fail", "pass")).toBe("false-pass");
    expect(classify("pass", "fail")).toBe("false-fail");
    expect(classify("pass", "pass")).toBe("agree");
    expect(classify("needs-review", "needs-review")).toBe("agree");
    expect(classify("pass", "needs-review")).toBe("review");
    expect(classify("needs-review", "pass")).toBe("missed-review");
    expect(classify("needs-review", "fail")).toBe("missed-review");
  });

  it("never lets absent evidence read as agreement", () => {
    // A skipped eval produced nothing to agree or disagree with, and an
    // errored one is the case the whole tool refuses to round toward a pass.
    expect(classify("pass", "skipped")).toBe("skipped");
    expect(classify("fail", "skipped")).toBe("skipped");
    expect(classify("pass", "error")).toBe("error");
  });
});

describe("rescore", () => {
  it("leaves a result with no consensus exactly as it was", () => {
    const result = deterministic();
    expect(rescore(result, { ensembleRuns: 1, zones: zones(0.95) })).toEqual({
      outcome: "fail",
      insufficient: false,
    });
  });

  it("re-applies the zone to the cached runs without touching a provider", () => {
    const result = judged([run("pass", 0.9), run("pass", 0.9), run("pass", 0.9)]);
    // Below the bar: unanimous and confident enough.
    expect(
      rescore(result, { ensembleRuns: 3, zones: zones(0.8) }).outcome,
    ).toBe("pass");
    // Above it: the same runs, now a review.
    expect(
      rescore(result, { ensembleRuns: 3, zones: zones(0.95) }).outcome,
    ).toBe("needs-review");
  });

  it("re-scores a smaller ensemble from the first k cached runs", () => {
    // Three runs, one dissenting: unanimity fails at k=3 but holds at k=1.
    const result = judged([run("pass", 0.9), run("pass", 0.9), run("fail", 0.9)]);
    expect(rescore(result, { ensembleRuns: 3, zones: zones(0.8) }).outcome).toBe(
      "needs-review",
    );
    expect(rescore(result, { ensembleRuns: 1, zones: zones(0.8) }).outcome).toBe(
      "pass",
    );
  });

  it("keeps an errored run counting against consensus after a re-score", () => {
    const result = judged([run("pass", 0.95), run("pass", 0.95), errored()]);
    expect(rescore(result, { ensembleRuns: 3, zones: zones(0.8) }).outcome).toBe(
      "needs-review",
    );
  });

  it("says so rather than guessing when the cache holds too few runs", () => {
    const result = judged([run("pass", 0.95)]);
    const out = rescore(result, { ensembleRuns: 5, zones: zones(0.8) });
    expect(out.insufficient).toBe(true);
    // And it does not invent a verdict from one run.
    expect(out.outcome).toBe("pass");
  });
});

describe("joinLabels", () => {
  const labelsText = `
version: 1
labels:
  - trace: a.jsonl
    artifact: fix-bug
    eval: forbidden-tool
    expected: pass
  - trace: a.jsonl
    artifact: fix-bug
    eval: no-such-eval
    expected: pass
`;
  const labels = parseLabels(labelsText, "labels.yaml");
  const traceFile = labels[0]?.traceFile as string;

  const outcomes = [
    {
      file: traceFile,
      report: {
        evalResults: [deterministic()],
      } as never,
    },
  ];

  it("matches on trace, artifact name, and eval id", () => {
    const { joined } = joinLabels(outcomes, labels);
    expect(joined).toHaveLength(1);
    expect(joined[0]?.label.eval).toBe("forbidden-tool");
    expect(joined[0]?.result.outcome).toBe("fail");
  });

  it("reports a label that matched nothing instead of dropping it", () => {
    const { unmatched } = joinLabels(outcomes, labels);
    expect(unmatched.map((l) => l.eval)).toEqual(["no-such-eval"]);
  });
});

describe("score", () => {
  const labels = parseLabels(
    `
version: 1
labels:
  - trace: a.jsonl
    artifact: fix-bug
    eval: forbidden-tool
    expected: pass
  - trace: a.jsonl
    artifact: fix-bug
    eval: minimal-fix
    expected: fail
    note: A debugging console.log survived.
`,
    "labels.yaml",
  );
  const traceFile = labels[0]?.traceFile as string;
  const results = [
    deterministic(),
    judged([run("pass", 0.9), run("pass", 0.9), run("pass", 0.9)], {
      evalName: "minimal-fix",
    }),
  ];
  const joined = joinLabels(
    [{ file: traceFile, report: { evalResults: results } as never }],
    labels,
  ).joined;

  it("counts the three numbers the manual procedure asked people to count", () => {
    const { counts } = score({ joined, all: results });
    expect(counts.falseFail).toBe(1); // labelled pass, judged fail
    expect(counts.falsePass).toBe(1); // labelled fail, judged pass
    expect(counts.review).toBe(0);
    expect(counts.agree).toBe(0);
    expect(counts.agreement).toBe(0);
  });

  it("carries the note into the disagreement, which is what makes it actionable", () => {
    const { disagreements } = score({ joined, all: results });
    const fp = disagreements.find((d) => d.kind === "false-pass");
    expect(fp?.note).toBe("A debugging console.log survived.");
    expect(fp?.consensus?.meanConfidence).toBeCloseTo(0.9);
  });

  it("re-scores every labelled result when a setting is given", () => {
    // At autoPass 0.95 the judged eval leaves auto-pass, so the false pass
    // becomes a review rather than a mistake.
    const { counts } = score({ joined, all: results }, {
      ensembleRuns: 3,
      zones: zones(0.95),
    });
    expect(counts.falsePass).toBe(0);
    // Labelled `fail`, judged needs-review: the tool deferred rather than
    // being wrong, which is the outcome a review band exists to produce.
    expect(counts.review).toBe(1);
    expect(counts.reviewVolume).toBe(1);
  });

  it("excludes skipped labels from the agreement denominator", () => {
    const skippedResults = [
      deterministic({ outcome: "skipped", skipReason: "trigger not met" }),
      results[1] as EvalResult,
    ];
    const j = joinLabels(
      [{ file: traceFile, report: { evalResults: skippedResults } as never }],
      labels,
    ).joined;
    const { counts, unscored } = score({ joined: j, all: skippedResults });
    expect(counts.skipped).toBe(1);
    expect(counts.scored).toBe(1);
    expect(unscored).toHaveLength(1);
    expect(unscored[0]?.skipReason).toBe("trigger not met");
  });
});

/**
 * Two artifacts in one trace legitimately share a name — a skill and the slash
 * command that types it, or a skill and an agent — which is the only reason
 * the labels file has an optional `type:` at all. A label that omits it and
 * matches both must be refused: silently binding it to whichever artifact was
 * indexed last would measure agreement against a verdict belonging to
 * something else, and report a false pass or a false fail with total
 * confidence.
 */
describe("joinLabels over a shared artifact name", () => {
  const labelsText = `
version: 1
labels:
  - trace: a.jsonl
    artifact: release
    eval: no-shell
    expected: pass
`;
  const untyped = parseLabels(labelsText, "labels.yaml");
  const traceFile = untyped[0]?.traceFile as string;

  const asSkill = deterministic({
    evalName: "no-shell",
    artifactName: "release",
    artifactType: "skill",
    artifact: "/p/.claude/skills/release/SKILL.md",
    outcome: "pass",
  });
  const asCommand = deterministic({
    evalName: "no-shell",
    artifactName: "release",
    artifactType: "slash-command",
    artifact: "/p/.claude/commands/release.md",
    outcome: "fail",
  });
  const outcomes = [
    {
      file: traceFile,
      report: { evalResults: [asSkill, asCommand] } as never,
    },
  ];

  it("refuses an untyped label that two artifact kinds both answer", () => {
    const { joined, unmatched, ambiguous } = joinLabels(outcomes, untyped);
    expect(joined).toHaveLength(0);
    expect(unmatched).toHaveLength(0);
    expect(ambiguous).toHaveLength(1);
    expect(ambiguous[0]?.label.eval).toBe("no-shell");
    expect(ambiguous[0]?.candidates.map((r) => r.artifactType).sort()).toEqual([
      "skill",
      "slash-command",
    ]);
  });

  it("joins a colliding name that states its type, and never calls it ambiguous", () => {
    const typed = parseLabels(
      `
version: 1
labels:
  - trace: a.jsonl
    artifact: release
    type: slash-command
    eval: no-shell
    expected: pass
  - trace: a.jsonl
    artifact: release
    type: skill
    eval: no-shell
    expected: pass
`,
      "labels.yaml",
    );
    const { joined, unmatched, ambiguous } = joinLabels(outcomes, typed);
    expect(ambiguous).toHaveLength(0);
    expect(unmatched).toHaveLength(0);
    // Each label reached its own artifact's verdict, not the other's.
    expect(joined.map((j) => [j.label.type, j.result.outcome])).toEqual([
      ["slash-command", "fail"],
      ["skill", "pass"],
    ]);
  });

  it("leaves a name only one kind answers joinable without a type", () => {
    // The refusal is scoped to an actual collision: an untyped label over a
    // unique name must keep working, which is how nearly every label is written.
    const { joined, ambiguous } = joinLabels(
      [{ file: traceFile, report: { evalResults: [asSkill] } as never }],
      untyped,
    );
    expect(ambiguous).toHaveLength(0);
    expect(joined).toHaveLength(1);
    expect(joined[0]?.result.artifactType).toBe("skill");
  });
});
