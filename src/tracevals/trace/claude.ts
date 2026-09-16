/**
 * Claude Code trace adapter. Parses both dialects behind one entry point:
 * session files (~/.claude/projects/<slug>/*.jsonl) and legacy `claude -p`
 * stream-json transcripts. Produces the normalized Trace model.
 */
import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { detectContentFormat } from "./detect.js";
import {
  applyAvailabilityRecord,
  foldBranchAvailability,
  newAvailability,
  newReplay,
  remapAvailability,
} from "./availability.js";
import type {
  AgentSpawn,
  FileAccess,
  SkillInvocation,
  SubagentBranch,
  ToolCall,
  Trace,
  TraceEvent,
} from "./types.js";

type Rec = Record<string, unknown>;

export async function parseTraceFile(filePath: string): Promise<Trace> {
  const absolute = resolve(filePath);
  const content = await readFile(absolute, "utf-8");
  const trace = parseTraceContent(content, absolute);
  await mergeSidecarBranches(trace, absolute);
  return trace;
}

export function parseTraceContent(content: string, filePath: string): Trace {
  const format = detectContentFormat(content);
  const { records, unparseable } = parseLines(content);
  const trace =
    format === "claude-session"
      ? parseSession(records, filePath)
      : parseStream(records, filePath);
  if (unparseable > 0) {
    trace.warnings.push(
      `${unparseable} unparseable JSONL line(s) were skipped`,
    );
  }
  return trace;
}

function parseLines(content: string): { records: Rec[]; unparseable: number } {
  const records: Rec[] = [];
  let unparseable = 0;
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const rec = JSON.parse(trimmed) as unknown;
      if (typeof rec === "object" && rec !== null) records.push(rec as Rec);
      else unparseable += 1;
    } catch {
      unparseable += 1;
    }
  }
  return { records, unparseable };
}

/** Record types that carry no conversation content. */
const SESSION_META_TYPES = new Set([
  "queue-operation",
  "attachment",
  "last-prompt",
  "custom-title",
  "summary",
  "mode",
  "pr-link",
]);

const COMMAND_NAME_RE = /<command-name>([^<]+)<\/command-name>/;
const COMMAND_ARGS_RE = /<command-args>([^<]*)<\/command-args>/;

/**
 * An `Agent` tool_use waiting for the sidechain records it spawned. `claimed`
 * disambiguates the case where one assistant turn spawns several subagents at
 * once and their records interleave.
 */
interface PendingBranch {
  toolUseId: string;
  prompt?: string;
  claimed: boolean;
}

/**
 * Subagent branch attribution. A sidechain record chains by `parentUuid` back
 * to the assistant record that carried the spawning `Agent` tool_use, so that
 * tool_use id is the branch identity. Records are written parent-first, which
 * is what lets one forward pass resolve the whole tree.
 */
interface BranchIndex {
  /** Agent spawns keyed by the uuid of the assistant record carrying them. */
  spawns: Map<string, PendingBranch[]>;
  /** Branch already resolved for a record, so its children inherit it. */
  resolved: Map<string, string>;
}

/** What a single on-disk record contributes to every event it produces. */
interface RecordContext {
  sidechain: boolean;
  timestamp?: string;
  branchId?: string;
  /** Session records only: lets `Agent` spawns be indexed by record uuid. */
  uuid?: string;
  branches?: BranchIndex;
}

function newTrace(filePath: string): Trace {
  return {
    source: "claude-code",
    file: filePath,
    cwd: "",
    events: [],
    toolCalls: [],
    skillInvocations: [],
    agentSpawns: [],
    subagentBranches: [],
    availability: newAvailability(),
    fileAccesses: [],
    userMessages: [],
    assistantTexts: [],
    turnCount: 0,
    warnings: [],
  };
}

/** Append an event, stamping its own ordinal, and hand that ordinal back. */
function pushEvent(trace: Trace, event: Omit<TraceEvent, "index">): number {
  const index = trace.events.length;
  trace.events.push({ ...event, index });
  return index;
}

/** A sidechain root's message is the Agent prompt verbatim — the tiebreak. */
function plainMessageText(rec: Rec): string | undefined {
  const content = (rec.message as Rec | undefined)?.content;
  return typeof content === "string" ? content : undefined;
}

