/**
 * The turn a Stop or SubagentStop judges (proposal 0079). A turn starts at the
 * last prompt the user typed; tool results and hook feedback do not start one.
 * Under SubagentStop the turn is the subagent's whole run.
 *
 * Which user records are typed prompts is read from the record shape Claude
 * Code writes, not guessed from wording alone:
 *
 *  - `isMeta: true` marks harness injections: a skill's "Base directory" body,
 *    `<local-command-caveat>`, peer and scheduled messages, hook feedback.
 *  - `isCompactSummary: true` is the "session is being continued" summary.
 *  - `origin.kind` is `human` for a typed prompt and `task-notification` or
 *    `peer` otherwise. Older records carry only `turnOrigin`, whose non-typed
 *    values are `task_notification`, `scheduled` and `peer`.
 *  - A record whose text is nothing but `<system-reminder>`,
 *    `<task-notification>`, `<ci-monitor-event>` or `<local-command-*>` blocks
 *    is an injection. A typed prompt Claude Code prefixed with a reminder keeps
 *    the text after it, so it still counts.
 *  - `Stop hook feedback:` and `[Request interrupted by user…]` are markers,
 *    never prompts.
 *
 * A `<command-name>` record is a slash command someone typed, so it counts.
 */
import {
  emptyWindow,
  materialize,
  type TraceWindow,
} from "../graders/util.js";
import type { Trace, TraceEvent } from "../trace/types.js";

export interface TurnSlice {
  window: TraceWindow;
  /** Ordinal in `trace.events` of the turn's first event. */
  from: number;
  /** Ordinal of its last event, inclusive. Less than `from` when there is no turn. */
  to: number;
  /** Typed prompts in the whole session, which `turn-count-above` reads. */
  sessionTurnCount: number;
}

const INJECTED =
  /<(system-reminder|task-notification|ci-monitor-event|local-command-stdout|local-command-stderr|local-command-caveat)>[\s\S]*?<\/\1>/g;
const MARKER =
  /^(?:Stop hook feedback:|SubagentStop hook feedback:|\[Request interrupted by user)/;
const TYPED_TURN_ORIGINS = new Set(["human", "sdk"]);
const WORK = new Set<TraceEvent["kind"]>(["assistant", "tool_call", "tool_result"]);

export function isTypedPrompt(event: TraceEvent): boolean {
  if (event.kind !== "user" || event.text === undefined) return false;
  const { raw } = event;
  if (raw.isMeta === true || raw.isCompactSummary === true) return false;
  const origin = raw.origin;
  if (
    typeof origin === "object" &&
    origin !== null &&
    "kind" in origin &&
    typeof origin.kind === "string"
  ) {
    if (origin.kind !== "human") return false;
  } else if (
    typeof raw.turnOrigin === "string" &&
    !TYPED_TURN_ORIGINS.has(raw.turnOrigin)
  ) {
    return false;
  }
  const rest = event.text.replace(INJECTED, "").trim();
  return rest !== "" && !MARKER.test(rest);
}

/** The last turn of a session: its last typed prompt to the end of the trace. */
export function lastTurn(trace: Trace): TurnSlice {
  const prompts = trace.events.filter((e) => e.sidechain !== true && isTypedPrompt(e));
  const sessionTurnCount = prompts.length;
  const to = trace.events.length - 1;
  const last = prompts.at(-1);
  if (last === undefined) {
    return {
      window: emptyWindow("turn", "last turn", "the trace holds no prompt the user typed"),
      from: to + 1,
      to,
      sessionTurnCount,
    };
  }
  return slice(trace, last.index, [last], new Set([undefined]), sessionTurnCount, {
    label: "last turn",
    reason: "nothing happened after the last prompt the user typed",
  });
}

/**
 * A subagent's sidecar transcript parsed alone. Every record is a sidechain,
 * so the parser keeps no prompts; the turn is the whole run, and its prompts
 * are the task the subagent was given.
 */
export function subagentTurn(trace: Trace): TurnSlice {
  const prompts = trace.events.filter(isTypedPrompt);
  return slice(
    trace,
    0,
    prompts,
    new Set(trace.events.map((e) => e.branchId)),
    prompts.length,
    { label: "subagent run", reason: "the subagent recorded no work" },
  );
}

function slice(
  trace: Trace,
  from: number,
  prompts: TraceEvent[],
  own: Set<string | undefined>,
  sessionTurnCount: number,
  words: { label: string; reason: string },
): TurnSlice {
  const to = trace.events.length - 1;
  const worked = trace.events.some((e) => e.index > from && WORK.has(e.kind));
  if (!worked) {
    return {
      window: emptyWindow("turn", words.label, words.reason),
      from,
      to,
      sessionTurnCount,
    };
  }
  const window = materialize(
    trace,
    "turn",
    words.label,
    [{ start: from, end: Number.POSITIVE_INFINITY }],
    undefined,
    own,
  );
  // Only typed prompts are prompts here, and `turnCount` is the session's,
  // because the one condition that reads it counts session turns.
  window.userMessages = prompts.map((p) => p.text ?? "");
  window.turnCount = sessionTurnCount;
  return { window, from, to, sessionTurnCount };
}
