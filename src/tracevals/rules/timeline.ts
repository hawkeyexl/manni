/**
 * "# Earlier in this session", read from the transcript (proposal 0080,
 * "Earlier in this session, from the transcript"). Every turn before the
 * judged one that did something gets a line, newest last, so a rule about a
 * procedure that spans turns is judged with the whole session behind it. The
 * ledger only says which of those turns had no rule in scope.
 */
import { makeRedactor } from "../judge/redact.js";
import { materialize } from "../graders/util.js";
import type { Trace } from "../trace/types.js";
import { clipTo, projectPath, turnFacts, type Ledger } from "./ledger.js";
import type { RuleSource } from "./sources.js";
import { isTypedPrompt } from "./turn.js";

const HEAD = "# Earlier in this session\n\n";
const RESULT_CHARS = 120;
const TICK_CHARS = 60;
const SPAWNS = 10;
/** A task line in Spec Kit, Kiro and OpenSpec task lists. */
const TASK = /^\s*-\s+\[([ xX])\]\s+(.+?)\s*$/;
/** A task's leading id: `T014`, `FR-001`, `1.2`. */
const TASK_ID = /^(?:[A-Z]+(?:-[A-Z]+)*-?\d+(?:\.\d+)*|\d+(?:\.\d+)*)(?=[\s:.)\]]|$)/;

export interface TimelineOptions {
  cwd: string;
  root: string;
  redact: readonly string[];
  /** The rule sources a `read` fact names; others' reads are left out. */
  sources: Pick<RuleSource, "path" | "displayPath">[];
  /** Marks a turn it recorded with no rules in scope. */
  ledger?: Ledger;
  maxChars?: number;
}

