import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { detectContentFormat, detectFormat } from "../../../src/tracevals/trace/detect.js";
import { parseTraceContent, parseTraceFile } from "../../../src/tracevals/trace/claude.js";
import { TracevalsError } from "../../../src/tracevals/types.js";

const sessionFixture = fileURLToPath(
  new URL("../fixtures/traces/claude-session.jsonl", import.meta.url),
);
const streamFixture = fileURLToPath(
  new URL("../fixtures/traces/claude-stream.jsonl", import.meta.url),
);
const resumedFixture = fileURLToPath(
  new URL("../fixtures/traces/claude-session-resumed.jsonl", import.meta.url),
);
const sidecarFixture = fileURLToPath(
  new URL("../fixtures/traces/claude-session-sidecar.jsonl", import.meta.url),
);

describe("detectFormat", () => {
  it("detects a Claude Code session file", () => {
    const line = `{"parentUuid":null,"isSidechain":false,"type":"user","sessionId":"x","message":{"role":"user","content":"hi"}}`;
    expect(detectFormat(line)).toBe("claude-session");
  });

  it("detects session files whose first record is a non-message type", () => {
    const line = `{"type":"queue-operation","operation":"enqueue","sessionId":"x","content":"hi"}`;
    expect(detectFormat(line)).toBe("claude-session");
  });

  it("detects legacy claude -p stream-json", () => {
    const line = `{"type":"system","subtype":"init","cwd":"/x","session_id":"y","model":"m"}`;
    expect(detectFormat(line)).toBe("claude-stream");
  });

  it("rejects unknown formats with an operational error", () => {
    expect(() => detectFormat(`{"hello":"world"}`)).toThrow(TracevalsError);
    expect(() => detectFormat("not json at all")).toThrow(TracevalsError);
  });
});

describe("detectContentFormat", () => {
  it("scans past a leading unidentifiable record (e.g. summary) to the format-bearing line", () => {
    const content = [
      `{"type":"summary","summary":"prior session","leafUuid":"abc"}`,
      `{"parentUuid":null,"isSidechain":false,"type":"user","sessionId":"x","message":{"role":"user","content":"hi"}}`,
    ].join("\n");
    expect(detectContentFormat(content)).toBe("claude-session");
  });

  it("scans past malformed leading lines", () => {
    const content = [
      `not json`,
      `{"type":"system","subtype":"init","session_id":"y","model":"m"}`,
    ].join("\n");
    expect(detectContentFormat(content)).toBe("claude-stream");
  });

  it("throws when no line identifies a format", () => {
    const content = [
      `{"type":"summary","leafUuid":"abc"}`,
      `{"type":"other","foo":1}`,
    ].join("\n");
    expect(() => detectContentFormat(content)).toThrow(TracevalsError);
  });
});

