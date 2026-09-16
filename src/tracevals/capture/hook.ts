/**
 * The Claude Code hook envelope, read from stdin (ADR 01024).
 *
 * Claude Code writes a hook command **one JSON object on stdin** and closes it.
 * Four members are documented as common to every hook event and are the only
 * ones `capture` depends on:
 *
 * | Member | Meaning |
 * |---|---|
 * | `session_id` | the session identifier — the manifest's filename and its join key |
 * | `transcript_path` | where the session file will be written; a correlation key only |
 * | `cwd` | the working directory the hook fired in — the project root to scan |
 * | `hook_event_name` | `SessionStart`, `SessionEnd`, … |
 *
 * The member naming *why* a session started or ended is **not** depended on.
 * The reference describes it as "how the session started" / "why the session
 * ended" and it has been published as `source`/`reason` and as `how`/`why`
 * across versions, so every spelling is accepted and the value is recorded as
 * provenance rather than used as a key. This is the same tolerance
 * `trace/detect.ts` already applies to `sessionId` versus `session_id`.
 *
 * Everything is optional and every member is type-checked before it is
 * believed: this payload is produced by another program, and a member of the
 * wrong shape must be ignored rather than propagated into a manifest.
 */
import { TracevalsError } from "../types.js";

export interface HookPayload {
  sessionId?: string;
  transcriptPath?: string;
  cwd?: string;
  hookEvent?: string;
  /** Why the session started or ended, whichever spelling arrived. */
  reason?: string;
}

/** Spellings of the start/end reason, most recent first. */
const REASON_KEYS = ["how", "why", "source", "reason"] as const;

function str(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Parse one hook payload. Throws only when the text is not a JSON object at
 * all — an object missing members is an ordinary, tolerable payload, while
 * text that is not one means `capture` was wired to something that is not a
 * Claude Code hook and saying so is more useful than writing an empty manifest.
 */
export function parseHookPayload(raw: string): HookPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new TracevalsError(
      `hook payload is not JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TracevalsError(
      "hook payload must be a JSON object; Claude Code writes one object on stdin",
    );
  }
  const record = parsed as Record<string, unknown>;
  let reason: string | undefined;
  for (const key of REASON_KEYS) {
    reason = str(record, key);
    if (reason !== undefined) break;
  }
  return {
    ...(str(record, "session_id") !== undefined
      ? { sessionId: str(record, "session_id") }
      : {}),
    ...(str(record, "transcript_path") !== undefined
      ? { transcriptPath: str(record, "transcript_path") }
      : {}),
    ...(str(record, "cwd") !== undefined
      ? { cwd: str(record, "cwd") }
      : {}),
    ...(str(record, "hook_event_name") !== undefined
      ? { hookEvent: str(record, "hook_event_name") }
      : {}),
    ...(reason !== undefined ? { reason } : {}),
  };
}

export interface ReadStdinOptions {
  /** Cap on the payload. A hook envelope is a handful of short strings. */
  maxBytes?: number;
  /**
   * How long to wait for a payload that never arrives. **Not optional
   * politeness** — an inherited stdin that is a pipe nobody ever writes to or
   * closes is a hang, and any script or CI runner that does not redirect stdin
   * hands `capture` exactly that. A hook writes and closes immediately, so this
   * only ever elapses when there was no payload to begin with.
   */
  timeoutMs?: number;
}

/**
 * Read a hook payload from stdin, or return "" when there is none.
 *
 * Never rejects on an idle stream: "nothing arrived" is the ordinary hand-run
 * case, and it is answered by an empty string.
 */
export function readStdin(
  stream: NodeJS.ReadStream = process.stdin,
  options: ReadStdinOptions = {},
): Promise<string> {
  const maxBytes = options.maxBytes ?? 1_000_000;
  const timeoutMs = options.timeoutMs ?? 1500;
  // A TTY means a person is at the keyboard, not a hook. Reading would block
  // on input nobody intends to type.
  if (stream.isTTY) return Promise.resolve("");

  return new Promise((settle, fail) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let done = false;

    const stop = (): void => {
      clearTimeout(timer);
      stream.off("data", onData);
      stream.off("end", onEnd);
      stream.off("error", onError);
      stream.pause();
    };
    const finish = (): void => {
      if (done) return;
      done = true;
      stop();
      settle(Buffer.concat(chunks).toString("utf-8"));
    };
    const abort = (err: Error): void => {
      if (done) return;
      done = true;
      stop();
      fail(err);
    };

    const onData = (chunk: Buffer | string): void => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (total > maxBytes) {
        abort(
          new TracevalsError(
            `hook payload exceeded ${maxBytes} bytes; this is not a Claude Code hook envelope`,
          ),
        );
        return;
      }
      chunks.push(buf);
    };
    const onEnd = (): void => { finish(); };
    // A closed or unreadable stdin is "no payload", not a failure: `capture`
    // has to survive being wired up in an environment nobody anticipated.
    const onError = (): void => { finish(); };

    const timer = setTimeout(finish, timeoutMs);
    stream.on("data", onData);
    stream.on("end", onEnd);
    stream.on("error", onError);
    stream.resume();
  });
}
