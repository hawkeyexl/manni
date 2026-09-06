import { describe, expect, it } from "vitest";
import { graderFor } from "../../../../src/tracevals/graders/registry.js";
import { globToRegExp } from "../../../../src/tracevals/graders/glob.js";
import { makeRulesPlan, makeTrace } from "../../helpers.js";
import type { Trace } from "../../../../src/tracevals/trace/types.js";

const grader = graderFor("skill-invoked")!;

/** A session that edited docs, ran Edit, and never invoked the writing skill. */
function docsSession(overrides: Partial<Trace> = {}): Trace {
  return makeTrace({
    events: [
      { kind: "user", text: "Rewrite the getting started guide", index: 0, raw: {} },
      { kind: "tool_call", toolName: "Edit", index: 1, raw: {} },
    ],
    userMessages: ["Rewrite the getting started guide"],
    toolCalls: [{ name: "Edit", input: {}, index: 1, sidechain: false }],
    fileAccesses: [
      { path: "C:\\work\\demo-project\\docs\\get-started.md", op: "edit", index: 1 },
    ],
    turnCount: 1,
    ...overrides,
  });
}

function grade(trace: Trace, options: Record<string, unknown>) {
  return grader.grade({
    trace,
    plan: makeRulesPlan({ grader: "skill-invoked", options }),
  });
}

describe("skill-invoked `when` triggers (ADR 01016)", () => {
  const options = {
    skill: "writing-toolkit:technical-writer",
    expect: "used",
    when: { "file-access": "docs/**" },
  };

  it("skips when the trigger is not matched — never passes", async () => {
    // The failure mode that would silently gut the feature: a check that never
    // armed has not been satisfied.
    const trace = makeTrace({ turnCount: 1, userMessages: ["fix the build"] });
    const result = await grade(trace, options);
    expect(result.findings).toEqual([]);
    expect(result.skipped).toBeDefined();
    expect(result.skipped).toContain("trigger not met");
    expect(result.skipped).toContain("docs/**");
  });

  it("fails when the trigger is matched and the skill was never invoked", async () => {
    const result = await grade(docsSession(), options);
    expect(result.skipped).toBeUndefined();
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.message).toContain(
      "writing-toolkit:technical-writer",
    );
  });

  it("passes when the trigger is matched and the skill was invoked", async () => {
    const trace = docsSession({
      skillInvocations: [
        {
          name: "writing-toolkit:technical-writer",
          via: "skill-tool",
          index: 1,
        },
      ],
    });
    const result = await grade(trace, options);
    expect(result.skipped).toBeUndefined();
    expect(result.findings).toEqual([]);
  });

  it("leaves an unconditioned eval exactly as it was", async () => {
    const result = await grade(makeTrace({}), {
      skill: "ghost",
      expect: "used",
    });
    expect(result.skipped).toBeUndefined();
    expect(result.findings).toHaveLength(1);
  });

  it("arms on a tool the session used", async () => {
    const armed = await grade(docsSession(), {
      skill: "ghost",
      when: { "tool-used": "Edit" },
    });
    expect(armed.findings).toHaveLength(1);
    const unarmed = await grade(docsSession(), {
      skill: "ghost",
      when: { "tool-used": "WebFetch" },
    });
    expect(unarmed.skipped).toContain("trigger not met");
  });

  it("arms on a prompt matching a regex", async () => {
    const armed = await grade(docsSession(), {
      skill: "ghost",
      when: { "prompt-matches": "getting started" },
    });
    expect(armed.findings).toHaveLength(1);
    const unarmed = await grade(docsSession(), {
      skill: "ghost",
      when: { "prompt-matches": "deploy to production" },
    });
    expect(unarmed.skipped).toContain("trigger not met");
  });

  it("arms above a turn-count floor", async () => {
    const unarmed = await grade(docsSession(), {
      skill: "ghost",
      when: { "turn-count-above": 5 },
    });
    expect(unarmed.skipped).toContain("trigger not met");
    const armed = await grade(docsSession(), {
      skill: "ghost",
      when: { "turn-count-above": 0 },
    });
    expect(armed.findings).toHaveLength(1);
  });

  it("requires every listed condition to hold", async () => {
    const result = await grade(docsSession(), {
      skill: "ghost",
      when: { "file-access": "docs/**", "tool-used": "WebFetch" },
    });
    expect(result.skipped).toContain("trigger not met");
    expect(result.skipped).toContain("WebFetch");
  });

  it("reports the empty-window reason ahead of the trigger", async () => {
    // No evidence at all outranks "the trigger did not fire".
    const result = await grader.grade({
      trace: docsSession(),
      plan: makeRulesPlan({
        grader: "skill-invoked",
        artifact: {
          name: "never-invoked",
          type: "skill",
          path: "C:\\work\\demo-project\\.claude\\skills\\never-invoked\\SKILL.md",
          content: "# never",
          origin: "project",
        },
        options,
      }),
    });
    expect(result.skipped).toContain("governed no turns");
  });

  it("honours `expect: not-used` under a matched trigger", async () => {
    const trace = docsSession({
      skillInvocations: [{ name: "risky", via: "skill-tool", index: 1 }],
    });
    const result = await grade(trace, {
      skill: "risky",
      expect: "not-used",
      when: { "file-access": "docs/**" },
    });
    expect(result.findings).toHaveLength(1);
  });
});