describe("parseTraceFile (session dialect)", () => {
  it("extracts session metadata", async () => {
    const trace = await parseTraceFile(sessionFixture);
    expect(trace.source).toBe("claude-code");
    expect(trace.sessionId).toBe("11111111-1111-1111-1111-111111111111");
    expect(trace.cwd).toBe("C:\\work\\demo-project");
    expect(trace.gitBranch).toBe("claude/fix-bug");
    expect(trace.model).toBe("claude-opus-4-8");
  });

  it("extracts Skill tool invocations", async () => {
    const trace = await parseTraceFile(sessionFixture);
    const invocation = trace.skillInvocations.find((s) => s.name === "fix-bug");
    expect(invocation).toMatchObject({
      name: "fix-bug",
      via: "skill-tool",
      args: "src/app.ts",
      toolUseId: "toolu_001",
    });
  });

  it("extracts <command-name> injections as skill refs, stripping the slash", async () => {
    const trace = await parseTraceFile(sessionFixture);
    const invocation = trace.skillInvocations.find(
      (s) => s.name === "writing-toolkit:identify-ai-tells",
    );
    expect(invocation).toMatchObject({
      name: "writing-toolkit:identify-ai-tells",
      via: "command-injection",
      args: "docs/draft.md",
    });
    // A command injection is a user turn, not a tool call, so there is no id.
    expect(invocation?.toolUseId).toBeUndefined();
  });

  it("extracts agent spawns from subagent_type, not prompt guessing", async () => {
    const trace = await parseTraceFile(sessionFixture);
    expect(trace.agentSpawns).toMatchObject([
      {
        subagentType: "Explore",
        description: "Explore crash site",
        toolUseId: "toolu_002",
      },
      {
        subagentType: "reviewer",
        description: "Review the fix",
        toolUseId: "toolu_006",
      },
      {
        subagentType: "doc-writer",
        description: "Document the fix",
        toolUseId: "toolu_008",
      },
    ]);
  });

  it("extracts file accesses with operations", async () => {
    const trace = await parseTraceFile(sessionFixture);
    expect(trace.fileAccesses).toContainEqual(
      expect.objectContaining({
        path: "C:\\work\\demo-project\\src\\app.ts",
        op: "read",
      }),
    );
    expect(trace.fileAccesses).toContainEqual(
      expect.objectContaining({
        path: "C:\\work\\demo-project\\src\\app.ts",
        op: "edit",
      }),
    );
    expect(trace.fileAccesses).toContainEqual(
      expect.objectContaining({
        path: "C:\\work\\demo-project\\notes.md",
        op: "write",
      }),
    );
  });

  it("flags sidechain tool calls and keeps main-chain ones unflagged", async () => {
    const trace = await parseTraceFile(sessionFixture);
    const sidechainRead = trace.toolCalls.find(
      (c) => c.name === "Read" && c.sidechain,
    );
    expect(sidechainRead).toBeDefined();
    const bash = trace.toolCalls.find((c) => c.name === "Bash");
    expect(bash?.sidechain).toBe(false);
  });

  it("records a Bash call on both sides of the skill invocation", async () => {
    const trace = await parseTraceFile(sessionFixture);
    // The corpus deliberately straddles the fix-bug window so scoped grading
    // is provable in both directions (ADR 01015): one Bash before the skill
    // was invoked, one after.
    const skill = trace.skillInvocations.find((s) => s.name === "fix-bug");
    const bash = trace.toolCalls.filter((c) => c.name === "Bash");
    expect(bash).toHaveLength(2);
    expect(bash[0]!.index).toBeLessThan(skill!.index);
    expect(bash[1]!.index).toBeGreaterThan(skill!.index);
  });

  it("counts turns as non-sidechain user prompts (not tool results)", async () => {
    const trace = await parseTraceFile(sessionFixture);
    // Three command injections (identify-ai-tells, /model, /ship-it) and the
    // plain prompt; tool_result records and the sidechain user record do not
    // count.
    expect(trace.turnCount).toBe(4);
  });

  it("sums usage across non-sidechain assistant messages", async () => {
    const trace = await parseTraceFile(sessionFixture);
    // 100+130+200+150+120+90+80+70+60 input, 50+18+25+30+40+35+12+15+20 output,
    // plus the /ship-it turns' 40+45+30 and 10+22+14 (the two sidechain
    // records, 80/10 and 60/8, are excluded)
    expect(trace.usage).toMatchObject({ inputTokens: 1115, outputTokens: 291 });
  });

  it("collects user prompts and assistant texts", async () => {
    const trace = await parseTraceFile(sessionFixture);
    expect(trace.userMessages).toContain(
      "Fix the crash in src/app.ts. Use the fix-bug skill.",
    );
    expect(
      trace.assistantTexts.some((t) => t.includes("Fixed the crash")),
    ).toBe(true);
  });

  it("tolerates malformed JSONL lines with a warning", async () => {
    const trace = await parseTraceFile(sessionFixture);
    expect(trace.warnings.some((w) => w.includes("unparseable"))).toBe(true);
  });
});

