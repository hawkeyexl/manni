/**
 * Live smoke test — the only test allowed to reach a real provider. Gated
 * behind MOOSE_TRACEVALS_LIVE=1 and skipped by default; requires an installed,
 * authenticated Claude Code CLI.
 */
import { describe, expect, it } from "vitest";
import { makeJudgeProvider } from "../../../src/tracevals/judge/provider.js";
import { makeTraceJudge } from "../../../src/tracevals/judge/trace-judge.js";
import { parseConfig } from "../../../src/tracevals/core/config.js";
import { makePlan, makeArtifact } from "../helpers.js";

const live = process.env.MOOSE_TRACEVALS_LIVE === "1";

describe.skipIf(!live)("live judge (claude-cli)", () => {
  it("judges one obvious criterion end to end", { timeout: 120_000 }, async () => {
    const provider = makeJudgeProvider(parseConfig({}), {
      provider: "claude-cli",
    });
    const judge = makeTraceJudge({ provider, runs: 1, noCache: true });
    const plan = makePlan({
      artifact: makeArtifact({
        content: "# Greeting skill\nAlways greet the user politely.",
      }),
      assertion: "The assistant greeted the user.",
    });
    const [result] = await judge(
      [plan],
      () =>
        "# Session\n## Timeline\n[user] hello\n[assistant] Hello! How can I help you today?",
    );
    expect(result).toBeDefined();
    expect(["pass", "needs-review"]).toContain(result!.outcome);
  });
});
