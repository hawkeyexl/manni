/** Coverage rendering shared by every reporter. */
import type { AvailabilityReport, CoverageEntry } from "../artifacts/types.js";
import type { ManifestReport } from "../capture/types.js";

/**
 * The "where" cell for one coverage entry.
 *
 * Shared rather than duplicated per reporter: this logic existed twice and the
 * copies drifted, so the markdown table interpolated an absent `path` and
 * printed the literal string "undefined" for an entry the human reporter
 * rendered correctly.
 *
 * A resolved entry usually names the file it resolved to, but not always —
 * project rules aggregate several files (`CLAUDE.md` *and* `AGENTS.md`) into one
 * entry with no single `path`. Fall through to the note, then to empty. `note`
 * is independent of `resolved` in the type, so a producer that supplies one is
 * honoured rather than having it silently dropped.
 */
export function coverageLocation(entry: CoverageEntry): string {
  if (entry.resolved) return entry.path ?? entry.note ?? "";
  if (entry.availability === "offered-not-used") {
    // Never looked for on disk, so "not found" would be a false claim.
    return entry.note ?? "offered, never used";
  }
  return entry.note ?? `not found (${entry.tried.length} location(s) tried)`;
}

/**
 * The roster line for one coverage row (ADR 01016). Only the two states a
 * reader has to act on are labelled: an artifact that was offered and used is
 * the ordinary case and says nothing, and `unknown` means the trace carried no
 * roster, which is not this row's problem to announce.
 */
export function availabilityTag(entry: CoverageEntry): string | undefined {
  if (entry.availability === "not-offered") return "not offered";
  if (entry.availability === "offered-not-used") return "offered, unused";
  return undefined;
}

/**
 * The offered-versus-used summary. Counts by default — a real roster runs to
 * hundreds of skills, and listing them would bury the evals above.
 */
export function availabilityLines(report: AvailabilityReport): string[] {
  if (!report.recorded) {
    // Unknown, not zero: older sessions and stream transcripts carry no
    // listing records at all (ADR 01003).
    return [
      "no availability roster in this trace, so what the session was offered is unknown",
    ];
  }
  const lines = [
    `${report.skills.offered} skill(s) offered, ${report.skills.used} used, ${report.skills.unused} never used`,
    `${report.agents.offered} agent(s) offered, ${report.agents.used} used, ${report.agents.unused} never used`,
  ];
  if (!report.listed && report.skills.unused + report.agents.unused > 0) {
    lines.push("pass --report-unused-artifacts to list them");
  }
  return lines;
}

/**
 * The staleness note for one coverage entry, or "" when it is not stale.
 *
 * Kept beside `coverageLocation` and separate from it: the location answers
 * "which file", and this answers "is that file still what the session saw"
 * (ADR 01021). Collapsing them would drop the path for a stale entry, which is
 * exactly the row where a reader most wants to open the file.
 *
 * The wording says which evidence answered, because they are not the same
 * claim (ADR 01024). A manifest mismatch is content identity — the file *is*
 * different. mtime is a guess that a checkout defeats. A reader deciding
 * whether to act on the row needs to know which of the two they are reading,
 * and the mtime phrasing is left byte-identical so that nothing downstream has
 * to re-learn it.
 */
export function coverageStaleness(entry: CoverageEntry): string {
  if (entry.stale !== true) return "";
  if (entry.contentCheck?.status === "mismatch") {
    return "changed since the session started (session manifest sha256)";
  }
  return entry.modifiedAt !== undefined
    ? `modified after the session ended (${entry.modifiedAt})`
    : "modified after the session ended";
}

/**
 * The session-manifest block, or nothing when no manifest was found.
 *
 * Silence is the right default for the absent case: a line on every run of
 * every project that has not adopted `capture` is noise, and the machine-
 * readable answer is already on each coverage row as a `skipped` content check
 * with its reason.
 *
 * `unrecorded` is reported rather than folded into `matched`, because those
 * rows still rest on the mtime heuristic and a reader has to be able to see how
 * many of them there are.
 */
export function manifestLines(report: ManifestReport): string[] {
  const lines = [
    `${report.path} captured ${report.capturedAt}${
      report.gitSha !== undefined ? ` at ${report.gitSha.slice(0, 12)}` : ""
    }`,
    `${report.matched} artifact(s) unchanged, ${report.changed} changed, ${report.unrecorded} not recorded`,
  ];
  if (report.unrecorded > 0) {
    lines.push(
      "artifacts the manifest did not record keep the mtime heuristic",
    );
  }
  return lines;
}
