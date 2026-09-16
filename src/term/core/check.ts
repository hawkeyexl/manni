/**
 * `term check`'s rules (proposal 0052 § 7): the referential integrity of a term
 * set. Pure: it reads records and references and returns findings, so the
 * command core owns every file and the rules are tested on sets built inline.
 *
 * Every label comparison ignores case, because the Vale style `write -f vale`
 * renders is a `swap` map keyed on the lowercased term. Two labels that differ
 * only in case collide there silently, so they collide here out loud.
 */
import { DEFAULT_ABSTRACT_MAX_LENGTH } from "./config.js";
import { resolveSeverity, ruleId } from "./severity.js";
import type { Term, TermField, TermFinding, TermRule, TermSet, TermSeverity } from "../types.js";

export interface CheckTermSetOptions {
  severity?: Partial<Record<TermRule, TermSeverity>>;
  /** Default `DEFAULT_ABSTRACT_MAX_LENGTH`. */
  abstractMaxLength?: number;
}

/** The fields whose values name other entries. */
const REFERENCE_FIELDS = ["broader", "narrower", "related-terms", "see"] as const;
type ReferenceField = (typeof REFERENCE_FIELDS)[number];

interface Draft {
  rule: TermRule;
  message: string;
  file: string;
  line?: number;
  id?: string;
  field?: TermField;
}

