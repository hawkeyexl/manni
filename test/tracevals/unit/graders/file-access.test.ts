import { describe, expect, it } from "vitest";
import { graderFor } from "../../../../src/tracevals/graders/registry.js";
import { makeArtifact, makePlan, makeTrace } from "../../helpers.js";

const grader = graderFor("file-access")!;

const trace = makeTrace({
  // The default plan's artifact is the skill `demo-skill`; invoking it first
  // opens a window over the whole list.
  skillInvocations: [{ name: "demo-skill", via: "skill-tool", index: 0 }],
  fileAccesses: [
    { path: "C:\\work\\demo-project\\src\\app.ts", op: "read", index: 0 },
    { path: "C:\\work\\demo-project\\src\\app.ts", op: "edit", index: 1 },
    { path: "C:\\work\\demo-project\\notes.md", op: "write", index: 2 },
  ],
});

describe("file-access grader", () => {
  it("matches by path suffix regardless of separators", async () => {
    const result = await grader.grade({
      trace,
      plan: makePlan({
        grader: "file-access",
        options: { path: "src/app.ts", op: "read", expect: "accessed" },
      }),
    });
    expect(result.findings).toEqual([]);
  });

  it("distinguishes operations", async () => {
    const result = await grader.grade({
      trace,
      plan: makePlan({
        grader: "file-access",
        options: { path: "notes.md", op: "edit", expect: "accessed" },
      }),
    });
    expect(result.findings).toHaveLength(1);
  });

  it("any op matches when op is omitted", async () => {
    const result = await grader.grade({
      trace,
      plan: makePlan({
        grader: "file-access",
        options: { path: "notes.md", expect: "accessed" },
      }),
    });
    expect(result.findings).toEqual([]);
  });

  it("fails on forbidden access", async () => {
    const result = await grader.grade({
      trace,
      plan: makePlan({
        grader: "file-access",
        options: { path: "app.ts", op: "edit", expect: "not-accessed" },
      }),
    });
    expect(result.findings).toHaveLength(1);
  });
  it("counts only accesses inside the artifact's window", async () => {
    const windowed = makeTrace({
      skillInvocations: [{ name: "demo-skill", via: "skill-tool", index: 1 }],
      fileAccesses: [
        { path: "secrets.env", op: "read", index: 0 },
        { path: "src/app.ts", op: "edit", index: 2 },
      ],
    });
    const before = await grader.grade({
      trace: windowed,
      plan: makePlan({
        grader: "file-access",
        options: { path: "secrets.env", expect: "not-accessed" },
      }),
    });
    // Read before the skill was invoked, so it is not this skill's business.
    expect(before.findings).toEqual([]);

    const inside = await grader.grade({
      trace: windowed,
      plan: makePlan({
        grader: "file-access",
        options: { path: "src/app.ts", expect: "not-accessed" },
      }),
    });
    expect(inside.findings).toHaveLength(1);
  });

  it("anchors a literal path at a segment boundary", async () => {
    // A bare `endsWith` matched `legacydb/migrations` for the spec
    // `db/migrations`, which is a different directory — and `glob.ts`'s header
    // already claims both matchers follow the segment-anchored rule.
    const nearMiss = makeTrace({
      skillInvocations: [{ name: "demo-skill", via: "skill-tool", index: 0 }],
      fileAccesses: [
        {
          path: "C:\\work\\demo-project\\legacydb\\migrations\\001.sql",
          op: "read",
          index: 0,
        },
      ],
    });
    const result = await grader.grade({
      trace: nearMiss,
      plan: makePlan({
        grader: "file-access",
        options: { path: "db/migrations/001.sql", expect: "accessed" },
      }),
    });
    expect(result.findings, "matched a different directory").toHaveLength(1);

    // The anchored suffix the docs promise still matches.
    const real = makeTrace({
      skillInvocations: [{ name: "demo-skill", via: "skill-tool", index: 0 }],
      fileAccesses: [
        {
          path: "C:\\work\\demo-project\\db\\migrations\\001.sql",
          op: "read",
          index: 0,
        },
      ],
    });
    const hit = await grader.grade({
      trace: real,
      plan: makePlan({
        grader: "file-access",
        options: { path: "db/migrations/001.sql", expect: "accessed" },
      }),
    });
    expect(hit.findings).toEqual([]);
  });

  it("skips, never passes, when the window is empty", async () => {
    const result = await grader.grade({
      trace,
      plan: makePlan({
        artifact: makeArtifact({ name: "ghost-skill", type: "skill" }),
        grader: "file-access",
        options: { path: "notes.md", expect: "not-accessed" },
      }),
    });
    expect(result.skipped).toContain("never invoked");
    expect(result.findings).toEqual([]);
  });
});
