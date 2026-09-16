/** Shared helpers for deterministic graders. */
import type { EvalPlan } from "../core/plan.js";
import type {
  FileAccess,
  SkillInvocation,
  ToolCall,
  Trace,
  TraceEvent,
} from "../trace/types.js";
import type { Finding, GradeResult } from "./types.js";

export function finding(plan: EvalPlan, message: string): Finding {
  return {
    evalName: plan.evalName,
    artifact: plan.artifact.path,
    message,
    severity: plan.severity,
  };
}

export function fail(plan: EvalPlan, message: string): GradeResult {
  return { findings: [finding(plan, message)] };
}

export const pass: GradeResult = { findings: [] };

export function optionsError(kind: string, message: string): GradeResult {
  return { findings: [], error: `${kind}: ${message}` };
}

/** An option-validation outcome: a message when invalid, undefined when fine. */
export type OptionCheck = string | undefined;

export type Options = Record<string, unknown>;

/** First failing check, so callers read as a flat list of constraints. */
export function firstError(...checks: OptionCheck[]): OptionCheck {
  return checks.find((check) => check !== undefined);
}

export function requiredString(options: Options, key: string): OptionCheck {
  const value = options[key];
  if (typeof value !== "string" || value.length === 0) {
    return `options.${key} is required`;
  }
  return undefined;
}

export function optionalString(options: Options, key: string): OptionCheck {
  const value = options[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0) {
    return `options.${key} must be a non-empty string`;
  }
  return undefined;
}

export function optionalEnum(
  options: Options,
  key: string,
  allowed: readonly string[],
): OptionCheck {
  const value = options[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !allowed.includes(value)) {
    return `options.${key} must be one of: ${allowed.join(", ")}`;
  }
  return undefined;
}

export function optionalNumber(
  options: Options,
  key: string,
  bounds: { min?: number; integer?: boolean } = {},
): OptionCheck {
  const value = options[key];
  if (value === undefined) return undefined;
  // Number.isFinite also rejects NaN and both infinities.
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return `options.${key} must be a finite number`;
  }
  if (bounds.integer === true && !Number.isInteger(value)) {
    return `options.${key} must be a whole number`;
  }
  if (bounds.min !== undefined && value < bounds.min) {
    return `options.${key} must be at least ${bounds.min}`;
  }
  return undefined;
}

export function optionalBoolean(options: Options, key: string): OptionCheck {
  if (options[key] !== undefined && typeof options[key] !== "boolean") {
    return `options.${key} must be a boolean`;
  }
  return undefined;
}

/** Rejects min > max once both are present and already known to be numbers. */
export function orderedBounds(
  options: Options,
  minKey: string,
  maxKey: string,
): OptionCheck {
  const min = options[minKey];
  const max = options[maxKey];
  if (typeof min === "number" && typeof max === "number" && min > max) {
    return `options.${maxKey} must be greater than or equal to options.${minKey}`;
  }
  return undefined;
}

/**
 * Rejects a criterion that configures no bound at all. Such a criterion can
 * never fail, so it reads as coverage while asserting nothing.
 */
export function requireOneOf(options: Options, keys: string[]): OptionCheck {
  if (keys.some((key) => options[key] !== undefined)) return undefined;
  return `at least one of ${keys.map((k) => `options.${k}`).join(" or ")} is required`;
}

// ── Scoped grading ───────────────────────────────────────────────

/**
 * The slice of a trace an artifact was actually governing (ADR 01015). The
 * window is derived from the artifact's *type*, never declared: a skill governs
 * from its invocation until the next skill takes over, an agent governs its own
 * branch, and project rules govern the whole session.
 */
export interface TraceWindow {
  /** Which rule produced this window. */
  scope: "session" | "skill" | "agent" | "slash-command";
  /** Names the window in reasons and in the judge digest. */
  label: string;
  /**
   * True when the artifact governed no turn at all. Graders must report
   * `skipped` on an empty window — never a pass, which would be a verdict
   * about turns the artifact had no part in.
   */
  empty: boolean;
  /** Why the window is empty; set only when `empty`. */
  reason?: string;
  events: TraceEvent[];
  toolCalls: ToolCall[];
  fileAccesses: FileAccess[];
  skillInvocations: SkillInvocation[];
  /** Prompts on the window's own chain; nested subagent turns are excluded. */
  userMessages: string[];
  assistantTexts: string[];
  turnCount: number;
}

/** Half-open ordinal range over `trace.events`; `end` may be Infinity. */
interface Span {
  start: number;
  end: number;
}

export function windowFor(trace: Trace, plan: EvalPlan): TraceWindow {
  const { name, type } = plan.artifact;
  if (type === "skill") return skillWindow(trace, name);
  if (type === "agent") return agentWindow(trace, name);
  if (type === "slash-command") return slashCommandWindow(trace, name);
  // Project rules govern everything, so the window is the trace itself —
  // handed back by reference, so a session-scoped eval grades exactly what it
  // graded before scoping existed.
  return {
    scope: "session",
    label: "whole session",
    empty: false,
    events: trace.events,
    toolCalls: trace.toolCalls,
    fileAccesses: trace.fileAccesses,
    skillInvocations: trace.skillInvocations,
    userMessages: trace.userMessages,
    assistantTexts: trace.assistantTexts,
    turnCount: trace.turnCount,
  };
}

/** A grader's response to an empty window: a stated skip, never a verdict. */
export function skippedWindow(window: TraceWindow): GradeResult {
  return { findings: [], skipped: window.reason ?? "the artifact governed no turns" };
}

function skillWindow(trace: Trace, name: string): TraceWindow {
  // A skill loads either way: through the `Skill` tool, or by someone typing
  // its slash form.
  return injectionWindow(trace, "skill", `skill "${name}"`, (s) => s.name === name);
}

