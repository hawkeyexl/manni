/**
 * Process execution for graders. The implementation now lives in
 * `@hawkeyexl/inference`: the judge's subprocess provider and the
 * command/tool graders were running two copies of the same cross-spawn
 * wrapper, and the Windows-specific parts — npm `.cmd` shim resolution
 * without `shell: true`, stdin piping past the ~32K command-line limit, and
 * StringDecoder-backed output so multi-byte UTF-8 survives chunk boundaries —
 * are exactly the parts worth having in one place.
 *
 * Re-exported rather than repointed at every call site, so existing
 * `graders/exec.js` imports keep working unchanged.
 */
import type { ExecResult } from "@hawkeyexl/inference";

export { realExec } from "@hawkeyexl/inference";

/** Truncate command output for finding messages. */
export function outputTail(result: ExecResult, maxChars = 400): string {
  const text = (result.stderr.trim() || result.stdout.trim()).trim();
  if (text.length <= maxChars) return text;
  return `…${text.slice(-maxChars)}`;
}

/**
 * How a finished process is described in a finding: "exited 2", or the truth
 * when there was no exit code.
 *
 * `code` is null when the process was killed by a signal rather than exiting.
 * "exited null" describes nothing a reader can act on, and it is the case a
 * timeout produces — so it is the one worth naming.
 */
export function exited(code: number | null): string {
  return code === null ? "was killed before exiting" : `exited ${code}`;
}
