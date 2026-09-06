import { describe, expect, it } from "vitest";
import { extractEvals } from "../../../src/tracevals/evals/extract.js";
import type { ResolvedArtifact } from "../../../src/tracevals/artifacts/types.js";

function artifact(lines: string[]): ResolvedArtifact {
  return {
    name: "demo",
    type: "skill",
    path: "C:\\work\\demo\\SKILL.md",
    content: lines.join("\n"),
    origin: "project",
  };
}

describe("extractEvals", () => {
  it("reads declared evals, expanding string shorthand", async () => {
    const result = await extractEvals(
      artifact([
        "---",
        "name: demo",
        "metadata:",
        "  evals:",
        "    - Reproduce the bug first.",
        "    - id: used-read",
        "      assertion: The session read a file.",
        "      grader: tool-usage",
        "      options:",
        "        tool: Read",
        "        expect: used",
        "---",
        "",
        "# Demo",
      ]),
    );
    expect(result.declared).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.evals).toHaveLength(2);
    // The shorthand is the id-less form, so its identity is positional.
    expect(result.evals[0]).toMatchObject({
      id: "eval-1",
      assertion: "Reproduce the bug first.",
      grader: "ai",
      severity: "error",
      type: "regression",
    });
    expect(result.evals[1]).toMatchObject({
      id: "used-read",
      grader: "tool-usage",
      options: { tool: "Read", expect: "used" },
    });
  });

  it("accepts the single-string block: the whole value is one assertion", async () => {
    const result = await extractEvals(
      artifact([
        "---",
        "metadata:",
        "  evals: Reproduce the bug with a failing test.",
        "---",
      ]),
    );
    expect(result.errors).toEqual([]);
    expect(result.evals).toHaveLength(1);
    expect(result.evals[0]).toMatchObject({
      id: "eval-1",
      assertion: "Reproduce the bug with a failing test.",
      grader: "ai",
    });
  });

  it("reports schema violations with source line numbers", async () => {
    const result = await extractEvals(
      artifact([
        "---",
        "name: demo",
        "metadata:",
        "  evals:",
        "    - assertion: x",
        "      severty: error",
        "---",
      ]),
    );
    expect(result.declared).toBe(true);
    expect(result.evals).toEqual([]);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => typeof e.line === "number")).toBe(true);
  });

  it("rejects the artifact-evals-0.2 spellings loudly", async () => {
    const envelope = await extractEvals(
      artifact([
        "---",
        "metadata:",
        "  evals:",
        "    criteria:",
        "      - Something.",
        "---",
      ]),
    );
    expect(envelope.errors.length).toBeGreaterThan(0);

    const oldName = await extractEvals(
      artifact([
        "---",
        "metadata:",
        "  evals:",
        "    - name: used-read",
        "      assertion: The session read a file.",
        "---",
      ]),
    );
    expect(oldName.errors.length).toBeGreaterThan(0);
  });

  it("returns declared=false when there is no evals block", async () => {
    const result = await extractEvals(
      artifact(["---", "name: demo", "---", "# D"]),
    );
    expect(result.declared).toBe(false);
    expect(result.evals).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it("lets other tools' metadata members pass untouched", async () => {
    const result = await extractEvals(
      artifact([
        "---",
        "metadata:",
        "  dockg:",
        "    label: Fix a bug",
        "  evals:",
        "    - Reproduce the bug first.",
        "---",
      ]),
    );
    expect(result.errors).toEqual([]);
    expect(result.evals).toHaveLength(1);
  });

  it("honors metadata.eval-skip", async () => {
    const result = await extractEvals(
      artifact(["---", "metadata:", "  eval-skip: true", "---"]),
    );
    expect(result.errors).toEqual([]);
    expect(result.skip).toBe(true);
  });

  it("reserves the eval prefix, so a misspelling is loud rather than inert", async () => {
    const result = await extractEvals(
      artifact([
        "---",
        "metadata:",
        "  eval-skpi: true",
        "  evals:",
        "    - Reproduce the bug first.",
        "---",
      ]),
    );
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.instancePath).toBe("/metadata/eval-skpi");
    expect(result.errors[0]?.subject).toBe("eval-skpi");
    expect(result.errors[0]?.line).toBe(3);
    expect(result.evals).toEqual([]);
  });

  it("normalizes a single anchor example to a list", async () => {
    const result = await extractEvals(
      artifact([
        "---",
        "metadata:",
        "  evals:",
        "    - id: honored-tdd",
        "      assertion: The session wrote a failing test first.",
        "      examples:",
        "        pass:",
        "          - A test edit lands before the src edit.",
        "        fail: The fix lands first.",
        "---",
      ]),
    );
    expect(result.errors).toEqual([]);
    expect(result.evals[0]?.examples).toEqual({
      pass: ["A test edit lands before the src edit."],
      fail: ["The fix lands first."],
    });
  });

  it("carries the per-entry skip, provider, and command family", async () => {
    const result = await extractEvals(
      artifact([
        "---",
        "metadata:",
        "  evals:",
        "    - id: paused",
        "      assertion: Something.",
        "      skip: true",
        "    - id: judged-elsewhere",
        "      assertion: Something else.",
        "      grader: ai",
        "      provider: claude-cli",
        "    - id: no-force-push",
        "      assertion: The trace contains no force push.",
        "      grader: command",
        '      command: ["node", "tracevals/check.mjs", "{trace}"]',
        "      success-exit-codes: [0, 3]",
        "      timeout-ms: 15000",
        "---",
      ]),
    );
    expect(result.errors).toEqual([]);
    expect(result.evals[0]?.skip).toBe(true);
    expect(result.evals[1]?.provider).toBe("claude-cli");
    expect(result.evals[2]).toMatchObject({
      command: ["node", "tracevals/check.mjs", "{trace}"],
      successExitCodes: [0, 3],
      timeoutMs: 15000,
    });
  });

  it("rejects a metadata that is not a mapping", async () => {
    // The schema types `metadata` as an object. Folding a scalar into the
    // "nothing declared" path would skip validation and pass it silently.
    const result = await extractEvals(
      artifact(["---", "name: x", "metadata: hello", "---", "body"]),
    );
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]?.instancePath).toBe("/metadata");
    expect(result.evals).toEqual([]);
  });

  it("validates an artifact carrying only eval-provenance", async () => {
    // No evals and no eval-skip, so the run has nothing to grade — but a
    // malformed provenance block is still a malformed block, and one of those
    // is never silently ignored.
    const result = await extractEvals(
      artifact([
        "---",
        "metadata:",
        "  eval-provenance:",
        "    - generated-by: 5",
        "      bogus: yes",
        "---",
      ]),
    );
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("accepts a well-formed eval-provenance on its own", async () => {
    const result = await extractEvals(
      artifact([
        "---",
        "metadata:",
        "  eval-provenance:",
        "    - generated-by: claude-fable-5",
        "      evals: [used-read]",
        "      confidence:",
        "        used-read: 0.9",
        "---",
      ]),
    );
    expect(result.errors).toEqual([]);
    expect(result.declared).toBe(false);
  });

  it("still short-circuits an artifact whose metadata claims nothing of ours", async () => {
    const result = await extractEvals(
      artifact([
        "---",
        "metadata:",
        "  some-other-tool:",
        "    setting: value",
        "---",
      ]),
    );
    expect(result.errors).toEqual([]);
    expect(result.declared).toBe(false);
    expect(result.evals).toEqual([]);
  });
});

