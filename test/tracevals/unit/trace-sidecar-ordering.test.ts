/**
 * Sidecar ownership must not depend on filename luck.
 *
 * `SidecarMeta` documents every member as optional, so a store that omits
 * `spawnDepth` is a real store. Ordering by `spawnDepth ?? 1` then falls back
 * to the agent-id tiebreak, and a depth-2 branch whose id sorts first is
 * visited before its parent registers the spawn it hangs off — so the branch is
 * discarded with a warning while a rename of the same file would merge it.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseTraceFile } from "../../../src/tracevals/trace/claude.js";

let dir: string;

beforeEach(async () => {
  await mkdir(".tmp", { recursive: true });
  dir = await mkdtemp(join(".tmp", "sidecar-order-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const line = (record: unknown): string => `${JSON.stringify(record)}\n`;

function assistantWithTool(
  uuid: string,
  parent: string | null,
  name: string,
  id: string,
  input: Record<string, unknown>,
  sidechain = false,
): string {
  return line({
    parentUuid: parent,
    isSidechain: sidechain,
    uuid,
    timestamp: "2026-08-20T10:00:00.000Z",
    sessionId: "33333333-3333-3333-3333-333333333333",
    cwd: "C:\\work\\demo-project",
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "tool_use", id, name, input }],
    },
  });
}

/**
 * Two sidecars: `agent-outer` (depth 1) spawns `agent-inner`, whose meta omits
 * `spawnDepth` — and whose id sorts *before* its parent's.
 */
async function writeSession(innerDepth?: number): Promise<string> {
  const session = join(dir, "session.jsonl");
  await writeFile(
    session,
    line({
      parentUuid: null,
      isSidechain: false,
      uuid: "u1",
      timestamp: "2026-08-20T09:59:00.000Z",
      sessionId: "33333333-3333-3333-3333-333333333333",
      cwd: "C:\\work\\demo-project",
      type: "user",
      message: { role: "user", content: "go" },
    }) +
      assistantWithTool("u2", "u1", "Agent", "toolu_outer", {
        subagent_type: "outer-agent",
        prompt: "survey",
      }),
    "utf-8",
  );

  const subagents = join(dir, "session", "subagents");
  await mkdir(subagents, { recursive: true });

  // The outer branch: one Read, then the Agent call that spawns the inner one.
  await writeFile(
    join(subagents, "agent-outer.meta.json"),
    JSON.stringify({
      agentType: "outer-agent",
      toolUseId: "toolu_outer",
      spawnDepth: 1,
    }),
    "utf-8",
  );
  await writeFile(
    join(subagents, "agent-outer.jsonl"),
    line({
      parentUuid: null,
      isSidechain: true,
      uuid: "o1",
      timestamp: "2026-08-20T10:00:00.000Z",
      sessionId: "33333333-3333-3333-3333-333333333333",
      cwd: "C:\\work\\demo-project",
      type: "user",
      message: { role: "user", content: "survey" },
    }) +
      assistantWithTool(
        "o2",
        "o1",
        "Read",
        "toolu_o_read",
        { file_path: "src/a.ts" },
        true,
      ) +
      assistantWithTool(
        "o3",
        "o2",
        "Agent",
        "toolu_inner",
        { subagent_type: "inner-agent", prompt: "dig" },
        true,
      ),
    "utf-8",
  );

  await writeFile(
    join(subagents, "agent-inner.meta.json"),
    JSON.stringify({
      agentType: "inner-agent",
      toolUseId: "toolu_inner",
      parentAgentId: "outer",
      ...(innerDepth !== undefined ? { spawnDepth: innerDepth } : {}),
    }),
    "utf-8",
  );
  await writeFile(
    join(subagents, "agent-inner.jsonl"),
    line({
      parentUuid: null,
      isSidechain: true,
      uuid: "i1",
      timestamp: "2026-08-20T10:01:00.000Z",
      sessionId: "33333333-3333-3333-3333-333333333333",
      cwd: "C:\\work\\demo-project",
      type: "user",
      message: { role: "user", content: "dig" },
    }) +
      assistantWithTool(
        "i2",
        "i1",
        "Grep",
        "toolu_i_grep",
        { pattern: "x" },
        true,
      ),
    "utf-8",
  );
  return session;
}

describe("sidecar ownership without a recorded spawnDepth", () => {
  it("attaches a nested branch whose meta omits spawnDepth", async () => {
    const trace = await parseTraceFile(await writeSession());
    const types = trace.subagentBranches.map((b) => b.agentType).sort();
    expect(types, trace.warnings.join(" | ")).toEqual([
      "inner-agent",
      "outer-agent",
    ]);
    expect(trace.toolCalls.map((c) => c.name)).toContain("Grep");
    expect(trace.warnings.some((w) => /not merged/.test(w))).toBe(false);
  });

  it("agrees with the same store once spawnDepth is recorded", async () => {
    // The control: correctness must not have depended on the metadata being
    // present, so both stores have to produce the same branch set.
    const trace = await parseTraceFile(await writeSession(2));
    expect(trace.subagentBranches.map((b) => b.agentType).sort()).toEqual([
      "inner-agent",
      "outer-agent",
    ]);
  });
});
