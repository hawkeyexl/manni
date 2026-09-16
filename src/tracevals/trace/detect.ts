/**
 * Trace format sniffing. Session files and stream-json are both JSONL, but
 * session records carry camelCase `sessionId` (and `parentUuid` on message
 * records) while stream-json uses snake_case `session_id`.
 */
import { TracevalsError } from "../types.js";
import type { TraceFormat } from "./types.js";

const SUPPORTED =
  "supported formats: Claude Code session files (~/.claude/projects/**.jsonl) and claude -p stream-json";

/** Detect the dialect from one JSONL line (typically the first parseable). */
export function detectFormat(line: string): TraceFormat {
  let rec: Record<string, unknown>;
  try {
    rec = JSON.parse(line) as Record<string, unknown>;
  } catch {
    throw new TracevalsError(`trace is not JSONL (${SUPPORTED})`);
  }
  if (typeof rec !== "object" || rec === null) {
    throw new TracevalsError(`unrecognized trace format (${SUPPORTED})`);
  }
  if ("parentUuid" in rec || "sessionId" in rec) return "claude-session";
  if ("session_id" in rec) return "claude-stream";
  throw new TracevalsError(`unrecognized trace format (${SUPPORTED})`);
}

/**
 * Detect the dialect of a whole file's content: the first line that *identifies*
 * a format decides. Malformed lines and parseable-but-unidentifiable records
 * (e.g. a leading `{"type":"summary",…}`, which real session files carry) are
 * skipped, so a metadata record at the top never masks the format below it.
 */
export function detectContentFormat(content: string): TraceFormat {
  let sawParseable = false;
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let rec: unknown;
    try {
      rec = JSON.parse(trimmed);
    } catch {
      continue; // Malformed line — keep scanning.
    }
    if (typeof rec !== "object" || rec === null) continue;
    sawParseable = true;
    const r = rec as Record<string, unknown>;
    if ("parentUuid" in r || "sessionId" in r) return "claude-session";
    if ("session_id" in r) return "claude-stream";
    // Parseable but unidentifiable (summary, and other metadata records) —
    // keep scanning for a line that names the format.
  }
  throw new TracevalsError(
    sawParseable
      ? `unrecognized trace format (${SUPPORTED})`
      : `empty or unparseable trace file (${SUPPORTED})`,
  );
}