function resolveBranch(
  branches: BranchIndex,
  parentUuid: unknown,
  rootText: string | undefined,
): string | undefined {
  if (typeof parentUuid !== "string") return undefined;
  const inherited = branches.resolved.get(parentUuid);
  if (inherited !== undefined) return inherited;
  const pending = branches.spawns.get(parentUuid);
  if (pending === undefined || pending.length === 0) return undefined;
  const byPrompt =
    rootText !== undefined
      ? pending.find((b) => !b.claimed && b.prompt === rootText)
      : undefined;
  const branch = byPrompt ?? pending.find((b) => !b.claimed) ?? pending[0];
  if (branch === undefined) return undefined;
  branch.claimed = true;
  return branch.toolUseId;
}

function parseSession(records: Rec[], filePath: string): Trace {
  const trace = newTrace(filePath);
  const branches: BranchIndex = { spawns: new Map(), resolved: new Map() };
  // Availability is replayed in record order: `isInitial` replaces the set,
  // a delta adds or removes, and each entry keeps the ordinal it changed at
  // (ADR 01016).
  const availability = newReplay();
  // Resolving a continuation pointer needs the whole file's uuids up front.
  const uuids = new Set<string>();
  for (const rec of records) {
    if (typeof rec.uuid === "string") uuids.add(rec.uuid);
  }
  // A leading `summary` record describes the *previous* session and its
  // `leafUuid` names a record there; a pointer that resolves in this file is
  // this session's own summary, not a continuation.
  const continuations: string[] = [];
  let sawMessage = false;
  let compactions = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let sawUsage = false;

  for (const rec of records) {
    const type = rec.type as string | undefined;
    const timestamp = rec.timestamp as string | undefined;
    if (timestamp) {
      trace.startedAt ??= timestamp;
      trace.endedAt = timestamp;
    }
    if (rec.sessionId) trace.sessionId ??= rec.sessionId as string;
    if (rec.subtype === "compact_boundary") compactions += 1;

    if (type !== undefined && SESSION_META_TYPES.has(type)) {
      if (
        type === "summary" &&
        !sawMessage &&
        typeof rec.leafUuid === "string" &&
        !uuids.has(rec.leafUuid)
      ) {
        continuations.push(rec.leafUuid);
      }
      const index = pushEvent(trace, { kind: "meta", timestamp, raw: rec });
      // An `attachment` record is bookkeeping to every other consumer, but the
      // listing ones are the only record of what the session was *offered*.
      if (
        type === "attachment" &&
        applyAvailabilityRecord(availability, rec.attachment, index)
      ) {
        availability.roster.recorded = true;
      }
      continue;
    }

    const sidechain = rec.isSidechain === true;
    // cwd/gitBranch follow the latest non-sidechain message record.
    if (!sidechain && typeof rec.cwd === "string") trace.cwd = rec.cwd;
    if (!sidechain && typeof rec.gitBranch === "string") {
      trace.gitBranch = rec.gitBranch;
    }

    const context: RecordContext = { sidechain, timestamp, branches };
    if (typeof rec.uuid === "string") context.uuid = rec.uuid;
    if (sidechain) {
      const branchId = resolveBranch(
        branches,
        rec.parentUuid,
        plainMessageText(rec),
      );
      if (branchId !== undefined) {
        context.branchId = branchId;
        if (context.uuid) branches.resolved.set(context.uuid, branchId);
      }
    }

    const message = rec.message as Rec | undefined;
    if (type === "user" && message) {
      sawMessage = true;
      handleUserMessage(trace, message, context, rec);
    } else if (type === "assistant" && message) {
      sawMessage = true;
      const usage = handleAssistantMessage(trace, message, context, rec);
      if (usage && !sidechain) {
        inputTokens += usage.input;
        outputTokens += usage.output;
        sawUsage = true;
      }
    } else {
      pushEvent(trace, { kind: "system", timestamp, raw: rec });
    }
  }

  if (sawUsage) trace.usage = { inputTokens, outputTokens };
  // Grading a fragment as if it were the whole session is a false verdict, so
  // both ways of losing earlier turns are reported rather than assumed away.
  for (const leaf of continuations) {
    trace.warnings.push(
      `this trace is a fragment of a longer session: it resumes an earlier ` +
        `one recorded elsewhere (summary leafUuid ${leaf} is not in this ` +
        `file), so evals see only the turns recorded here`,
    );
  }
  if (compactions > 0) {
    trace.warnings.push(
      `the conversation was compacted ${compactions} time(s): the agent ` +
        `stopped seeing the turns before each boundary, so early transcript ` +
        `content is not what it was working from`,
    );
  }
  trace.availability = availability.roster;
  trace.subagentBranches = buildBranches(trace);
  return trace;
}

