import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  MockProvider,
  type InferenceProvider,
  type MockDecisions,
  type MockResponse,
} from "@hawkeyexl/inference";
import { parseTraceFile } from "../../../src/tracevals/trace/claude.js";
import { lastTurn } from "../../../src/tracevals/rules/turn.js";
import {
  TurnCache,
  applicableRules,
  judgeTurn,
  type TurnJudgeInput,
  type TurnRule,
} from "../../../src/tracevals/rules/judge.js";
import {
  TURN_CRITERIA,
  TURN_JUDGE_PROMPT_VERSION,
  TURN_JUDGE_SYSTEM_PROMPT,
  TURN_SCHEMA,
  buildDecisionState,
  buildTurnUser,
  questionFor,
} from "../../../src/tracevals/rules/judge-prompt.js";
import type { Trace } from "../../../src/tracevals/trace/types.js";

const TRACES = join(import.meta.dirname, "..", "fixtures", "rules", "traces");

const claude = { displayPath: "CLAUDE.md" };
const agents = { displayPath: "src/api/AGENTS.md" };
const CI = "0:run-npm-ci-first";
const PUSH = "0:no-force-push";

const RULES: TurnRule[] = [
  {
    source: claude,
    rule: { id: "run-npm-ci-first", text: "Run npm ci first when working in a worktree." },
  },
  { source: claude, rule: { id: "no-force-push", text: "Never force-push." } },
  {
    source: agents,
    rule: {
      id: "api-tests",
      text: "Run the API tests after editing a handler.",
      // The last turn of turns.jsonl touches no file, so this never applies.
      when: { "file-access": "src/api/**" },
    },
  },
];

let trace: Trace;
let dir: string;

