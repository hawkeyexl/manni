/**
 * Tool adapter: Doc Detective. Runs procedure tests embedded in a page and
 * reports failed steps. Slow (may drive a browser) — enable it only in
 * dedicated suites. Options:
 *   command: override (default: npx --no-install doc-detective)
 *
 * `--input <page>` and `--exit-on-fail` are always appended, the latter even
 * over a command override: Doc Detective exits 0 on test failures by default,
 * and 4.x writes its results JSON to a file rather than stdout, so without the
 * flag a failing doc test is undetectable and passes silently.
 *
 * Output: on older versions a results JSON may appear on stdout, in which case
 * failed steps are collected from objects with result/status === "FAIL". On 4.x
 * only a coloured terminal summary is printed, so the nonzero exit plus
 * `extractFailureReport` carry the finding. See ADR 01005.
 */
import type { Finding } from "../../types.js";
import { exited } from "../exec.js";
import type { Grader } from "../types.js";
import {
  firstError,
  knownKeys,
  optionalStringArray,
  type OptionCheck,
  type Options,
} from "../options.js";

interface FailedStep {
  description: string;
  detail?: string;
}

/** A FAIL node is only worth reporting if it can name itself. */
function labelFor(record: Record<string, unknown>): string | undefined {
  return (
    (typeof record.description === "string" && record.description) ||
    (typeof record.id === "string" && record.id) ||
    (typeof record.stepId === "string" && record.stepId) ||
    undefined
  );
}

/**
 * Collect FAIL entries, one per failed *step*.
 *
 * Doc Detective repeats FAIL at every level of the results tree — assertion,
 * step, context, test, spec — so collecting every FAIL node reports a single
 * broken step five times. Two rules avoid that:
 *
 *   1. Recurse first. If anything below this node was reported, this node is an
 *      ancestor of a real failure and adds nothing.
 *   2. Only report a node that can name itself (`description`, `id`, or
 *      `stepId`). Assertions carry a FAIL and a `statement` but no label, so
 *      they are skipped in favor of the step that contains them — which is the
 *      node holding the human-readable `description` and `resultDescription`.
 *
 * A FAIL with nothing readable anywhere yields no findings; the caller's
 * nonzero-exit fallback catches that case.
 */
export function collectFailures(node: unknown, out: FailedStep[] = []): FailedStep[] {
  collectInto(node, out);
  return out;
}

/** Returns true when this subtree contributed a finding. */
function collectInto(node: unknown, out: FailedStep[]): boolean {
  if (Array.isArray(node)) {
    let collected = false;
    for (const item of node) collected = collectInto(item, out) || collected;
    return collected;
  }
  if (node == null || typeof node !== "object") return false;
  const record = node as Record<string, unknown>;

  let childCollected = false;
  for (const value of Object.values(record)) {
    if (value != null && typeof value === "object") {
      childCollected = collectInto(value, out) || childCollected;
    }
  }
  if (childCollected) return true;

  const status = record.result ?? record.status;
  if (typeof status !== "string" || status.toUpperCase() !== "FAIL") return false;
  const description = labelFor(record);
  if (description === undefined) return false;

  const detail =
    (typeof record.resultDescription === "string" && record.resultDescription) ||
    (typeof record.message === "string" && record.message) ||
    undefined;
  out.push({ description, detail });
  return true;
}

/**
 * Pull the human-readable failure report out of Doc Detective's terminal
 * output.
 *
 * 4.x writes the results JSON to a *file* and prints only a coloured summary to
 * stdout, so `collectFailures` has nothing to parse. The summary still names
 * each failed step and its error, which beats the alternative: stderr, where
 * the tool emits tens of kilobytes of ajv "strict mode" schema warnings that
 * would otherwise fill the finding message with noise.
 */