/**
 * Derive the branch list from whatever branch identity the events already
 * carry. Runs for inline sidechains at parse time and again after sidecar
 * transcripts are spliced in, so both shapes produce the same descriptions.
 */
function buildBranches(
  trace: Trace,
  sidecars: Map<string, Partial<SubagentBranch>> = new Map(),
): SubagentBranch[] {
  const ranges = new Map<string, { min: number; max: number }>();
  for (const event of trace.events) {
    const id = event.branchId;
    if (id === undefined) continue;
    const range = ranges.get(id);
    if (range === undefined) ranges.set(id, { min: event.index, max: event.index });
    else range.max = Math.max(range.max, event.index);
  }
  if (ranges.size === 0) return [];

  const spawnFor = new Map<string, AgentSpawn>();
  for (const spawn of trace.agentSpawns) {
    if (spawn.toolUseId) spawnFor.set(spawn.toolUseId, spawn);
  }

  // A branch's parent is whichever branch owns its spawning `Agent` call.
  const parentOf = new Map<string, string | undefined>();
  for (const id of ranges.keys()) {
    const spawn = spawnFor.get(id);
    parentOf.set(
      id,
      spawn ? trace.events[spawn.index]?.branchId : undefined,
    );
  }
  const depthOf = (id: string): number => {
    let depth = 1;
    let cursor = parentOf.get(id);
    const seen = new Set<string>([id]);
    while (cursor !== undefined && !seen.has(cursor)) {
      seen.add(cursor);
      depth += 1;
      cursor = parentOf.get(cursor);
    }
    return depth;
  };

  const branches: SubagentBranch[] = [];
  for (const [id, range] of ranges) {
    const spawn = spawnFor.get(id);
    const sidecar = sidecars.get(id);
    const branch: SubagentBranch = {
      branchId: id,
      agentType: sidecar?.agentType ?? spawn?.subagentType ?? id,
      origin: sidecar ? "sidecar" : "inline",
      spawnDepth: sidecar?.spawnDepth ?? depthOf(id),
      spawnIndex: spawn?.index ?? range.min,
      startIndex: range.min,
      endIndex: range.max + 1,
    };
    const description = sidecar?.description ?? spawn?.description;
    if (description !== undefined) branch.description = description;
    if (sidecar?.agentId) branch.agentId = sidecar.agentId;
    if (sidecar?.parentAgentId) branch.parentAgentId = sidecar.parentAgentId;
    if (sidecar?.file) branch.file = sidecar.file;
    branches.push(branch);
  }

  // A branch's span covers the branches nested under it, so widen deepest
  // first and every ancestor inherits the reach of its whole subtree.
  branches.sort((a, b) => b.spawnDepth - a.spawnDepth);
  const byId = new Map(branches.map((b) => [b.branchId, b]));
  for (const branch of branches) {
    const parentId = parentOf.get(branch.branchId);
    const parent = parentId === undefined ? undefined : byId.get(parentId);
    if (parent === undefined) continue;
    parent.startIndex = Math.min(parent.startIndex, branch.startIndex);
    parent.endIndex = Math.max(parent.endIndex, branch.endIndex);
  }
  branches.sort((a, b) => a.startIndex - b.startIndex);
  return branches;
}

