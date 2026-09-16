import { describe, expect, it } from "vitest";
import { parseTraceContent } from "../../../src/tracevals/trace/claude.js";
import { availableAt, offeredNames } from "../../../src/tracevals/trace/availability.js";
import type { AvailabilityEntry } from "../../../src/tracevals/trace/types.js";

/** One session record, so the fixtures below read as a transcript. */
const rec = (value: Record<string, unknown>): string => JSON.stringify(value);

function attachment(
  uuid: string,
  parentUuid: string | null,
  payload: Record<string, unknown>,
): string {
  return rec({
    type: "attachment",
    uuid,
    parentUuid,
    sessionId: "s1",
    cwd: "C:\\work\\demo",
    attachment: payload,
  });
}

function user(uuid: string, parentUuid: string | null, text: string): string {
  return rec({
    type: "user",
    uuid,
    parentUuid,
    sessionId: "s1",
    cwd: "C:\\work\\demo",
    message: { role: "user", content: text },
  });
}

const SKILL_LISTING = {
  type: "skill_listing",
  isInitial: true,
  skillCount: 3,
  names: ["fix-bug", "writing-toolkit:identify-ai-tells", "bare-skill"],
  content: [
    "- fix-bug: Fix a reported bug, reproducing it with a failing test first.",
    "- writing-toolkit:identify-ai-tells: Use when scanning prose for AI-generation markers.",
    "  Detection only; never rewrites.",
    "- bare-skill",
  ].join("\n"),
};

const SKILL_DELTA = {
  type: "skill_listing",
  isInitial: false,
  skillCount: 1,
  names: ["tdd-coverage"],
  content:
    "- tdd-coverage: TDD and Coverage Skill (from src/common/.claude/skills — applies when working on files under src/common/)",
};

const AGENT_LISTING = {
  type: "agent_listing_delta",
  isInitial: true,
  addedTypes: ["doc-writer", "reviewer"],
  addedLines: [
    "- doc-writer: Writes changelog entries. (Tools: Read, Write)",
    "- reviewer: Reviews a diff. (Tools: Read)",
  ],
  removedTypes: [],
};

const TOOLS_DELTA = {
  type: "deferred_tools_delta",
  addedNames: ["WebSearch", "WebFetch"],
  addedLines: ["WebSearch", "WebFetch"],
  removedNames: [],
  readdedNames: [],
  pendingMcpServers: ["git"],
  needsAuthMcpServers: ["plugin:stripe:stripe"],
  failedMcpServers: [],
};

function parse(lines: string[]) {
  return parseTraceContent(lines.join("\n"), "trace.jsonl");
}

