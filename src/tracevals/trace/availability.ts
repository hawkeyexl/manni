/**
 * The availability roster (ADR 01016): what a session was *offered*, whether or
 * not it used any of it.
 *
 * Claude Code records the roster in the transcript as structured `attachment`
 * records rather than as the prose the model reads, so it is recoverable
 * deterministically and **retroactively, on every session already on disk**:
 *
 * | `attachment.type` | Carries |
 * |---|---|
 * | `skill_listing` | `names`, `skillCount`, `isInitial`, and `content` — one `- name: description` line per skill |
 * | `agent_listing_delta` | `addedTypes`, `addedLines` (description plus tool grants), `removedTypes`, `isInitial` |
 * | `deferred_tools_delta` | `addedNames`, `removedNames`, `readdedNames`, and the MCP server state lists |
 *
 * Two properties of the real data drive the shape of this module, both
 * confirmed across the 606 `skill_listing` records in a 281-session store:
 *
 * 1. **`content` is the description source, `names` is the identity source.**
 *    A plugin skill is named `plugin:skill`, so splitting a listing line on its
 *    first colon truncates the name; every line is instead matched against the
 *    `names` array (longest match wins). On that corpus the rule leaves zero
 *    lines unjoined. Descriptions also wrap onto continuation lines, and the
 *    listing text is capped near 30,000 characters — past the cap Claude Code
 *    emits bare `- name` lines, so a description is genuinely optional.
 * 2. **Deltas are not idempotent.** `isInitial: true` replaces the set;
 *    `isInitial: false` adds (and, for agents and tools, removes). Replay is
 *    therefore ordered by record index, and per-index history is kept so a
 *    consumer can ask what was available when a window opened rather than only
 *    what was available at some point.
 */
import type {
  AvailabilityEntry,
  AvailabilityKind,
  McpServerStatus,
  TraceAvailability,
} from "./types.js";

export function newAvailability(): TraceAvailability {
  return { recorded: false, skills: [], agents: [], tools: [], mcpServers: [] };
}

/** Entries whose interval covers `index`. */
export function availableAt(
  entries: readonly AvailabilityEntry[],
  index: number,
): AvailabilityEntry[] {
  return entries.filter(
    (e) => e.offeredAt <= index && (e.withdrawnAt === undefined || index < e.withdrawnAt),
  );
}

/** Every distinct name that was offered at any point. */
export function offeredNames(entries: readonly AvailabilityEntry[]): Set<string> {
  return new Set(entries.map((e) => e.name));
}

/**
 * Join a listing's `content` lines onto its `names`.
 *
 * A line belongs to the longest name it starts with, so `plugin:skill` survives
 * intact; a line that starts no name is a continuation of the description above
 * it. Names with no line at all keep an absent description.
 */
export function joinDescriptions(
  content: string,
  names: readonly string[],
): Map<string, string | undefined> {
  const byName = new Map<string, string | undefined>(
    names.map((name) => [name, undefined]),
  );
  let current: string | undefined;
  for (const raw of content.split("\n")) {
    const line = raw.trimEnd();
    if (line.startsWith("- ")) {
      const body = line.slice(2);
      let best: string | undefined;
      for (const name of names) {
        if (body !== name && !body.startsWith(`${name}:`)) continue;
        if (best === undefined || name.length > best.length) best = name;
      }
      // A `- ` line that names nothing on the roster is not a skill entry, so
      // it must not become the target for the lines that follow it either.
      current = best;
      if (best === undefined) continue;
      const rest = body.slice(best.length).replace(/^:\s*/, "").trim();
      byName.set(best, rest.length > 0 ? rest : undefined);
      continue;
    }
    if (current === undefined) continue;
    const continued = line.trim();
    if (continued.length === 0) continue;
    const previous = byName.get(current);
    byName.set(current, previous ? `${previous}\n${continued}` : continued);
  }
  return byName;
}

