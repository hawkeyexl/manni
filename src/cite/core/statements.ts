/**
 * The marker scanner lives in `src/shared/statements.ts`, which cite and meta
 * share (proposal 0099). This module keeps cite's import path and adds the one
 * piece that is cite's alone: rendering a new marker, whose refusal is a
 * `CiteError`.
 */
import { CiteError } from "../errors.js";
import { statementForms, type StatementForm } from "../../shared/statements.js";

export * from "../../shared/statements.js";

/** The form `formatStatement` writes for a format, or a refusal naming the format. */
function writtenForm(format: string): StatementForm {
  const form = statementForms(format)[0];
  if (!form) {
    throw new CiteError(`No marker syntax for format "${format}".`);
  }
  return form;
}

/** Render a marker in the format's first form, e.g. `<!-- cite fetch-timeout -->`. */
export function formatStatement(
  format: string,
  payload: { kind: "ref"; ids: readonly [string, ...string[]] },
): string {
  const form = writtenForm(format);
  // `[comment]: # (`, `// (` and `.. (` hug their parentheses; the comment
  // forms take a space inside each delimiter.
  const pad = form.open.endsWith("(") ? "" : " ";
  return `${form.open}${pad}cite ${payload.ids.join(" ")}${pad}${form.close}`;
}

