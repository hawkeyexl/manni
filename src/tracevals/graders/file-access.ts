/** file-access: assert a file was read/written/edited (or not) in the session. */
import type { TraceGrader } from "./types.js";
import { matchesGlob } from "./glob.js";
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

/** Mirrors FileAccess["op"] in the normalized trace model. */
const OPS = ["read", "write", "edit"] as const;

function validateOptions(options: Options): string | undefined {
  return firstError(
    requiredString(options, "path"),
    optionalEnum(options, "op", OPS),
    optionalEnum(options, "expect", ["accessed", "not-accessed"]),
    validateWhen(options),
  );
}

/**
 * Match a spec against an access, through the one matcher `glob.ts` already
 * documents: separators normalized, case folded, **anchored at a path segment
 * boundary**.
 *
 * A plain `endsWith` was neither of the last two: `db/migrations` also matched
 * `.../legacydb/migrations`, which is a different directory, and the eval read
 * as covering a path it had never been pointed at. A literal path carries no
 * glob metacharacters, so compiling it here resolves to exactly the anchored
 * suffix the docs promise — and a spec that *does* carry `*` or `**` now means
 * here what it means in `options.when`, rather than being taken literally.
 */
function matches(accessPath: string, spec: string): boolean {
  return matchesGlob(accessPath, spec);
}

export const fileAccessGrader: TraceGrader = {
  kind: "file-access",
  validateOptions,
  grade({ trace, plan }) {
    const options = plan.options ?? {};
    const invalid = validateOptions(options);
    if (invalid !== undefined) return optionsError("file-access", invalid);
    const path = options.path as string;
    const op = options.op as string | undefined;
    const expect = (options.expect as string | undefined) ?? "accessed";

    const window = windowFor(trace, plan);
    if (window.empty) return skippedWindow(window);
    const trigger = evaluateWhen(options, window);
    if (!trigger.armed) return skippedTrigger(trigger);
    const accessed = window.fileAccesses.some(
      (a) => matches(a.path, path) && (op === undefined || a.op === op),
    );

    const opLabel = op ?? "any";
    if (expect === "accessed" && !accessed) {
      return fail(plan, `file ${path} was never accessed (op: ${opLabel})`);
    }
    if (expect === "not-accessed" && accessed) {
      return fail(plan, `file ${path} was accessed (op: ${opLabel}) but must not be`);
    }
    return pass;
  },
};
