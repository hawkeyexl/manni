/**
 * `manni docevals list` — dry-run: show the resolved eval plan for each discovered
 * page without executing anything. The fastest way to debug suite/frontmatter
 * resolution.
 */
import pc from "picocolors";
import { loadConfig } from "../core/config.js";
import { discoverPages } from "../core/discover.js";
import { resolvePages, type ResolvedPagePlan } from "../core/resolve.js";
import { applySelection } from "../core/engine.js";
import {
  parseFormat,
  SUMMARY_FORMATS,
  type SummaryFormat,
} from "../reporters/format.js";

export interface ListOptions {
  config?: string;
  format?: SummaryFormat;
  /** Show only these evals by name (ADR 01018). */
  evalNames?: string[];
  /** Show only evals in this suite. */
  suite?: string;
  cwd?: string;
}

export interface ListRun {
  plans: ResolvedPagePlan[];
  /** 0 = clean, 1 = resolution errors present. */
  exitCode: 0 | 1;
}

export function runList(globs: string[], options: ListOptions = {}): ListRun {
  const cwd = options.cwd ?? process.cwd();
  const config = loadConfig(options.config, cwd);
  const pages = discoverPages(config, globs, cwd);
  const plans = resolvePages(pages, config);
  // `false`: list executes nothing, so an eval that resolves but is skipped is
  // a legitimate answer here — and this is the command `run`'s empty-match
  // error tells the user to reach for.
  applySelection(plans, config, options, false);
  const hasErrors = plans.some((p) =>
    p.problems.some((pr) => pr.level === "error"),
  );
  return { plans, exitCode: hasErrors ? 1 : 0 };
}

export function renderList(run: ListRun, format: SummaryFormat): string {
  // Exported from src/index.ts, so library callers reach this without the CLI
  // parser in front. Falling through to the human renderer is the silent
  // degradation ADR 01007 removes; it is no less silent off the CLI path.
  parseFormat(format, SUMMARY_FORMATS, "format");
  if (format === "json") {
    return JSON.stringify(
      run.plans.map((p) => ({
        file: p.page.file,
        skip: p.skip,
        suite: p.suite,
        evals: p.evals.map((e) => ({
          name: e.name,
          suite: e.suite,
          type: e.type,
          grader: e.grader,
          source: e.source,
          skip: e.skip,
          hasCommand: e.command != null,
          assertion: e.assertion,
        })),
        problems: p.problems,
      })),
      null,
      2,
    );
  }

  const lines: string[] = [];
  for (const plan of run.plans) {
    const suite = plan.suite ? pc.dim(` (suite: ${plan.suite})`) : "";
    const skip = plan.skip ? pc.yellow(" [skipped]") : "";
    lines.push(`${pc.bold(plan.page.file)}${suite}${skip}`);
    if (plan.evals.length === 0 && plan.problems.length === 0) {
      lines.push(pc.dim("  no evals"));
    }
    for (const e of plan.evals) {
      const bits = [
        pc.cyan(e.grader),
        e.type,
        e.source === "page" ? "page" : "config",
      ];
      if (e.grader === "command" && !e.command) bits.push(pc.yellow("needs generation"));
      if (e.skip) bits.push(pc.yellow("skip"));
      lines.push(`  - ${e.name} ${pc.dim(`[${bits.join(", ")}]`)}`);
    }
    for (const pr of plan.problems) {
      const tag = pr.level === "error" ? pc.red("error") : pc.yellow("warn");
      const line = pr.line != null ? pc.dim(`:${pr.line}`) : "";
      lines.push(`  ${tag}${line} ${pr.message}`);
    }
  }
  const total = run.plans.reduce((n, p) => n + p.evals.length, 0);
  lines.push("");
  lines.push(pc.dim(`${run.plans.length} pages, ${total} evals resolved`));
  return lines.join("\n");
}
