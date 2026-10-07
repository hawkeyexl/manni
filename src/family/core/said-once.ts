/**
 * What a hook has already told the user this session (proposal 0079: "A skip
 * message is said once per session").
 *
 * Each hook is a process of its own, and parallel subagents end in parallel
 * SubagentStop hooks, so the memory is one marker file per message, created
 * exclusively. The process whose create succeeds is the one that says it, so
 * no two hooks can both read "not said yet".
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DEFAULT_CAPTURE_DIR } from "../../tracevals/capture/types.js";
import { idHash } from "../../tracevals/rules/ledger.js";

/**
 * `<project>/.manni/tracevals/sessions/<session hash>.<key>.said`. The session
 * id is hashed, so nothing in it can climb out of the directory and two ids
 * never share a marker. The key is a gate name, which is already safe.
 */
export function saidPath(projectDir: string, sessionId: string, key: string): string {
  return join(projectDir, DEFAULT_CAPTURE_DIR, `${idHash(sessionId)}.${key}.said`);
}

/**
 * True the first time `key` comes up in a session, and records it. A marker
 * that cannot be written says the message rather than lose it.
 */
export function sayOnce(projectDir: string, sessionId: string, key: string): boolean {
  const path = saidPath(projectDir, sessionId, key);
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "", { flag: "wx" });
    return true;
  } catch (err) {
    // EEXIST: another hook said it first. Anything else is an unwritable
    // project, which repeats the message each stop rather than lose it.
    return (err as NodeJS.ErrnoException).code !== "EEXIST";
  }
}