describe("availability roster (ADR 01016)", () => {
  it("parses a skill listing into named entries with descriptions", () => {
    const trace = parse([
      attachment("a1", null, SKILL_LISTING),
      user("u1", "a1", "hello"),
    ]);
    expect(trace.availability.recorded).toBe(true);
    const names = trace.availability.skills.map((s) => s.name);
    expect(names).toEqual([
      "fix-bug",
      "writing-toolkit:identify-ai-tells",
      "bare-skill",
    ]);
    const byName = new Map(trace.availability.skills.map((s) => [s.name, s]));
    expect(byName.get("fix-bug")?.description).toBe(
      "Fix a reported bug, reproducing it with a failing test first.",
    );
  });

  it("keeps a plugin skill's `plugin:skill` name whole", () => {
    // Splitting the line on its first colon would truncate the name to
    // "writing-toolkit" and strand the description.
    const trace = parse([attachment("a1", null, SKILL_LISTING)]);
    const entry = trace.availability.skills.find(
      (s) => s.name === "writing-toolkit:identify-ai-tells",
    );
    expect(entry?.description).toBe(
      "Use when scanning prose for AI-generation markers.\nDetection only; never rewrites.",
    );
  });

  it("leaves a description absent when the listing carried none", () => {
    // A large roster is budget-truncated: later entries are listed by name
    // alone, so absent means "not recorded", never "has no description".
    const trace = parse([attachment("a1", null, SKILL_LISTING)]);
    const bare = trace.availability.skills.find((s) => s.name === "bare-skill");
    expect(bare).toBeDefined();
    expect(bare?.description).toBeUndefined();
  });

  it("records the event ordinal each entry was offered at", () => {
    const trace = parse([
      user("u0", null, "first"),
      attachment("a1", "u0", SKILL_LISTING),
    ]);
    const offeredAt = trace.availability.skills[0]?.offeredAt;
    expect(offeredAt).toBe(1);
    expect(trace.events[offeredAt as number]?.kind).toBe("meta");
  });

  it("replays a non-initial delta as an addition, not a replacement", () => {
    const trace = parse([
      attachment("a1", null, SKILL_LISTING),
      user("u1", "a1", "work"),
      attachment("a2", "u1", SKILL_DELTA),
    ]);
    const names = trace.availability.skills.map((s) => s.name);
    expect(names).toContain("fix-bug");
    expect(names).toContain("tdd-coverage");
    const late = trace.availability.skills.find((s) => s.name === "tdd-coverage");
    expect(late?.offeredAt).toBe(2);
    expect(late?.description).toContain("applies when working on files under");
    // The earlier ones were never withdrawn.
    expect(
      trace.availability.skills.find((s) => s.name === "fix-bug")?.withdrawnAt,
    ).toBeUndefined();
  });

  it("withdraws the previous set when a listing is initial", () => {
    const trace = parse([
      attachment("a1", null, SKILL_LISTING),
      user("u1", "a1", "work"),
      attachment("a2", "u1", {
        type: "skill_listing",
        isInitial: true,
        skillCount: 1,
        names: ["fix-bug"],
        content: "- fix-bug: Fix a reported bug.",
      }),
    ]);
    const gone = trace.availability.skills.filter((s) => s.name === "bare-skill");
    expect(gone).toHaveLength(1);
    expect(gone[0]?.withdrawnAt).toBe(2);
    // A name still offered stays on one open interval rather than being
    // withdrawn and re-added, so "available at T" reads cleanly.
    const kept = trace.availability.skills.filter((s) => s.name === "fix-bug");
    expect(kept).toHaveLength(1);
    expect(kept[0]?.withdrawnAt).toBeUndefined();
  });

  it("parses agents with their descriptions and tool grants", () => {
    const trace = parse([attachment("a1", null, AGENT_LISTING)]);
    expect(trace.availability.agents.map((a) => a.name)).toEqual([
      "doc-writer",
      "reviewer",
    ]);
    expect(trace.availability.agents[0]?.description).toBe(
      "Writes changelog entries. (Tools: Read, Write)",
    );
  });

  it("removes an agent named in removedTypes", () => {
    const trace = parse([
      attachment("a1", null, AGENT_LISTING),
      user("u1", "a1", "work"),
      attachment("a2", "u1", {
        type: "agent_listing_delta",
        isInitial: false,
        addedTypes: [],
        addedLines: [],
        removedTypes: ["reviewer"],
      }),
    ]);
    const reviewer = trace.availability.agents.find((a) => a.name === "reviewer");
    expect(reviewer?.withdrawnAt).toBe(2);
    expect(availableAt(trace.availability.agents, 1).map((a) => a.name)).toEqual([
      "doc-writer",
      "reviewer",
    ]);
    expect(availableAt(trace.availability.agents, 2).map((a) => a.name)).toEqual([
      "doc-writer",
    ]);
  });

  it("parses deferred tools and MCP server state", () => {
    const trace = parse([attachment("a1", null, TOOLS_DELTA)]);
    expect(trace.availability.tools.map((t) => t.name)).toEqual([
      "WebSearch",
      "WebFetch",
    ]);
    const servers = trace.availability.mcpServers;
    expect(servers.map((s) => [s.name, s.status])).toEqual([
      ["git", "pending"],
      ["plugin:stripe:stripe", "needs-auth"],
    ]);
  });

  it("re-offers a tool that was removed and readded", () => {
    const trace = parse([
      attachment("a1", null, TOOLS_DELTA),
      user("u1", "a1", "work"),
      attachment("a2", "u1", {
        type: "deferred_tools_delta",
        addedNames: [],
        removedNames: ["WebSearch"],
      }),
      user("u2", "a2", "more"),
      // `readdedNames` alone, which is the shape a real re-offer takes. Naming
      // it in `addedNames` as well would let the added-path handle it and leave
      // the readded-path untested — the case would pass whether or not
      // `readdedNames` is read at all.
      attachment("a3", "u2", {
        type: "deferred_tools_delta",
        addedNames: [],
        readdedNames: ["WebSearch"],
        removedNames: [],
      }),
    ]);
    // One interval per stretch of availability, so a gap is visible rather
    // than smoothed over.
    const search = trace.availability.tools.filter((t) => t.name === "WebSearch");
    expect(search).toHaveLength(2);
    expect(search[0]?.withdrawnAt).toBe(2);
    expect(search[1]?.offeredAt).toBe(4);
    expect(availableAt(trace.availability.tools, 3).map((t) => t.name)).toEqual([
      "WebFetch",
    ]);
    expect(offeredNames(trace.availability.tools)).toEqual(
      new Set(["WebSearch", "WebFetch"]),
    );
  });

  it("reports no roster rather than an empty one when nothing was listed", () => {
    // Old traces carry no listing records at all. Claiming zero skills were
    // offered would be a confident wrong answer (ADR 01003).
    const trace = parse([user("u0", null, "hello")]);
    expect(trace.availability.recorded).toBe(false);
    expect(trace.availability.skills).toEqual([]);
  });

  it("tolerates a malformed listing record instead of throwing", () => {
    const trace = parse([
      attachment("a1", null, { type: "skill_listing", names: "not-an-array" }),
      attachment("a2", "a1", { type: "skill_listing" }),
      user("u1", "a2", "hello"),
    ]);
    expect(trace.availability.skills).toEqual([]);
    expect(trace.userMessages).toEqual(["hello"]);
  });

  it("still emits the listing record as a meta event", () => {
    // Availability is read off the record; the event stream keeps its shape.
    const trace = parse([attachment("a1", null, SKILL_LISTING)]);
    expect(trace.events).toHaveLength(1);
    expect(trace.events[0]?.kind).toBe("meta");
  });
});

describe("availableAt", () => {
  const entries: AvailabilityEntry[] = [
    { kind: "skill", name: "a", offeredAt: 0 },
    { kind: "skill", name: "b", offeredAt: 2, withdrawnAt: 5 },
  ];

  it("excludes an entry before it was offered", () => {
    expect(availableAt(entries, 1).map((e) => e.name)).toEqual(["a"]);
  });

  it("includes an entry at the ordinal it was offered", () => {
    expect(availableAt(entries, 2).map((e) => e.name)).toEqual(["a", "b"]);
  });

  it("excludes an entry from the ordinal it was withdrawn", () => {
    expect(availableAt(entries, 5).map((e) => e.name)).toEqual(["a"]);
  });
});
