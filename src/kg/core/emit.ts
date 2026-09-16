/**
 * Deterministic Turtle serialization — the git-diff contract. Canonical form:
 * fixed sorted prefix header; subjects sorted by full IRI; within a subject,
 * rdf:type first (as `a`), then predicates sorted by full IRI; objects sorted
 * (IRIs before literals, each lexicographic); LF line endings, UTF-8, exactly
 * one trailing newline. Byte-identical output for any input quad order.
 *
 * Deliberately not N3.Writer: its formatting is incidental library behavior.
 * Correctness of escaping is guarded by a round-trip test through n3's parser.
 */
import type { Quad, Term } from "./derive.js";
import { byCodeUnit } from "./sort.js";
import { NS, PREFIXES, RDF_TYPE } from "./vocab.js";

/** Conservative PN_LOCAL: shorten only when the local name is trivially safe. */
const SAFE_LOCAL = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/**
 * Percent-encode characters the Turtle IRIREF production forbids
 * (controls, space, <>"{}|^` and backslash) so output always parses,
 * whatever made it into a node value.
 */
// Forbidden by IRIREF: <>"{}|^ plus backtick and backslash.
const ILLEGAL_IRI_CHARS = '<>"{}|^\x60\x5c';

function sanitizeIri(iriValue: string): string {
  let out = "";
  for (const ch of iriValue) {
    const code = ch.codePointAt(0) as number;
    const illegal = code <= 0x20 || ILLEGAL_IRI_CHARS.includes(ch);
    out += illegal
      ? "%" + code.toString(16).toUpperCase().padStart(2, "0")
      : ch;
  }
  return out;
}

/**
 * Memo: the same predicates/objects recur once per quad; shorten each once.
 * Cleared at the start of every emit so long-lived embedders don't accumulate
 * every IRI ever serialized.
 */
const shortenMemo = new Map<string, string>();

function shorten(iriValue: string): string {
  const memoized = shortenMemo.get(iriValue);
  if (memoized !== undefined) return memoized;
  let result: string | undefined;
  for (const [prefix, ns] of PREFIXES) {
    if (iriValue.startsWith(ns)) {
      const local = iriValue.slice(ns.length);
      if (SAFE_LOCAL.test(local)) {
        result = `${prefix}:${local}`;
        break;
      }
    }
  }
  result ??= `<${sanitizeIri(iriValue)}>`;
  shortenMemo.set(iriValue, result);
  return result;
}

function escapeLiteral(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

const INTEGER = `${NS.xsd}integer`;
const INTEGER_RE = /^-?\d+$/;

function renderTerm(term: Term): string {
  if (term.kind === "iri") return shorten(term.value);
  if (term.datatype === INTEGER && INTEGER_RE.test(term.value))
    return term.value;
  const quoted = `"${escapeLiteral(term.value)}"`;
  return term.datatype ? `${quoted}^^${shorten(term.datatype)}` : quoted;
}

/** Sort objects: IRIs before literals, each lexicographically. */
function compareTerms(a: Term, b: Term): number {
  if (a.kind !== b.kind) return a.kind === "iri" ? -1 : 1;
  const byValue = byCodeUnit(a.value, b.value);
  if (byValue !== 0) return byValue;
  const da = a.kind === "literal" ? (a.datatype ?? "") : "";
  const db = b.kind === "literal" ? (b.datatype ?? "") : "";
  return byCodeUnit(da, db);
}

export function emitTurtle(quads: Quad[]): string {
  shortenMemo.clear();
  const lines: string[] = [];
  for (const [prefix, ns] of PREFIXES) {
    lines.push(`@prefix ${prefix}: <${ns}> .`);
  }

  // subject → predicate → terms
  const subjects = new Map<string, Map<string, Term[]>>();
  for (const quad of quads) {
    let preds = subjects.get(quad.s);
    if (!preds) {
      preds = new Map();
      subjects.set(quad.s, preds);
    }
    let terms = preds.get(quad.p);
    if (!terms) {
      terms = [];
      preds.set(quad.p, terms);
    }
    terms.push(quad.o);
  }

  const sortedSubjects = [...subjects.keys()].sort(byCodeUnit);
  for (const subject of sortedSubjects) {
    const preds = subjects.get(subject)!;
    const sortedPreds = [...preds.keys()].sort((a, b) => {
      if (a === RDF_TYPE) return b === RDF_TYPE ? 0 : -1;
      if (b === RDF_TYPE) return 1;
      return byCodeUnit(a, b);
    });

    lines.push("");
    const entries = sortedPreds.map((p, i) => {
      const objects = [...preds.get(p)!]
        .sort(compareTerms)
        .map(renderTerm)
        .join(", ");
      const pred = p === RDF_TYPE ? "a" : shorten(p);
      const terminator = i === sortedPreds.length - 1 ? " ." : " ;";
      return { pred, objects, terminator };
    });

    const first = entries[0]!;
    lines.push(
      `${shorten(subject)} ${first.pred} ${first.objects}${first.terminator}`,
    );
    for (const entry of entries.slice(1)) {
      lines.push(`  ${entry.pred} ${entry.objects}${entry.terminator}`);
    }
  }

  return `${lines.join("\n")}\n`;
}
