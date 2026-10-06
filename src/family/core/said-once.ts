/**
 * What a hook has already told the user this session (proposal 0079: "A skip
 * message is said once per session").
 *
 * Each hook is a process of its own, so the memory is a file: the keys said,
 * as a JSON array, beside the session manifests `tracevals capture` writes.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DEFAULT_CAPTURE_DIR } from "../../tracevals/capture/types.js";

/** `<project>/.manni/tracevals/sessions/<session>.said.json`. */
export function saidPath(projectDir: string, sessionId: string): string {
  // A session id names a file, so nothing in it may climb out of the directory.
  return join(projectDir, DEFAULT_CAPTURE_DIR, `${sessionId.replace(/[^A-Za-z0-9._-]/g, "_")}.said.json`);
}

function said(path: string): string[] {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string") : [];
  } catch {
    return [];
  }
}

/**
 * True the first time `key` comes up in a session, and records it. A marker
 * that cannot be written says the message rather than lose it.
 */
export function sayOnce(projectDir: string, sessionId: string, key: string): boolean {
  const path = saidPath(projectDir, sessionId);
  const keys = said(path);
  if (keys.includes(key)) return false;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify([...keys, key])}\n`, "utf8");
  } catch {
    // ponytail: an unwritable project repeats the message each stop.
  }
  return true;
}
