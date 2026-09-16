import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { parseTraceFile } from "../../../src/tracevals/trace/claude.js";
import { renderTrace } from "../../../src/tracevals/judge/render.js";
import { windowFor } from "../../../src/tracevals/graders/util.js";
import { makeArtifact, makePlan, makeTrace } from "../helpers.js";

const sidecarFixture = fileURLToPath(
  new URL("../fixtures/traces/claude-session-sidecar.jsonl", import.meta.url),
);

const trace = makeTrace({
  model: "claude-opus-4-8",
  turnCount: 2,
  events: [
    { kind: "user", text: "Fix the crash.", raw: {}, index: 0 },
    { kind: "assistant", text: "On it.", raw: {}, index: 1 },
    { kind: "tool_call", toolName: "Read", raw: {}, index: 2 },
    { kind: "tool_call", toolName: "Grep", sidechain: true, raw: {}, index: 3 },
  ],
  toolCalls: [
    {
      name: "Read",
      input: { file_path: "src/app.ts" },
      sidechain: false,
      index: 2,
    },
    { name: "Grep", input: { pattern: "x" }, sidechain: true, index: 3 },
  ],
  skillInvocations: [{ name: "fix-bug", via: "skill-tool", index: 0 }],
  userMessages: ["Fix the crash."],
  assistantTexts: ["On it."],
});

const branched = makeTrace({
  agentSpawns: [
    { subagentType: "Explore", description: "one", index: 0, toolUseId: "toolu_a" },
    { subagentType: "Plan", description: "two", index: 1, toolUseId: "toolu_b" },
  ],
  events: [
    { kind: "tool_call", toolName: "Agent", raw: {}, index: 0 },
    { kind: "tool_call", toolName: "Agent", raw: {}, index: 1 },
    { kind: "tool_call", toolName: "Read", sidechain: true, branchId: "toolu_a", raw: {}, index: 2 },
    { kind: "assistant", text: "looked", sidechain: true, branchId: "toolu_a", raw: {}, index: 3 },
    { kind: "tool_call", toolName: "Grep", sidechain: true, branchId: "toolu_b", raw: {}, index: 4 },
    { kind: "assistant", text: "wrapping up", raw: {}, index: 5 },
  ],
  toolCalls: [
    { name: "Agent", input: {}, sidechain: false, index: 0 },
    { name: "Agent", input: {}, sidechain: false, index: 1 },
    { name: "Read", input: { file_path: "a.ts" }, sidechain: true, branchId: "toolu_a", index: 2 },
    { name: "Grep", input: { pattern: "x" }, sidechain: true, branchId: "toolu_b", index: 4 },
  ],
});

