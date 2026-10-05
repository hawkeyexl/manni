import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseTraceFile } from "../../../src/tracevals/trace/claude.js";
import {
  isTypedPrompt,
  lastTurn,
  subagentTurn,
} from "../../../src/tracevals/rules/turn.js";

const TRACES = join(import.meta.dirname, "..", "fixtures", "rules", "traces");
const load = (name: string) => parseTraceFile(join(TRACES, name));

describe("the typed-prompt predicate", () => {
  it("keeps prompts a person typed and drops every injection", async () => {
    const trace = await load("turns.jsonl");
    const typed = trace.events.filter(isTypedPrompt).map((e) => e.text);
    expect(typed).toEqual(["Fix the handler.", "Now run the tests."]);
  });

  it("keeps a prompt typed after a system-reminder in the same record", async () => {
    const trace = await load("reminder-prompt.jsonl");
    const typed = trace.events.filter(isTypedPrompt);
    expect(typed).toHaveLength(2);
    expect(typed[1]?.text).toContain("Second, typed after a reminder.");
  });

  it("counts a slash command as a typed prompt", async () => {
    const trace = await load("slash-command.jsonl");
    const typed = trace.events.filter(isTypedPrompt);
    expect(typed.at(-1)?.text).toContain("<command-name>/ship</command-name>");
  });
});

describe("lastTurn", () => {
  it("starts at the last typed prompt; hook feedback and meta records do not start one", async () => {
    const trace = await load("turns.jsonl");
    const turn = lastTurn(trace);
    const prompt = trace.events.find((e) => e.text === "Now run the tests.");
    expect(turn.from).toBe(prompt?.index);
    expect(turn.to).toBe(trace.events.length - 1);
    expect(turn.window.scope).toBe("turn");
    expect(turn.window.empty).toBe(false);
    expect(turn.window.userMessages).toEqual(["Now run the tests."]);
    expect(turn.window.toolCalls.map((c) => c.name)).toEqual(["Bash"]);
    // The Read belongs to the first turn.
    expect(turn.window.fileAccesses).toEqual([]);
    expect(turn.window.assistantTexts).toEqual(["Tests pass."]);
    expect(turn.window.events[0]?.index).toBe(turn.from);
  });

  it("counts the session's typed turns, which turn-count-above reads", async () => {
    const trace = await load("turns.jsonl");
    const turn = lastTurn(trace);
    expect(turn.sessionTurnCount).toBe(2);
    expect(turn.window.turnCount).toBe(turn.sessionTurnCount);
    // The parser's own count still includes the injections.
    expect(trace.turnCount).toBeGreaterThan(turn.sessionTurnCount);
  });

  it("opens a turn at a slash command", async () => {
    const trace = await load("slash-command.jsonl");
    const turn = lastTurn(trace);
    expect(turn.window.toolCalls.map((c) => c.name)).toEqual(["Bash"]);
    expect(turn.sessionTurnCount).toBe(2);
  });

  it("is empty when nothing happened after the last typed prompt", async () => {
    const trace = await load("empty-turn.jsonl");
    const turn = lastTurn(trace);
    expect(turn.window.empty).toBe(true);
    expect(turn.window.reason).toMatch(/nothing/);
    expect(turn.from).toBe(
      trace.events.find((e) => e.text === "And the docs?")?.index,
    );
  });

  it("is empty when the trace holds no typed prompt", async () => {
    const trace = await load("no-prompt.jsonl");
    const turn = lastTurn(trace);
    expect(turn.window.empty).toBe(true);
    expect(turn.sessionTurnCount).toBe(0);
    expect(turn.to).toBeLessThan(turn.from);
  });
});

describe("subagentTurn", () => {
  it("takes a sidecar transcript's whole run as the turn", async () => {
    const trace = await load(join("subagents", "agent-a7979797979797979.jsonl"));
    // Every record is a sidechain, so the parser keeps no prompts.
    expect(trace.userMessages).toEqual([]);
    const turn = subagentTurn(trace);
    expect(turn.from).toBe(0);
    expect(turn.to).toBe(trace.events.length - 1);
    expect(turn.window.empty).toBe(false);
    expect(turn.window.scope).toBe("turn");
    expect(turn.window.userMessages).toEqual(["Review the diff."]);
    expect(turn.window.fileAccesses.map((a) => a.op)).toEqual(["read"]);
    expect(turn.window.assistantTexts).toEqual(["One finding."]);
  });

  it("is empty when the subagent recorded no work", async () => {
    const trace = await load(join("subagents", "agent-a7979797979797979.jsonl"));
    trace.events = trace.events.slice(0, 1);
    expect(subagentTurn(trace).window.empty).toBe(true);
  });
});
