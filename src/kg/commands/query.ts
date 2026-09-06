/**
 * `manni kg query` — triple-pattern matching over the built graph. Any of
 * s/p/o may be omitted (wildcard). Prefixed names (`dcterms:references`)
 * and full IRIs are accepted; `--o` also matches literal values verbatim.
 */
import { resolve } from "node:path";
import { DataFactory } from "n3";
import { loadConfig } from "../core/config.js";
import { compactIri, expandTerm, loadGraph } from "../core/load.js";
import { byCodeUnit } from "../core/sort.js";

export interface QueryOptions {
  s?: string;
  p?: string;
  o?: string;
  config?: string;
  /** Graph path override (default: config `out`). */
  graph?: string;
  cwd?: string;
}

export interface QueryMatch {
  s: string;
  p: string;
  o: { kind: "iri" | "literal"; value: string; datatype?: string };
}

export interface QueryResult {
  matches: QueryMatch[];
}

export function runQuery(opts: QueryOptions = {}): QueryResult {
  const cwd = opts.cwd ?? process.cwd();
  const config = loadConfig(opts.config, cwd);
  const store = loadGraph(resolve(cwd, opts.graph ?? config.out));

  const s = opts.s ? DataFactory.namedNode(expandTerm(opts.s)) : null;
  const p = opts.p ? DataFactory.namedNode(expandTerm(opts.p)) : null;
  const oValue = opts.o ? expandTerm(opts.o) : null;

  const matches: QueryMatch[] = [];
  for (const quad of store.getQuads(s, p, null, null)) {
    const obj = quad.object;
    if (oValue !== null && obj.value !== oValue) continue;
    matches.push({
      s: quad.subject.value,
      p: quad.predicate.value,
      o:
        obj.termType === "Literal"
          ? {
              kind: "literal",
              value: obj.value,
              ...(obj.datatype &&
              obj.datatype.value !== "http://www.w3.org/2001/XMLSchema#string"
                ? { datatype: obj.datatype.value }
                : {}),
            }
          : { kind: "iri", value: obj.value },
    });
  }

  // Compare field by field rather than joining into one key: every separator
  // choice is wrong in some way. NUL orders correctly (it sorts before any
  // real character) but makes git classify this file as binary, exempting it
  // from the repo's LF normalization. A printable separator like `|` keeps the
  // file text but sorts *after* most characters, which would rank a subject
  // behind one that merely extends it (`…/configuration.md` after
  // `…/configuration.md#advanced`). Field-wise comparison has neither problem
  // and is exactly equivalent to the original NUL-joined ordering.
  matches.sort(
    (a, b) =>
      byCodeUnit(a.s, b.s) ||
      byCodeUnit(a.p, b.p) ||
      byCodeUnit(a.o.kind, b.o.kind) ||
      byCodeUnit(a.o.value, b.o.value),
  );
  return { matches };
}

export function renderQuery(
  result: QueryResult,
  format: "pretty" | "json",
): string {
  if (format === "json") return JSON.stringify(result, null, 2);
  if (result.matches.length === 0) return "No matches.";
  const lines = result.matches.map((m) => {
    const o =
      m.o.kind === "iri"
        ? `<${m.o.value}>`
        : `"${m.o.value}"${m.o.datatype ? `^^${compactIri(m.o.datatype)}` : ""}`;
    return `<${m.s}> ${compactIri(m.p)} ${o}`;
  });
  lines.push(`\n${result.matches.length} match(es)`);
  return lines.join("\n");
}
