/** Resolved instruction artifacts and coverage reporting. */
import type { ContentCheck } from "../capture/types.js";

/**
 * The kinds of instruction artifact a session can be governed by.
 *
 * `slash-command` is a `.claude/commands/*.md` file: frontmattered markdown
 * whose body Claude Code injects as a prompt when someone types `/name`
 * (ADR 01023). It is the same shape as a skill — an instruction set that loads
 * at a point in the session — and is graded the same way.
 */
export type ArtifactType =
  | "skill"
  | "agent"
  | "project-rules"
  | "slash-command";

export type ArtifactOrigin = "project" | "user" | "plugin";

export interface ResolvedArtifact {
  /** Reference name (skill name, subagent_type, or rules filename). */
  name: string;
  type: ArtifactType;
  /** Absolute path on disk. */
  path: string;
  content: string;
  origin: ArtifactOrigin;
}

/**
 * Whether the session was *offered* an artifact, and whether it used it
 * (ADR 01016). The three states are kept apart deliberately: "offered and not
 * used" is a judgement call, while "not offered" is a configuration bug and
 * collapsing them sends a reader looking in the wrong place.
 *
 * `unknown` is not a fourth shade of the same thing — it means the trace
 * carried no roster at all, which older sessions and stream transcripts never
 * do (ADR 01003).
 */
export type ArtifactAvailability =
  | "offered-and-used"
  | "offered-not-used"
  | "not-offered"
  | "unknown";

/** One row of the report's artifact-coverage table. */
export interface CoverageEntry {
  ref: string;
  kind: ArtifactType;
  resolved: boolean;
  path?: string;
  /** Paths that were checked, for unresolved refs. */
  tried: string[];
  note?: string;
  /**
   * Roster state. Absent for `project-rules`, which is not something a session
   * is offered — it is always in force — and for `slash-command`, which the
   * transcript keeps no roster of at all (ADR 01023). Never affects an eval
   * outcome or the exit code: this is an observation.
   */
  availability?: ArtifactAvailability;
  /**
   * The artifact on disk is not the one the session followed, so its evals may
   * not be the instructions in force at the time.
   *
   * Two sources, and which one answered is in `contentCheck`. Without a session
   * manifest this is the **mtime heuristic** of ADR 01021 — the file is newer
   * than the session's end — and it is absent when the trace records no end
   * time, since then there is nothing to compare against. With a manifest it is
   * the **exact** answer: a sha256 that differs from the one recorded when the
   * session started, or provably identical content (ADR 01024).
   *
   * A warning either way. It never becomes an eval outcome and never changes
   * the exit code.
   */
  stale?: boolean;
  /** The artifact's mtime, ISO-8601. Present whenever it could be read. */
  modifiedAt?: string;
  /**
   * What the session manifest said about this row's content (ADR 01024).
   * `skipped` — with the reason — whenever there was no manifest, or none that
   * covered this artifact; then `stale` is still the mtime guess.
   */
  contentCheck?: ContentCheck;
}

/** Roster tallies for one artifact kind. */
export interface AvailabilityCounts {
  offered: number;
  used: number;
  unused: number;
}

/**
 * The offered-versus-used summary that accompanies the coverage table. Counts
 * by default; `listed` says whether the offered-but-unused rows were included
 * in `coverage` as well, which `--report-unused-artifacts` turns on.
 */
export interface AvailabilityReport {
  /** False means unknown — never "nothing was offered". */
  recorded: boolean;
  skills: AvailabilityCounts;
  agents: AvailabilityCounts;
  listed: boolean;
}

export interface ResolvedArtifacts {
  artifacts: ResolvedArtifact[];
  coverage: CoverageEntry[];
  availability: AvailabilityReport;
  warnings: string[];
}