interface ToolResult {
  text: string;
  isError: boolean;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Every tool_result block in the trace, by the id of the call it answers. */
function toolResults(trace: Trace): Map<string, ToolResult> {
  const out = new Map<string, ToolResult>();
  for (const e of trace.events) {
    if (e.kind !== "tool_result") continue;
    const message = e.raw.message;
    const content: unknown = isRecord(message) ? message.content : undefined;
    if (!Array.isArray(content)) continue;
    for (const block of content as unknown[]) {
      if (!isRecord(block) || block.type !== "tool_result" || typeof block.tool_use_id !== "string") continue;
      const body: unknown = block.content;
      const text =
        typeof body === "string"
          ? body
          : Array.isArray(body)
            ? (body as unknown[])
                .flatMap((b) => (isRecord(b) && typeof b.text === "string" ? [b.text] : []))
                .join("\n")
            : "";
      out.set(block.tool_use_id, { text, isError: block.is_error === true });
    }
  }
  return out;
}

/** The `tool_use` id of the call at `index`, read from its event. */
function callId(trace: Trace, index: number): string | undefined {
  // Find by ordinal: the event array need not hold one event per ordinal.
  const id = trace.events.find((e) => e.index === index)?.raw.id;
  return typeof id === "string" ? id : undefined;
}

/** Texts of the task lines in `text` whose box is ticked (`x`) or not (` `). */
function tasks(text: string, ticked: boolean): string[] {
  return text.split(/\r?\n/).flatMap((line) => {
    const m = TASK.exec(line);
    const box = m?.[1];
    const body = m?.[2];
    if (box === undefined || body === undefined) return [];
    return (box !== " ") === ticked ? [body] : [];
  });
}

/** The tasks an edit ticks: unticked in its old string, ticked with the same text in its new. */
function ticks(oldText: unknown, newText: unknown): string[] {
  if (typeof oldText !== "string" || typeof newText !== "string") return [];
  const now = new Set(tasks(newText, true));
  return tasks(oldText, false).filter((t) => now.has(t));
}

const list = (verb: string, items: string[]): string[] =>
  items.length > 0 ? [`${verb} ${items.join(", ")}`] : [];

/**
 * The block for the turns before `before`, or "" when none did anything.
 * Over `maxChars`, the oldest lines go first, and a marker line says which.
 */
export function timelineBlock(trace: Trace, before: number, opts: TimelineOptions): string {
  const scrub = makeRedactor(opts.redact);
  const results = toolResults(trace);
  const starts = trace.events
    .filter((e) => e.index < before && e.sidechain !== true && isTypedPrompt(e))
    .map((e) => e.index);

  const lines = starts.flatMap((from, i) => {
    const end = starts[i + 1] ?? before;
    const window = materialize(trace, "turn", "earlier turn", [{ start: from, end }], undefined, new Set([undefined]));
    // turnFacts reads only the window and bounds; 0 just satisfies TurnSlice.
    const facts = turnFacts(trace, { window, from, to: end - 1, sessionTurnCount: 0 }, opts.sources, opts);
    const spawns = trace.agentSpawns
      .filter((a) => a.index >= from && a.index < end)
      .slice(0, SPAWNS)
      .map((a) => {
        const result = results.get(a.toolUseId ?? callId(trace, a.index) ?? "");
        // Redact, then clip, so a cap never lands mid-secret.
        const first = scrub(result?.text ?? "").trim().split(/\r?\n/)[0]?.trim() ?? "";
        return first === ""
          ? `spawned ${a.subagentType}`
          : `spawned ${a.subagentType}, which returned ${clipTo(first, RESULT_CHARS)}`;
      });
    const calls = window.toolCalls;
    const asked = calls.some((c) => c.name === "AskUserQuestion") ? ["asked the user"] : [];
    const ticked = calls.flatMap((c) => {
      if (typeof c.input.file_path !== "string") return [];
      const edits: unknown[] =
        c.name === "Edit" ? [c.input] : c.name === "MultiEdit" && Array.isArray(c.input.edits) ? c.input.edits : [];
      const path = scrub(projectPath(c.input.file_path, opts.cwd, opts.root));
      return edits.flatMap((e) =>
        isRecord(e)
          ? ticks(e.old_string, e.new_string).map((t) => {
              const safe = scrub(t);
              return `ticked ${TASK_ID.exec(safe)?.[0] ?? clipTo(safe, TICK_CHARS)} in ${path}`;
            })
          : [],
      );
    });
    const approved = calls.some((c) => {
      if (c.name !== "ExitPlanMode") return false;
      const result = results.get(callId(trace, c.index) ?? "");
      return result !== undefined && !result.isError;
    })
      ? ["had a plan approved"]
      : [];
    const parts = [
      ...list("ran", facts.commands),
      ...list("wrote", facts.wrote),
      ...list("read", facts.read),
      ...facts.skills.map((s) => `ran skill ${s}`),
      ...spawns,
      ...asked,
      ...[...new Set(ticked)],
      ...approved,
    ];
    if (parts.length === 0) return [];
    const out = opts.ledger?.turns.find((t) => t.turn === from)?.inScope === false;
    return [{ turn: from, line: `- turn ${String(from)}: ${parts.join("; ")}${out ? " (no rules in scope)" : ""}` }];
  });

  // Drop the oldest until the block fits, the marker's length included.
  const max = opts.maxChars ?? Number.POSITIVE_INFINITY;
  const marker = (n: number): string => {
    const a = String(lines[0]?.turn);
    const b = String(lines[n - 1]?.turn);
    return n === 1 ? `- (turn ${a}: 1 line left out)` : `- (turns ${a}–${b}: ${String(n)} lines left out)`;
  };
  let kept = lines.reduce((sum, l) => sum + l.line.length + 1, HEAD.length - 1);
  let dropped = 0;
  const size = (): number => kept + (dropped > 0 ? marker(dropped).length + 1 : 0);
  while (dropped < lines.length && size() > max) {
    kept -= (lines[dropped]?.line.length ?? 0) + 1;
    dropped += 1;
  }
  if (dropped === lines.length) return "";
  const shown = lines.slice(dropped).map((l) => l.line);
  return `${HEAD}${[...(dropped > 0 ? [marker(dropped)] : []), ...shown].join("\n")}`;
}
