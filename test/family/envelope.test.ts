import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { parseEnvelope, readEnvelope } from "../../src/family/core/envelope.js";
import { envelope } from "./helpers.js";

function stream(text: string | undefined, isTTY = false): NodeJS.ReadStream {
  const s = new PassThrough() as unknown as NodeJS.ReadStream;
  s.isTTY = isTTY;
  if (text !== undefined) (s as unknown as PassThrough).end(text);
  return s;
}

describe("parseEnvelope", () => {
  it("reads a PostToolUse edit's file and cwd", () => {
    expect(parseEnvelope(envelope("post-tool-use-member", "/repo"))).toEqual({
      event: "PostToolUse",
      sessionId: "s1",
      cwd: "/repo",
      toolName: "Edit",
      filePath: "docs/page.md",
      stopHookActive: false,
    });
  });

  it("reads a notebook edit's notebook_path", () => {
    const parsed = parseEnvelope(
      JSON.stringify({ hook_event_name: "PostToolUse", tool_name: "NotebookEdit", tool_input: { notebook_path: "a.ipynb" } }),
    );
    expect(parsed?.filePath).toBe("a.ipynb");
  });

  it("reads stop_hook_active", () => {
    expect(parseEnvelope(envelope("stop"))?.stopHookActive).toBe(false);
    expect(parseEnvelope(envelope("stop-hook-active"))?.stopHookActive).toBe(true);
  });

  it("reads a SessionStart model as a string or as an object's id", () => {
    expect(parseEnvelope(envelope("session-start-model"))?.model).toBe("claude-opus-4-5");
    expect(parseEnvelope(envelope("session-start"))?.model).toBeUndefined();
    expect(
      parseEnvelope(JSON.stringify({ hook_event_name: "SessionStart", model: { id: "m-1" } }))?.model,
    ).toBe("m-1");
  });

  it("reads a Stop's session, transcript and last message", () => {
    expect(parseEnvelope(envelope("stop-transcript"))).toEqual({
      event: "Stop",
      stopHookActive: false,
      sessionId: "s1",
      transcriptPath: "/home/maya/.claude/projects/repo/s1.jsonl",
      lastAssistantMessage: "Done.",
    });
  });

  it("reads a SubagentStop's agent and its own transcript", () => {
    expect(parseEnvelope(envelope("subagent-stop"))).toMatchObject({
      event: "SubagentStop",
      sessionId: "s1",
      transcriptPath: "/home/maya/.claude/projects/repo/s1.jsonl",
      agentTranscriptPath: "/home/maya/.claude/projects/repo/s1/subagents/agent-a1b2.jsonl",
      agentId: "a1b2",
      agentType: "general-purpose",
      lastAssistantMessage: "Done.",
    });
  });

  it("reads a SessionEnd's session", () => {
    expect(parseEnvelope(envelope("session-end"))).toMatchObject({ event: "SessionEnd", sessionId: "s1" });
  });

  it("is not an envelope without a hook_event_name, or when not a JSON object", () => {
    expect(parseEnvelope("")).toBeUndefined();
    expect(parseEnvelope("docs/page.md")).toBeUndefined();
    expect(parseEnvelope("[1]")).toBeUndefined();
    expect(parseEnvelope(JSON.stringify({ tool_name: "Edit" }))).toBeUndefined();
  });
});

describe("readEnvelope", () => {
  it("does not read a terminal", async () => {
    expect(await readEnvelope(stream(undefined, true))).toBeUndefined();
  });

  it("answers an empty, closed stdin as a run by hand", async () => {
    expect(await readEnvelope(stream(""))).toBeUndefined();
  });

  it("reads the envelope Claude Code writes", async () => {
    expect((await readEnvelope(stream(envelope("stop"))))?.event).toBe("Stop");
  });
});
