/**
 * The one sentence every reporter prints about a scoped run: what `--since`
 * and `--newer-than` narrowed it to (ADR 01040). Built here once so the
 * formats cannot word the same scope three ways.
 */
import type { EngineReport } from "../core/engine.js";

export interface ScopeLine {
  /** Nothing was selected, so nothing was evaluated. */
  empty: boolean;
  /** The sentence, with `code` applied to the ref (backticks in Markdown). */
  text: (code?: (s: string) => string) => string;
}

/** The scope sentence for `report`, or `undefined` when the run was not scoped. */
export function scopeLine(report: EngineReport): ScopeLine | undefined {
  const sc = report.since ?? report.newerThan;
  if (sc === undefined) return undefined;
  const { pagesSelected, pagesTotal } = sc;
  const ref = report.since?.ref;
  const window = report.newerThan?.duration;
  return {
    empty: pagesSelected === 0,
    text: (code = (s) => s) => {
      const what = [
        ref === undefined ? undefined : `since ${code(ref)}`,
        window === undefined ? undefined : `in the last ${window}`,
      ]
        .filter((s) => s !== undefined)
        .join(" and ");
      return pagesSelected === 0
        ? `No pages changed ${what} — nothing was evaluated.`
        : `Scoped to ${String(pagesSelected)} of ${String(pagesTotal)} page(s) changed ${what}.`;
    },
  };
}
