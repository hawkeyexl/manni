/**
 * The judged block docevals and tracevals print under a judged eval
 * (proposal 0089, C2). The evidence comes from a run that did not pass, so a
 * failing consensus never quotes the one run that disagreed with it.
 */
import { describe, expect, it } from "vitest";
import type { ConsensusResult, JudgeRun, Match } from "@hawkeyexl/inference";
import { evidenceVerdict, verdictLines } from "../../src/shared/verdict-lines.js";

function run(match: Match, observed: string, reasoning: string): JudgeRun {
  return {
    verdict: { claim: "c", observed, match, confidence: 0.9, reasoning },
    provider: "mock",
    model: "m",
    cached: false,
    durationMs: 1,
  };
}

function consensus(runs: JudgeRun[], meanConfidence = 0.91): ConsensusResult {
  return {
    runs,
    votes: { pass: 1, fail: 2, partial: 0, error: 0 },
    verdict: "fail",
    agreement: 0.67,
    meanConfidence,
    zone: "auto-fail",
  };
}

describe("verdictLines", () => {
  it("quotes a failing run when the votes are 1 pass and 2 fail", () => {
    const c = consensus([
      run("pass", "The page is fine.", "Nothing is promised."),
      run("fail", "Planned for a later release.", "Line 16 promises a later release."),
      run("fail", "Later release.", "It promises."),
    ]);
    expect(verdictLines(c, "fail", "Edit the page so the assertion holds.")).toEqual([
      "AI judge: fail (confidence 0.91). Edit the page so the assertion holds.",
      "Observed: Planned for a later release.",
      "Reasoning: Line 16 promises a later release.",
    ]);
  });

  it("counts a partial run as not passing", () => {
    const c = consensus([run("pass", "p", "p"), run("partial", "half", "half done")]);
    expect(evidenceVerdict(c)?.observed).toBe("half");
  });

  it("falls back to the first run with a verdict, skipping errored runs", () => {
    const errored: JudgeRun = { error: "boom", provider: "mock", model: "m", cached: false, durationMs: 1 };
    const c = consensus([errored, run("pass", "seen", "fine")], 0.55);
    expect(verdictLines(c, "no confident verdict", "Decide.")).toEqual([
      "AI judge: no confident verdict (confidence 0.55). Decide.",
      "Observed: seen",
      "Reasoning: fine",
    ]);
  });

  it("prints the head alone when no run has a verdict", () => {
    const errored: JudgeRun = { error: "boom", provider: "mock", model: "m", cached: false, durationMs: 1 };
    expect(verdictLines(consensus([errored], 0), "fail", "Fix it.")).toEqual([
      "AI judge: fail (confidence 0.00). Fix it.",
    ]);
  });
});
