import { describe, expect, it } from "vitest";
import { graderFor, listGraderKinds } from "../../../../src/tracevals/graders/registry.js";
import { makePlan, makeTrace } from "../../helpers.js";

/**
 * Kinds whose whole configuration is the entry itself rather than `options`.
 * `command` carries its argv, exit codes, and timeout on the eval entry, where
 * the schema pins them — so there is nothing for `validateOptions` to check,
 * and omitting the hook is also what stops `fill` proposing it (ADR 01011).
 */
const NO_OPTIONS = new Set(["command"]);

const optionConfigured = (): string[] =>
  listGraderKinds().filter((kind) => !NO_OPTIONS.has(kind));

/** Options accepted by every kind, so the "valid" leg of each table is honest. */
const VALID: Record<string, Record<string, unknown>> = {
  "tool-usage": { tool: "Read" },
  "tool-order": { before: "Read", after: "Write" },
  "skill-invoked": { skill: "fix-bug" },
  "file-access": { path: "src/index.ts" },
  "turn-count": { max: 10 },
  cost: { maxUsd: 1 },
  regex: { pattern: "hello" },
  "json-output": { schema: { type: "object" } },
};

describe("grader option validation", () => {
  it("is implemented by every option-configured kind", () => {
    for (const kind of optionConfigured()) {
      expect(
        graderFor(kind)?.validateOptions,
        `${kind} must implement validateOptions`,
      ).toBeTypeOf("function");
    }
  });

  it("accepts each kind's minimal valid options", () => {
    for (const kind of optionConfigured()) {
      const options = VALID[kind];
      expect(options, `no VALID entry for ${kind}`).toBeDefined();
      expect(
        graderFor(kind)?.validateOptions?.(options!),
        `${kind} rejected its own valid options`,
      ).toBeUndefined();
    }
  });

  it("requires every kind's required options", () => {
    // turn-count and cost have no single required key, but a criterion with no
    // bound at all is vacuous — it can never fail — so it is rejected too.
    for (const kind of optionConfigured()) {
      expect(
        graderFor(kind)?.validateOptions?.({}),
        `${kind} accepted empty options`,
      ).toBeTypeOf("string");
    }
  });

  describe("tool-usage", () => {
    const validate = graderFor("tool-usage")!.validateOptions!;

    it("rejects a missing or empty tool", () => {
      expect(validate({})).toContain("tool");
      expect(validate({ tool: "" })).toContain("tool");
      expect(validate({ tool: 7 })).toContain("tool");
    });

    it("rejects an unknown expect value", () => {
      // Previously this fell through every branch and silently passed.
      expect(validate({ tool: "Bash", expect: "typo" })).toContain("expect");
      expect(validate({ tool: "Bash", expect: "not-used" })).toBeUndefined();
    });

    it("rejects non-numeric or contradictory bounds", () => {
      expect(validate({ tool: "Bash", min: "3" })).toContain("min");
      expect(validate({ tool: "Bash", max: null })).toContain("max");
      expect(validate({ tool: "Bash", min: 5, max: 2 })).toContain("max");
      expect(validate({ tool: "Bash", min: 1, max: 2 })).toBeUndefined();
    });

    it("rejects a non-boolean includeSidechains", () => {
      expect(validate({ tool: "Bash", includeSidechains: "yes" })).toContain(
        "includeSidechains",
      );
    });
  });

  describe("skill-invoked", () => {
    const validate = graderFor("skill-invoked")!.validateOptions!;

    it("requires a skill and a known expect", () => {
      expect(validate({})).toContain("skill");
      expect(validate({ skill: "x", expect: "nope" })).toContain("expect");
      expect(validate({ skill: "x", expect: "not-used" })).toBeUndefined();
    });
  });

  describe("file-access", () => {
    const validate = graderFor("file-access")!.validateOptions!;

    it("requires a path and constrains op and expect", () => {
      expect(validate({})).toContain("path");
      expect(validate({ path: "a.ts", op: "delete" })).toContain("op");
      expect(validate({ path: "a.ts", op: "read" })).toBeUndefined();
      expect(validate({ path: "a.ts", expect: "bad" })).toContain("expect");
      expect(validate({ path: "a.ts", expect: "not-accessed" })).toBeUndefined();
    });
  });

  describe("turn-count", () => {
    const validate = graderFor("turn-count")!.validateOptions!;

    it("requires at least one bound and rejects contradictions", () => {
      expect(validate({})).toContain("min");
      expect(validate({ min: "2" })).toContain("min");
      expect(validate({ min: 5, max: 2 })).toContain("max");
      expect(validate({ min: 1, max: 5 })).toBeUndefined();
    });
  });

  describe("cost", () => {
    const validate = graderFor("cost")!.validateOptions!;

    it("requires at least one budget", () => {
      expect(validate({})).toContain("maxUsd");
      expect(validate({ maxTokens: "x" })).toContain("maxTokens");
      expect(validate({ maxUsd: -1 })).toContain("maxUsd");
      expect(validate({ maxTokens: 1000 })).toBeUndefined();
    });
  });

  describe("regex", () => {
    const validate = graderFor("regex")!.validateOptions!;

    it("requires a compilable pattern", () => {
      expect(validate({})).toContain("pattern");
      expect(validate({ pattern: "a[" })).toContain("pattern");
      expect(validate({ pattern: "a", flags: "q" })).toContain("flags");
      expect(validate({ pattern: "a", flags: "gi" })).toBeUndefined();
    });

    it("validates the pattern against its flags, as grade() builds it", () => {
      // `a{` is legal on its own but not under `u`. Validating them apart
      // would accept options that then throw at grade time.
      expect(validate({ pattern: "a{", flags: "u" })).toContain("pattern");
      expect(validate({ pattern: "a{" })).toBeUndefined();
    });

    it("does not let a bad pattern escape grade() as an exception", async () => {
      const result = await graderFor("regex")!.grade({
        trace: makeTrace({ assistantTexts: ["hello"] }),
        plan: makePlan({
          grader: "regex",
          options: { pattern: "a{", flags: "u" },
        }),
      });
      expect(result.error).toContain("pattern");
    });

    it("constrains on and expect", () => {
      expect(validate({ pattern: "a", on: "bad" })).toContain("on");
      expect(validate({ pattern: "a", expect: "bad" })).toContain("expect");
      expect(validate({ pattern: "a", on: "all", expect: "no-match" })).toBeUndefined();
    });
  });

  describe("json-output", () => {
    const validate = graderFor("json-output")!.validateOptions!;

    it("requires an object schema", () => {
      expect(validate({})).toContain("schema");
      expect(validate({ schema: "x" })).toContain("schema");
      expect(validate({ schema: [] })).toContain("schema");
      expect(validate({ schema: null })).toContain("schema");
    });
  });

  it("exempts only the kinds that genuinely take no options", () => {
    // Guards the exemption itself: a new grader must not join NO_OPTIONS by
    // accident, and a kind that disappears must not leave a stale entry.
    for (const kind of NO_OPTIONS) {
      expect(graderFor(kind), `${kind} is not registered`).toBeDefined();
      expect(
        graderFor(kind)?.validateOptions,
        `${kind} takes options after all — drop it from NO_OPTIONS`,
      ).toBeUndefined();
    }
  });

  it("is enforced by grade(), not just callable on its own", async () => {
    const result = await graderFor("tool-usage")!.grade({
      trace: makeTrace({
        toolCalls: [{ name: "Bash", input: {}, sidechain: false, index: 0 }],
      }),
      plan: makePlan({
        grader: "tool-usage",
        options: { tool: "Bash", expect: "typo" },
      }),
    });
    expect(result.findings).toEqual([]);
    expect(result.error).toContain("expect");
  });
});