function handleUserMessage(
  trace: Trace,
  message: Rec,
  context: RecordContext,
  raw: Rec,
): void {
  const { sidechain, timestamp, branchId } = context;
  const content = message.content;
  if (typeof content === "string") {
    const index = pushEvent(trace, {
      kind: "user",
      timestamp,
      text: content,
      sidechain,
      branchId,
      raw,
    });
    if (sidechain) return;
    const command = COMMAND_NAME_RE.exec(content);
    if (command?.[1]) {
      const invocation: SkillInvocation = {
        name: command[1].replace(/^\//, ""),
        via: "command-injection",
        index,
      };
      const args = COMMAND_ARGS_RE.exec(content)?.[1]?.trim();
      if (args) invocation.args = args;
      trace.skillInvocations.push(invocation);
    }
    trace.userMessages.push(content);
    trace.turnCount += 1;
    return;
  }
  if (Array.isArray(content)) {
    // Tool results (and mixed blocks). Text blocks alongside tool results are
    // rare; only pure text turns count as prompts.
    let hasToolResult = false;
    const texts: string[] = [];
    for (const block of content as Rec[]) {
      if (block?.type === "tool_result") hasToolResult = true;
      if (block?.type === "text" && typeof block.text === "string") {
        texts.push(block.text);
      }
    }
    if (hasToolResult) {
      pushEvent(trace, {
        kind: "tool_result",
        timestamp,
        sidechain,
        branchId,
        raw,
      });
      return;
    }
    const text = texts.join("\n");
    pushEvent(trace, {
      kind: "user",
      timestamp,
      text,
      sidechain,
      branchId,
      raw,
    });
    if (!sidechain && text) {
      trace.userMessages.push(text);
      trace.turnCount += 1;
    }
  }
}

function handleAssistantMessage(
  trace: Trace,
  message: Rec,
  context: RecordContext,
  raw: Rec,
): { input: number; output: number } | undefined {
  const { sidechain, timestamp, branchId } = context;
  if (!sidechain && typeof message.model === "string") {
    trace.model ??= message.model;
  }
  const content = message.content;
  if (Array.isArray(content)) {
    for (const block of content as Rec[]) {
      if (block?.type === "text" && typeof block.text === "string") {
        pushEvent(trace, {
          kind: "assistant",
          timestamp,
          text: block.text,
          sidechain,
          branchId,
          raw,
        });
        if (!sidechain) trace.assistantTexts.push(block.text);
      } else if (block?.type === "tool_use") {
        extractToolUse(trace, block, context);
      }
    }
  }
  const usage = message.usage as Rec | undefined;
  if (usage) {
    return {
      input: typeof usage.input_tokens === "number" ? usage.input_tokens : 0,
      output: typeof usage.output_tokens === "number" ? usage.output_tokens : 0,
    };
  }
  return undefined;
}

function extractToolUse(
  trace: Trace,
  block: Rec,
  context: RecordContext,
): void {
  const { sidechain, timestamp, branchId } = context;
  const name = block.name as string;
  const input = (block.input as Rec) ?? {};
  const toolUseId = typeof block.id === "string" ? block.id : undefined;
  const index = pushEvent(trace, {
    kind: "tool_call",
    timestamp,
    toolName: name,
    sidechain,
    branchId,
    raw: block,
  });
  const call: ToolCall = { name, input, index, sidechain };
  if (timestamp) call.timestamp = timestamp;
  if (branchId) call.branchId = branchId;
  trace.toolCalls.push(call);

  switch (name) {
    case "Skill": {
      if (typeof input.skill === "string") {
        const invocation: SkillInvocation = {
          name: input.skill,
          via: "skill-tool",
          index,
        };
        if (toolUseId) invocation.toolUseId = toolUseId;
        if (typeof input.args === "string" && input.args) {
          invocation.args = input.args;
        }
        trace.skillInvocations.push(invocation);
      }
      break;
    }
    case "Agent": {
      if (typeof input.subagent_type === "string") {
        const spawn: AgentSpawn = {
          subagentType: input.subagent_type,
          index,
        };
        if (typeof input.description === "string") {
          spawn.description = input.description;
        }
        if (toolUseId) spawn.toolUseId = toolUseId;
        trace.agentSpawns.push(spawn);
      }
      // The spawn opens a branch its sidechain records chain back to.
      if (context.branches && context.uuid && toolUseId) {
        const pending = context.branches.spawns.get(context.uuid) ?? [];
        pending.push({
          toolUseId,
          prompt: typeof input.prompt === "string" ? input.prompt : undefined,
          claimed: false,
        });
        context.branches.spawns.set(context.uuid, pending);
      }
      break;
    }
    case "Read":
    case "Write":
    case "Edit": {
      if (typeof input.file_path === "string") {
        const op: FileAccess["op"] =
          name === "Read" ? "read" : name === "Write" ? "write" : "edit";
        trace.fileAccesses.push({ path: input.file_path, op, index });
      }
      break;
    }
  }
}

function parseStream(records: Rec[], filePath: string): Trace {
  const trace = newTrace(filePath);
  // stream-json has no sidechains, so every record shares one flat context.
  const context: RecordContext = { sidechain: false };
  let inputTokens = 0;
  let outputTokens = 0;
  let sawMessageUsage = false;

  for (const rec of records) {
    const type = rec.type as string | undefined;

    if (type === "system" && (rec.subtype === "init" || !rec.subtype)) {
      if (typeof rec.cwd === "string") trace.cwd = rec.cwd;
      if (typeof rec.model === "string") trace.model = rec.model;
      if (typeof rec.session_id === "string") trace.sessionId = rec.session_id;
      pushEvent(trace, { kind: "system", raw: rec });
      continue;
    }

    if (type === "assistant" || type === "user") {
      const message = (rec.message as Rec | undefined) ?? rec;
      if (type === "assistant") {
        const usage = handleAssistantMessage(trace, message, context, rec);
        if (usage) {
          inputTokens += usage.input;
          outputTokens += usage.output;
          sawMessageUsage = true;
        }
      } else {
        handleUserMessage(trace, message, context, rec);
      }
      continue;
    }

    if (type === "result") {
      trace.isError = rec.is_error === true;
      if (typeof rec.num_turns === "number") trace.turnCount = rec.num_turns;
      const usage = rec.usage as Rec | undefined;
      const totalCost =
        typeof rec.total_cost_usd === "number" ? rec.total_cost_usd : undefined;
      if (usage) {
        trace.usage = {
          inputTokens:
            typeof usage.input_tokens === "number" ? usage.input_tokens : 0,
          outputTokens:
            typeof usage.output_tokens === "number" ? usage.output_tokens : 0,
        };
        if (totalCost !== undefined) trace.usage.totalCostUsd = totalCost;
      } else if (sawMessageUsage) {
        trace.usage = { inputTokens, outputTokens };
        if (totalCost !== undefined) trace.usage.totalCostUsd = totalCost;
      }
      pushEvent(trace, { kind: "meta", raw: rec });
      continue;
    }

    pushEvent(trace, { kind: "meta", raw: rec });
  }

  if (!trace.usage && sawMessageUsage) {
    trace.usage = { inputTokens, outputTokens };
  }
  return trace;
}

/* ------------------------------------------------------------------------ *
 * Sidecar subagent transcripts (ADR 01014)
 *
 * Current Claude Code no longer writes subagent turns into the session file.
 * It writes each branch to `<session>/subagents/agent-<id>.jsonl` beside an
 * `agent-<id>.meta.json` naming the `Agent` tool_use that spawned it, so the
 * join is exact rather than heuristic. Every branch is spliced into
 * `trace.events` immediately after that spawning call, which keeps a branch
 * (and any branch nested inside it) contiguous and keeps `index` a gap-free
 * ordinal over the merged list.
 * ------------------------------------------------------------------------ */

/** `agent-<id>.meta.json`. Every member is optional in real stores. */
interface SidecarMeta {
  agentType?: string;
  description?: string;
  toolUseId?: string;
  parentAgentId?: string;
  spawnDepth?: number;
}

/** One transcript to splice: the base session file, or a loaded sidecar. */
interface MergeSource {
  id: string;
  events: TraceEvent[];
  toolCalls: ToolCall[];
  fileAccesses: FileAccess[];
  skillInvocations: SkillInvocation[];
  agentSpawns: AgentSpawn[];
}

interface LoadedSidecar {
  agentId: string;
  file: string;
  meta: SidecarMeta;
  sub: Trace;
  source: MergeSource;
}

const AGENT_META_RE = /^agent-(.+)\.meta\.json$/;
const AGENT_JSONL_RE = /^agent-(.+)\.jsonl$/;

/** `<dir>/<session>.jsonl` -> `<dir>/<session>/subagents`. */
function sidecarDirFor(traceFile: string): string {
  const stem = basename(traceFile).replace(/\.jsonl$/i, "");
  return join(dirname(traceFile), stem, "subagents");
}

function asSource(id: string, trace: Trace): MergeSource {
  return {
    id,
    events: trace.events,
    toolCalls: trace.toolCalls,
    fileAccesses: trace.fileAccesses,
    skillInvocations: trace.skillInvocations,
    agentSpawns: trace.agentSpawns,
  };
}

/**
 * Every record in one sidecar carries the same `agentId`, so the whole file is
 * one branch and that file-level fact overrides anything inferred inside it.
 * It has to: `isSidechain` is uniformly true within a sidecar, so the inline
 * `parentUuid` heuristic would hand this agent's own later turns to a nested
 * `Agent` call whose records actually live in a different file.
 */
function stampBranch(sub: Trace, branchId: string): void {
  for (const event of sub.events) {
    event.sidechain = true;
    event.branchId = branchId;
  }
  for (const call of sub.toolCalls) {
    call.sidechain = true;
    call.branchId = branchId;
  }
}

/**
 * Read every `agent-*.meta.json` beside a session file and parse its
 * transcript. A directory that is not there is the ordinary case and says
 * nothing; anything else that goes wrong becomes a warning (ADR 01003).
 */
async function loadSidecars(
  dir: string,
  trace: Trace,
): Promise<LoadedSidecar[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTDIR") {
      trace.warnings.push(
        `could not read the subagent transcript directory ${dir} ` +
          `(${code ?? "unknown error"}), so subagent turns are missing here`,
      );
    }
    return [];
  }

  const metas = new Set<string>();
  const transcripts = new Set<string>();
  for (const name of names) {
    const meta = AGENT_META_RE.exec(name);
    if (meta?.[1] !== undefined) {
      metas.add(meta[1]);
      continue;
    }
    const jsonl = AGENT_JSONL_RE.exec(name);
    if (jsonl?.[1] !== undefined) transcripts.add(jsonl[1]);
  }
  for (const orphan of [...transcripts].sort()) {
    if (!metas.has(orphan)) {
      trace.warnings.push(
        `subagent transcript agent-${orphan}.jsonl has no ` +
          `agent-${orphan}.meta.json, so it names no Agent spawn and was ` +
          `not merged`,
      );
    }
  }

  const loaded: LoadedSidecar[] = [];
  for (const agentId of [...metas].sort()) {
    let meta: SidecarMeta;
    try {
      const raw = await readFile(
        join(dir, `agent-${agentId}.meta.json`),
        "utf-8",
      );
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null) throw new Error("shape");
      meta = parsed;
    } catch {
      trace.warnings.push(
        `subagent metadata agent-${agentId}.meta.json is unreadable or not ` +
          `an object, so that branch was not merged`,
      );
      continue;
    }
    const file = join(dir, `agent-${agentId}.jsonl`);
    let sub: Trace;
    try {
      sub = parseTraceContent(await readFile(file, "utf-8"), file);
    } catch {
      trace.warnings.push(
        `subagent transcript agent-${agentId}.jsonl is missing or ` +
          `unreadable, so that branch was not merged`,
      );
      continue;
    }
    for (const warning of sub.warnings) {
      trace.warnings.push(`subagent ${meta.agentType ?? agentId}: ${warning}`);
    }
    loaded.push({ agentId, file, meta, sub, source: asSource(agentId, sub) });
  }
  return loaded;
}

