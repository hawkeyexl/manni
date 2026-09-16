/**
 * Render a trace into judge-readable text. Session files can be tens of MB,
 * so every block is capped and the whole digest is bounded by a head/tail
 * window — the opening (instructions, intent) and the ending (outcome) matter
 * most for adherence judging.
 *
 * Given an eval plan, only the turns that plan's artifact was governing are
 * rendered (ADR 01015). That is both the correct evidence to judge against and
 * a large cut in tokens: a skill's window is usually a fraction of a session.
 *
 * This is also the only place trace content is turned into text bound for a
 * third-party API, so it is where redaction happens (ADR 01020). Every block is
 * scrubbed *before* it is clipped, so truncation can never bisect a secret and
 * leave a usable prefix behind.
 */
import type { Trace, TraceEvent } from "../trace/types.js";
import type { EvalPlan } from "../core/plan.js";
import { windowFor } from "../graders/util.js";
import { makeRedactor } from "./redact.js";

export interface RenderOptions {
  /** Per-block character cap (messages, tool inputs). */
  maxBlockChars?: number;
  /** Whole-digest character cap; overflow keeps head and tail. */
  maxTotalChars?: number;
  /**
   * Extra redaction patterns, applied on top of the built-in shapes rather
   * than instead of them. Sources are compiled with the `g` flag.
   */
  redact?: string[];
}

const DEFAULTS: Required<RenderOptions> = {
  maxBlockChars: 2_000,
  maxTotalChars: 150_000,
  redact: [],
};

/**
 * The smallest timeline the head/tail window will ever leave.
 *
 * The cap used to be skipped outright when the header grew past it — the guard
 * was `budget > 0`, so a non-positive budget *disabled* truncation and shipped
 * the entire unclipped transcript to a third-party provider, precisely when the
 * user had asked for the tightest cap. A floor keeps truncation running; the
 * header is bounded separately so the whole digest still honours the cap.
 */
const MIN_TIMELINE_CHARS = 200;

const HEADER_TRUNCATED = "\n[... header truncated ...]";
const TIMELINE_SHELL = "\n\n## Timeline\n";

