/**
 * `manni tracevals release`: return a session's lease on the model host
 * (proposal 0079). The SessionEnd hook runs it with the envelope on stdin, and
 * then nothing goes to stdout. A person runs it with `--all` to free the
 * memory now.
 */
import { parseHookPayload, readStdin } from "../capture/hook.js";
import { renderRelease } from "../reporters/conformance.js";
import type { SummaryFormat } from "../reporters/index.js";
import { releaseHost, type ReleaseResult } from "../rules/host.js";
import { TracevalsError } from "../types.js";

export interface ReleaseReport extends ReleaseResult {
  exitCode: number;
}

export interface ReleaseOptions {
  /** The hook payload. Undefined reads stdin; "" means there was none. */
  stdin?: string;
  /** Drop every lease, unload every model and stop the host. */
  all?: boolean;
  format?: SummaryFormat;
}

export interface ReleaseCommandResult {
  report: ReleaseReport;
  rendered: string;
  /** Empty under a hook envelope. */
  stdout: string;
  exitCode: number;
}

export async function runRelease(options: ReleaseOptions = {}): Promise<ReleaseCommandResult> {
  const raw = options.stdin ?? (await readStdin());
  const hookMode = raw.trim() !== "";
  const sessionId = hookMode ? parseHookPayload(raw).sessionId : undefined;
  let result: ReleaseResult;
  if (options.all === true) result = await releaseHost({ all: true });
  else if (sessionId !== undefined) result = await releaseHost({ sessionId });
  else throw new TracevalsError("release needs a session from a SessionEnd hook, or --all");
  const report: ReleaseReport = { ...result, exitCode: 0 };
  const rendered =
    options.format === "json" ? JSON.stringify(report, null, 2) : renderRelease(report);
  return { report, rendered, stdout: hookMode ? "" : rendered, exitCode: 0 };
}
