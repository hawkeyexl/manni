/**
 * `term check`'s rules (proposal 0052 § 7): the referential integrity of a term
 * set. Pure: it reads records and references and returns findings, so the
 * command core owns every file and the rules are tested on sets built inline.
 *
 * Every label comparison ignores case, because the Vale style `write -f vale`
 * renders is a `swap` map keyed on the lowercased term. Two labels that differ
 * only in case collide there silently, so they collide here out loud. Ids
 * compare ignoring case too, because references resolve them that way.
 *
 * A set may hold one term per language, joined on `id` (proposal 0084). A term
 * with no language counts as `en`, and languages compare ignoring case. Across
 * languages, two labels collide only when they differ in spelling but not in
 * case: `API` in en and de is one word, `Kubernetes`/`kubernetes` is a clash.
 *
 * The hierarchy is the concept scheme's (proposal 0086): every term's
 * `broader` and `narrower`, plus every page's `graph:` block. A name on a page
 * resolves as the graph resolves it, by label, then id, then alt-label.
 */
import { TERM_RELATION_FIELDS } from "../../shared/reference-fields.js";
import { DEFAULT_ABSTRACT_MAX_LENGTH } from "./config.js";
import { DEFAULT_LANGUAGE, languageKey as language } from "./writers/render-util.js";
import { resolveSeverity, ruleId } from "./severity.js";
import { TERM_MATCH_FIELDS, type Term, type TermField, type TermFinding, type TermRule, type TermSet, type TermSeverity } from "../types.js";

export interface CheckTermSetOptions {
  severity?: Partial<Record<TermRule, TermSeverity>>;
  /** Default `DEFAULT_ABSTRACT_MAX_LENGTH`. */
  abstractMaxLength?: number;
}

