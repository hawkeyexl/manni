import { describe, expect, it } from "vitest";
import { coverAvailability } from "../../../src/tracevals/artifacts/availability.js";
import { makeTrace } from "../helpers.js";
import type { CoverageEntry } from "../../../src/tracevals/artifacts/types.js";
import type { AvailabilityEntry, Trace } from "../../../src/tracevals/trace/types.js";

const skill = (
  name: string,
  description?: string,
): AvailabilityEntry => ({
  kind: "skill",
  name,
  offeredAt: 0,
  ...(description !== undefined ? { description } : {}),
});

const agent = (name: string): AvailabilityEntry => ({
  kind: "agent",
  name,
  offeredAt: 0,
});

function rostered(): Trace {
  return makeTrace({
    availability: {
      recorded: true,
      skills: [
        skill("fix-bug", "Fix a reported bug."),
        skill("deep-research", "Fan-out web searches."),
        skill("bare-skill"),
      ],
      agents: [agent("reviewer"), agent("doc-writer")],
      tools: [],
      mcpServers: [],
    },
  });
}

const used = (ref: string, kind: CoverageEntry["kind"]): CoverageEntry => ({
  ref,
  kind,
  resolved: true,
  path: `/p/${ref}`,
  tried: [],
});

const RULES: CoverageEntry = {
  ref: "project rules",
  kind: "project-rules",
  resolved: true,
  tried: [],
};

describe("coverAvailability (ADR 01016)", () => {
  it("marks a referenced artifact the roster listed as offered and used", () => {
    const { coverage } = coverAvailability(rostered(), [
      used("fix-bug", "skill"),
      used("reviewer", "agent"),
      RULES,
    ]);
    expect(coverage[0]?.availability).toBe("offered-and-used");
    expect(coverage[1]?.availability).toBe("offered-and-used");
  });

  it("marks a referenced artifact the roster never listed as not offered", () => {
    // The state that wastes an afternoon: a configuration bug, not an
    // adherence failure.
    const { coverage } = coverAvailability(rostered(), [
      used("ghost-skill", "skill"),
    ]);
    expect(coverage[0]?.availability).toBe("not-offered");
  });

  it("leaves project rules out of the roster comparison", () => {
    const { coverage } = coverAvailability(rostered(), [RULES]);
    expect(coverage[0]?.availability).toBeUndefined();
  });

  // The transcript records no roster of slash commands, so "not offered" would
  // be a claim about evidence that does not exist — and asserting it anyway is
  // exactly the defect ADR 01016 recorded (ADR 01023).
  it("leaves slash commands out of the roster comparison", () => {
    const { coverage, report } = coverAvailability(rostered(), [
      used("ship-it", "slash-command"),
      {
        ref: "model",
        kind: "slash-command",
        resolved: false,
        tried: ["/p/.claude/commands/model.md"],
      },
    ]);
    expect(coverage.every((c) => c.availability === undefined)).toBe(true);
    expect(report.skills.used).toBe(0);
    expect(report.agents.used).toBe(0);
  });

  it("counts offered, used, and unused per kind", () => {
    const { report } = coverAvailability(rostered(), [
      used("fix-bug", "skill"),
      used("reviewer", "agent"),
      RULES,
    ]);
    expect(report.recorded).toBe(true);
    expect(report.skills).toEqual({ offered: 3, used: 1, unused: 2 });
    expect(report.agents).toEqual({ offered: 2, used: 1, unused: 1 });
    expect(report.listed).toBe(false);
  });

  it("summarises rather than listing by default", () => {
    // 274 offered skills would drown the report.
    const { coverage } = coverAvailability(rostered(), [used("fix-bug", "skill")]);
    expect(coverage).toHaveLength(1);
  });

  it("lists every offered-and-unused artifact when asked", () => {
    const { coverage, report } = coverAvailability(
      rostered(),
      [used("fix-bug", "skill"), used("reviewer", "agent")],
      { listUnused: true },
    );
    expect(report.listed).toBe(true);
    const unused = coverage.filter((c) => c.availability === "offered-not-used");
    expect(unused.map((c) => c.ref)).toEqual([
      "deep-research",
      "bare-skill",
      "doc-writer",
    ]);
    // The description is the point: it is the criterion Claude Code itself
    // uses to decide whether to invoke.
    expect(unused[0]?.note).toBe("offered, never used — Fan-out web searches.");
    expect(unused[1]?.note).toBe("offered, never used");
    // An unused artifact was never looked for on disk, so it claims nothing
    // about resolution.
    expect(unused[0]?.resolved).toBe(false);
    expect(unused[0]?.tried).toEqual([]);
  });

  it("reports unknown, not zero, when the trace carried no roster", () => {
    // An old trace has no listing records. Claiming nothing was offered would
    // be a confident wrong answer (ADR 01003).
    const { coverage, report } = coverAvailability(
      makeTrace({}),
      [used("fix-bug", "skill")],
      { listUnused: true },
    );
    expect(report.recorded).toBe(false);
    expect(report.skills).toEqual({ offered: 0, used: 0, unused: 0 });
    expect(coverage[0]?.availability).toBe("unknown");
    expect(coverage).toHaveLength(1);
  });

  it("counts a name once however many times it was referenced", () => {
    const { report } = coverAvailability(rostered(), [
      used("fix-bug", "skill"),
      used("fix-bug", "skill"),
    ]);
    expect(report.skills.used).toBe(1);
  });

  it("counts a re-offered name once", () => {
    // A withdrawn-and-readded name is two intervals but one artifact.
    const trace = makeTrace({
      availability: {
        recorded: true,
        skills: [
          { kind: "skill", name: "fix-bug", offeredAt: 0, withdrawnAt: 3 },
          { kind: "skill", name: "fix-bug", offeredAt: 6 },
        ],
        agents: [],
        tools: [],
        mcpServers: [],
      },
    });
    const { report, coverage } = coverAvailability(trace, [], {
      listUnused: true,
    });
    expect(report.skills).toEqual({ offered: 1, used: 0, unused: 1 });
    expect(coverage.filter((c) => c.availability === "offered-not-used")).toHaveLength(1);
  });
});
