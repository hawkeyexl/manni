/** tool-usage: assert a tool was used / not used / used within count bounds. */
import type { TraceGrader } from "./types.js";
import { evaluateWhen, skippedTrigger, validateWhen } from "./when.js";
import {
  fail,
  firstError,
  optionalBoolean,
  optionalEnum,
  optionalNumber,
  optionsError,
  orderedBounds,
  pass,
  requiredString,
  skippedWindow,
  windowFor,
  type Options,
} from "./util.js";

/**
 * A criterion that can never pass is as useless as one that can never fail:
 * `expect: not-used` with `min >= 1` demands the tool be both absent and
 * called, and `expect: used` with `max: 0` is the mirror image.
 */
function checkContradiction(options: Options): string | undefined {
  const expect = (options.expect as string | undefined) ?? "used";
  const { min, max } = options;
  if (expect === "not-used" && typeof min === "number" && min > 0) {
    return "options.min is unsatisfiable with expect: not-used";
  }
  if (expect === "used" && typeof max === "number" && max === 0) {
    return "options.max of 0 is unsatisfiable with expect: used";
  }
  return undefined;
}

function validateOptions(options: Options): string | undefined {
  return firstError(
    requiredString(options, "tool"),
    optionalEnum(options, "expect", ["used", "not-used"]),
    optionalNumber(options, "min", { min: 0, integer: true }),
    optionalNumber(options, "max", { min: 0, integer: true }),
    orderedBounds(options, "min", "max"),
    checkContradiction(options),
    optionalBoolean(options, "includeSidechains"),
    validateWhen(options),
  );
}

export const toolUsageGrader: TraceGrader = {
  kind: "tool-usage",
  validateOptions,
  grade({ trace, plan }) {
    const options = plan.options ?? {};
    const invalid = validateOptions(options);
    if (invalid !== undefined) return optionsError("tool-usage", invalid);
    const tool = options.tool as string;
    const expect = (options.expect as string | undefined) ?? "used";
    const includeSidechains = options.includeSidechains === true;

    // Count only the calls the artifact was governing (ADR 01015).
    const window = windowFor(trace, plan);
    if (window.empty) return skippedWindow(window);
    const trigger = evaluateWhen(options, window);
    if (!trigger.armed) return skippedTrigger(trigger);

    // `includeSidechains` asks whether calls from *somebody else's* branch
    // count toward this artifact. Inside an agent's own window there is no
    // such thing: every call in a branch is `sidechain: true`, so honouring
    // the default there emptied the window and made an agent-artifact eval
    // structurally unable to fail — `{tool: Edit, expect: not-used}` on
    // `.claude/agents/reviewer.md` passed however much the reviewer edited.
    // The window *is* the branch, so the branch's calls are the subject.
    // Agent only, deliberately. An agent window *is* a branch, so its calls
    // are the subject. A skill or slash-command window sits on the chain that
    // invoked it, so sidechain calls inside it belong to subagents it spawned
    // — someone else's work, excluded unless asked for. A slash command reached
    // from inside a branch would count nothing by default; that needs a user to
    // type one there, which is not a path the harness offers.
    const branchScoped = window.scope === "agent";
    const count = window.toolCalls.filter(
      (c) => c.name === tool && (branchScoped || includeSidechains || !c.sidechain),
    ).length;

    if (expect === "not-used" && count > 0) {
      return fail(plan, `tool ${tool} was used ${count} time(s) but must not be`);
    }
    if (expect === "used" && count === 0 && options.min === undefined) {
      return fail(plan, `tool ${tool} was never used`);
    }
    if (typeof options.min === "number" && count < options.min) {
      return fail(
        plan,
        `tool ${tool} was used ${count} time(s); at least ${options.min} required`,
      );
    }
    if (typeof options.max === "number" && count > options.max) {
      return fail(
        plan,
        `tool ${tool} was used ${count} time(s); at most ${options.max} allowed`,
      );
    }
    return pass;
  },
};
