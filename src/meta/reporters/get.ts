/**
 * Reporter for `get`.
 *
 * `render()` in ./index.ts is keyed to ValidationResult/RunSummary, so `get`
 * gets its own renderer, exactly as `fill` does. It lived inline in
 * `src/cli.ts` until `--quiet` arrived and made the question "who decides what
 * is printed?" answerable in two places at once.
 *
 * `--quiet` is a **reporter** concern, not a core one. `GetOptions` /
 * `GetFileResult` are public API, and a programmatic caller handed a silently
 * filtered array cannot tell a filtered run from an empty one — so `runGet`
 * returns every file it read, and the filtering happens here, where it only
 * affects text a person is reading.
 */
import type { GetFileResult } from "../commands/get.js";
import { compareDerived, type DerivedValue } from "../core/derive/types.js";
import { palette } from "../../shared/color.js";

export interface GetReportOptions {
  color?: boolean;
  /** In pretty output, omit files where every requested field is unset. */
  quiet?: boolean;
}

/** `(unset)` for a missing field; JSON for anything that is not a string. */
export function stringifyValue(value: unknown): string {
  if (value === undefined) return "(unset)";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/**
 * The evidence as the source wrote it, so the reader can check the claim
 * without re-running — minus a trailing `(<value>)` that repeats the derived
 * value, since the value is already on the line. The git source spells a date
 * fact `body changed in 424f71a (2026-09-07)` so that it stands alone in
 * `query`'s `_sources` column, where nothing else names the date.
 */
function evidenceOf(d: DerivedValue): string {
  const repeated = ` (${stringifyValue(d.value)})`;
  return d.evidence.endsWith(repeated)
    ? d.evidence.slice(0, -repeated.length)
    : d.evidence;
}

/**
 * The annotation after a resolved value (proposal 0043): which side the value
 * came from, and — when the two sides disagree — what the other one says.
 * Five cases, and only five:
 *
 * 1. asserted, with no derived value or no derivable field → `(asserted)`
 * 2. nothing asserted, a source answered → `(derived, <source>: <evidence>)`
 * 3. both, agreeing as `validate` judges it → `(asserted)`
 * 4. both, disagreeing → `(asserted; <source> says <value>, <evidence>)`
 * 5. neither → nothing at all; the value already prints `(unset)`
 *
 * Case 4 is the drift `validate` files as `derived:stale`. The asserted value
 * is what prints, because that is what the page publishes, and the evidence
 * is named beside it rather than in place of it.
 */
function annotation(r: GetFileResult, field: string): string {
  const origin = r.origin?.[field];
  if (origin === undefined) return "";
  const d = r.derived?.[field] ?? null;
  if (origin === "derived") {
    // Unreachable with null evidence — `origin` only says `derived` when a
    // source answered — but the record is public API, so a caller that built
    // one by hand gets a plain line rather than a crash.
    return d == null ? "" : ` (derived, ${d.source}: ${evidenceOf(d)})`;
  }
  if (d == null) return " (asserted)";
  // Judged as `validate` judges it, with lists as multisets, so the two can
  // never disagree about whether a value is drift.
  if (compareDerived(field, r.resolved?.[field], d).status === "current") {
    return " (asserted)";
  }
  return ` (asserted; ${d.source} says ${stringifyValue(d.value)}, ${evidenceOf(d)})`;
}

/**
 * One `<file>: <field>=<value>` line per requested field per file. The value
 * is the **resolved** one where the run derived (proposal 0043), followed by
 * the annotation saying which side answered; under `--no-derived` it is what
 * the document stores, with no annotation at all.
 *
 * `quiet` hides a file only when **every** requested field is unset, judged
 * after resolving — so a page whose only `owner` comes from CODEOWNERS is
 * shown, where before the flag hid it. A file where one field resolved and
 * another did not is still printed, `(unset)` included: the flag hides files,
 * never values, so `--quiet` can never be the reason a value the user asked
 * for went missing.
 */
export function renderGet(
  results: GetFileResult[],
  fields: string[],
  opts: GetReportOptions = {},
): string {
  const c = palette(opts.color ?? false);
  const lines: string[] = [];
  for (const r of results) {
    // Checked before `quiet`, deliberately. An unparseable file resolves no
    // values, so the quiet rule below would hide the one file the reader most
    // needs to see — and `--quiet` must never be the reason a missing value
    // goes unexplained, which is the same rule that keeps it hiding files
    // rather than values.
    if (r.error !== undefined) {
      lines.push(`${c.dim(`${r.file}:`)} ${c.red(`(parse) ${r.error}`)}`);
      continue;
    }
    // What the line reports: the resolved value where the run derived, and
    // what the document stores where it did not. `--quiet` reads the same
    // record, so it hides a file only when nothing at all answered for it.
    const effective = r.resolved ?? r.values;
    if (opts.quiet && fields.every((f) => effective[f] === undefined)) continue;
    for (const f of fields) {
      const note = annotation(r, f);
      const suffix = note === "" ? "" : c.dim(note);
      lines.push(
        `${c.dim(`${r.file}:`)} ${f}=${stringifyValue(effective[f])}${suffix}`,
      );
    }
  }
  return lines.join("\n");
}
