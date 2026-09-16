/**
 * `manni tracevals capture` — record what the project's instruction artifacts
 * said, and at which commit, at the moment a session started (ADR 01024).
 *
 * **This is the one write path `run` never takes.** CLAUDE.md states that
 * evaluation is read-only, so the manifest is written by a separate,
 * explicitly-invoked command — the same shape as `fill`. `run` only ever reads
 * a manifest, and degrades cleanly when there is none.
 *
 * Designed to be wired to a `SessionStart` hook, which constrains it in two
 * ways that are not obvious:
 *
 *  - **Nothing goes to stdout in hook mode.** Claude Code adds a
 *    SessionStart hook's stdout to the model's context, so a report printed
 *    there would be a side effect on the very session being observed. In hook
 *    mode the report goes to stderr, where an exit-0 hook's output is a debug
 *    line and nothing more.
 *  - **The transcript is never read.** `transcript_path` is recorded as a
 *    correlation key only. At SessionStart the file barely exists, and the
 *    reference warns that it lags the conversation in any case.
 */
import { resolve } from "node:path";
import { loadConfig } from "../core/config.js";
import { buildManifest } from "../capture/build.js";
import { manifestPathFor, writeManifest } from "../capture/manifest.js";
import type { SessionManifest } from "../capture/types.js";
import { parseHookPayload, readStdin } from "../capture/hook.js";
import { TracevalsError } from "../types.js";

export interface CaptureCommandOptions {
  /**
   * The hook payload. Undefined means "read stdin"; an empty string means
   * "there was none", which is the hand-run path.
   */
  stdin?: string;
  /** Overrides the payload's `cwd` as the project root to scan. */
  project?: string;
  /** Overrides the payload's `session_id`. */
  sessionId?: string;
  /** Write here instead of `<project>/<capture.dir>/<session-id>.json`. */
  out?: string;
  /** Directory holding manni.config.yaml; defaults to the project root. */
  configDir?: string;
  format?: "human" | "json";
  /**
   * Version recorded in the manifest. Passed in rather than read from
   * package.json here: this module is bundled into an unpredictable chunk
   * path, so any relative require of it resolves differently in dist than in
   * src. The CLI, which is not bundled away, supplies it.
   */
  version?: string;
}

export interface CaptureCommandResult {
  manifest: SessionManifest;
  /** Where the manifest was written. */
  path: string;
  /** The report, wherever it is destined for. */
  rendered: string;
  /** What the caller should print to stdout — empty in hook mode. */
  stdout: string;
  /** What the caller should print to stderr — the report, in hook mode. */
  stderr: string;
  exitCode: number;
}

export async function runCapture(
  options: CaptureCommandOptions = {},
): Promise<CaptureCommandResult> {
  const raw = options.stdin ?? (await readStdin());
  const hookMode = raw.trim().length > 0;
  const payload = hookMode ? parseHookPayload(raw) : {};

  const sessionId = options.sessionId ?? payload.sessionId;
  if (sessionId === undefined) {
    // Without an id the manifest has no name and no join key, and writing one
    // under a guessed name would produce evidence nothing could ever find.
    throw new TracevalsError(
      "no session id: pipe a Claude Code hook payload on stdin, or pass --session-id",
    );
  }

  const root = resolve(options.project ?? payload.cwd ?? process.cwd());
  const config = await loadConfig(options.configDir ?? root);

  const manifest = await buildManifest({
    sessionId,
    root,
    hookEvent: payload.hookEvent ?? "manual",
    ...(payload.reason !== undefined ? { reason: payload.reason } : {}),
    ...(payload.transcriptPath !== undefined
      ? { transcriptPath: payload.transcriptPath }
      : {}),
    config,
    redact: config.judge.redact,
    ...(options.version !== undefined ? { version: options.version } : {}),
  });

  const path =
    options.out ??
    manifestPathFor(resolve(root, config.capture.dir), sessionId);
  try {
    await writeManifest(path, manifest);
  } catch (err) {
    throw new TracevalsError(
      `could not write ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const rendered =
    options.format === "json"
      ? JSON.stringify({ path, manifest }, null, 2)
      : renderCapture(path, manifest);

  return {
    manifest,
    path,
    rendered,
    // The whole point of the split: a SessionStart hook's stdout becomes model
    // context, so hook mode writes none.
    stdout: hookMode ? "" : rendered,
    stderr: hookMode ? rendered : "",
    exitCode: 0,
  };
}

export function renderCapture(
  path: string,
  manifest: SessionManifest,
): string {
  const lines = [
    `Captured session ${manifest.sessionId}`,
    `  manifest   ${path}`,
    `  artifacts  ${manifest.artifacts.length} hashed`,
  ];
  if (manifest.git !== undefined) {
    lines.push(
      `  commit     ${manifest.git.sha}${manifest.git.branch ? ` (${manifest.git.branch})` : ""}${
        manifest.git.dirty ? " — working tree dirty" : ""
      }`,
    );
  } else {
    lines.push("  commit     not a git repository, or git is unavailable");
  }
  lines.push(`  device     ${manifest.device.id} (${manifest.device.platform})`);
  return lines.join("\n");
}
