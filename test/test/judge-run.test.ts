import { MockProvider, mockVerdict } from "@hawkeyexl/inference";
import { afterEach, describe, expect, it } from "vitest";
import { FOLLOWED_THE_DOCS, judgeRun } from "../../src/test/core/judge-run.js";
import type { TaskJourney, TaskPersona } from "../../src/test/core/task-types.js";
import { TestError } from "../../src/test/errors.js";
import type { EvalEntry } from "../../src/tracevals/evals/extract.js";
import { recordedPass, taskRun, stream, type TaskRun } from "./task-run.js";
import { join } from "node:path";

let run: TaskRun | undefined;
afterEach(() => {
  run?.cleanup();
  run = undefined;
});

const pass = mockVerdict("pass", 0.95, { reasoning: "The check ran and passed." });
/** A verdict for each of `evals` judged evals' three runs. */
const passes = (evals: number): MockProvider =>
  new MockProvider(Array.from({ length: evals * 3 }, () => pass));

const T1 = "docs/content-strategy/journeys/t1.md";

function journey(overrides: Partial<TaskJourney> = {}): TaskJourney {
  return {
    id: "t1",
    file: T1,
    title: "Fix a failing metadata check fast",
    titleLocation: { file: T1, line: 4 },
    personas: ["theo"],
    evals: [],
    ...overrides,
  };
}

const theo: TaskPersona = {
  id: "theo",
  file: "docs/content-strategy/personas/theo.md",
  title: "Theo",
  description: "A contributor fixing a failure.",
  proficiency: [],
  prerequisites: [],
  goals: [],
  pains: [],
  constraints: [
    { text: "Avoids reading the whole docs.", location: { file: "docs/content-strategy/personas/theo.md", line: 12 } },
  ],
};

function entry(overrides: Partial<EvalEntry> & Pick<EvalEntry, "id" | "grader">): EvalEntry {
  return { type: "regression", severity: "error", ...overrides };
}

describe("judgeRun: a --task run", () => {
  it("judges completed and followed-the-docs against the evidence, and derives nothing", async () => {
    run = recordedPass();
    const provider = passes(2);
    const judged = await judgeRun(run.evidence, { providers: {}, judgeProvider: provider });

    const start = { file: "docs/src/content/docs/meta/fix/index.mdx", line: 1 };
    expect(judged.docs).toEqual(["meta/fix/index.mdx"]);
    expect(judged.evals).toEqual([
      {
        id: "completed",
        grader: "ai",
        severity: "error",
        outcome: "pass",
        assertion: "The reader completed the task: Fix the failing docs check.",
        message: "The check ran and passed.",
        location: start,
        consensus: { votes: { pass: 3, fail: 0, partial: 0, error: 0 }, meanConfidence: expect.closeTo(0.95, 6) },
      },
      expect.objectContaining({
        id: "followed-the-docs",
        grader: "ai",
        severity: "warning",
        assertion: FOLLOWED_THE_DOCS,
        location: start,
      }),
    ]);
    for (const e of judged.evals) expect(e).not.toHaveProperty("derived");

    // Three ensemble runs per judged eval, and no call for a derivation.
    expect(provider.requests).toHaveLength(6);
    const user = provider.requests[0]?.user ?? "";
    expect(user).toContain('# Source project-rules ("task")\nFix the failing docs check.\nStart here: meta/fix/index.mdx');
    expect(user).toContain("# Session transcript\n## The trace\n");
    expect(user).toContain("## The workspace\n\nchanged: docs/install.md");
    expect(user).toContain("## The docs the reader had\n\n### meta/fix/index.mdx");
  });

  it("adds one constraint eval per persona constraint after followed-the-docs", async () => {
    run = recordedPass({ persona: theo });
    const judged = await judgeRun(run.evidence, { providers: {}, judgeProvider: passes(3) });
    expect(judged.evals.map((e) => [e.id, e.severity, e.assertion, e.location])).toEqual([
      ["completed", "error", "The reader completed the task: Fix the failing docs check.", expect.anything()],
      ["followed-the-docs", "warning", FOLLOWED_THE_DOCS, expect.anything()],
      ["constraint", "warning", "Avoids reading the whole docs.", theo.constraints[0]?.location],
    ]);
  });

  it("maps fail and split ensembles to fail and needs-review", async () => {
    run = recordedPass();
    const fail = mockVerdict("fail", 0.9, { reasoning: "No check ran after the edit." });
    const provider = new MockProvider([fail, fail, fail, pass, fail, pass]);
    const judged = await judgeRun(run.evidence, { providers: {}, judgeProvider: provider });
    expect(judged.evals.map((e) => [e.id, e.outcome])).toEqual([
      ["completed", "fail"],
      ["followed-the-docs", "needs-review"],
    ]);
    expect(judged.evals[0]?.message).toBe("No check ran after the edit.");
  });

  it("annotates the task nowhere for a URL start", async () => {
    run = taskRun({
      url: "https://docs.example.com/fix",
      trace: (long) => [stream.init(join(long, "workspace")), stream.say("Done.")],
    });
    const judged = await judgeRun(run.evidence, { providers: {}, judgeProvider: passes(2) });
    expect(judged.evals.map((e) => [e.id, e.location])).toEqual([
      ["completed", null],
      ["followed-the-docs", null],
    ]);
  });
});

