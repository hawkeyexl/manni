/**
 * `options.when` is a general trigger (ADR 01016), not a `skill-invoked`
 * feature. `options` is an open bag, so a `when` block a grader neither
 * evaluates nor rejects validates clean and is silently ignored — leaving the
 * eval armed on every session, which is the exact failure `when.ts` exists to
 * prevent.
 *
 * Every windowed grader is held to both halves here: an unmet trigger skips,
 * and a malformed one errors.
 */
import { describe, expect, it } from "vitest";
import { graderFor } from "../../../../src/tracevals/graders/registry.js";
import { makeRulesPlan, makeTrace } from "../../helpers.js";
import type { Trace } from "../../../../src/tracevals/trace/types.js";

/** A session that edited docs and ran Edit; no prompt mentions deploying. */
function docsSession(): Trace {
  return makeTrace({
    events: [
      { kind: "user", text: "Rewrite the getting started guide", index: 0, raw: {} },
      { kind: "tool_call", toolName: "Edit", index: 1, raw: {} },
    ],
    userMessages: ["Rewrite the getting started guide"],
    assistantTexts: ["Done rewriting the guide."],
    toolCalls: [{ name: "Edit", input: {}, index: 1, sidechain: false }],
    fileAccesses: [
      { path: "C:\\work\\demo-project\\docs\\get-started.md", op: "edit", index: 1 },
    ],
    turnCount: 1,
  });
}

/**
 * Each windowed grader, with options that fail loudly on this session when the
 * trigger is armed — so a `skipped` can only come from the trigger.
 */
const CASES: Array<{ kind: string; options: Record<string, unknown> }> = [
  { kind: "tool-usage", options: { tool: "Edit", expect: "not-used" } },
  {
    kind: "file-access",
    options: { path: "docs/get-started.md", expect: "not-accessed" },
  },
  { kind: "regex", options: { pattern: "rewriting", expect: "no-match" } },
  { kind: "turn-count", options: { max: 0 } },
  { kind: "skill-invoked", options: { skill: "ghost", expect: "used" } },
];

describe("`when` is honoured by every windowed grader", () => {
  it.each(CASES)("$kind skips on an unmet trigger", async ({ kind, options }) => {
    const grader = graderFor(kind)!;
    // Armed first: the options must actually be able to fail here, or a skip
    // would prove nothing.
    const armed = await grader.grade({
      trace: docsSession(),
      plan: makeRulesPlan({ grader: kind, options }),
    });
    expect(armed.findings, `${kind} did not fail while armed`).toHaveLength(1);

    const result = await grader.grade({
      trace: docsSession(),
      plan: makeRulesPlan({
        grader: kind,
        options: { ...options, when: { "file-access": "migrations/**" } },
      }),
    });
    expect(result.findings, `${kind} ignored options.when`).toEqual([]);
    expect(result.skipped).toContain("trigger not met");
    expect(result.skipped).toContain("migrations/**");
  });

  it.each(CASES)("$kind arms on a met trigger", async ({ kind, options }) => {
    const grader = graderFor(kind)!;
    const result = await grader.grade({
      trace: docsSession(),
      plan: makeRulesPlan({
        grader: kind,
        options: { ...options, when: { "file-access": "docs/**" } },
      }),
    });
    expect(result.skipped).toBeUndefined();
    expect(result.findings).toHaveLength(1);
  });

  it.each(CASES)(
    "$kind rejects an unknown condition rather than ignoring it",
    ({ kind, options }) => {
      const grader = graderFor(kind)!;
      const message = grader.validateOptions?.({
        ...options,
        when: { "file-acess": "docs/**" },
      });
      expect(message, `${kind} accepted a typo'd condition`).toContain(
        "file-acess",
      );
    },
  );

  it.each(CASES)("$kind errors at grade time on a malformed `when`", async ({
    kind,
    options,
  }) => {
    const grader = graderFor(kind)!;
    const result = await grader.grade({
      trace: docsSession(),
      plan: makeRulesPlan({ grader: kind, options: { ...options, when: {} } }),
    });
    expect(result.error, `${kind} graded a malformed trigger`).toBeDefined();
  });
});
