/**
 * tool-order: sequence, which `tool-usage` cannot express.
 *
 * "Read before Write" is a claim a lot of instruction artifacts actually make,
 * and counting alone cannot check it: a session that wrote first and read
 * afterwards to see what it had done satisfies every count and violates the
 * instruction.
 */
import { describe, expect, it } from "vitest";
import { graderFor } from "../../../../src/tracevals/graders/registry.js";
import { makePlan, makeTrace } from "../../helpers.js";
import type { ToolCall } from "../../../../src/tracevals/trace/types.js";

const grader = graderFor("tool-order")!;

/**
 * Tool calls numbered as consecutive `trace.events` ordinals.
 *
 * The grader reads `index`, not array position, so every fixture has to carry
 * one. Consecutive numbering is the ordinary case; the test that separates the
 * two writes its ordinals by hand.
 */
function calls(items: Array<Omit<ToolCall, "index">>): ToolCall[] {
  return items.map((call, index) => ({ ...call, index }));
}

const ordered = makeTrace({
  toolCalls: calls([
    { name: "Read", input: { file_path: "src/a.ts" }, sidechain: false },
    { name: "Write", input: { file_path: "src/a.ts" }, sidechain: false },
  ]),
});

const reversed = makeTrace({
  toolCalls: calls([
    { name: "Write", input: { file_path: "src/a.ts" }, sidechain: false },
    { name: "Read", input: { file_path: "src/a.ts" }, sidechain: false },
  ]),
});

const plan = (options: Record<string, unknown>) =>
  makePlan({ grader: "tool-order", options });

const gradeWith = async (trace: ReturnType<typeof makeTrace>, options: Record<string, unknown>) =>
  grader.grade({ trace, plan: plan(options) });

describe("tool-order grader", () => {
  it("passes when before precedes after", async () => {
    const r = await gradeWith(ordered, { before: "Read", after: "Write" });
    expect(r.findings).toEqual([]);
  });

  it("fails when the order is reversed", async () => {
    const r = await gradeWith(reversed, { before: "Read", after: "Write" });
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]?.message).toContain("only used after");
  });

  it("fails when after happened and before never did", async () => {
    const writeOnly = makeTrace({
      toolCalls: calls([{ name: "Write", input: {}, sidechain: false }]),
    });
    const r = await gradeWith(writeOnly, { before: "Read", after: "Write" });
    expect(r.findings[0]?.message).toContain("without Read ever being used");
  });

  it("fails when before happened and after never did", async () => {
    const readOnly = makeTrace({
      toolCalls: calls([{ name: "Read", input: {}, sidechain: false }]),
    });
    const r = await gradeWith(readOnly, { before: "Read", after: "Write" });
    expect(r.findings[0]?.message).toContain("was never used");
  });

  it("passes vacuously when neither tool appears", async () => {
    // An ordering claim with nothing to bite on. A suite that wants the calls
    // to happen at all says so with tool-usage — the grader for that question.
    const neither = makeTrace({
      toolCalls: calls([{ name: "Glob", input: {}, sidechain: false }]),
    });
    const r = await gradeWith(neither, { before: "Read", after: "Write" });
    expect(r.findings).toEqual([]);
  });

  it("narrows by input, so an unrelated read does not satisfy the claim", async () => {
    const wrongFile = makeTrace({
      toolCalls: calls([
        { name: "Read", input: { file_path: "README.md" }, sidechain: false },
        { name: "Write", input: { file_path: "src/a.ts" }, sidechain: false },
      ]),
    });
    const loose = await gradeWith(wrongFile, { before: "Read", after: "Write" });
    expect(loose.findings).toEqual([]);
    const strict = await gradeWith(wrongFile, {
      before: "Read",
      beforeInputMatch: "src/",
      after: "Write",
      afterInputMatch: "src/",
    });
    expect(strict.findings).toHaveLength(1);
  });

  it("takes the weakest useful reading: one good pair is enough", async () => {
    // Read, Write, Write. Demanding every Write be preceded by its own Read
    // would fail a session that did the right thing and then repeated the
    // second half.
    const repeated = makeTrace({
      toolCalls: calls([
        { name: "Read", input: {}, sidechain: false },
        { name: "Write", input: {}, sidechain: false },
        { name: "Write", input: {}, sidechain: false },
      ]),
    });
    const r = await gradeWith(repeated, { before: "Read", after: "Write" });
    expect(r.findings).toEqual([]);
  });

  it("ignores sidechain calls by default but counts them on request", async () => {
    const inSubagent = makeTrace({
      toolCalls: calls([
        { name: "Read", input: {}, sidechain: true },
        { name: "Write", input: {}, sidechain: false },
      ]),
    });
    const scoped = await gradeWith(inSubagent, { before: "Read", after: "Write" });
    expect(scoped.findings).toHaveLength(1);
    const widened = await gradeWith(inSubagent, {
      before: "Read",
      after: "Write",
      includeSidechains: true,
    });
    expect(widened.findings).toEqual([]);
  });

  it("reports an uncompilable pattern as an eval error, not a session failure", async () => {
    const r = await gradeWith(ordered, {
      before: "Read",
      after: "Write",
      beforeInputMatch: "([unclosed",
    });
    expect(r.error).toContain("not a valid regular expression");
    expect(r.findings).toEqual([]);
  });

  it("requires both ends of the claim", async () => {
    const r = await gradeWith(ordered, { before: "Read" });
    expect(r.error).toContain("options.after is required");
  });

  it("orders on the event ordinal, not on array position", async () => {
    // Splicing a sidecar subagent branch into the trace (ADR 01014) groups a
    // branch's calls together in `toolCalls` while their ordinals interleave
    // with the main chain. Here the Write is listed first but happened last,
    // so reading array position would report a violation that never occurred.
    const spliced = makeTrace({
      toolCalls: [
        { name: "Write", input: {}, sidechain: false, index: 7 },
        { name: "Read", input: {}, sidechain: false, index: 3 },
      ],
    });
    const r = await gradeWith(spliced, { before: "Read", after: "Write" });
    expect(r.findings).toEqual([]);

    // And the inverse still fails, so this is ordering rather than blanket
    // permissiveness.
    const violating = makeTrace({
      toolCalls: [
        { name: "Read", input: {}, sidechain: false, index: 9 },
        { name: "Write", input: {}, sidechain: false, index: 2 },
      ],
    });
    const bad = await gradeWith(violating, { before: "Read", after: "Write" });
    expect(bad.findings).toHaveLength(1);
  });

  it("treats ordinal 0 as a real position rather than an absent one", async () => {
    // The sentinel trap: with -1 meaning "not found", a `before` at the
    // session's very first event compares equal to nothing found at all.
    const atZero = makeTrace({
      toolCalls: [
        { name: "Read", input: {}, sidechain: false, index: 0 },
        { name: "Write", input: {}, sidechain: false, index: 1 },
      ],
    });
    const r = await gradeWith(atZero, { before: "Read", after: "Write" });
    expect(r.findings).toEqual([]);
    expect(r.error).toBeUndefined();
  });
});