describe("judgeRun: a journey", () => {
  it("grades completed at the title line of a journey with no success criteria or evals", async () => {
    run = recordedPass({ journey: journey(), task: "Fix a failing metadata check fast" });
    const provider = passes(2);
    const judged = await judgeRun(run.evidence, { providers: {}, judgeProvider: provider });
    expect(judged.evals.map((e) => [e.id, e.severity, e.location])).toEqual([
      ["completed", "error", { file: T1, line: 4 }],
      ["followed-the-docs", "warning", { file: T1, line: 4 }],
    ]);
    expect(judged.evals[0]?.assertion).toBe("The reader completed the task: Fix a failing metadata check fast");
    expect(provider.requests).toHaveLength(6);
  });

  it("grades no completed when the journey has success criteria", async () => {
    run = recordedPass({
      journey: journey({ successCriteria: { text: "The docs check passes.", location: { file: T1, line: 8 } } }),
    });
    const judged = await judgeRun(run.evidence, { providers: {}, judgeProvider: passes(2) });
    expect(judged.evals.map((e) => e.id)).toEqual(["success", "followed-the-docs"]);
  });

  it("grades no completed when the journey has golden evals", async () => {
    run = recordedPass({
      journey: journey({
        evals: [{ entry: entry({ id: "wrote-a-file", grader: "tool-usage", options: { tool: "Write" } }), location: { file: T1, line: 18 } }],
      }),
    });
    const judged = await judgeRun(run.evidence, { providers: {}, judgeProvider: passes(1) });
    expect(judged.evals.map((e) => e.id)).toEqual(["wrote-a-file", "followed-the-docs"]);
  });

  it("grades success, the golden evals, followed-the-docs and each constraint, in that order", async () => {
    const at = (line: number) => ({ file: T1, line });
    run = recordedPass({
      journey: journey({
        successCriteria: { text: "The docs check passes.", location: at(8) },
        evals: [
          {
            entry: entry({
              id: "has-description",
              grader: "command",
              assertion: "docs/install.md has a description.",
              command: [
                "node",
                "-e",
                "process.exit(require('fs').readFileSync('docs/install.md','utf8').includes('description:')?0:1)",
              ],
            }),
            location: at(12),
          },
          {
            entry: entry({ id: "wrote-a-file", grader: "tool-usage", options: { tool: "Write" }, severity: "warning" }),
            location: at(18),
          },
          {
            entry: entry({
              id: "reads-well",
              grader: "ai",
              assertion: "The description is a full sentence.",
              target: { source: "file", path: "docs/install.md" },
            }),
            location: at(21),
          },
          { entry: entry({ id: "later", grader: "regex", skip: true }), location: at(26) },
          { entry: entry({ id: "odd", grader: "no-such-grader" }), location: at(28) },
        ],
      }),
      persona: theo,
    });
    const provider = new MockProvider([pass]);
    const judged = await judgeRun(run.evidence, { providers: {}, judgeProvider: provider });

    expect(judged.evals.map((e) => [e.id, e.grader, e.severity, e.outcome, e.location])).toEqual([
      ["success", "ai", "error", "pass", at(8)],
      ["has-description", "command", "error", "pass", at(12)],
      ["wrote-a-file", "tool-usage", "warning", "fail", at(18)],
      ["reads-well", "ai", "error", "pass", at(21)],
      ["later", "regex", "error", "skipped", at(26)],
      ["odd", "no-such-grader", "error", "error", at(28)],
      ["followed-the-docs", "ai", "warning", "pass", at(4)],
      ["constraint", "ai", "warning", "pass", theo.constraints[0]?.location],
    ]);
    expect(judged.evals[0]?.assertion).toBe("The docs check passes.");
    expect(judged.evals[2]?.message).not.toContain("Redo the session work");
    expect(judged.evals[2]?.message).toMatch(/Write/);
    expect(judged.evals[7]?.assertion).toBe("Avoids reading the whole docs.");

    // Three ensemble runs for each of the four judged evals and nothing else,
    // and the file target read the workspace.
    expect(provider.requests).toHaveLength(12);
    expect(
      provider.requests.some((r) =>
        r.user.includes("# Graded content (file docs/install.md)\n---\ntitle: Install the widget\ndescription:"),
      ),
    ).toBe(true);
  });
});

describe("judgeRun: the provider", () => {
  it("selects the judge as tracevals does, and judges under --provider mock", async () => {
    run = recordedPass();
    const judged = await judgeRun(run.evidence, { providers: {}, provider: "mock" });
    expect(judged.evals.map((e) => [e.id, e.outcome])).toEqual([
      ["completed", "pass"],
      ["followed-the-docs", "pass"],
    ]);
  });

  it("reports a provider tracevals refuses as a TestError with its message", async () => {
    run = recordedPass();
    const error = await judgeRun(run.evidence, { providers: {}, provider: "nope" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TestError);
    expect((error as Error).message).toMatch(/nope/);
  });
});