export function extractFailureReport(stdout: string): string | undefined {
  // Strip SGR colour codes only — anchored on the ESC byte so literal
  // bracketed text in a message ("Expected one of [0]") survives.
  const clean = stdout.replace(/\u001b\[[0-9;]*m/g, "");
  const start = clean.indexOf("Failed Steps:");
  if (start < 0) return undefined;
  const end = clean.indexOf("===", start);
  const block = (end < 0 ? clean.slice(start) : clean.slice(start, end)).trim();
  return block.length > 0 ? block : undefined;
}

/**
 * Find the last JSON object in mixed stdout (Doc Detective logs, then results).
 *
 * Both ends are searched, because either can be buried in noise: the tool logs
 * before the blob, and may print paths or summaries after it. Anchoring the end
 * on the single last `}` in the whole string breaks as soon as anything
 * trailing contains one — a `{runId}` path segment, an error line, a future
 * reporter — because every candidate then over-runs the JSON and parsing fails
 * for all of them, silently returning undefined.
 *
 * So: walk closing braces backwards from the end (bounded — this is a scan, not
 * a parser) and opening braces forwards, and take the first pair that parses.
 */
const MAX_END_CANDIDATES = 12;

/** Doc Detective may drive a browser; ten minutes is its own default ballpark. */
const DEFAULT_TIMEOUT_MS = 600000;

/** Cap on the failure report carried into a finding message. */
const MAX_REPORT_CHARS = 600;

/** Truncate on a line boundary so a failure entry is never cut mid-sentence. */
function clampReport(report: string): string {
  if (report.length <= MAX_REPORT_CHARS) return report;
  const head = report.slice(0, MAX_REPORT_CHARS);
  const lastNewline = head.lastIndexOf("\n");
  const kept = lastNewline > 0 ? head.slice(0, lastNewline) : head;
  return `${kept.trimEnd()}\n… (truncated)`;
}

export function lastJsonBlob(stdout: string): unknown {
  const firstOpen = stdout.indexOf("{");
  if (firstOpen < 0) return undefined;

  const ends: number[] = [];
  for (
    let e = stdout.lastIndexOf("}");
    e > firstOpen && ends.length < MAX_END_CANDIDATES;
    e = stdout.lastIndexOf("}", e - 1)
  ) {
    ends.push(e);
  }

  for (const end of ends) {
    for (let i = firstOpen; i >= 0 && i < end; i = stdout.indexOf("{", i + 1)) {
      try {
        return JSON.parse(stdout.slice(i, end + 1));
      } catch {
        // keep scanning
      }
    }
  }
  return undefined;
}

export const docDetectiveGrader: Grader = {
  kind: "tool:doc-detective",
  validateOptions(options: Options): OptionCheck {
    return firstError(
      knownKeys(options, ["command"]),
      optionalStringArray(options, "command"),
    );
  },
  mode: "per-file",
  async grade(ctx) {
    const findings: Finding[] = [];
    for (const { plan, eval: ev } of ctx.targets) {
      const commandOverride = ev.options.command as string[] | undefined;
      // No subcommand: Doc Detective 4.x runs tests as its *default* command
      // and rejects `run` with "Unknown argument: run" (ADR 01005).
      //
      // --exit-on-fail is appended unconditionally, including over a command
      // override, because this grader's correctness depends on it: without it
      // Doc Detective exits 0 even when steps fail, and since 4.x also keeps
      // the results JSON out of stdout there is nothing left to detect the
      // failure from — every broken doc test would silently pass.
      const cmd = [
        ...(commandOverride ?? ["npx", "--no-install", "doc-detective"]),
        "--input",
        plan.page.file,
        "--exit-on-fail",
      ];
      const result = await ctx.exec(cmd, {
        cwd: ctx.root,
        timeoutMs: ev.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      });
      if (result.spawnError) {
        findings.push({
          evalName: ev.name,
          file: plan.page.file,
          message: `Failed to run doc-detective: ${result.spawnError} (is it installed?)`,
          severity: ev.severity,
          diagnostic: true,
        });
        continue;
      }
      // A timeout leaves code null, which would otherwise fall through to the
      // nonzero-exit branch and report "doc-detective exited null". Doc
      // Detective can drive a browser, so timeouts are a realistic outcome and
      // deserve their own message — matching commandGrader.
      if (result.timedOut) {
        findings.push({
          evalName: ev.name,
          file: plan.page.file,
          message: `doc-detective timed out after ${ev.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`,
          severity: ev.severity,
          // It was cut off, so it reached no verdict about the page (ADR
          // 01023). `commandGrader` has always marked its timeout this way;
          // this branch was written to match it and did not.
          diagnostic: true,
        });
        continue;
      }
      const blob = lastJsonBlob(result.stdout);
      const failures = blob ? collectFailures(blob) : [];
      if (failures.length > 0) {
        for (const f of failures) {
          findings.push({
            evalName: ev.name,
            file: plan.page.file,
            ruleId: "doc-detective/step",
            message: f.detail ? `${f.description}: ${f.detail}` : f.description,
            severity: ev.severity,
          });
        }
      } else if (result.code !== 0) {
        // Prefer the stdout failure report (4.x) over the stderr tail — stderr
        // is dominated by ajv schema warnings that say nothing about the test.
        const report = extractFailureReport(result.stdout);
        findings.push({
          evalName: ev.name,
          file: plan.page.file,
          ruleId: report ? "doc-detective/step" : undefined,
          message: report
            ? clampReport(report)
            : `doc-detective ${exited(result.code)}: ${result.stderr.trim().slice(-300)}`,
          severity: ev.severity,
          // A readable failure report is a verdict about the page. Without
          // one, all we know is that the tool exited non-zero and said
          // nothing we could parse — which is what an uninstalled or
          // misconfigured doc-detective produces (ADR 01023).
          ...(report ? {} : { diagnostic: true }),
        });
      }
    }
    return findings;
  },
};
