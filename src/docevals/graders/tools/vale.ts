/**
 * Tool adapter: Vale. Runs once per eval-configuration group with
 * --output=JSON:
 *   { "path.md": [{ Check, Message, Line, Span, Severity }, ...], ... }
 * Vale's own severities map through the eval's severityMap
 * (default: error→error, warning→warning, suggestion→info).
 */
import type { Finding, Severity } from "../../types.js";
import { groupTargetsByEval, type Grader, type GraderContext, type GraderTarget } from "../types.js";
import {
  firstError,
  knownKeys,
  optionalStringArray,
  type OptionCheck,
  type Options,
} from "../options.js";

interface ValeIssue {
  Check?: string;
  Message?: string;
  Line?: number;
  Span?: [number, number];
  Severity?: string;
}

const DEFAULT_SEVERITY_MAP: Record<string, Severity> = {
  error: "error",
  warning: "warning",
  suggestion: "info",
};

async function gradeGroup(
  ctx: GraderContext,
  targets: GraderTarget[],
): Promise<Finding[]> {
  const first = targets[0]!;
  const commandOverride = first.eval.options.command as string[] | undefined;
  const files = [...new Set(targets.map((t) => t.plan.page.file))];
  const result = await ctx.exec(
    [...(commandOverride ?? ["vale", "--output=JSON"]), ...files],
    { cwd: ctx.root, timeoutMs: first.eval.timeoutMs ?? 120000 },
  );
  if (result.spawnError) {
    return targets.map(({ plan, eval: ev }) => ({
      evalName: ev.name,
      file: plan.page.file,
      message: `Failed to run vale: ${result.spawnError ?? "spawn failed"} (is it installed?)`,
      severity: ev.severity,
      diagnostic: true,
    }));
  }

  let parsed: Record<string, ValeIssue[]>;
  try {
    parsed = JSON.parse(result.stdout) as Record<string, ValeIssue[]>;
  } catch {
    // Vale prints config errors to stderr with a nonzero exit and no JSON.
    return targets.map(({ plan, eval: ev }) => ({
      evalName: ev.name,
      file: plan.page.file,
      message: `Vale produced no JSON output: ${result.stderr.trim().slice(-300)}`,
      severity: ev.severity,
      diagnostic: true,
    }));
  }

  const byFile = new Map(targets.map((t) => [t.plan.page.file, t.eval] as const));
  const findings: Finding[] = [];
  for (const [file, issues] of Object.entries(parsed)) {
    const normalized = file.replace(/\\/g, "/");
    const ev = byFile.get(normalized);
    if (!ev) continue;
    const severityMap = { ...DEFAULT_SEVERITY_MAP, ...(ev.severityMap ?? {}) };
    for (const issue of issues) {
      findings.push({
        evalName: ev.name,
        file: normalized,
        ruleId: issue.Check,
        message: issue.Message ?? "Vale issue",
        severity: severityMap[issue.Severity ?? "warning"] ?? "warning",
        line: issue.Line,
        col: issue.Span?.[0],
      });
    }
  }
  return findings;
}

export const valeGrader: Grader = {
  kind: "tool:vale",
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