/**
 * A slash command's window is a skill's window, because the mechanism is the
 * same one: an instruction set injected at a point in the session, in force
 * until the next injection takes over (ADR 01023). Only the opening differs —
 * a `Skill` tool call is not the slash-command mechanism, so it can close a
 * command's window but never open it.
 */
function slashCommandWindow(trace: Trace, name: string): TraceWindow {
  return injectionWindow(
    trace,
    "slash-command",
    `slash command "/${name}"`,
    (s) => s.name === name && s.via === "command-injection",
  );
}

/**
 * The window an injected instruction set governed: from each of its own
 * injections until the next injection of any kind — including another of its
 * own, which simply reopens the window — or to the end of the session.
 */
function injectionWindow(
  trace: Trace,
  scope: "skill" | "slash-command",
  label: string,
  opensHere: (invocation: SkillInvocation) => boolean,
): TraceWindow {
  const opens = trace.skillInvocations.filter(opensHere).map((s) => s.index);
  if (opens.length === 0) {
    return emptyWindow(
      scope,
      label,
      `${label} was never invoked in this trace, so it governed no turns`,
    );
  }
  // An instruction set injected inside a subagent branch governs that branch's
  // chain; one injected on the main chain governs the main chain.
  const chainOf = (index: number): string | undefined =>
    trace.events[index]?.branchId;
  const own = new Set<string | undefined>(opens.map(chainOf));
  // **Boundaries are drawn from the opening chain only** (ADR 01015: the next
  // invocation *on the same chain*). Drawn from every invocation, a subagent
  // that loaded a skill of its own closed the parent's window at the spawn —
  // so a `not-used` eval passed on turns it never saw, and the judge digest
  // stopped where the subagent started.
  const boundaries = trace.skillInvocations
    .filter((s) => own.has(chainOf(s.index)))
    .map((s) => s.index)
    .sort((a, b) => a - b);
  const spans = opens.map((start) => ({
    start,
    end: boundaries.find((b) => b > start) ?? Number.POSITIVE_INFINITY,
  }));
  return materialize(trace, scope, label, spans, undefined, own);
}

function agentWindow(trace: Trace, name: string): TraceWindow {
  const label = `agent "${name}"`;
  const mine = trace.subagentBranches.filter((b) => b.agentType === name);
  if (mine.length === 0) {
    const spawned = trace.agentSpawns.some((a) => a.subagentType === name);
    return emptyWindow(
      "agent",
      label,
      spawned
        ? `${label} was spawned but recorded no subagent turns (no inline ` +
            `sidechain records and no sidecar transcript), so it governed no turns`
        : `${label} was never spawned in this trace, so it governed no turns`,
    );
  }
  // A branch's span already covers everything nested under it (ADR 01014), so
  // one containment pass reaches subagents at any depth.
  const branchIds = new Set(mine.map((b) => b.branchId));
  for (const branch of trace.subagentBranches) {
    if (branchIds.has(branch.branchId)) continue;
    const nested = mine.some(
      (m) => m.startIndex <= branch.startIndex && branch.endIndex <= m.endIndex,
    );
    if (nested) branchIds.add(branch.branchId);
  }
  const spans = mine.map((b) => ({ start: b.startIndex, end: b.endIndex }));
  return materialize(
    trace,
    "agent",
    label,
    spans,
    branchIds,
    new Set<string | undefined>(mine.map((b) => b.branchId)),
  );
}

function emptyWindow(
  scope: TraceWindow["scope"],
  label: string,
  reason: string,
): TraceWindow {
  return {
    scope,
    label,
    empty: true,
    reason,
    events: [],
    toolCalls: [],
    fileAccesses: [],
    skillInvocations: [],
    userMessages: [],
    assistantTexts: [],
    turnCount: 0,
  };
}

/**
 * Cut every derived list to the spans. `branchIds`, when given, additionally
 * drops events that fall inside an *inline* branch's bounding range without
 * belonging to it — a sidecar branch is contiguous and loses nothing here, but
 * an inline one can enclose interleaved main-chain turns (ADR 01014).
 *
 * `own` names the chain the window is anchored to. Prompts and assistant text
 * are taken from that chain alone, so a subagent spawned inside the window
 * contributes tool calls and file accesses but not turns.
 */
function materialize(
  trace: Trace,
  scope: TraceWindow["scope"],
  label: string,
  spans: Span[],
  branchIds: Set<string> | undefined,
  own: Set<string | undefined>,
): TraceWindow {
  const inSpan = (index: number): boolean =>
    spans.some((s) => index >= s.start && index < s.end);
  const excluded = new Set<number>();
  if (branchIds !== undefined) {
    for (const event of trace.events) {
      if (!inSpan(event.index)) continue;
      if (event.branchId === undefined || !branchIds.has(event.branchId)) {
        excluded.add(event.index);
      }
    }
  }
  const inWindow = (index: number): boolean =>
    inSpan(index) && !excluded.has(index);

  const events = trace.events.filter((e) => inWindow(e.index));
  const textOf = (kind: TraceEvent["kind"]): string[] =>
    events
      .filter((e) => e.kind === kind && own.has(e.branchId) && e.text)
      .map((e) => e.text as string);
  const userMessages = textOf("user");

  return {
    scope,
    label,
    empty: false,
    events,
    toolCalls: trace.toolCalls.filter((c) => inWindow(c.index)),
    fileAccesses: trace.fileAccesses.filter((a) => inWindow(a.index)),
    skillInvocations: trace.skillInvocations.filter((s) => inWindow(s.index)),
    userMessages,
    assistantTexts: textOf("assistant"),
    turnCount: userMessages.length,
  };
}
