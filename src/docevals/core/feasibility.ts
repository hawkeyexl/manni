/**
 * Pre-run feasibility: evals that cannot reach a verdict as configured.
 *
 * ADRs 01020 and 01022 already make an eval that reached no verdict a failure
 * rather than a pass — but they do it at grade time, which for an `ai` eval is
 * after the judge has been paid. Everything here is knowable from the resolved
 * config and page alone, so it is knowable before a single call goes out.
 *
 * `claude plugin eval` computes the same class of thing and prints it up
 * front, on the reasoning that an infeasible check scores zero in every arm
 * and reads as "the tool found nothing" rather than as "you configured this
 * wrong". That is exactly the confusion worth spending a cheap static pass to
 * avoid.
 *
 * Scope is deliberately narrow: only what *configuration* makes impossible,
 * and only where nothing already answers it. Whether `vale` is on PATH is a
 * runtime fact ADR 01020 covers; an unknown grader kind is already an errored
 * result in the engine; and an `ai` eval with no assertion is already rejected
 * by both schemas at parse time, with a better message than this could give.
 * A second answer to a settled question is worse than none.
 */
import { graderFor } from "../graders/registry.js";
import type { RunProblem } from "./engine.js";
import type { ResolvedPagePlan } from "./resolve.js";

export interface FeasibilityOptions {
  /** Whether frontmatter-declared commands may run in this invocation. */
  allowFrontmatterCommands: boolean;
  /** Whether script generation can supply a missing command. */
  canGenerate: boolean;
  /** `--deterministic-only`: ai evals are not run, so not checked. */
  deterministicOnly?: boolean;
  /** `--ai-only`: deterministic evals are not run, so not checked. */
  aiOnly?: boolean;
}

export function checkFeasibility(
  plans: ResolvedPagePlan[],
  options: FeasibilityOptions,
): RunProblem[] {
  const problems: RunProblem[] = [];
  for (const plan of plans) {
    if (plan.skip) continue;
    for (const ev of plan.evals) {
      if (ev.skip) continue;
      // Only what this run would actually execute. A filtered run reporting a
      // configuration error about work it never attempted is the shape ADR
      // 01018 guards against: numbers about one thing, a verdict about another.
      const isAi = ev.grader === "ai";
      if (isAi && options.deterministicOnly === true) continue;
      if (!isAi && ev.grader !== "human" && options.aiOnly === true) continue;
      const where = `Eval "${ev.name}"`;

      // Grader options. The published vocabulary leaves `options` open and
      // says the grader validates it; this is where that happens for every
      // grader at once, before any of them run.
      const grader = graderFor(ev.grader);
      const invalid = grader?.validateOptions?.(ev.options);
      if (invalid !== undefined) {
        problems.push({
          file: plan.page.file,
          level: "error",
          message: `${where}: ${ev.grader} ${invalid}`,
        });
      }

      // A page-declared command that may not run, and cannot be generated
      // either, can only ever be skipped — so it is a gate that checks
      // nothing, which is the failure mode worth naming out loud.
      if (
        ev.grader === "command" &&
        ev.source === "page" &&
        !options.allowFrontmatterCommands &&
        !ev.command &&
        !options.canGenerate
      ) {
        problems.push({
          file: plan.page.file,
          level: "error",
          message:
            `${where}: a page-declared command eval with no command, while ` +
            `frontmatter commands are not granted (execution.allow: ` +
            `[frontmatter-commands]) and generation is off — it can only ever ` +
            `be skipped`,
        });
      }
    }
  }
  return problems;
}