export function renderTrace(
  trace: Trace,
  options: RenderOptions = {},
  plan?: EvalPlan,
): string {
  const { maxBlockChars, maxTotalChars, redact } = { ...DEFAULTS, ...options };
  const scrub = makeRedactor(redact);
  // Redact, then truncate. The other order would let a cap land mid-secret and
  // ship the surviving prefix.
  const clip = (text: string, max: number): string => {
    const safe = scrub(text);
    if (safe.length <= max) return safe;
    return `${safe.slice(0, max)} [... truncated ${safe.length - max} chars ...]`;
  };
  const window = plan === undefined ? undefined : windowFor(trace, plan);
  // Project rules govern the whole session, so their digest is the session's —
  // byte-identical to an unscoped render, and cached as such.
  const scoped =
    window !== undefined && window.scope !== "session" ? window : undefined;
  const events: TraceEvent[] = scoped?.events ?? trace.events;

  // Scrubbed too: `cwd` and a branch name are author-supplied strings, and the
  // header is as much a thing that leaves the machine as the timeline is.
  const fullHeader = scrub(
    [
      "# Session",
      `source: ${trace.source}`,
      trace.model ? `model: ${trace.model}` : undefined,
      `cwd: ${trace.cwd}`,
      trace.gitBranch ? `branch: ${trace.gitBranch}` : undefined,
      scoped
        ? `scope: ${scoped.label} — ${events.length} of ${trace.events.length} session events`
        : undefined,
      // Everything below describes what the judge can actually see. On a
      // scoped render the timeline is the window, so a session-wide count here
      // reads as evidence that the rest was truncated away — the judge would
      // discount a digest that is complete for what it was asked about. The
      // session totals stay, in parentheses, because "3 of 87" is context the
      // window count alone does not carry.
      scoped
        ? `turns: ${scoped.turnCount} (of ${trace.turnCount} in the session)`
        : `turns: ${trace.turnCount}`,
      ((): string => {
        const used = (scoped ?? trace).skillInvocations.map((s) => s.name);
        return used.length > 0
          ? `skills used: ${used.join(", ")}`
          : "skills used: none";
      })(),
      ((): string | undefined => {
        // Spawns and branches inside the window only: an agent the parent
        // session started after this skill handed over is not this artifact's
        // to answer for.
        const inWindow = new Set(events.map((e) => e.index));
        const spawns = trace.agentSpawns.filter(
          (a) => !scoped || inWindow.has(a.index),
        );
        return spawns.length > 0
          ? `agents spawned: ${spawns.map((a) => a.subagentType).join(", ")}`
          : undefined;
      })(),
      ((): string | undefined => {
        const inWindow = new Set(events.map((e) => e.index));
        const branches = trace.subagentBranches.filter(
          (b) => !scoped || inWindow.has(b.spawnIndex),
        );
        return branches.length > 0
          ? `subagent transcripts: ${branches
              .map((b) => `${b.agentType} (depth ${b.spawnDepth})`)
              .join(", ")}`
          : undefined;
      })(),
    ]
      .filter((line): line is string => line !== undefined)
      .join("\n"),
  );

  // The header lists every skill name, agent type and branch, so on a busy
  // session it can outgrow a tight cap on its own. Bound it first, leaving the
  // timeline its floor, so `maxTotalChars` stays a cap on the whole digest
  // rather than on one half of it.
  const headerRoom = Math.max(
    maxTotalChars - TIMELINE_SHELL.length - MIN_TIMELINE_CHARS,
    0,
  );
  const header =
    fullHeader.length <= headerRoom
      ? fullHeader
      : fullHeader.slice(
          0,
          Math.max(headerRoom - HEADER_TRUNCATED.length, 0),
        ) + HEADER_TRUNCATED;

  // Two concurrent subagents are indistinguishable under a flat `:sidechain`
  // tag, so each branch becomes a labelled block named for the subagent that
  // ran it. The header can fall outside the head/tail window below, so every
  // line keeps a short tag of its own as well. Inline and sidecar branches
  // render through this one path; a sidecar branch is named by its meta file's
  // `agentType`, which is the recorder's own statement of what ran.
  const branchTypes = new Map<string, string>();
  for (const spawn of trace.agentSpawns) {
    if (spawn.toolUseId) branchTypes.set(spawn.toolUseId, spawn.subagentType);
  }
  for (const branch of trace.subagentBranches) {
    branchTypes.set(branch.branchId, branch.agentType);
  }
  const label = (branchId: string): string =>
    branchTypes.get(branchId) ?? branchId;
  const callAt = new Map(trace.toolCalls.map((call) => [call.index, call]));

  if (scoped?.empty === true) {
    return `${header}${TIMELINE_SHELL}[no turns: ${scrub(scoped.reason ?? "")}]`;
  }

  const lines: string[] = [];
  let branch: string | undefined;
  for (const event of events) {
    const tag = event.branchId
      ? `:${label(event.branchId)}`
      : event.sidechain
        ? ":sidechain"
        : "";
    let line: string | undefined;
    switch (event.kind) {
      case "user":
        if (event.text) line = `[user${tag}] ${clip(event.text, maxBlockChars)}`;
        break;
      case "assistant":
        if (event.text) {
          line = `[assistant${tag}] ${clip(event.text, maxBlockChars)}`;
        }
        break;
      case "tool_call": {
        const call = callAt.get(event.index);
        const input = call ? JSON.stringify(call.input) : "";
        line = `[tool${tag}] ${event.toolName ?? call?.name ?? "?"} ${clip(input, Math.min(maxBlockChars, 500))}`;
        break;
      }
      default:
        break;
    }
    if (line === undefined) continue;
    if (event.branchId !== branch) {
      if (branch !== undefined) lines.push(`[/subagent ${label(branch)}]`);
      branch = event.branchId;
      if (branch !== undefined) {
        lines.push(`[subagent ${label(branch)} (${branch})]`);
      }
    }
    lines.push(line);
  }
  if (branch !== undefined) lines.push(`[/subagent ${label(branch)}]`);

  // One more pass over the assembled timeline. Every message and tool input
  // already went through `clip`, so this pass is the belt to that pair of
  // braces: it covers what is assembled here rather than clipped — tool names,
  // branch labels — and anything a later change adds to this loop without
  // remembering to scrub it. Redaction is idempotent, so it costs nothing.
  let timeline = scrub(lines.join("\n"));
  // A floor, never a switch: `budget > 0` used to turn truncation *off* for a
  // non-positive budget, which is the one case where it matters most.
  const budget = Math.max(
    maxTotalChars - header.length - TIMELINE_SHELL.length,
    MIN_TIMELINE_CHARS,
  );
  if (timeline.length > budget) {
    // The marker counts against the budget, so the digest never exceeds what
    // the caller asked for. `omitted` is at most `timeline.length`, so the
    // width reserved for it is always enough.
    const marker = (omitted: number): string =>
      `\n[... truncated ${omitted} chars of transcript ...]\n`;
    const room = Math.max(budget - marker(timeline.length).length, 0);
    const headLen = Math.floor(room * 0.6);
    const tailLen = room - headLen;
    const omitted = timeline.length - headLen - tailLen;
    timeline = `${timeline.slice(0, headLen)}${marker(omitted)}${
      tailLen > 0 ? timeline.slice(-tailLen) : ""
    }`;
  }

  return `${header}${TIMELINE_SHELL}${timeline}`;
}