/** `- name: description` in one string, as the agent-listing deltas ship it. */
function describedLines(
  names: readonly string[],
  lines: readonly string[],
): Map<string, string | undefined> {
  const byName = new Map<string, string | undefined>();
  names.forEach((name, i) => {
    const line = lines[i];
    if (typeof line !== "string") {
      byName.set(name, undefined);
      return;
    }
    const body = line.startsWith("- ") ? line.slice(2) : line;
    const rest = body.startsWith(`${name}:`)
      ? body.slice(name.length + 1).trim()
      : body === name
        ? ""
        : body.trim();
    byName.set(name, rest.length > 0 ? rest : undefined);
  });
  return byName;
}

const asStrings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

/** Mutable replay state: the open interval per name, per kind. */
export interface AvailabilityReplay {
  roster: TraceAvailability;
  open: Map<AvailabilityKind, Map<string, AvailabilityEntry>>;
}

export function newReplay(): AvailabilityReplay {
  return {
    roster: newAvailability(),
    open: new Map<AvailabilityKind, Map<string, AvailabilityEntry>>([
      ["skill", new Map()],
      ["agent", new Map()],
      ["tool", new Map()],
      ["mcp-server", new Map()],
    ]),
  };
}

function listFor(
  roster: TraceAvailability,
  kind: AvailabilityKind,
): AvailabilityEntry[] {
  if (kind === "skill") return roster.skills;
  if (kind === "agent") return roster.agents;
  if (kind === "tool") return roster.tools;
  return roster.mcpServers;
}

function offer(
  replay: AvailabilityReplay,
  kind: AvailabilityKind,
  name: string,
  index: number,
  description?: string,
  status?: McpServerStatus,
): void {
  const open = replay.open.get(kind) as Map<string, AvailabilityEntry>;
  const existing = open.get(name);
  if (existing !== undefined) {
    // Already offered: keep the one interval and let a later listing fill in a
    // description the earlier, truncated one omitted.
    if (existing.description === undefined && description !== undefined) {
      existing.description = description;
    }
    if (status !== undefined) existing.status = status;
    return;
  }
  const entry: AvailabilityEntry = { kind, name, offeredAt: index };
  if (description !== undefined) entry.description = description;
  if (status !== undefined) entry.status = status;
  open.set(name, entry);
  listFor(replay.roster, kind).push(entry);
}

function withdraw(
  replay: AvailabilityReplay,
  kind: AvailabilityKind,
  name: string,
  index: number,
): void {
  const open = replay.open.get(kind) as Map<string, AvailabilityEntry>;
  const entry = open.get(name);
  if (entry === undefined) return;
  entry.withdrawnAt = index;
  open.delete(name);
}

/** Names currently offered for a kind, in offer order. */
function openNames(replay: AvailabilityReplay, kind: AvailabilityKind): string[] {
  return [...(replay.open.get(kind) as Map<string, AvailabilityEntry>).keys()];
}

/**
 * Fold one `attachment` payload into the roster. Anything unrecognised, or
 * shaped unexpectedly, is ignored rather than thrown: a listing record is
 * bookkeeping, and losing one must never cost the run its trace (ADR 01003).
 *
 * Returns true when the record was a listing record — which is what makes
 * `recorded` mean "a roster was present", as opposed to "the roster was empty".
 */