describe("parseTraceFile (stream dialect)", () => {
  it("extracts metadata from system/init and result records", async () => {
    const trace = await parseTraceFile(streamFixture);
    expect(trace.source).toBe("claude-code");
    expect(trace.sessionId).toBe("7bd91576-4e75-47d1-9a8e-10aad7099e7b");
    expect(trace.cwd).toBe(
      "/mnt/c/Users/hawkeyexl/Documents/Workspaces/agent-tools/agent-evals",
    );
    expect(trace.model).toBe("claude-sonnet-4-6");
    expect(trace.isError).toBe(false);
    expect(trace.turnCount).toBe(1);
  });

  it("takes usage and cost from the result record", async () => {
    const trace = await parseTraceFile(streamFixture);
    expect(trace.usage?.inputTokens).toBe(3);
    expect(trace.usage?.outputTokens).toBe(5);
    expect(trace.usage?.totalCostUsd).toBeCloseTo(0.0586, 3);
  });

  it("collects assistant texts", async () => {
    const trace = await parseTraceFile(streamFixture);
    expect(trace.assistantTexts).toContain("4");
  });
});

describe("trace model position (ordinals)", () => {
  it("numbers every event with its own position in trace.events", async () => {
    const trace = await parseTraceFile(sessionFixture);
    expect(trace.events.map((e) => e.index)).toEqual(
      trace.events.map((_, i) => i),
    );
  });

  it("stamps each tool call with the ordinal of its own event", async () => {
    const trace = await parseTraceFile(sessionFixture);
    expect(trace.toolCalls.length).toBeGreaterThan(0);
    for (const call of trace.toolCalls) {
      const event = trace.events[call.index];
      expect(event?.kind).toBe("tool_call");
      expect(event?.toolName).toBe(call.name);
    }
    const ordinals = trace.toolCalls.map((c) => c.index);
    expect([...ordinals].sort((a, b) => a - b)).toEqual(ordinals);
  });

  it("stamps file accesses with the ordinal of the tool call that made them", async () => {
    const trace = await parseTraceFile(sessionFixture);
    expect(trace.fileAccesses.length).toBeGreaterThan(0);
    for (const access of trace.fileAccesses) {
      const event = trace.events[access.index];
      expect(event?.kind).toBe("tool_call");
      expect(["Read", "Write", "Edit"]).toContain(event?.toolName);
    }
  });

  it("stamps skill invocations and agent spawns with their ordinal", async () => {
    const trace = await parseTraceFile(sessionFixture);
    const tool = trace.skillInvocations.find((s) => s.via === "skill-tool");
    expect(trace.events[tool!.index]?.toolName).toBe("Skill");
    const injected = trace.skillInvocations.find(
      (s) => s.via === "command-injection",
    );
    expect(trace.events[injected!.index]?.kind).toBe("user");
    for (const spawn of trace.agentSpawns) {
      expect(trace.events[spawn.index]?.toolName).toBe("Agent");
    }
  });
});

