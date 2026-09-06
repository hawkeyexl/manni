/**
 * Tool adapter: markdownlint-cli2. Runs once per eval-configuration group
 * (batch) over that group's files and parses the default text output, which
 * comes in two shapes depending on the tool's version:
 *
 *   path/to/file.md:12:3 MD013/line-length Line length [Expected: 80 ...]
 *   path/to/file.md:9 MD041/first-line-heading First line ...
 *   path/to/file.md:6:81 error MD013/line-length Line length [Expected: 80 ...]
 *
 * The third is 0.23's, with a severity token between the position and the rule
 * id. Without it in the pattern nothing matched, every finding was dropped,
 * and the eval passed on a page full of issues (ADR 01023).
 */
import type { Finding } from "../../types.js";
import { outputTail } from "../exec.js";
import { groupTargetsByEval, type Grader, type GraderContext, type GraderTarget } from "../types.js";
import {
  firstError,
  knownKeys,
  optionalStringArray,
  type OptionCheck,
  type Options,
} from "../options.js";

const LINE =
  /^(.+?):(\d+)(?::(\d+))?\s+(?:(?:error|warning)\s+)?(MD\d+(?:\/[\w-]+)*)\s+(.*)$/;

export function parseMarkdownlintOutput(output: string): {
  file: string;
  line: number;
  col?: number;
  ruleId: string;
  message: string;
}[] {
  const results = [];
  for (const raw of output.split(/\r?\n/)) {
    const m = LINE.exec(raw.trim());
    if (!m) continue;
    results.push({
      file: m[1]!.replace(/\\/g, "/"),
      line: Number(m[2]),
      col: m[3] ? Number(m[3]) : undefined,
      ruleId: m[4]!,
      message: m[5]!,
    });
  }
  return results;
}

async function gradeGroup(
  ctx: GraderContext,
  targets: GraderTarget[],
): Promise<Finding[]> {
  const first = targets[0]!;
  const commandOverride = first.eval.options.command as string[] | undefined;
  const files = [...new Set(targets.map((t) => t.plan.page.file))];
  const cmd = [
    ...(commandOverride ?? ["npx", "--no-install", "markdownlint-cli2"]),
    ...files,
  ];
  const result = await ctx.exec(cmd, {
    cwd: ctx.root,
    timeoutMs: first.eval.timeoutMs ?? 120000,
  });
  if (result.spawnError) {
    return targets.map(({ plan, eval: ev }) => ({
      evalName: ev.name,
      file: plan.page.file,
      message: `Failed to run markdownlint-cli2: ${result.spawnError ?? "spawn failed"} (is it installed?)`,
      severity: ev.severity,
      diagnostic: true,
    }));
  }

  const byFile = new Map(targets.map((t) => [t.plan.page.file, t.eval] as const));
  const findings: Finding[] = [];
  // markdownlint-cli2 writes findings to stderr; parse both streams to be safe.
  for (const item of parseMarkdownlintOutput(
    `${result.stderr}\n${result.stdout}`,
  )) {
    const ev = byFile.get(item.file);
    if (!ev) continue; // Output for a file we didn't target.
    findings.push({
      evalName: ev.name,
      file: item.file,
      ruleId: item.ruleId,
      message: item.message,
      severity: ev.severity,
      line: item.line,
      col: item.col,
    });
  }
  // markdownlint-cli2 exits 1 *because* it found issues, so a non-zero code is
  // not itself a problem — but a non-zero code with nothing parseable, or a
  // timeout, means the run said nothing about these files. Neither was checked
  // at all: only `spawnError` was, so a timed-out or misconfigured run
  // returned no findings and every eval in the batch passed. That is the
  // silent green ADR 01020 opened on, still open here (ADR 01023).
  if (findings.length === 0 && (result.timedOut || result.code !== 0)) {
    const why = result.timedOut
      ? `timed out after ${first.eval.timeoutMs ?? 120000}ms`
      : result.code === null
        ? "was killed before exiting"
        : `exited ${result.code} without output this grader could read`;
    const tail = outputTail(result);
    return targets.map(({ plan, eval: ev }) => ({
      evalName: ev.name,
      file: plan.page.file,
      message: `markdownlint-cli2 ${why}${tail ? `: ${tail}` : ""}`,
      severity: ev.severity,
      diagnostic: true,
    }));
  }
  return findings;
}

export const markdownlintGrader: Grader = {
  kind: "tool:markdownlint",
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
