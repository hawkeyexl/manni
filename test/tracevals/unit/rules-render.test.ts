import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseTraceFile } from "../../../src/tracevals/trace/claude.js";
import { renderTrace } from "../../../src/tracevals/judge/render.js";
import { lastTurn } from "../../../src/tracevals/rules/turn.js";

const TRACES = join(import.meta.dirname, "..", "fixtures", "rules", "traces");

describe("renderTrace over a precomputed window", () => {
  it("renders only the turn's events", async () => {
    const trace = await parseTraceFile(join(TRACES, "turns.jsonl"));
    const turn = lastTurn(trace);
    const text = renderTrace(trace, { window: turn.window });
    expect(text).toContain("scope: last turn");
    expect(text).toContain("[user] Now run the tests.");
    expect(text).toContain("npm test");
    expect(text).toContain("[assistant] Tests pass.");
    // The first turn is outside the window.
    expect(text).not.toContain("Fix the handler.");
    expect(text).not.toContain("[assistant] Fixed.");
  });

  it("leaves a render without a window unchanged", async () => {
    const trace = await parseTraceFile(join(TRACES, "turns.jsonl"));
    expect(renderTrace(trace, {})).toBe(renderTrace(trace));
    expect(renderTrace(trace)).toContain("Fix the handler.");
  });

  it("tells the caller when the total cap cut the render", async () => {
    const trace = await parseTraceFile(join(TRACES, "turns.jsonl"));
    const window = lastTurn(trace).window;
    let cuts = 0;
    renderTrace(trace, { window, onTruncated: () => (cuts += 1) });
    expect(cuts).toBe(0);

    const cut = renderTrace(trace, {
      window,
      maxTotalChars: 40,
      onTruncated: () => (cuts += 1),
    });
    expect(cuts).toBeGreaterThan(0);
    expect(cut).toMatch(/truncated/);
  });
});