async function mergeSidecarBranches(
  trace: Trace,
  traceFile: string,
): Promise<void> {
  const loaded = await loadSidecars(sidecarDirFor(traceFile), trace);
  if (loaded.length === 0) return;

  const base = asSource("", trace);
  const sources = new Map<string, MergeSource>([["", base]]);
  // Which transcript holds the `Agent` call a branch hangs off, and where in
  // that transcript. A depth-2 branch's spawn lives inside a depth-1 sidecar,
  // never in the session file, so ascending depth is what makes the join work.
  const spawnOwner = new Map<string, { sourceId: string; local: number }>();
  const registerSpawns = (source: MergeSource): void => {
    for (const spawn of source.agentSpawns) {
      if (spawn.toolUseId !== undefined) {
        spawnOwner.set(spawn.toolUseId, {
          sourceId: source.id,
          local: spawn.index,
        });
      }
    }
  };
  registerSpawns(base);

  // Ownership is resolved **iteratively**, not in one depth-sorted pass.
  //
  // The pass assumed `meta.spawnDepth` was always there, but `SidecarMeta`
  // documents every member as optional — and with the depths equal the order
  // fell to the agent-id tiebreak, so a depth-2 branch whose id happened to
  // sort first was visited before its parent had registered the `Agent` call
  // it hangs off, and was discarded with a warning. Renaming the same file
  // made it merge. Repeating until nothing new attaches reaches every branch
  // whose owner is reachable at all, whatever the metadata says.
  const children = new Map<string, LoadedSidecar[]>();
  const attached: Array<{ sidecar: LoadedSidecar; branchId: string }> = [];
  // Byte comparison, not `localeCompare`: sibling modules already sort this
  // way so the ubuntu and windows CI legs order reports identically.
  const pending = [...loaded].sort(
    (a, b) =>
      (a.meta.spawnDepth ?? 1) - (b.meta.spawnDepth ?? 1) ||
      (a.agentId < b.agentId ? -1 : a.agentId > b.agentId ? 1 : 0),
  );
  let progress = true;
  while (progress) {
    progress = false;
    for (let i = 0; i < pending.length; i += 1) {
      const sidecar = pending[i] as LoadedSidecar;
      const branchId = sidecar.meta.toolUseId;
      const owner = branchId === undefined ? undefined : spawnOwner.get(branchId);
      if (branchId === undefined || owner === undefined) continue;
      pending.splice(i, 1);
      i -= 1;
      progress = true;
      stampBranch(sidecar.sub, branchId);
      sources.set(sidecar.agentId, sidecar.source);
      const key = `${owner.sourceId}\u0000${owner.local}`;
      children.set(key, [...(children.get(key) ?? []), sidecar]);
      registerSpawns(sidecar.source);
      attached.push({ sidecar, branchId });
    }
  }
  // Whatever is left names an `Agent` call no reachable transcript makes.
  for (const sidecar of pending) {
    trace.warnings.push(
      `subagent transcript agent-${sidecar.agentId}.jsonl names Agent call ` +
        `${sidecar.meta.toolUseId ?? "(none recorded)"}, which is not in this ` +
        `trace, so that branch was not merged`,
    );
  }
  if (attached.length === 0) return;

  // Depth-first assembly: a transcript's own events in order, and after each
  // one the whole subtree of any branch that event spawned.
  const slots: Array<{ sourceId: string; local: number }> = [];
  const emit = (sourceId: string): void => {
    const source = sources.get(sourceId);
    if (source === undefined) return;
    for (let local = 0; local < source.events.length; local += 1) {
      slots.push({ sourceId, local });
      for (const kid of children.get(`${sourceId}\u0000${local}`) ?? []) {
        emit(kid.agentId);
      }
    }
  };
  emit("");

  const remap = new Map<string, number[]>();
  slots.forEach((slot, final) => {
    const row = remap.get(slot.sourceId) ?? [];
    row[slot.local] = final;
    remap.set(slot.sourceId, row);
  });
  const finalIndex = (sourceId: string, local: number): number =>
    remap.get(sourceId)?.[local] ?? local;

  trace.events = slots.map((slot, final) => {
    const event = sources.get(slot.sourceId)?.events[slot.local];
    return { ...(event as TraceEvent), index: final };
  });

  const gather = <T extends { index: number }>(
    pick: (source: MergeSource) => T[],
  ): T[] =>
    [...sources.values()]
      .flatMap((source) =>
        pick(source).map((item) => ({
          ...item,
          index: finalIndex(source.id, item.index),
        })),
      )
      .sort((a, b) => a.index - b.index);

  trace.toolCalls = gather((s) => s.toolCalls);
  trace.fileAccesses = gather((s) => s.fileAccesses);
  trace.skillInvocations = gather((s) => s.skillInvocations);
  trace.agentSpawns = gather((s) => s.agentSpawns);

  // The roster's ordinals are positions in `trace.events`, which the splice
  // just renumbered. Then each branch's own roster contributes whatever the
  // session never saw elsewhere, anchored at the spawn (ADR 01016).
  trace.availability = remapAvailability(trace.availability, (index) =>
    finalIndex("", index),
  );
  for (const { sidecar, branchId } of attached) {
    const owner = spawnOwner.get(branchId);
    foldBranchAvailability(
      trace.availability,
      sidecar.sub.availability,
      branchId,
      owner === undefined ? 0 : finalIndex(owner.sourceId, owner.local),
    );
  }

  const described = new Map<string, Partial<SubagentBranch>>();
  for (const { sidecar, branchId } of attached) {
    const info: Partial<SubagentBranch> = {
      agentId: sidecar.agentId,
      file: sidecar.file,
    };
    if (sidecar.meta.agentType) info.agentType = sidecar.meta.agentType;
    if (sidecar.meta.description) info.description = sidecar.meta.description;
    if (sidecar.meta.parentAgentId) {
      info.parentAgentId = sidecar.meta.parentAgentId;
    }
    if (typeof sidecar.meta.spawnDepth === "number") {
      info.spawnDepth = sidecar.meta.spawnDepth;
    }
    described.set(branchId, info);
  }
  trace.subagentBranches = buildBranches(trace, described);
}
