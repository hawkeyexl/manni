/**
 * Conditional triggers (ADR 01016): `options.when` arms an eval only for the
 * sessions it is about.
 *
 * The point is to make the *absence* of an artifact checkable. You cannot hang
 * an eval on a skill that never loaded — nothing resolves it, so nothing plans
 * it — but you can hang it on `CLAUDE.md`, which resolves for every session.
 * `when` is what lets that always-planned eval stay quiet on the sessions it
 * has nothing to say about.
 *
 * **A trigger that does not fire is `skipped`, never `pass`.** A check that
 * never armed has not been satisfied, and reporting it as a pass would make a
 * green report out of an eval that never ran — the same reasoning that makes an
 * empty window a skip (ADR 01015).
 *
 * **`when` is a general trigger, not one grader's feature.** Every windowed
 * grader routes its options through `validateWhen` and its window through
 * `evaluateWhen`, because `options` is an open bag: a grader that merely
 * ignored an unrecognised `when` would leave the eval armed on every session,
 * which is the exact failure this module exists to prevent. `cost` and
 * `json-output` are the abstainers, and they say so: both grade the whole
 * session rather than a window (ADR 01015), so there is nothing to evaluate a
 * predicate over, and `rejectWhen` turns the option into a loud error.
 *
 * Predicates are pure trace facts, evaluated over the artifact's window, and
 * every listed one must hold.
 *
 * `options` is an open object by schema decree — "validated by the grader at
 * run time — a grader's options evolve on the grader's schedule" — so this
 * costs no schema change and no upstream docmeta proposal (ADR 01010).
 */
import { matchesGlob } from "./glob.js";
import type { TraceWindow } from "./util.js";
import type { Options } from "./util.js";

/**
 * One condition, defined once.
 *
 * The three facets used to live in three unlinked places — the name list, the
 * validator's type grouping, and the evaluator's if-chain — so adding a
 * condition meant three coordinated edits, and an incomplete one failed
 * *silently in the arming direction*: an unvalidated key would be rejected as
 * unknown, but an unevaluated one would simply never constrain anything.
 * Keeping them together makes an incomplete condition a type error.
 */
interface Condition {
  /** Rejects a malformed value without a trace, for `fill` (ADR 01004). */
  validate(value: unknown): string | undefined;
  /** True when the condition holds over the window. */
  test(value: unknown, window: TraceWindow): boolean;
  /** The half of the reason that names what was missing. */
  reason(value: unknown, window: TraceWindow): string;
}

const stringValue =
  (kind: string) =>
  (value: unknown): string | undefined =>
    typeof value === "string" && value.length > 0
      ? undefined
      : `options.when.${kind} must be a string`;

/**
 * Compiled once per pattern, as `globToRegExp` does. The pattern is fixed by
 * the artifact, so rebuilding it for every eval on every trace of a batch is
 * work with no new answer. No `g` flag here, so a shared instance carries no
 * `lastIndex` between calls.
 */
const prompts = new Map<string, RegExp>();

function promptRe(pattern: string): RegExp {
  const cached = prompts.get(pattern);
  if (cached !== undefined) return cached;
  const built = new RegExp(pattern);
  prompts.set(pattern, built);
  return built;
}

const CONDITIONS = {
  "file-access": {
    validate: stringValue("file-access"),
    test: (value, window) =>
      window.fileAccesses.some((a) => matchesGlob(a.path, value as string)),
    reason: (value) => `no file matching "${value as string}" was accessed`,
  },
  "tool-used": {
    validate: stringValue("tool-used"),
    test: (value, window) => window.toolCalls.some((c) => c.name === value),
    reason: (value) => `the ${value as string} tool was never used`,
  },
  "prompt-matches": {
    validate: (value) => {
      const shape = stringValue("prompt-matches")(value);
      if (shape !== undefined) return shape;
      try {
        new RegExp(value as string);
      } catch (err) {
        return `options.when.prompt-matches is not a valid regular expression: ${(err as Error).message}`;
      }
      return undefined;
    },
    test: (value, window) => {
      const re = promptRe(value as string);
      return window.userMessages.some((text) => re.test(text));
    },
    reason: (value) => `no prompt matched /${value as string}/`,
  },
  "turn-count-above": {
    validate: (value) => {
      if (typeof value !== "number" || !Number.isInteger(value)) {
        return "options.when.turn-count-above must be a whole number";
      }
      if (value < 0) return "options.when.turn-count-above must be at least 0";
      return undefined;
    },
    test: (value, window) => window.turnCount > (value as number),
    reason: (value, window) =>
      `${window.turnCount} turn(s) is not more than ${value as number}`,
  },
} satisfies Record<string, Condition>;