export function applyAvailabilityRecord(
  replay: AvailabilityReplay,
  attachment: unknown,
  index: number,
): boolean {
  if (typeof attachment !== "object" || attachment === null) return false;
  const record = attachment as Record<string, unknown>;
  const type = record.type;

  if (type === "skill_listing") {
    const names = asStrings(record.names);
    const content = typeof record.content === "string" ? record.content : "";
    // A skill listing carries no removal member of its own: an initial listing
    // is the set, and a delta only adds.
    if (record.isInitial === true) {
      for (const name of openNames(replay, "skill")) {
        if (!names.includes(name)) withdraw(replay, "skill", name, index);
      }
    }
    const described = joinDescriptions(content, names);
    for (const name of names) {
      offer(replay, "skill", name, index, described.get(name));
    }
    return true;
  }

  if (type === "agent_listing_delta") {
    const added = asStrings(record.addedTypes);
    const lines = asStrings(record.addedLines);
    if (record.isInitial === true) {
      for (const name of openNames(replay, "agent")) {
        if (!added.includes(name)) withdraw(replay, "agent", name, index);
      }
    }
    const described = describedLines(added, lines);
    for (const name of added) {
      offer(replay, "agent", name, index, described.get(name));
    }
    for (const name of asStrings(record.removedTypes)) {
      withdraw(replay, "agent", name, index);
    }
    return true;
  }

  if (type === "deferred_tools_delta") {
    // Tool deltas carry no `isInitial` at all — verified across 431 records —
    // so they are purely additive/subtractive.
    for (const name of asStrings(record.removedNames)) {
      withdraw(replay, "tool", name, index);
    }
    // `addedLines` is the tool's own name again rather than a description, and
    // is sometimes empty while `addedNames` is not; there is no description to
    // recover for a tool.
    // `readdedNames` is the shape a re-offer actually takes: a tool that was
    // withdrawn and is offered again arrives there, not in `addedNames`.
    // Reading only `addedNames` left it withdrawn for the rest of the
    // session, so `availableAt` answered false for a tool the session could
    // still call.
    for (const name of [
      ...asStrings(record.addedNames),
      ...asStrings(record.readdedNames),
    ]) {
      offer(replay, "tool", name, index);
    }
    const servers: Array<[string, McpServerStatus]> = [
      ...asStrings(record.pendingMcpServers).map(
        (n): [string, McpServerStatus] => [n, "pending"],
      ),
      ...asStrings(record.needsAuthMcpServers).map(
        (n): [string, McpServerStatus] => [n, "needs-auth"],
      ),
      ...asStrings(record.failedMcpServers).map(
        (n): [string, McpServerStatus] => [n, "failed"],
      ),
    ];
    for (const [name, status] of servers) {
      offer(replay, "mcp-server", name, index, undefined, status);
    }
    return true;
  }

  return false;
}

/** Shift every ordinal through a remap, for the sidecar splice (ADR 01014). */
export function remapAvailability(
  roster: TraceAvailability,
  at: (index: number) => number,
): TraceAvailability {
  const shift = (entries: AvailabilityEntry[]): AvailabilityEntry[] =>
    entries.map((entry) => ({
      ...entry,
      offeredAt: at(entry.offeredAt),
      ...(entry.withdrawnAt !== undefined
        ? { withdrawnAt: at(entry.withdrawnAt) }
        : {}),
    }));
  return {
    recorded: roster.recorded,
    skills: shift(roster.skills),
    agents: shift(roster.agents),
    tools: shift(roster.tools),
    mcpServers: shift(roster.mcpServers),
  };
}

/**
 * Fold a subagent branch's own roster into the session's.
 *
 * A subagent is offered its own roster — every sidecar transcript checked
 * carries `skill_listing` and `deferred_tools_delta` records of its own — and
 * that roster is a *different* set from the parent's. Replaying it as if it
 * were the main chain's would churn the parent's intervals, since a sidecar's
 * listing is `isInitial: true` and would withdraw everything the parent had.
 *
 * So only names the session never saw at all are added, tagged with the branch
 * that saw them and never withdrawn. That keeps the main chain's intervals
 * exact while making "was this ever on the menu?" — the question coverage asks
 * — answer correctly for a skill only a subagent was offered.
 */
export function foldBranchAvailability(
  roster: TraceAvailability,
  branch: TraceAvailability,
  branchId: string,
  spawnIndex: number,
): void {
  if (!branch.recorded) return;
  roster.recorded = true;
  const merge = (into: AvailabilityEntry[], from: AvailabilityEntry[]): void => {
    const known = offeredNames(into);
    for (const entry of from) {
      if (known.has(entry.name)) continue;
      known.add(entry.name);
      into.push({
        ...entry,
        offeredAt: spawnIndex,
        branchId,
        ...(entry.withdrawnAt !== undefined ? { withdrawnAt: undefined } : {}),
      });
    }
  };
  merge(roster.skills, branch.skills);
  merge(roster.agents, branch.agents);
  merge(roster.tools, branch.tools);
  merge(roster.mcpServers, branch.mcpServers);
}