/** The fields whose values name other entries. */
const REFERENCE_FIELDS = TERM_RELATION_FIELDS;
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

  // The first entry claiming each folded label, id and alt-label, overall
  // and per language.
  const byLabel = new Map<string, number>();
  const byId = new Map<string, number>();
  const inLanguage = new Map<string, number>();
  const byAlt = new Map<string, number>();
  // Every entry per folded label, in set order, for the collision rules.
  const labelled = new Map<string, number[]>();
  const claim = (map: Map<string, number>, key: string, index: number): void => {
    if (!map.has(key)) map.set(key, index);
  };
  terms.forEach((t, index) => {
    claim(byLabel, fold(t.record.label), index);
    const group = labelled.get(fold(t.record.label));
    if (group === undefined) labelled.set(fold(t.record.label), [index]);
    else group.push(index);
    claim(byId, fold(t.id), index);
    claim(inLanguage, `${language(t)} label ${fold(t.record.label)}`, index);
    claim(inLanguage, `${language(t)} id ${fold(t.id)}`, index);
    for (const alt of t.record["alt-labels"] ?? []) {
      claim(byAlt, fold(alt), index);
      claim(inLanguage, `${language(t)} alt ${fold(alt)}`, index);
    }
  });
  /** Whether `t`'s label `a` collides with `other`'s label `b`: within a language when they fold alike, across languages only when their spelling differs too. */
  const clash = (t: Term, a: string, other: Term, b: string): boolean =>
    fold(a) === fold(b) && (language(t) === language(other) || a !== b);
  /** The first entry other than `index` whose label collides with `value` on `t`, among those `before` allows. */
  const collider = (t: Term, index: number, value: string, before: boolean): Term | undefined => {
    for (const otherIndex of labelled.get(fold(value)) ?? []) {
      if (otherIndex === index || (before && otherIndex > index)) continue;
      const other = terms[otherIndex];
      if (other !== undefined && clash(t, value, other, other.record.label)) return other;
    }
    return undefined;
  };

  // A same-language label, then a same-language id, then any language.
  const resolveReference = (from: Term, value: string): number | undefined =>
    inLanguage.get(`${language(from)} label ${fold(value)}`) ??
    inLanguage.get(`${language(from)} id ${fold(value)}`) ??
    byLabel.get(fold(value)) ??
    byId.get(fold(value));

  // A name on a page, as the graph resolves it: a label or an id, then an
  // alt-label, each in the page's language before any other.
  const pageLanguage = (lang: string | undefined): string => (lang ?? DEFAULT_LANGUAGE).toLowerCase();
  const resolveLabelOrId = (value: string, lang: string | undefined): number | undefined =>
    inLanguage.get(`${pageLanguage(lang)} label ${fold(value)}`) ??
    inLanguage.get(`${pageLanguage(lang)} id ${fold(value)}`) ??
    byLabel.get(fold(value)) ??
    byId.get(fold(value));
  const resolveAlt = (value: string, lang: string | undefined): number | undefined =>
    inLanguage.get(`${pageLanguage(lang)} alt ${fold(value)}`) ?? byAlt.get(fold(value));
  const resolveName = (value: string, lang: string | undefined): number | undefined =>
    resolveLabelOrId(value, lang) ?? resolveAlt(value, lang);

  // undefined-term and alt-label-reference, and the ids some page names, for unused-term.
  const usedIds = new Set<string>();
  for (const reference of set.references) {
    const field = reference.field ?? "concepts";
    const at = { file: reference.file, ...(reference.line === undefined ? {} : { line: reference.line }) };
    const named = resolveLabelOrId(reference.label, reference.language);
    const synonym = named === undefined ? resolveAlt(reference.label, reference.language) : undefined;
    const target = terms[named ?? synonym ?? -1];
    if (target !== undefined) usedIds.add(fold(target.id));
    if (named !== undefined) continue;
    drafts.push(
      target === undefined
        ? { rule: "undefined-term", message: `${field}: "${reference.label}" names no entry.`, ...at }
        : {
            rule: "alt-label-reference",
            message: `${field}: "${reference.label}" is an alt-label of "${target.record.label}", so name the label.`,
            ...at,
          },
    );
  }

  // duplicate-id: ignoring case, as references resolve ids, on every entry
  // sharing the id in one language.
  const sharing = new Map<string, Term[]>();
  for (const t of terms) {
    const id = `${language(t)} ${fold(t.id)}`;
    const group = sharing.get(id);
    if (group === undefined) sharing.set(id, [t]);
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
    const firstTerm = collider(t, index, t.record.label, true);
    if (firstTerm !== undefined) {
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
      const owner = collider(t, index, alt, false);
      if (owner !== undefined) {
        drafts.push(
          onEntry(t, "alt-label-collision", `alt-labels: "${alt}" is the label of ${where(owner)}`, "alt-labels"),
        );
      }
    }

    // dangling-reference: one finding per value that resolves to nothing.
    for (const field of REFERENCE_FIELDS) {
      for (const value of referenceValues(t, field)) {
        if (resolveReference(t, value) === undefined) {
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

    // missing-definition: an entry that neither defines its term nor redirects.
    if (t.record.see === undefined && t.record.definition === undefined) {
      drafts.push(
        onEntry(t, "missing-definition", "definition: missing, so write one or run manni term fill.", "definition"),
      );
    }

    // conflicting-matches: once per IRI, naming the first kind it is under and the next.
    const kindOf = new Map<string, TermField>();
    const conflicting = new Set<string>();
    for (const field of TERM_MATCH_FIELDS) {
      for (const iri of t.record[field] ?? []) {
        const first = kindOf.get(iri);
        if (first === undefined) kindOf.set(iri, field);
        else if (first !== field && !conflicting.has(iri)) {
          conflicting.add(iri);
          drafts.push(
            onEntry(t, "conflicting-matches", `${first}: "${iri}" is also in ${field}, and a mapping has one kind.`, first),
          );
        }
      }
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

    // unused-term: no reference resolves to any term sharing the id.
    if (!usedIds.has(fold(t.id))) {
      drafts.push(onEntry(t, "unused-term", "no page's concepts: names this term"));
    }
  });

  // The resolved hierarchy, one edge per pair.
  const edges = (field: "broader" | "narrower"): Set<number>[] =>
    terms.map((t) => {
      const targets = new Set<number>();
      for (const value of referenceValues(t, field)) {
        const target = resolveReference(t, value);
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

  // The concept scheme's hierarchy, child to parent: every term's broader and
  // narrower, then every graph block's. A name no term claims is a freeform
  // node of its own, after the terms.
  const names = terms.map((t) => t.record.label);
  const freeform = new Map<string, number>();
  const node = (value: string, lang: string | undefined): number => {
    const index = resolveName(value, lang) ?? freeform.get(fold(value));
    if (index !== undefined) return index;
    freeform.set(fold(value), names.length);
    names.push(value);
    return names.length - 1;
  };
  const up: Set<number>[] = [];
  const termEdges = new Set<string>();
  const blockEdges = new Map<string, { file: string; line?: number }>();
  const link = (child: number, parent: number): string => {
    (up[child] ??= new Set()).add(parent);
    return `${String(child)}>${String(parent)}`;
  };
  broader.forEach((parents, child) => {
    for (const parent of parents) termEdges.add(link(child, parent));
  });
  narrower.forEach((children, parent) => {
    for (const child of children) termEdges.add(link(child, parent));
  });
  for (const block of set.blocks) {
    const subject = node(block.label, block.language);
    for (const edge of block.edges) {
      if (edge.field === "related-concepts") continue;
      const other = node(edge.value, block.language);
      const key = edge.field === "broader" ? link(subject, other) : link(other, subject);
      const line = edge.line ?? block.line;
      if (!blockEdges.has(key)) blockEdges.set(key, { file: block.file, ...(line === undefined ? {} : { line }) });
    }
  }

  // broader-cycle: every elementary cycle once, found from its earliest node.
  // A cycle the terms close alone sits on that entry; one a block edge closes
  // sits on the first such edge's page.
  for (const [start, path] of broaderCycles(up)) {
    const chain = [...path, start];
    const message = `broader: ${chain.map((index) => names[index] ?? "").join(" > ")}`;
    const hops = path.map((from, i) => `${String(from)}>${String(chain[i + 1])}`);
    const viaBlock = hops.find((hop) => !termEdges.has(hop));
    const startTerm = terms[start];
    if (viaBlock === undefined && startTerm !== undefined) {
      drafts.push(onEntry(startTerm, "broader-cycle", message, "broader"));
    } else {
      const at = blockEdges.get(viaBlock ?? "");
      if (at !== undefined) drafts.push({ rule: "broader-cycle", message, ...at });
    }
  }

  // hierarchy-outside-termbase: a block whose label is a term gives it an edge
  // the term's own field does not list. Values compare as concepts, by id.
  const concept = (index: number | undefined, value: string): string => {
    const t = index === undefined ? undefined : terms[index];
    return t === undefined ? `name ${fold(value)}` : `id ${fold(t.id)}`;
  };
  for (const block of set.blocks) {
    const t = terms[resolveName(block.label, block.language) ?? -1];
    if (t === undefined) continue;
    for (const edge of block.edges) {
      const field = edge.field === "related-concepts" ? "related-terms" : edge.field;
      const listed = referenceValues(t, field).map((value) => concept(resolveReference(t, value), value));
      if (listed.includes(concept(resolveName(edge.value, block.language), edge.value))) continue;
      const kind = t.location.construct === "page" ? "page" : "entry";
      const line = edge.line ?? block.line;
      drafts.push({
        rule: "hierarchy-outside-termbase",
        message: `graph: ${edge.field} "${edge.value}" on "${t.record.label}" is not on its term ${kind} (${t.location.file}), so add it there.`,
        file: block.file,
        ...(line === undefined ? {} : { line }),
      });
    }
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