/** Every recognised condition. Unknown keys are an error, never ignored. */
export const WHEN_CONDITIONS = Object.keys(
  CONDITIONS,
) as readonly WhenCondition[];

export type WhenCondition = keyof typeof CONDITIONS;

/** What a trigger decided, and — when it did not fire — why. */
export interface TriggerResult {
  armed: boolean;
  /** Reason phrase for the skip; set only when `armed` is false. */
  reason?: string;
}

/**
 * Validate `options.when` without a trace, so `fill` can ground-check a
 * proposal before writing it (ADR 01004).
 *
 * An unrecognised condition is rejected rather than dropped. A silently
 * ignored `file-acess` would leave the eval armed on every session — the loud
 * failure is the safe one, and it mirrors how `metadata.eval*` reserves its
 * own prefix in `src/evals/extract.ts`.
 */
export function validateWhen(options: Options): string | undefined {
  const when = options.when;
  if (when === undefined) return undefined;
  if (typeof when !== "object" || when === null || Array.isArray(when)) {
    return "options.when must be an object of conditions";
  }
  const conditions = when as Record<string, unknown>;
  const keys = Object.keys(conditions);
  if (keys.length === 0) {
    // A trigger with no conditions arms on every session, which is the same as
    // having no trigger — but reads like a scoped check.
    return `options.when needs at least one of: ${WHEN_CONDITIONS.join(", ")}`;
  }
  for (const key of keys) {
    const condition = (CONDITIONS as Record<string, Condition>)[key];
    if (condition === undefined) {
      return `options.when.${key} is not a known condition; expected one of: ${WHEN_CONDITIONS.join(", ")}`;
    }
    const invalid = condition.validate(conditions[key]);
    if (invalid !== undefined) return invalid;
  }
  return undefined;
}

/**
 * Decide whether the trigger fires over a window. Conjunctive: the first
 * condition that fails names itself in the reason, so a skipped eval says
 * which half of its trigger was missing rather than only that it was.
 *
 * Evaluation walks `WHEN_CONDITIONS`, not the caller's key order, so the
 * reason a skip carries is stable across two spellings of the same trigger.
 */
export function evaluateWhen(options: Options, window: TraceWindow): TriggerResult {
  const when = options.when as Record<string, unknown> | undefined;
  if (when === undefined) return { armed: true };

  for (const name of WHEN_CONDITIONS) {
    const value = when[name];
    if (value === undefined) continue;
    const condition = CONDITIONS[name] as Condition;
    if (condition.test(value, window)) continue;
    return {
      armed: false,
      reason: `trigger not met (${window.label}): ${condition.reason(value, window)}`,
    };
  }

  return { armed: true };
}

/**
 * Reject `when` outright, for a grader that has no window to evaluate it over.
 *
 * Silence is the one answer not available. `options` is an open bag, so a
 * `when` a grader neither evaluates nor rejects validates clean and is
 * ignored — and an ignored trigger is an eval left armed on every session,
 * which is precisely the outcome its author wrote `when` to avoid. `cost` is
 * unwindowed by design (ADR 01015) and `json-output` reads the session's final
 * text; for both, the honest answer is that the option does not apply.
 */
export function rejectWhen(kind: string, options: Options): string | undefined {
  if (options.when === undefined) return undefined;
  return (
    `options.when is not supported by the ${kind} grader, ` +
    "which grades the whole session rather than a window"
  );
}

/**
 * The skip a grader returns for an unfired trigger. One helper rather than one
 * per grader, so every grader's wording — and the fact that it is a skip and
 * not a pass — comes from a single place.
 */
export function skippedTrigger(trigger: TriggerResult): {
  findings: never[];
  skipped: string;
} {
  return { findings: [], skipped: trigger.reason ?? "trigger not met" };
}