describe("eval-provenance, read back", () => {
  // `fill` has always written this block; nothing read it until the judge
  // needed to know whether it was grading an assertion it wrote itself.
  const withProvenance = (provenance: string[]) =>
    artifact([
      "---",
      "name: demo",
      "metadata:",
      "  evals:",
      "    - id: used-read",
      "      assertion: The session read a file.",
      "    - id: hand-written",
      "      assertion: A human wrote this one.",
      "  eval-provenance:",
      ...provenance,
      "---",
    ]);

  it("maps each eval id to the model that proposed it", async () => {
    const r = await extractEvals(
      withProvenance([
        "    - generated-by: anthropic:claude-opus-4-5",
        "      evals: [used-read]",
      ]),
    );
    expect(r.errors).toEqual([]);
    expect(r.proposedBy.get("used-read")).toEqual([
      "anthropic:claude-opus-4-5",
    ]);
    // Absent, not empty: a hand-written eval has no author on record.
    expect(r.proposedBy.get("hand-written")).toBeUndefined();
  });

  it("collects every model that proposed the same eval", async () => {
    // A re-fill by a second model extends the block rather than replacing it,
    // so one id can appear under two entries and both are self-preference.
    const r = await extractEvals(
      withProvenance([
        "    - generated-by: anthropic:claude-opus-4-5",
        "      evals: [used-read]",
        "    - generated-by: openai:gpt-5",
        "      evals: [used-read, hand-written]",
      ]),
    );
    expect(r.proposedBy.get("used-read")).toEqual([
      "anthropic:claude-opus-4-5",
      "openai:gpt-5",
    ]);
    expect(r.proposedBy.get("hand-written")).toEqual(["openai:gpt-5"]);
  });

  it("is empty rather than throwing when the block is absent", async () => {
    const r = await extractEvals(
      artifact([
        "---",
        "name: demo",
        "metadata:",
        "  evals:",
        "    - id: used-read",
        "      assertion: The session read a file.",
        "---",
      ]),
    );
    expect(r.proposedBy.size).toBe(0);
  });
});