describe("renderTrace", () => {
  it("includes metadata, messages, tools, and skills", () => {
    const out = renderTrace(trace);
    expect(out).toContain("claude-opus-4-8");
    expect(out).toContain("Fix the crash.");
    expect(out).toContain("On it.");
    expect(out).toContain("Read");
    expect(out).toContain("fix-bug");
  });

  it("marks sidechain activity", () => {
    const out = renderTrace(trace);
    expect(out).toContain("sidechain");
  });

  it("truncates oversized blocks", () => {
    const big = makeTrace({
      events: [
        { kind: "assistant", text: "x".repeat(10_000), raw: {}, index: 0 },
      ],
      assistantTexts: ["x".repeat(10_000)],
    });
    const out = renderTrace(big, { maxBlockChars: 100 });
    expect(out).toContain("truncated");
    expect(out.length).toBeLessThan(5_000);
  });

  it("renders each subagent branch as a labelled block naming its type", () => {
    const out = renderTrace(branched);
    expect(out).toContain("[subagent Explore (toolu_a)]");
    expect(out).toContain("[/subagent Explore]");
    expect(out).toContain("[subagent Plan (toolu_b)]");
  });

  it("keeps two concurrent subagents distinguishable line by line", () => {
    const out = renderTrace(branched);
    expect(out).toContain("[tool:Explore] Read");
    expect(out).toContain("[tool:Plan] Grep");
  });

  it("renders a sidecar branch through the same labelled-block path", async () => {
    const trace = await parseTraceFile(sidecarFixture);
    const out = renderTrace(trace);
    // Named from the sidecar meta's agentType, not from a flat sidechain tag.
    expect(out).toContain("[subagent Explore (toolu_lead)]");
    expect(out).toContain("[subagent general-purpose (toolu_nested)]");
    expect(out).toContain("[tool:Explore] Read");
    expect(out).toContain("[tool:general-purpose] Grep");
    expect(out).not.toContain(":sidechain");
  });

  it("caps total size with a head/tail window", () => {
    const events = Array.from({ length: 500 }, (_, i) => ({
      kind: "assistant" as const,
      text: `message number ${i} ${"y".repeat(200)}`,
      raw: {},
      index: i,
    }));
    const big = makeTrace({ events });
    const out = renderTrace(big, { maxTotalChars: 10_000 });
    expect(out.length).toBeLessThan(12_000);
    expect(out).toContain("message number 0");
    expect(out).toContain("message number 499");
    expect(out).toContain("truncated");
  });

  it("keeps the cap when the header alone is larger than the budget", () => {
    // `budget = maxTotalChars - header.length - 64` went non-positive once the
    // header listed every skill, agent type and branch — and the old
    // `budget > 0` guard then *skipped truncation entirely*, shipping the whole
    // unclipped transcript to a third-party provider precisely when the user
    // had asked for the tightest cap.
    const skills = Array.from({ length: 120 }, (_, i) => ({
      name: `skill-with-a-fairly-long-name-${i}`,
      via: "skill-tool" as const,
      index: 0,
    }));
    const events = Array.from({ length: 400 }, (_, i) => ({
      kind: "assistant" as const,
      text: `message number ${i} ${"y".repeat(200)}`,
      raw: {},
      index: i,
    }));
    const big = makeTrace({ events, skillInvocations: skills });
    const cap = 1000; // the schema minimum for render.maxTotalChars
    const out = renderTrace(big, { maxTotalChars: cap });
    expect(out).toContain("truncated");
    expect(
      out.length,
      `digest was ${out.length} chars for a ${cap}-char cap`,
    ).toBeLessThanOrEqual(cap);
  });

  it("renders only the window for a scoped eval", async () => {
    const parsed = await parseTraceFile(sidecarFixture);
    const whole = renderTrace(parsed);
    const scoped = renderTrace(
      parsed,
      {},
      makePlan({ artifact: makeArtifact({ name: "Explore", type: "agent" }) }),
    );
    // The parent session's own Bash call is outside the Explore branch.
    expect(whole).toContain("npm test");
    expect(scoped).not.toContain("npm test");
    // The branch's own work, and the branch nested inside it, are in.
    expect(scoped).toContain("[subagent Explore (toolu_lead)]");
    expect(scoped).toContain("[tool:general-purpose] Grep");
    expect(scoped).toContain('scope: agent "Explore"');
    expect(scoped.length).toBeLessThan(whole.length);
  });

  /**
   * The header has to describe what the judge can see. A session-wide turn
   * count beside a windowed timeline reads as evidence the rest was truncated
   * away, so a judge would discount a digest that is complete for the thing it
   * was asked about. The session total is still worth carrying, which is why
   * it stays in parentheses rather than being dropped.
   */
  it("counts the window's turns in a scoped header, with the session as context", async () => {
    const parsed = await parseTraceFile(sidecarFixture);
    const scoped = renderTrace(
      parsed,
      {},
      makePlan({ artifact: makeArtifact({ name: "Explore", type: "agent" }) }),
    );
    const turns = /turns: (\d+) \(of (\d+) in the session\)/.exec(scoped);
    expect(turns, `no scoped turns line in:\n${scoped.slice(0, 400)}`).not.toBeNull();
    const [, windowTurns, sessionTurns] = turns as RegExpExecArray;
    // Exact, not relational: the two counts can legitimately coincide on a
    // short fixture, so "window < session" would pass or fail on the corpus
    // rather than on the behaviour. Compare each against its own source.
    const plan = makePlan({
      artifact: makeArtifact({ name: "Explore", type: "agent" }),
    });
    expect(Number(sessionTurns)).toBe(parsed.turnCount);
    expect(Number(windowTurns)).toBe(windowFor(parsed, plan).turnCount);

    const whole = renderTrace(parsed);
    expect(whole).toContain(`turns: ${parsed.turnCount}`);
    expect(whole).not.toContain("in the session)");
  });

  it("lists only the agents spawned inside the window", async () => {
    const parsed = await parseTraceFile(sidecarFixture);
    const scoped = renderTrace(
      parsed,
      {},
      makePlan({ artifact: makeArtifact({ name: "Explore", type: "agent" }) }),
    );
    const header = scoped.slice(0, scoped.indexOf("## Timeline"));
    const whole = renderTrace(parsed);
    // Spawns the parent session made outside the Explore branch are not this
    // artifact's to answer for, but must still appear on an unscoped render.
    expect(whole).toContain("agents spawned:");
    expect(header).not.toContain("doc-writer");
  });

  it("leaves a project-rules eval rendering the whole session", async () => {
    const parsed = await parseTraceFile(sidecarFixture);
    const scoped = renderTrace(
      parsed,
      {},
      makePlan({
        artifact: makeArtifact({ name: "CLAUDE.md", type: "project-rules" }),
      }),
    );
    expect(scoped).toBe(renderTrace(parsed));
    expect(scoped).not.toContain("scope:");
  });

  it("says so rather than rendering nothing when the window is empty", async () => {
    const parsed = await parseTraceFile(sidecarFixture);
    const scoped = renderTrace(
      parsed,
      {},
      makePlan({ artifact: makeArtifact({ name: "ghost-skill", type: "skill" }) }),
    );
    expect(scoped).toContain("never invoked");
  });
});

