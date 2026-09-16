import { graderFor } from "../../src/tracevals/graders/registry.js";
import type { TraceGrader } from "../../src/tracevals/graders/types.js";
import type { Trace } from "../../src/tracevals/trace/types.js";
import type { EvalPlan } from "../../src/tracevals/core/plan.js";
import type { ResolvedArtifact } from "../../src/tracevals/artifacts/types.js";

export function makeTrace(overrides: Partial<Trace> = {}): Trace {
  return {
    source: "claude-code",
    file: "trace.jsonl",
    cwd: "C:\\work\\demo-project",
    events: [],
    toolCalls: [],
    skillInvocations: [],
    agentSpawns: [],
    subagentBranches: [],
    availability: {
      recorded: false,
      skills: [],
      agents: [],
      tools: [],
      mcpServers: [],
    },
    fileAccesses: [],
    userMessages: [],
    assistantTexts: [],
    turnCount: 0,
    warnings: [],
    ...overrides,
  };
}

export function makeArtifact(
  overrides: Partial<ResolvedArtifact> = {},
): ResolvedArtifact {
  return {
    name: "demo-skill",
    type: "skill",
    path: "C:\\work\\demo-project\\.claude\\skills\\demo-skill\\SKILL.md",
    content: "# Demo",
    origin: "project",
    ...overrides,
  };
}

export function makePlan(overrides: Partial<EvalPlan> = {}): EvalPlan {
  return {
    artifact: makeArtifact(),
    evalName: "demo-eval",
    assertion: "The session did the thing.",
    grader: "ai",
    severity: "error",
    implicit: false,
    ...overrides,
  };
}

/**
 * A plan whose artifact is project rules — the one artifact type that grades
 * the whole session (ADR 01015). Grader tests that are about grader logic
 * rather than windowing use this so the window is never the variable.
 */
export function makeRulesPlan(overrides: Partial<EvalPlan> = {}): EvalPlan {
  return makePlan({
    artifact: makeArtifact({
      name: "CLAUDE.md",
      type: "project-rules",
      path: "C:\work\demo-project\CLAUDE.md",
    }),
    ...overrides,
  });
}

/**
 * The value, or a failure that says the setup did not hold.
 *
 * The alternative is `!`, which turns a missing row or an unmatched line
 * into `Cannot read properties of undefined` several lines later. This
 * fails on the assumption itself, at the line that made it.
 */
export function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) {
    throw new Error(`test setup: ${what} was not there`);
  }
  return value;
}

/** A registered grader, by kind. Fails loudly when the kind is unknown. */
export function graderOf(kind: string): TraceGrader {
  return must(graderFor(kind), `a registered grader for "${kind}"`);
}

/** A grader's option validator. Fails loudly when the kind has none. */
export function validatorOf(
  kind: string,
): (options: Record<string, unknown>) => string | undefined {
  return must(graderOf(kind).validateOptions, `validateOptions on "${kind}"`);
}
