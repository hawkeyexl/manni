/**
 * Offered versus used (ADR 01016).
 *
 * Artifact resolution starts from what the trace *used*, so a skill that should
 * have been invoked and was not resolves to nothing and is reported nowhere.
 * The availability roster closes that blind spot without a filesystem scan:
 * the evidence travels inside the trace, so it works on any machine and on
 * every session already recorded.
 *
 * Three states, never collapsed:
 *
 * - **offered and used** — the ordinary case.
 * - **offered and not used** — a judgement call for a person to make. Counted
 *   by default and listed only on request, because a real roster runs to
 *   hundreds of skills and would drown the report.
 * - **not offered** — the session referenced it but it was never on the menu.
 *   That is a *configuration* bug, not an adherence failure, and it is the
 *   state that is invisible today.
 *
 * This is an observation. It never becomes an eval outcome and never moves the
 * exit code.
 *
 * `discoverArtifacts` is deliberately not used here: it scans the project tree
 * for authoring, and the roster makes a scan unnecessary anyway.
 */
import { offeredNames } from "../trace/availability.js";
import type { Trace } from "../trace/types.js";
import type {
  AvailabilityCounts,
  AvailabilityReport,
  CoverageEntry,
} from "./types.js";

export interface AvailabilityOptions {
  /** Include a coverage row per offered-but-unused artifact, not just a count. */
  listUnused?: boolean;
}

export interface AvailabilityCoverage {
  report: AvailabilityReport;
  /** The rows handed in, annotated, plus the unused ones when listed. */
  coverage: CoverageEntry[];
}

/**
 * A fresh zero row per call. One shared object assigned to both `skills` and
 * `agents` would make a mutation of either silently move the other; every
 * caller is read-only today, which is exactly why it would go unnoticed.
 */
const empty = (): AvailabilityCounts => ({ offered: 0, used: 0, unused: 0 });

/**
 * Kinds the roster says nothing about, so no row of theirs may carry a state.
 *
 * Project rules are never *offered* — they are in force from the first turn.
 * Slash commands have no listing record of any kind, so `not-offered` would be
 * a confident accusation drawn from evidence that was never collected — which
 * is precisely what a built-in command looked like before it had its own type
 * (ADR 01016's recorded limitation, closed by ADR 01023).
 */
const UNROSTERED = new Set<CoverageEntry["kind"]>([
  "project-rules",
  "slash-command",
]);

export function coverAvailability(
  trace: Trace,
  coverage: CoverageEntry[],
  options: AvailabilityOptions = {},
): AvailabilityCoverage {
  const roster = trace.availability;
  if (!roster.recorded) {
    // No listing records: unknown, not zero. Every row says so rather than
    // implying the session was offered nothing.
    return {
      report: { recorded: false, skills: empty(), agents: empty(), listed: false },
      coverage: coverage.map((entry) =>
        UNROSTERED.has(entry.kind)
          ? entry
          : { ...entry, availability: "unknown" as const },
      ),
    };
  }

  const offeredSkills = offeredNames(roster.skills);
  const offeredAgents = offeredNames(roster.agents);
  const offeredFor = (kind: CoverageEntry["kind"]): Set<string> =>
    kind === "skill" ? offeredSkills : offeredAgents;

  const usedSkills = new Set<string>();
  const usedAgents = new Set<string>();

  const annotated = coverage.map((entry) => {
    if (UNROSTERED.has(entry.kind)) return entry;
    const offered = offeredFor(entry.kind).has(entry.ref);
    if (offered) {
      (entry.kind === "skill" ? usedSkills : usedAgents).add(entry.ref);
    }
    return {
      ...entry,
      availability: offered ? ("offered-and-used" as const) : ("not-offered" as const),
    };
  });

  const listUnused = options.listUnused === true;
  const unusedRows: CoverageEntry[] = [];
  const collect = (kind: "skill" | "agent", used: Set<string>): number => {
    let unused = 0;
    // Ordered by first offer, and deduplicated: a name withdrawn and
    // re-offered is two intervals but one artifact.
    const seen = new Set<string>();
    for (const entry of kind === "skill" ? roster.skills : roster.agents) {
      if (seen.has(entry.name)) continue;
      seen.add(entry.name);
      if (used.has(entry.name)) continue;
      unused += 1;
      if (!listUnused) continue;
      unusedRows.push({
        ref: entry.name,
        kind,
        resolved: false,
        tried: [],
        note:
          entry.description === undefined
            ? "offered, never used"
            : `offered, never used — ${firstLine(entry.description)}`,
        availability: "offered-not-used",
      });
    }
    return unused;
  };

  const skillsUnused = collect("skill", usedSkills);
  const agentsUnused = collect("agent", usedAgents);

  return {
    report: {
      recorded: true,
      skills: {
        offered: offeredSkills.size,
        used: usedSkills.size,
        unused: skillsUnused,
      },
      agents: {
        offered: offeredAgents.size,
        used: usedAgents.size,
        unused: agentsUnused,
      },
      listed: listUnused,
    },
    coverage: [...annotated, ...unusedRows],
  };
}

/** Descriptions wrap over several lines; a table cell wants the first one. */
function firstLine(description: string): string {
  const line = description.split("\n")[0] ?? "";
  return line.length > 160 ? `${line.slice(0, 157)}...` : line;
}
