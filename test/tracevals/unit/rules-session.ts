/**
 * A Claude Code session file built from steps and parsed by the real adapter,
 * so the raw shapes the earlier-turns timeline reads are the recorder's own.
 */
import { parseTraceContent } from "../../../src/tracevals/trace/claude.js";
import type { Trace } from "../../../src/tracevals/trace/types.js";

export type SessionStep =
  | { prompt: string }
  | { say: string }
  | { tool: string; input: Record<string, unknown>; result?: string; error?: boolean };

export const SESSION_CWD = "C:\\work\\demo";

/** `sidechain` records every step as a subagent's own, as its sidecar transcript does. */
export function session(steps: SessionStep[], cwd = SESSION_CWD, { sidechain = false } = {}): Trace {
  const lines: Record<string, unknown>[] = [];
  let parent: string | null = null;
  const push = (rec: Record<string, unknown>): void => {
    const uuid = `rec-${String(lines.length + 1)}`;
    lines.push({
      parentUuid: parent,
      isSidechain: sidechain,
      uuid,
      timestamp: `2026-10-05T10:00:${String(lines.length).padStart(2, "0")}.000Z`,
      sessionId: "80808080-0000-0000-0000-000000000000",
      cwd,
      ...rec,
    });
    parent = uuid;
  };
  steps.forEach((step, i) => {
    if ("prompt" in step) {
      push({ type: "user", origin: { kind: "human" }, message: { role: "user", content: step.prompt } });
    } else if ("say" in step) {
      push({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: step.say }] } });
    } else {
      const id = `toolu_${String(i)}`;
      push({
        type: "assistant",
        message: { role: "assistant", content: [{ type: "tool_use", id, name: step.tool, input: step.input }] },
      });
      if (step.result !== undefined) {
        push({
          type: "user",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: id,
                content: [{ type: "text", text: step.result }],
                ...(step.error === true ? { is_error: true } : {}),
              },
            ],
          },
        });
      }
    }
  });
  return parseTraceContent(lines.map((l) => JSON.stringify(l)).join("\n"), "session.jsonl");
}
