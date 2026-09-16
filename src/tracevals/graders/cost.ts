/**
 * cost: assert the session stayed within cost/token budgets.
 *
 * Deliberately **not** windowed (ADR 01015). Every other deterministic grader
 * counts events, which are attributable to the artifact that was governing when
 * they happened; tokens are not. Usage is reported per assistant message for
 * the whole context, so charging a slice of it to one skill would be an
 * invented number. `cost` therefore grades the session no matter which artifact
 * declared it — including one whose window is empty, where a session that blew
 * its budget must still fail rather than quietly skip.
 */
import type { TraceGrader } from "./types.js";
import { rejectWhen } from "./when.js";
import {
  fail,
  firstError,
  optionalNumber,
  optionsError,
  pass,
  requireOneOf,
  type Options,
} from "./util.js";

function validateOptions(options: Options): string | undefined {
  return firstError(
    requireOneOf(options, ["maxUsd", "maxTokens"]),
    optionalNumber(options, "maxUsd", { min: 0 }),
    optionalNumber(options, "maxTokens", { min: 0 }),
    rejectWhen("cost", options),
  );
}

export const costGrader: TraceGrader = {
  kind: "cost",
  validateOptions,
  grade({ trace, plan }) {
    const options = plan.options ?? {};
    const invalid = validateOptions(options);
    if (invalid !== undefined) return optionsError("cost", invalid);
    const usage = trace.usage;
    // Each configured budget is evaluated independently: a missing-data skip on
    // one must not suppress the other. Only skip the whole eval when no
    // configured budget could be checked at all.
    const skips: string[] = [];
    let checked = false;

    if (typeof options.maxUsd === "number") {
      if (usage?.totalCostUsd === undefined) {
        skips.push("no cost data (maxUsd not checkable)");
      } else {
        checked = true;
        if (usage.totalCostUsd > options.maxUsd) {
          return fail(
            plan,
            `session cost $${usage.totalCostUsd.toFixed(4)}; at most $${options.maxUsd} allowed`,
          );
        }
      }
    }

    if (typeof options.maxTokens === "number") {
      if (usage === undefined) {
        skips.push("no usage data (maxTokens not checkable)");
      } else {
        checked = true;
        const total = usage.inputTokens + usage.outputTokens;
        if (total > options.maxTokens) {
          return fail(
            plan,
            `session used ${total} tokens; at most ${options.maxTokens} allowed`,
          );
        }
      }
    }

    if (!checked && skips.length > 0) {
      return {
        findings: [],
        skipped: `trace carries insufficient cost data: ${skips.join("; ")}`,
      };
    }
    return pass;
  },
};
