/**
 * Self-preference: the judge model is the model that ran the session.
 *
 * This is the sharpest form of the bias in either manni tool. docevals asks a
 * model whether a document it may have drafted is any good; here the question
 * is whether the model's *own session* followed the rules it was given, and a
 * model grading its own conduct is not a neutral judge.
 *
 * It stays a warning. Bias skews a verdict; it does not stop one forming, so
 * the "no verdict fails" rule is not in play — and erroring would punish a
 * setup with only one model configured.
 */
import { describe, expect, it } from "vitest";
import { MockProvider, mockVerdict } from "@hawkeyexl/inference";
import { makeTraceJudge } from "../../../src/tracevals/judge/trace-judge.js";
import { makePlan, makeTrace } from "../helpers.js";

const plan = () => makePlan({ grader: "ai", assertion: "The session behaved." });

const judgeWith = async (judgeModel: string, sessionModel?: string) => {
  const judge = makeTraceJudge({
    provider: new MockProvider(
      [mockVerdict("pass", 0.95), mockVerdict("pass", 0.95), mockVerdict("pass", 0.95)],
      judgeModel,
    ),
    cacheDir: undefined,
    noCache: true,
  });
  const results = await judge([plan()], () => "rendered transcript", {
    trace: makeTrace(sessionModel === undefined ? {} : { model: sessionModel }),
  });
  return results[0];
};

describe("self-preference (session axis)", () => {
  it("flags a judge grading its own session", async () => {
    const r = await judgeWith("claude-sonnet-4-5", "claude-sonnet-4-5");
    expect(r?.selfPreference).toEqual({
      axis: "session",
      model: "claude-sonnet-4-5",
    });
    // A real verdict still forms; the bias rides alongside it.
    expect(r?.outcome).toBe("pass");
  });

  it("does not flag a different judge", async () => {
    const r = await judgeWith("judge-model", "claude-sonnet-4-5");
    expect(r?.selfPreference).toBeUndefined();
  });

  it("does not guess when the trace records no model", async () => {
    // Some adapters do not carry one. Unknown is unknown — it must not read as
    // "not the same model", which would be a silent all-clear.
    const r = await judgeWith("judge-model", undefined);
    expect(r?.selfPreference).toBeUndefined();
  });
});

describe("self-preference (criterion axis)", () => {
  /**
   * The second axis: the judge wrote the *assertion*, not the session.
   * `eval-provenance.generated-by` records it, `fill` writes it, and until the
   * plan carried it back the axis was declared in the type and never set.
   */
  const judgeCriterion = async (judgeModel: string, proposedBy?: string[]) => {
    const judge = makeTraceJudge({
      provider: new MockProvider(
        [
          mockVerdict("pass", 0.95),
          mockVerdict("pass", 0.95),
          mockVerdict("pass", 0.95),
        ],
        judgeModel,
      ),
      cacheDir: undefined,
      noCache: true,
    });
    const results = await judge(
      [
        makePlan({
          grader: "ai",
          assertion: "The session behaved.",
          ...(proposedBy === undefined ? {} : { proposedBy }),
        }),
      ],
      () => "rendered transcript",
      { trace: makeTrace({ model: "some-other-model" }) },
    );
    return results[0];
  };

  it("flags a judge grading an assertion it proposed", async () => {
    const r = await judgeCriterion("claude-opus-4-5", ["claude-opus-4-5"]);
    expect(r?.selfPreference).toEqual({
      axis: "criterion",
      model: "claude-opus-4-5",
    });
  });

  it("stays silent when another model proposed the assertion", async () => {
    const r = await judgeCriterion("claude-opus-4-5", ["gpt-5"]);
    expect(r?.selfPreference).toBeUndefined();
  });

  it("stays silent when nothing recorded who proposed it", async () => {
    // Hand-written evals have no provenance. Absent is "unknown", and an
    // unknown author is not evidence of bias.
    const r = await judgeCriterion("claude-opus-4-5");
    expect(r?.selfPreference).toBeUndefined();
  });

  it("reports the session axis first when both apply", async () => {
    // Judging your own session is bias about the behavior under test; judging
    // your own assertion is bias about the yardstick. Only one field carries
    // the report, and the stronger remedy wins.
    const judge = makeTraceJudge({
      provider: new MockProvider(
        [
          mockVerdict("pass", 0.95),
          mockVerdict("pass", 0.95),
          mockVerdict("pass", 0.95),
        ],
        "claude-opus-4-5",
      ),
      cacheDir: undefined,
      noCache: true,
    });
    const results = await judge(
      [
        makePlan({
          grader: "ai",
          assertion: "The session behaved.",
          proposedBy: ["claude-opus-4-5"],
        }),
      ],
      () => "rendered transcript",
      { trace: makeTrace({ model: "claude-opus-4-5" }) },
    );
    expect(results[0]?.selfPreference?.axis).toBe("session");
  });
});