describe("subagent branch identity", () => {
  it("attributes sidechain calls to the Agent tool_use that spawned them", async () => {
    const trace = await parseTraceFile(sessionFixture);
    const sidechainRead = trace.toolCalls.find(
      (c) => c.name === "Read" && c.sidechain,
    );
    // toolu_002 is the Explore spawn; its branch is reachable only by walking
    // the sidechain record's parentUuid chain back to that call.
    expect(sidechainRead?.branchId).toBe("toolu_002");
    const events = trace.events.filter((e) => e.sidechain);
    expect(events.length).toBeGreaterThan(0);
    // Every sidechain event lands in a branch, and the fixture's two branches
    // stay apart: Explore under toolu_002, reviewer under toolu_006.
    expect(events.every((e) => e.branchId !== undefined)).toBe(true);
    expect(new Set(events.map((e) => e.branchId))).toEqual(
      new Set(["toolu_002", "toolu_006"]),
    );
  });

  it("leaves main-chain activity unbranched", async () => {
    const trace = await parseTraceFile(sessionFixture);
    const bash = trace.toolCalls.find((c) => c.name === "Bash");
    expect(bash?.sidechain).toBe(false);
    expect(bash?.branchId).toBeUndefined();
  });

  it("separates two subagents spawned in the same assistant turn", () => {
    const spawns = [
      `{"type":"tool_use","id":"toolu_a","name":"Agent","input":{"description":"one","subagent_type":"Explore","prompt":"P-ONE"}}`,
      `{"type":"tool_use","id":"toolu_b","name":"Agent","input":{"description":"two","subagent_type":"Plan","prompt":"P-TWO"}}`,
    ].join(",");
    const content = [
      `{"parentUuid":null,"isSidechain":false,"type":"user","message":{"role":"user","content":"go"},"uuid":"a1","sessionId":"s","cwd":"/work"}`,
      `{"parentUuid":"a1","isSidechain":false,"type":"assistant","message":{"role":"assistant","content":[${spawns}]},"uuid":"a2","sessionId":"s","cwd":"/work"}`,
      // The branches interleave, and the second spawn reports first.
      `{"parentUuid":"a2","isSidechain":true,"type":"user","message":{"role":"user","content":"P-TWO"},"uuid":"b1","sessionId":"s","cwd":"/work"}`,
      `{"parentUuid":"b1","isSidechain":true,"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_r","name":"Read","input":{"file_path":"plan.md"}}]},"uuid":"b2","sessionId":"s","cwd":"/work"}`,
      `{"parentUuid":"a2","isSidechain":true,"type":"user","message":{"role":"user","content":"P-ONE"},"uuid":"c1","sessionId":"s","cwd":"/work"}`,
      `{"parentUuid":"c1","isSidechain":true,"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_g","name":"Grep","input":{"pattern":"x"}}]},"uuid":"c2","sessionId":"s","cwd":"/work"}`,
    ].join("\n");
    const trace = parseTraceContent(content, "inline.jsonl");
    const read = trace.toolCalls.find((c) => c.name === "Read");
    const grep = trace.toolCalls.find((c) => c.name === "Grep");
    expect(read?.branchId).toBe("toolu_b");
    expect(grep?.branchId).toBe("toolu_a");
  });
});

describe("fragment detection", () => {
  it("warns loudly that a resumed session file is only a fragment", async () => {
    const trace = await parseTraceFile(resumedFixture);
    const warning = trace.warnings.find((w) => w.includes("fragment"));
    expect(warning).toBeDefined();
    // The pointer into the earlier session is named so it can be found.
    expect(warning).toContain("99999999-0000-0000-0000-0000000000ff");
  });

  it("does not warn when the summary's leafUuid resolves inside the file", () => {
    const content = [
      `{"type":"summary","summary":"this session","leafUuid":"a2"}`,
      `{"parentUuid":null,"isSidechain":false,"type":"user","message":{"role":"user","content":"go"},"uuid":"a1","sessionId":"s","cwd":"/work"}`,
      `{"parentUuid":"a1","isSidechain":false,"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"done"}]},"uuid":"a2","sessionId":"s","cwd":"/work"}`,
    ].join("\n");
    const trace = parseTraceContent(content, "inline.jsonl");
    expect(trace.warnings.some((w) => w.includes("fragment"))).toBe(false);
  });

  it("leaves the reference corpus silent: it is a whole session, not a fragment", async () => {
    // The fragment path is the resumed fixture's job. The canonical corpus is
    // an ordinary complete session whose summary points at its own last record,
    // so every dogfood run over it must be quiet about fragments.
    const trace = await parseTraceFile(sessionFixture);
    expect(trace.warnings.some((w) => w.includes("fragment"))).toBe(false);
  });

  it("warns that compaction hid earlier turns from the agent", () => {
    const content = [
      `{"parentUuid":null,"isSidechain":false,"type":"user","message":{"role":"user","content":"go"},"uuid":"a1","sessionId":"s","cwd":"/work"}`,
      `{"parentUuid":null,"logicalParentUuid":"a1","isSidechain":false,"type":"system","subtype":"compact_boundary","content":"Conversation compacted","uuid":"a2","sessionId":"s","cwd":"/work","compactMetadata":{"trigger":"auto","preTokens":1000}}`,
      `{"parentUuid":"a2","isSidechain":false,"type":"user","isCompactSummary":true,"message":{"role":"user","content":"summary so far"},"uuid":"a3","sessionId":"s","cwd":"/work"}`,
    ].join("\n");
    const trace = parseTraceContent(content, "inline.jsonl");
    expect(trace.warnings.some((w) => w.includes("compact"))).toBe(true);
  });
});

