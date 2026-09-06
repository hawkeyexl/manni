/**
 * Tool adapter: remark (ADR 01024). Runs once per eval-configuration group
 * (batch) over that group's files and reads the JSON report.
 *
 * Two invocation details are load-bearing, and both are easy to get wrong:
 *
 * - **`--no-stdout`.** Given file arguments and no `--output`, remark prints
 *   the *reformatted document* to stdout. Without this flag the adapter would
 *   be reading a rewritten copy of the page.
 * - **The report is on stderr.** `--report json` writes through
 *   `vfile-reporter-json`, and unified-engine reports to stderr. An adapter
 *   that parsed stdout would find the document there and never the findings.
 *
 * `--frail` is deliberately *not* passed. It exits 1 whenever there are any
 * warnings, which would spend the exit code on the normal case; without it a
 * non-zero exit means something actually went wrong.
 */
import type { Finding } from "../../types.js";
import { exited, outputTail } from "../exec.js";
import {
  groupTargetsByEval,
  type Grader,
  type GraderContext,
  type GraderTarget,
} from "../types.js";
import {
  firstError,
  knownKeys,
  optionalStringArray,
  type OptionCheck,
  type Options,
} from "../options.js";

/** One entry of `vfile-reporter-json`'s output. Fields beyond these are ignored. */
interface RemarkMessage {
  line?: number | null;
  column?: number | null;
  reason?: string;
  ruleId?: string | null;
  source?: string | null;
  fatal?: boolean | null;
}
interface RemarkFile {
  path?: string;
  messages?: RemarkMessage[];
}

const DEFAULT_COMMAND = [
  "npx",
  "--no-install",
  "remark",
  "--no-stdout",
  "--quiet",
  "--report",
  "json",
];

/** Tool paths arrive with the platform separator; targets are always POSIX. */
const posix = (p: string): string => p.replace(/\\/g, "/");

function isRemarkFileList(v: unknown): v is RemarkFile[] {
  return Array.isArray(v) && v.every((e) => typeof e === "object" && e !== null);
}

async function gradeGroup(
  ctx: GraderContext,
  targets: GraderTarget[],
): Promise<Finding[]> {
  const first = targets[0]!;
  const commandOverride = first.eval.options.command as string[] | undefined;
  const files = [...new Set(targets.map((t) => t.plan.page.file))];
  const cmd = [...(commandOverride ?? DEFAULT_COMMAND), ...files];
  const timeoutMs = first.eval.timeoutMs ?? 120000;
  const result = await ctx.exec(cmd, { cwd: ctx.root, timeoutMs });

  /** No verdict was reached, for every target in the batch (ADR 01023). */
  const unreadable = (detail: string): Finding[] =>
    targets.map(({ plan, eval: ev }) => ({
      evalName: ev.name,
      file: plan.page.file,
      ruleId: "remark/unreadable",
      message: detail,
      severity: ev.severity,
      diagnostic: true,
    }));

  if (result.spawnError) {
    return unreadable(`Failed to run remark: ${result.spawnError} (is it installed?)`);
  }
  if (result.timedOut) return unreadable(`remark timed out after ${timeoutMs}ms`);

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stderr.trim());
  } catch {
    return unreadable(
      `remark ${exited(result.code)} without a JSON report: ${outputTail(result)}`,
    );
  }
  if (!isRemarkFileList(parsed)) {
    return unreadable(
      `remark's report was not the expected list of files: ${outputTail(result)}`,
    );
  }

  const byFile = new Map(targets.map((t) => [t.plan.page.file, t.eval] as const));
  const findings: Finding[] = [];
  const unmatched: string[] = [];
  for (const entry of parsed) {
    const messages = Array.isArray(entry.messages) ? entry.messages : [];
    if (messages.length === 0) continue;
    const file = typeof entry.path === "string" ? posix(entry.path) : "";
    const ev = byFile.get(file);
    if (!ev) {
      unmatched.push(file || "(no path)");
      continue;
    }
    for (const m of messages) {
      const rule =
        typeof m.ruleId === "string" && m.ruleId
          ? `${typeof m.source === "string" && m.source ? m.source : "remark"}/${m.ruleId}`
          : undefined;
      findings.push({
        evalName: ev.name,
        file,
        ...(rule ? { ruleId: rule } : {}),
        // A fatal message carries no rule and no position: the file could not
        // be parsed at all, and the JSON reporter drops vfile's `cause` chain
        // that holds the real reason. Say where to find it.
        message:
          m.fatal === true && !rule
            ? `remark could not parse the page: ${m.reason ?? "Cannot process file"} ` +
              `(run \`npx remark ${file}\` for the cause)`
            : (m.reason ?? "remark reported an issue"),
        severity: ev.severity,
        ...(typeof m.line === "number" ? { line: m.line } : {}),
        ...(typeof m.column === "number" ? { col: m.column } : {}),
      });
    }
  }

  // remark is handed an explicit file list, so a reported path that matches no
  // target means the mapping broke — a separator, a relative prefix, a rename.
  // Dropping those quietly is how markdownlint reported nothing for years while
  // its evals passed, so this is loud instead (ADR 01023, ADR 01024).
  if (unmatched.length > 0) {
    findings.push({
      evalName: first.eval.name,
      file: first.plan.page.file,
      ruleId: "remark/unreadable",
      message:
        `remark reported findings for ${unmatched.length} file(s) that could not be matched ` +
        `to a page in this run: ${unmatched.slice(0, 3).join(", ")}`,
      severity: first.eval.severity,
      diagnostic: true,
    });
  }
  return findings;
}

export const remarkGrader: Grader = {
  kind: "tool:remark",
  validateOptions(options: Options): OptionCheck {
    return firstError(
      knownKeys(options, ["command"]),
      optionalStringArray(options, "command"),
    );
  },
  mode: "batch",
  async grade(ctx) {
    const findings: Finding[] = [];
    for (const group of groupTargetsByEval(ctx.targets)) {
      findings.push(...(await gradeGroup(ctx, group)));
    }
    return findings;
  },
};
