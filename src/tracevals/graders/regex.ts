/** regex: assert a pattern does/doesn't appear in session text. */
import type { TraceGrader } from "./types.js";
import { evaluateWhen, skippedTrigger, validateWhen } from "./when.js";
import {
  fail,
  firstError,
  optionalEnum,
  optionsError,
  pass,
  requiredString,
  skippedWindow,
  windowFor,
  type Options,
} from "./util.js";
import { readTarget } from "../core/target.js";

/** Flags are checked alone first, so the message names the actual culprit. */
function checkFlags(options: Options): string | undefined {
  const flags = options.flags;
  if (flags === undefined) return undefined;
  if (typeof flags !== "string") return "options.flags must be a string";
  try {
    new RegExp("", flags);
  } catch (err) {
    return `options.flags is invalid: ${(err as Error).message}`;
  }
  return undefined;
}

/**
 * Pattern and flags must be validated *together*, exactly as `grade()` builds
 * them: `a{` is legal on its own but not under the `u` flag, so checking them
 * separately would pass options that then throw at grade time.
 */
function checkPattern(options: Options): string | undefined {
  const required = requiredString(options, "pattern");
  if (required !== undefined) return required;
  try {
    new RegExp(options.pattern as string, (options.flags as string) ?? "");
  } catch (err) {
    return `options.pattern is not a valid regular expression: ${(err as Error).message}`;
  }
  return undefined;
}

function validateOptions(options: Options): string | undefined {
  return firstError(
    checkFlags(options),
    checkPattern(options),
    optionalEnum(options, "on", ["assistant", "user", "all"]),
    optionalEnum(options, "expect", ["match", "no-match"]),
    validateWhen(options),
  );
}

export const regexGrader: TraceGrader = {
  kind: "regex",
  validateOptions,
  grade({ trace, plan, projectRoot }) {
    const options = plan.options ?? {};
    const invalid = validateOptions(options);
    if (invalid !== undefined) return optionsError("regex", invalid);
    const pattern = options.pattern as string;
    const re = new RegExp(pattern, (options.flags as string | undefined) ?? "");
    const on = (options.on as string | undefined) ?? "assistant";
    const expect = (options.expect as string | undefined) ?? "match";

    const window = windowFor(trace, plan);
    if (window.empty) return skippedWindow(window);
    const trigger = evaluateWhen(options, window);
    if (!trigger.armed) return skippedTrigger(trigger);

    // Two axes that compose rather than compete. `target` picks the *subject*
    // — the session, its final answer, the files it wrote, the artifact — and
    // `on` picks the *speaker* within a transcript. Only the transcript has
    // speakers, so `on` applies there and nowhere else. Both read the window
    // this artifact governed (ADR 01015), never the whole session.
    const target = plan.target ?? "transcript";
    let corpus: string[];
    let where: string;
    if (target === "transcript") {
      corpus =
        on === "user"
          ? window.userMessages
          : on === "all"
            ? [...window.userMessages, ...window.assistantTexts]
            : window.assistantTexts;
      where = `${on} text`;
    } else {
      const selected = readTarget(target, {
        trace,
        // Never consulted: `transcript` took the branch above.
        renderedTrace: "",
        artifactContent: plan.artifact.content,
        root: projectRoot ?? trace.cwd,
      });
      if (!selected.ok) return optionsError("regex", selected.reason);
      corpus = [selected.text];
      where = selected.label;
    }
    const matched = corpus.some((text) => re.test(text));

    if (expect === "match" && !matched) {
      return fail(plan, `pattern /${pattern}/ never matched ${where}`);
    }
    if (expect === "no-match" && matched) {
      return fail(plan, `pattern /${pattern}/ matched ${where} but must not`);
    }
    return pass;
  },
};