describe("sidecar subagent transcripts", () => {
  it("merges a sidecar branch's tool calls into the trace", async () => {
    const trace = await parseTraceFile(sidecarFixture);
    const read = trace.toolCalls.find((c) => c.name === "Read");
    expect(read).toBeDefined();
    expect(read?.sidechain).toBe(true);
    expect(read?.branchId).toBe("toolu_lead");
    expect(read?.input).toMatchObject({
      file_path: "C:\work\demo-project\src\trace.ts",
    });
  });

  it("merges a sidecar branch's file accesses", async () => {
    const trace = await parseTraceFile(sidecarFixture);
    expect(trace.fileAccesses).toContainEqual(
      expect.objectContaining({
        path: "C:\work\demo-project\src\trace.ts",
        op: "read",
      }),
    );
  });

  it("splices each branch immediately after the Agent call that spawned it", async () => {
    const trace = await parseTraceFile(sidecarFixture);
    const spawn = trace.agentSpawns.find((a) => a.toolUseId === "toolu_lead");
    const branch = trace.subagentBranches.find(
      (b) => b.branchId === "toolu_lead",
    );
    expect(spawn?.index).toBe(branch?.spawnIndex);
    expect(branch?.startIndex).toBe(spawn!.index + 1);
    // The whole subtree is contiguous, so a window is a plain slice.
    const span = trace.events.slice(branch!.startIndex, branch!.endIndex);
    expect(span.every((e) => e.sidechain === true)).toBe(true);
    // Main-chain work after the spawn resumes only once the branch closes.
    expect(trace.events[branch!.endIndex]?.sidechain).toBe(false);
  });

  it("keeps index a gap-free ordinal over the merged event list", async () => {
    const trace = await parseTraceFile(sidecarFixture);
    expect(trace.events.map((e) => e.index)).toEqual(
      trace.events.map((_, i) => i),
    );
    for (const call of trace.toolCalls) {
      expect(trace.events[call.index]?.toolName).toBe(call.name);
    }
    for (const access of trace.fileAccesses) {
      expect(trace.events[access.index]?.kind).toBe("tool_call");
    }
    for (const spawn of trace.agentSpawns) {
      expect(trace.events[spawn.index]?.toolName).toBe("Agent");
    }
    const ordinals = trace.toolCalls.map((c) => c.index);
    expect([...ordinals].sort((a, b) => a - b)).toEqual(ordinals);
  });

  it("nests a depth-2 branch inside the branch that spawned it", async () => {
    const trace = await parseTraceFile(sidecarFixture);
    const nested = trace.subagentBranches.find(
      (b) => b.branchId === "toolu_nested",
    );
    expect(nested).toMatchObject({
      agentType: "general-purpose",
      description: "Check the schema",
      spawnDepth: 2,
      parentAgentId: "a1111111111111111",
      origin: "sidecar",
    });
    const grep = trace.toolCalls.find((c) => c.name === "Grep");
    expect(grep?.branchId).toBe("toolu_nested");
    const lead = trace.subagentBranches.find(
      (b) => b.branchId === "toolu_lead",
    );
    // The nested span sits wholly inside its parent's span.
    expect(nested!.startIndex).toBeGreaterThan(lead!.startIndex);
    expect(nested!.endIndex).toBeLessThan(lead!.endIndex);
    // The parent's own turns after the nested spawn stay the parent's: inside
    // a sidecar `isSidechain` is uniformly true and carries no attribution.
    expect(trace.events[nested!.endIndex]?.branchId).toBe("toolu_lead");
  });

  it("carries agentType, spawnDepth, and the sidecar path on each branch", async () => {
    const trace = await parseTraceFile(sidecarFixture);
    const lead = trace.subagentBranches.find(
      (b) => b.branchId === "toolu_lead",
    );
    expect(lead).toMatchObject({
      agentId: "a1111111111111111",
      agentType: "Explore",
      description: "Survey the parser",
      spawnDepth: 1,
      origin: "sidecar",
    });
    expect(lead?.file).toMatch(/agent-a1111111111111111\.jsonl$/);
  });

  it("does not let subagent tokens or turns inflate the session totals", async () => {
    const trace = await parseTraceFile(sidecarFixture);
    // Main chain only: 120+80+60 in, 40+20+15 out. The sidecars carry
    // 5000/4000/3000/2000/1000 input tokens that must not be counted.
    expect(trace.usage).toMatchObject({
      inputTokens: 260,
      outputTokens: 75,
    });
    expect(trace.turnCount).toBe(1);
    expect(trace.userMessages).toEqual([
      "Survey the trace parser and report back.",
    ]);
    expect(trace.assistantTexts).toEqual(["Survey complete."]);
  });

  it("warns without merging when a sidecar meta joins no Agent spawn", async () => {
    const trace = await parseTraceFile(sidecarFixture);
    const warning = trace.warnings.find((w) => w.includes("toolu_absent"));
    expect(warning).toBeDefined();
    expect(trace.toolCalls.some((c) => c.name === "WebSearch")).toBe(false);
    expect(
      trace.subagentBranches.some((b) => b.agentId === "a3333333333333333"),
    ).toBe(false);
  });

  it("warns rather than throwing on an unreadable sidecar meta", async () => {
    const trace = await parseTraceFile(sidecarFixture);
    expect(
      trace.warnings.some((w) => w.includes("a4444444444444444")),
    ).toBe(true);
  });

  it("stays silent and unchanged when no sidecar directory exists", async () => {
    const trace = await parseTraceFile(sessionFixture);
    expect(trace.warnings.some((w) => w.includes("subagent"))).toBe(false);
    // The inline sidechain shape keeps working untouched.
    const read = trace.toolCalls.find((c) => c.name === "Read" && c.sidechain);
    expect(read?.branchId).toBe("toolu_002");
  });

  it("describes inline sidechain branches through the same branch model", async () => {
    const trace = await parseTraceFile(sessionFixture);
    const branch = trace.subagentBranches.find(
      (b) => b.branchId === "toolu_002",
    );
    expect(branch).toMatchObject({
      agentType: "Explore",
      origin: "inline",
      spawnDepth: 1,
    });
    expect(branch?.agentId).toBeUndefined();
    const spanned = trace.events
      .slice(branch!.startIndex, branch!.endIndex)
      .filter((e) => e.branchId === "toolu_002");
    expect(spanned.length).toBeGreaterThan(0);
  });

  it("leaves a spawn with no recorded branch out of subagentBranches", async () => {
    const trace = await parseTraceFile(sessionFixture);
    // doc-writer (toolu_008) spawned nothing that was ever recorded.
    expect(
      trace.subagentBranches.some((b) => b.branchId === "toolu_008"),
    ).toBe(false);
  });

  // The availability roster on the committed corpus (ADR 01016): an initial
  // listing before the first prompt, plus a mid-session delta.
  describe("availability roster", () => {
    it("reads the initial roster off the session fixture", async () => {
      const trace = await parseTraceFile(sessionFixture);
      expect(trace.availability.recorded).toBe(true);
      expect(trace.availability.skills.map((s) => s.name)).toEqual([
        "fix-bug",
        "writing-toolkit:identify-ai-tells",
        "deep-research",
        "bare-listing",
        "tdd-coverage",
      ]);
      expect(trace.availability.agents.map((a) => a.name)).toEqual([
        "Explore",
        "reviewer",
        "researcher",
      ]);
      expect(trace.availability.tools.map((t) => t.name)).toEqual([
        "WebSearch",
        "WebFetch",
      ]);
      expect(
        trace.availability.mcpServers.map((s) => `${s.name}:${s.status ?? "unknown"}`),
      ).toEqual(["git:pending", "demo-server:needs-auth"]);
    });

    it("adds the mid-session delta after the initial listing, not before", async () => {
      const trace = await parseTraceFile(sessionFixture);
      const initial = trace.availability.skills.find((s) => s.name === "fix-bug");
      const late = trace.availability.skills.find((s) => s.name === "tdd-coverage");
      expect(late?.offeredAt).toBeGreaterThan(initial?.offeredAt as number);
      // A non-initial delta adds; it must not withdraw the initial set.
      expect(initial?.withdrawnAt).toBeUndefined();
    });

    it("keeps descriptions, including the multi-line and absent cases", async () => {
      const trace = await parseTraceFile(sessionFixture);
      const byName = new Map(
        trace.availability.skills.map((s) => [s.name, s.description]),
      );
      expect(byName.get("fix-bug")).toContain("reproducing it with a failing test");
      // The plugin skill's description wraps onto a continuation line.
      expect(byName.get("writing-toolkit:identify-ai-tells")).toContain(
        "Flags rather than rewrites.",
      );
      // A truncated listing names a skill with no description at all.
      expect(byName.get("bare-listing")).toBeUndefined();
    });

    it("records nothing for a trace with no listing records", async () => {
      // The stream transcript predates the roster entirely.
      const trace = await parseTraceFile(streamFixture);
      expect(trace.availability.recorded).toBe(false);
      expect(trace.availability.skills).toEqual([]);
    });

    it("keeps roster ordinals valid across the sidecar splice", async () => {
      // ADR 01014 renumbers `index` over the merged list, so an ordinal
      // captured at parse time would point at the wrong event afterwards.
      const trace = await parseTraceFile(sidecarFixture);
      const listings = trace.events.filter(
        (e) => (e.raw as { attachment?: { type?: string } }).attachment !== undefined,
      );
      expect(listings.length).toBeGreaterThan(1);
      for (const entry of [
        ...trace.availability.skills,
        ...trace.availability.agents,
      ]) {
        if (entry.branchId !== undefined) continue;
        expect(trace.events[entry.offeredAt]?.kind).toBe("meta");
        expect(
          (trace.events[entry.offeredAt]?.raw as { attachment?: unknown })
            .attachment,
        ).toBeDefined();
      }
      // The late agent listing sits after the spliced branches, so its parse-
      // time ordinal (4) would be wrong without the remap.
      const explore = trace.availability.agents.find((a) => a.name === "Explore");
      expect(explore?.offeredAt).toBeGreaterThan(4);
    });

    it("folds a branch-only skill in without churning the main chain", async () => {
      // A subagent is offered its own roster. Replaying it as the session's
      // would withdraw everything the parent had, because a sidecar listing is
      // `isInitial: true` for that branch.
      const trace = await parseTraceFile(sidecarFixture);
      const byName = new Map(
        trace.availability.skills.map((s) => [s.name, s]),
      );
      expect(byName.get("branch-only-skill")?.branchId).toBe("toolu_lead");
      expect(byName.get("branch-only-skill")?.withdrawnAt).toBeUndefined();
      // A name the main chain already carried is not duplicated, and its own
      // interval is untouched.
      expect(
        trace.availability.skills.filter((s) => s.name === "fix-bug"),
      ).toHaveLength(1);
      expect(byName.get("fix-bug")?.branchId).toBeUndefined();
      expect(byName.get("fix-bug")?.withdrawnAt).toBeUndefined();
    });
  });
});