export function checkTermSet(set: TermSet, opts: CheckTermSetOptions = {}): TermFinding[] {
  const levels = resolveSeverity(opts.severity);
  const maxLength = opts.abstractMaxLength ?? DEFAULT_ABSTRACT_MAX_LENGTH;
  const { terms } = set;
  const drafts: Draft[] = [];

  const fold = (value: string): string => value.toLowerCase();
  const where = (t: Term): string => `${t.location.file}:${String(t.location.line)}`;
  const onEntry = (t: Term, rule: TermRule, message: string, field?: TermField): Draft => ({
    rule,
    message,
    file: t.location.file,
    line: (field === undefined ? undefined : t.location.fieldLines[field]) ?? t.location.line,
    id: t.id,
    ...(field === undefined ? {} : { field }),
  });

  // The first entry claiming each folded label, and each folded id.
  const byLabel = new Map<string, number>();
  const byId = new Map<string, number>();
  terms.forEach((t, index) => {
    const label = fold(t.record.label);
    if (!byLabel.has(label)) byLabel.set(label, index);
    const id = fold(t.id);
    if (!byId.has(id)) byId.set(id, index);
  });
  const resolveReference = (value: string): number | undefined =>
    byLabel.get(fold(value)) ?? byId.get(fold(value));

  // undefined-term, and the folded labels some page names, for unused-term.
  const referenced = new Set<string>();
  for (const reference of set.references) {
    const label = fold(reference.label);
    referenced.add(label);
    if (byLabel.has(label)) continue;
    let message = `concepts: "${reference.label}" names no entry.`;
    const synonym = terms.find((t) => (t.record["alt-labels"] ?? []).some((alt) => fold(alt) === label));
    if (synonym !== undefined) {
      message += ` "${synonym.record.label}" lists it as an alt-label.`;
    }
    drafts.push({
      rule: "undefined-term",
      message,
      file: reference.file,
      ...(reference.line === undefined ? {} : { line: reference.line }),
    });
  }

  // duplicate-id: exact, on every entry sharing the id.
  const sharing = new Map<string, Term[]>();
  for (const t of terms) {
    const group = sharing.get(t.id);
    if (group === undefined) sharing.set(t.id, [t]);
    else group.push(t);
  }
  for (const group of sharing.values()) {
    if (group.length < 2) continue;
    for (const t of group) {
      const others = group.filter((other) => other !== t).map(where);
      drafts.push(onEntry(t, "duplicate-id", `id: "${t.id}" is also used by ${others.join(", ")}`));
    }
  }

  terms.forEach((t, index) => {
    // label-collision: on each later entry, naming the first.
    const first = byLabel.get(fold(t.record.label));
    const firstTerm = first === undefined ? undefined : terms[first];
    if (first !== undefined && first !== index && firstTerm !== undefined) {
      drafts.push(
        onEntry(
          t,
          "label-collision",
          `"${t.record.label}" is claimed by ${where(firstTerm)} as "${firstTerm.record.label}"`,
          "label",
        ),
      );
    }

    // alt-label-collision: an alt-label that is another entry's label.
    for (const alt of t.record["alt-labels"] ?? []) {
      const owner = terms.find((other, otherIndex) => otherIndex !== index && fold(other.record.label) === fold(alt));
      if (owner !== undefined) {
        drafts.push(
          onEntry(t, "alt-label-collision", `alt-labels: "${alt}" is the label of ${where(owner)}`, "alt-labels"),
        );
      }
    }

    // dangling-reference: one finding per value that resolves to nothing.
    for (const field of REFERENCE_FIELDS) {
      for (const value of referenceValues(t, field)) {
        if (resolveReference(value) === undefined) {
          drafts.push(onEntry(t, "dangling-reference", `${field}: "${value}" names no entry`, field));
        }
      }
    }

    // see-not-empty: a redirect carries no definition.
    if (t.record.see !== undefined && t.record.definition !== undefined) {
      drafts.push(
        onEntry(t, "see-not-empty", `see: "${t.record.see}" redirects this entry, so remove its definition`, "see"),
      );
    }

    // abstract-too-long.
    const abstract = t.record.abstract;
    if (abstract !== undefined && abstract.length > maxLength) {
      drafts.push(
        onEntry(
          t,
          "abstract-too-long",
          `abstract: ${String(abstract.length)} characters is over the limit of ${String(maxLength)}, so shorten it`,
          "abstract",
        ),
      );
    }

    // unused-term: no reference names the label.
    if (!referenced.has(fold(t.record.label))) {
      drafts.push(onEntry(t, "unused-term", "no page's concepts: names this term"));
    }
  });

  // The resolved hierarchy, one edge per pair.
  const edges = (field: "broader" | "narrower"): Set<number>[] =>
    terms.map((t) => {
      const targets = new Set<number>();
      for (const value of referenceValues(t, field)) {
        const target = resolveReference(value);
        if (target !== undefined) targets.add(target);
      }
      return targets;
    });
  const broader = edges("broader");
  const narrower = edges("narrower");

  // asymmetric-hierarchy: each missing half, on the entry that should carry it.
  terms.forEach((t, index) => {
    for (const parent of broader[index] ?? []) {
      const parentTerm = terms[parent];
      if (parentTerm !== undefined && !(narrower[parent]?.has(index) ?? false)) {
        drafts.push(
          onEntry(
            parentTerm,
            "asymmetric-hierarchy",
            `narrower: omits "${t.record.label}", which lists this entry as broader`,
            "narrower",
          ),
        );
      }
    }
    for (const child of narrower[index] ?? []) {
      const childTerm = terms[child];
      if (childTerm !== undefined && !(broader[child]?.has(index) ?? false)) {
        drafts.push(
          onEntry(
            childTerm,
            "asymmetric-hierarchy",
            `broader: omits "${t.record.label}", which lists this entry as narrower`,
            "broader",
          ),
        );
      }
    }
  });

  // broader-cycle: every elementary cycle once, found from its earliest entry.
  for (const [start, path] of broaderCycles(broader)) {
    const startTerm = terms[start];
    if (startTerm === undefined) continue;
    const labels = [...path, start].map((index) => terms[index]?.record.label ?? "");
    drafts.push(onEntry(startTerm, "broader-cycle", `broader: ${labels.join(" > ")}`, "broader"));
  }

  const findings: TermFinding[] = [];
  for (const draft of drafts) {
    const level = levels[draft.rule];
    if (level === "off") continue;
    findings.push({
      rule: draft.rule,
      ruleId: ruleId(draft.rule),
      severity: level,
      message: draft.message,
      file: draft.file,
      ...(draft.line === undefined ? {} : { line: draft.line }),
      ...(draft.id === undefined ? {} : { id: draft.id }),
      ...(draft.field === undefined ? {} : { field: draft.field }),
    });
  }
  return findings.sort(compareFindings);
}

function referenceValues(t: Term, field: ReferenceField): string[] {
  const value = t.record[field];
  if (value === undefined) return [];
  return typeof value === "string" ? [value] : value;
}

/**
 * Each elementary cycle of the `broader` graph, as its start and the path from
 * it. A search from `start` only visits later entries, so a cycle is found
 * exactly once, from the entry of it that comes first in set order.
 */
function broaderCycles(broader: readonly Set<number>[]): [number, number[]][] {
  const cycles: [number, number[]][] = [];
  for (let start = 0; start < broader.length; start++) {
    const path: number[] = [start];
    const onPath = new Set<number>([start]);
    const walk = (node: number): void => {
      for (const next of broader[node] ?? []) {
        if (next === start) {
          cycles.push([start, [...path]]);
        } else if (next > start && !onPath.has(next)) {
          path.push(next);
          onPath.add(next);
          walk(next);
          path.pop();
          onPath.delete(next);
        }
      }
    };
    walk(start);
  }
  return cycles;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareFindings(a: TermFinding, b: TermFinding): number {
  return (
    compareText(a.file, b.file) ||
    (a.line ?? 0) - (b.line ?? 0) ||
    compareText(a.ruleId, b.ruleId) ||
    compareText(a.message, b.message)
  );
}