describe("skill-invoked `when` validation (ADR 01004)", () => {
  const invalid = (options: Record<string, unknown>): string | undefined =>
    grader.validateOptions?.({ skill: "x", ...options });

  it("rejects a `when` that is not an object", () => {
    expect(invalid({ when: "docs/**" })).toContain("options.when");
    expect(invalid({ when: ["docs/**"] })).toContain("options.when");
    expect(invalid({ when: null })).toContain("options.when");
  });

  it("rejects a `when` with no conditions, which would arm always", () => {
    expect(invalid({ when: {} })).toContain("at least one");
  });

  it("rejects an unknown condition rather than ignoring it", () => {
    // A silently-ignored typo is a trigger that always fires, which is exactly
    // the failure this grader is meant to make impossible.
    const message = invalid({ when: { "file-acess": "docs/**" } });
    expect(message).toContain("file-acess");
    expect(message).toContain("file-access");
  });

  it("rejects a malformed condition value", () => {
    expect(invalid({ when: { "file-access": 3 } })).toContain("must be a string");
    expect(invalid({ when: { "turn-count-above": "many" } })).toContain(
      "whole number",
    );
    expect(invalid({ when: { "turn-count-above": -1 } })).toContain("at least 0");
    expect(invalid({ when: { "prompt-matches": "a(" } })).toContain(
      "valid regular expression",
    );
  });

  it("accepts a well-formed condition set", () => {
    expect(
      invalid({
        when: {
          "file-access": "docs/**",
          "tool-used": "Edit",
          "prompt-matches": "docs?",
          "turn-count-above": 2,
        },
      }),
    ).toBeUndefined();
  });

  it("errors the eval rather than grading it when `when` is malformed", async () => {
    const result = await grade(docsSession(), {
      skill: "ghost",
      when: { nope: true },
    });
    expect(result.error).toContain("skill-invoked");
  });
});

describe("globToRegExp", () => {
  const hit = (glob: string, path: string): boolean =>
    globToRegExp(glob).test(path.replace(/\\/g, "/").toLowerCase());

  it("matches a directory tree, including the directory itself", () => {
    expect(hit("docs/**", "C:/work/demo/docs/get-started.md")).toBe(true);
    expect(hit("docs/**", "C:/work/demo/docs/a/b/c.md")).toBe(true);
    expect(hit("docs/**", "C:/work/demo/docs")).toBe(true);
    expect(hit("docs/**", "C:/work/demo/src/app.ts")).toBe(false);
    // Not a prefix match on the segment name.
    expect(hit("docs/**", "C:/work/demo/docsite/index.md")).toBe(false);
  });

  it("keeps a single star inside one path segment", () => {
    expect(hit("*.ts", "C:/work/demo/src/app.ts")).toBe(true);
    expect(hit("src/*.ts", "C:/work/demo/src/app.ts")).toBe(true);
    expect(hit("src/*.ts", "C:/work/demo/src/deep/app.ts")).toBe(false);
  });

  it("spans segments through an interior double star", () => {
    expect(hit("docs/**/*.mdx", "C:/w/docs/reference/graders.mdx")).toBe(true);
    expect(hit("docs/**/*.mdx", "C:/w/docs/index.mdx")).toBe(true);
  });

  it("matches a literal path at a segment boundary", () => {
    expect(hit("src/app.ts", "C:/work/demo/src/app.ts")).toBe(true);
    expect(hit("src/app.ts", "C:/work/demo/other-src/app.ts")).toBe(false);
  });

  it("treats regex metacharacters in a glob as literals", () => {
    expect(hit("a+b.md", "C:/w/a+b.md")).toBe(true);
    expect(hit("a+b.md", "C:/w/aab.md")).toBe(false);
  });

  it("matches one character per question mark", () => {
    expect(hit("app.?s", "C:/w/app.ts")).toBe(true);
    expect(hit("app.?s", "C:/w/app.mjs")).toBe(false);
  });
});