describe("renderTrace redaction", () => {
  // Fake credential shapes only: nothing here resolves anywhere.
  const leaky = makeTrace({
    events: [
      {
        kind: "user",
        text: "deploy with sk-ant-api03-NOTAREALKEYNOTAREALKEY01",
        raw: {},
        index: 0,
      },
      { kind: "tool_call", toolName: "Bash", raw: {}, index: 1 },
      {
        kind: "assistant",
        text: "exported AWS_SECRET_ACCESS_KEY=fakefakefake",
        raw: {},
        index: 2,
      },
    ],
    toolCalls: [
      {
        name: "Bash",
        input: {
          command: "curl -H 'Authorization: Bearer tok_abcdefghijklmnop123'",
        },
        sidechain: false,
        index: 1,
      },
    ],
    userMessages: ["deploy with sk-ant-api03-NOTAREALKEYNOTAREALKEY01"],
  });

  it("redacts secrets in messages, assistant text, and tool inputs", () => {
    const out = renderTrace(leaky);
    expect(out).not.toContain("NOTAREALKEYNOTAREALKEY01");
    expect(out).not.toContain("tok_abcdefghijklmnop123");
    expect(out).not.toContain("fakefakefake");
    expect(out).toContain("[redacted:api-key]");
    expect(out).toContain("[redacted:auth-token]");
    expect(out).toContain("AWS_SECRET_ACCESS_KEY=[redacted:secret-value]");
  });

  it("redacts before clipping, so truncation cannot bisect a secret", () => {
    // A block cap landing mid-key would leave a usable prefix behind if
    // clipping ran first.
    const out = renderTrace(leaky, { maxBlockChars: 24 });
    expect(out).not.toContain("sk-ant-api03");
    expect(out).not.toContain("sk-ant");
  });

  it("applies configured patterns as well as the built-ins", () => {
    const out = renderTrace(leaky, { redact: ["deploy"] });
    expect(out).not.toContain("deploy");
    expect(out).toContain("[redacted]");
    expect(out).toContain("[redacted:api-key]");
  });

  it("leaves a trace with nothing secret byte-identical", () => {
    // The cache key is sha256 of this digest, so a no-op redaction must not
    // move it — a config change that changes nothing must not cost a replay.
    expect(renderTrace(trace)).toBe(renderTrace(trace, { redact: [] }));
  });
});