beforeAll(async () => {
  trace = await parseTraceFile(join(TRACES, "turns.jsonl"));
  dir = await mkdtemp(join(tmpdir(), "turn-judge-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

function input(
  provider: InferenceProvider,
  overrides: Partial<TurnJudgeInput> = {},
): TurnJudgeInput {
  return {
    trace,
    turn: lastTurn(trace),
    rules: RULES,
    provider,
    runs: 3,
    temperature: 0,
    zones: { autoPass: 0.8, autoFail: 0.8 },
    render: { maxBlockChars: 2_000, maxTotalChars: 150_000, redact: [] },
    ...overrides,
  };
}

function decider(decisions: MockDecisions, stateLimit?: number): MockProvider {
  return new MockProvider([{ json: {} }], "decider", {
    decisions,
    ...(stateLimit !== undefined ? { stateLimit } : {}),
  });
}

/** The shared state of the first decide call; the judge always sends a string. */
function stateOf(provider: MockProvider): string {
  const state = provider.decideRequests[0]?.state;
  return typeof state === "string" ? state : "";
}

/** A provider with no `decide`, so the judge runs generatively. */
function generative(responses: MockResponse[]): {
  mock: MockProvider;
  provider: InferenceProvider;
} {
  const mock = new MockProvider(responses, "writer");
  return {
    mock,
    provider: {
      provider: () => mock.provider(),
      modelName: () => mock.modelName(),
      completeJSON: (req) => mock.completeJSON(req),
    },
  };
}

const answer = (
  violations: { rule: string; confidence: number }[],
  unclear: { rule: string; confidence: number }[] = [],
): MockResponse => ({
  json: {
    violations: violations.map((v) => ({ ...v, observed: `saw ${v.rule}` })),
    unclear: unclear.map((v) => ({ ...v, observed: `unsure ${v.rule}` })),
  },
});

describe("the turn judge prompt", () => {
  it("moves TURN_JUDGE_PROMPT_VERSION with the prompt surface", () => {
    const groups = [
      { displayPath: "CLAUDE.md", rules: [{ id: "a", text: "Do a." }] },
    ];
    const surface = [
      TURN_JUDGE_SYSTEM_PROMPT,
      buildTurnUser(groups, "TURN"),
      buildDecisionState(groups, "TURN"),
      JSON.stringify(questionFor("CLAUDE.md", { id: "a", text: "Do a." })),
      JSON.stringify(TURN_CRITERIA),
      JSON.stringify(TURN_SCHEMA),
    ].join("\n---\n");
    const digest = createHash("sha256").update(surface).digest("hex").slice(0, 12);
    expect({ version: TURN_JUDGE_PROMPT_VERSION, digest }).toEqual({
      version: 1,
      digest: "052e8c440300",
    });
  });

  it("states the shared precedence and when to answer unclear", () => {
    for (const text of [TURN_JUDGE_SYSTEM_PROMPT, buildDecisionState([], "")]) {
      expect(text).toMatch(/nearer file overrides a farther one/);
      expect(text).toMatch(/prompt the user typed in the turn overrides any file/);
      expect(text).toMatch(/never a violation/);
      expect(text).toMatch(/unclear/);
    }
  });

  it("offers exactly the four options", () => {
    expect(Object.keys(TURN_CRITERIA)).toEqual([
      "followed",
      "violated",
      "not_applicable",
      "unclear",
    ]);
  });
});

describe("applicableRules", () => {
  it("skips a rule whose when fails over the turn, and counts it", () => {
    const { applicable, notApplicable } = applicableRules(RULES, lastTurn(trace).window);
    expect(applicable.map((r) => r.rule.id)).toEqual(["run-npm-ci-first", "no-force-push"]);
    expect(notApplicable).toBe(1);
  });

  it("keeps a rule whose when holds", () => {
    const rules: TurnRule[] = [
      { source: claude, rule: { id: "ci", text: "Run npm ci.", when: { "command-matches": "npm test" } } },
    ];
    expect(applicableRules(rules, lastTurn(trace).window).applicable).toHaveLength(1);
  });
});

describe("judgeTurn in decision mode", () => {
  it("asks one question per applicable rule in a single decide call", async () => {
    const provider = decider({ [CI]: { violated: 0.91, followed: 0.09 }, [PUSH]: "followed" });
    const result = await judgeTurn(input(provider));
    expect(provider.decideRequests).toHaveLength(1);
    expect(provider.requests).toHaveLength(0);
    expect(result).toMatchObject({ mode: "decision", runs: 1, judged: 2, notApplicable: 1, cached: false });
    expect(result.findings).toEqual([
      {
        source: "CLAUDE.md",
        rule: "run-npm-ci-first",
        text: "Run npm ci first when working in a worktree.",
        outcome: "fail",
        observed: "violated with probability 0.91",
        confidence: 0.91,
      },
    ]);

    const req = provider.decideRequests[0];
    expect(Object.keys(req?.questions ?? {})).toEqual([CI, PUSH]);
    const q = req?.questions[CI];
    expect(Object.keys(q?.criteria ?? {})).toEqual(["followed", "violated", "not_applicable", "unclear"]);
    expect(q?.instructions).toContain("Run npm ci first when working in a worktree.");
    expect(q?.instructions).toContain("CLAUDE.md");
    const state = stateOf(provider);
    expect(state).toMatch(/nearer file overrides a farther one/);
    expect(state).toContain("[user] Now run the tests.");
    expect(state).not.toContain("Fix the handler.");
  });

  it("presents rules grouped by source, farthest first", async () => {
    const rules: TurnRule[] = [
      { source: claude, rule: { id: "a", text: "Do a." } },
      { source: agents, rule: { id: "b", text: "Do b." } },
      { source: claude, rule: { id: "c", text: "Do c." } },
    ];
    const provider = decider({});
    await judgeTurn(input(provider, { rules }));
    const state = stateOf(provider);
    const order = ["CLAUDE.md#a", "CLAUDE.md#c", "src/api/AGENTS.md#b"].map((k) => state.indexOf(k));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    expect(state.indexOf("## CLAUDE.md")).toBeLessThan(state.indexOf("## src/api/AGENTS.md"));
  });

  it("blocks at exactly the bar and not just below it", async () => {
    const at = await judgeTurn(input(decider({ [CI]: { violated: 0.8, followed: 0.2 } })));
    expect(at.findings[0]?.outcome).toBe("fail");
    const below = await judgeTurn(input(decider({ [CI]: { violated: 0.79, followed: 0.21 } })));
    expect(below.findings[0]?.outcome).toBe("needs-review");
  });

  it("sends unclear to review and counts not_applicable", async () => {
    const result = await judgeTurn(
      input(decider({ [CI]: { unclear: 0.95, violated: 0.05 }, [PUSH]: "not_applicable" })),
    );
    expect(result.findings).toEqual([
      expect.objectContaining({ rule: "run-npm-ci-first", outcome: "needs-review", confidence: 0.95 }),
    ]);
    expect(result.notApplicable).toBe(2);
  });

  it("makes no call when no rule applies", async () => {
    const provider = decider({});
    const result = await judgeTurn(input(provider, { rules: [RULES[2] as TurnRule] }));
    expect(provider.decideRequests).toHaveLength(0);
    expect(result).toMatchObject({ judged: 0, notApplicable: 1, findings: [] });
  });

  it("warns when the turn is cut to fit the state limit", async () => {
    const result = await judgeTurn(input(decider({}, 50)));
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/state limit of 50 tokens/);
  });

  it("does not warn when the turn fits", async () => {
    expect((await judgeTurn(input(decider({})))).warnings).toEqual([]);
  });

  it("appends the last assistant message the transcript lacks, redacted", async () => {
    const provider = decider({});
    await judgeTurn(
      input(provider, {
        lastAssistantMessage: "All 12 tests passed. token SECRET-abc",
        render: { maxBlockChars: 2_000, maxTotalChars: 150_000, redact: ["SECRET-\\w+"] },
      }),
    );
    const state = stateOf(provider);
    expect(state).toContain("[assistant] All 12 tests passed.");
    expect(state).not.toContain("SECRET-abc");

    const same = decider({});
    await judgeTurn(input(same, { lastAssistantMessage: "Tests pass." }));
    expect(stateOf(same).split("Tests pass.")).toHaveLength(2);
  });

  it("reuses a cached verdict, keyed on the rule set", async () => {
    const cache = new TurnCache(join(dir, "decision"));
    const first = await judgeTurn(
      input(decider({ [CI]: { violated: 0.9, followed: 0.1 } }), { cache }),
    );
    expect(first.cached).toBe(false);

    const again = decider({});
    const second = await judgeTurn(input(again, { cache }));
    expect(again.decideRequests).toHaveLength(0);
    expect(second.cached).toBe(true);
    expect(second.findings).toEqual(first.findings);

    const more = decider({});
    const rules = [...RULES, { source: claude, rule: { id: "extra", text: "Do extra." } }];
    const third = await judgeTurn(input(more, { cache, rules }));
    expect(more.decideRequests).toHaveLength(1);
    expect(third.cached).toBe(false);
  });
});

describe("judgeTurn in generative mode", () => {
  const CI_KEY = "CLAUDE.md#run-npm-ci-first";

  it("fails a rule only when every run says violated at the bar", async () => {
    const { mock, provider } = generative([answer([{ rule: CI_KEY, confidence: 0.9 }])]);
    const result = await judgeTurn(input(provider));
    expect(mock.requests).toHaveLength(3);
    expect(result).toMatchObject({ mode: "generative", runs: 3, judged: 2, notApplicable: 1 });
    expect(result.findings).toEqual([
      {
        source: "CLAUDE.md",
        rule: "run-npm-ci-first",
        text: "Run npm ci first when working in a worktree.",
        outcome: "fail",
        observed: `saw ${CI_KEY}`,
        confidence: 0.9,
      },
    ]);
    expect(mock.requests[0]?.system).toMatch(/nearer file overrides a farther one/);
    expect(mock.requests[0]?.user).toContain(CI_KEY);
  });

  it("sends a split ensemble to review", async () => {
    const { provider } = generative([
      answer([{ rule: CI_KEY, confidence: 0.9 }]),
      answer([]),
      answer([{ rule: CI_KEY, confidence: 0.9 }]),
    ]);
    const result = await judgeTurn(input(provider));
    expect(result.findings[0]?.outcome).toBe("needs-review");
  });

  it("sends a violation below the bar to review", async () => {
    const { provider } = generative([answer([{ rule: CI_KEY, confidence: 0.7 }])]);
    expect((await judgeTurn(input(provider))).findings[0]?.outcome).toBe("needs-review");
  });

  it("sends unclear to review", async () => {
    const { provider } = generative([answer([], [{ rule: CI_KEY, confidence: 0.6 }])]);
    const result = await judgeTurn(input(provider));
    expect(result.findings).toEqual([
      expect.objectContaining({ rule: "run-npm-ci-first", outcome: "needs-review", observed: `unsure ${CI_KEY}` }),
    ]);
  });

  it("never fails a rule when a run errored, and never caches it", async () => {
    const cache = new TurnCache(join(dir, "errored"));
    // Run 2 errors on its call and on the library's one retry.
    const responses = [
      answer([{ rule: CI_KEY, confidence: 0.95 }]),
      { error: "rate limited" },
      { error: "rate limited" },
    ];
    const first = await judgeTurn(input(generative(responses).provider, { cache }));
    expect(first.findings[0]?.outcome).toBe("needs-review");
    expect(first.warnings).toEqual([
      "1 of 3 judge runs errored, so no rule could fail: rate limited",
    ]);

    const again = generative(responses);
    const second = await judgeTurn(input(again.provider, { cache }));
    expect(second.cached).toBe(false);
    expect(again.mock.requests.length).toBeGreaterThan(0);
  });

  it("throws when every run errors", async () => {
    const { provider } = generative([{ error: "connection refused" }]);
    await expect(judgeTurn(input(provider))).rejects.toThrow(/connection refused/);
  });

  it("counts a response the schema rejects as an errored run", async () => {
    const { provider } = generative([{ json: { verdict: "fine" } }]);
    await expect(judgeTurn(input(provider))).rejects.toThrow();
  });

  it("reuses a clean cached ensemble", async () => {
    const cache = new TurnCache(join(dir, "generative"));
    const responses = [answer([{ rule: CI_KEY, confidence: 0.9 }])];
    await judgeTurn(input(generative(responses).provider, { cache }));
    const again = generative(responses);
    const second = await judgeTurn(input(again.provider, { cache }));
    expect(second.cached).toBe(true);
    expect(again.mock.requests).toHaveLength(0);
    expect(second.findings[0]?.outcome).toBe("fail");
  });
});
