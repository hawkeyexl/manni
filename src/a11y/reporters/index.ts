/**
 * The a11y reporters render a `CheckRun` to a string. The command layer writes
 * the result to stdout; diagnostics go to stderr separately.
 */
import { A11yError, type CheckRun } from "../types.js";
import { renderGithub } from "./github.js";
import { renderJson } from "./json.js";
import { renderPretty } from "./pretty.js";

export { renderGithub, annotationLevel } from "./github.js";
export type { AnnotationLevel } from "./github.js";
export { renderJson } from "./json.js";
export { renderPretty } from "./pretty.js";

/**
 * Every value `--format` accepts, in the order help and error messages list
 * them. Stated once, so the union, the guard, the option text and the error
 * cannot drift apart. SARIF and JUnit are deferred (proposal 0035).
 */
export const A11Y_FORMATS = ["pretty", "json", "github"] as const;
export type A11yFormat = (typeof A11Y_FORMATS)[number];

/** `"pretty | json | github"`, for messages and help text. */
export const A11Y_FORMAT_LIST: string = A11Y_FORMATS.join(" | ");

export function isA11yFormat(value: string): value is A11yFormat {
  return (A11Y_FORMATS as readonly string[]).includes(value);
}

export interface RenderOptions {
  /** From shared `shouldColor`. */
  color: boolean;
  /** pretty only: hide pages with no remaining violations. */
  quiet: boolean;
}

/** Returns the full text without a trailing newline; `github` returns "" when clean. */
export function render(format: A11yFormat, run: CheckRun, opts: RenderOptions): string {
  switch (format) {
    case "pretty":
      return renderPretty(run, opts);
    case "json":
      return renderJson(run);
    case "github":
      return renderGithub(run);
    default: {
      // Exhaustive: a format added to `A11Y_FORMATS` without a case here is a
      // compile error; the throw is for a caller who bypassed the guard.
      const unreachable: never = format;
      throw new A11yError(
        `Unknown report format ${JSON.stringify(unreachable)}. Use ${A11Y_FORMAT_LIST}.`,
      );
    }
  }
}
