/**
 * `term list -f csv`: one row per term for a script, `id,label,alt-labels,abstract`.
 * A list is joined with `|`, and a cell is quoted as RFC 4180 says.
 */
import type { Term } from "../types.js";

const LIST_SEPARATOR = "|";

function cell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function renderListCsv(terms: readonly Term[]): string {
  const rows = [
    ["id", "label", "alt-labels", "abstract"],
    ...terms.map((t) => [
      t.id,
      t.record.label,
      (t.record["alt-labels"] ?? []).join(LIST_SEPARATOR),
      t.record.abstract ?? "",
    ]),
  ];
  return rows.map((row) => row.map(cell).join(",")).join("\n");
}
