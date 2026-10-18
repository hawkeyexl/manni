/**
 * `x-manni-term` (proposal 0086 §6): a field whose string values must name
 * terms in the termbase, optionally below one branch of its hierarchy.
 *
 * The keyword is registered on every Ajv meta builds (validator.ts), next to
 * `x-manni-encrypt`, and like it records where it was evaluated, at any depth.
 * Ajv's own resolution is the walker, so a mark counts through `$ref`, `allOf`
 * and a referenced built-in. `Validator.termMarks` is the one question
 * `validate` asks of it. `fill` reads the marks from a candidate's subschema
 * instead, since the value it asks for is not there yet.
 *
 * The termbase is the one the family's term label source returns
 * (`src/shared/term-labels.ts`). The hierarchy is each term's `broader` and
 * `narrower`, read in both directions and resolved by label or id.
 */
import type { TermLabel } from "../../shared/term-labels.js";

/** The schema keyword. */
export const TERM_KEYWORD = "x-manni-term";

/** The keyword's argument: an object with an optional `under` label or id. */
export interface TermMark {
  under?: string;
}

/**
 * validate's three findings about a marked value. Builtin-shaped refs like
 * `location:external`, so the rule ids are `term:undefined/term`,
 * `term:outside-branch/term` and `term:alt-label/term`.
 */
export const TERM_UNDEFINED_SCHEMA = "term:undefined";
export const TERM_OUTSIDE_BRANCH_SCHEMA = "term:outside-branch";
export const TERM_ALT_LABEL_SCHEMA = "term:alt-label";
/** The `keyword` all three findings carry. */
export const TERM_FINDING_KEYWORD = "term";

/** The meta-schema Ajv checks the argument against when a schema compiles. */
export const TERM_MARK_META_SCHEMA = {
  type: "object",
  properties: { under: { type: "string" } },
  additionalProperties: false,
} as const;

export function isTermMark(value: unknown): value is TermMark {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const under: unknown = (value as Record<string, unknown>)["under"];
  return under === undefined || typeof under === "string";
}

/** The term a value names, and whether it named it by an alt-label. */
export interface TermMatch {
  /** The term's id, folded: the key `below` answers in. */
  key: string;
  /** The term's preferred label. */
  label: string;
  alt: boolean;
}

/** The termbase as the keyword reads it. */
export interface TermScheme {
  /** The term `value` names by label or id, else by alt-label, ignoring case. */
  find(value: string): TermMatch | undefined;
  /** The keys of every term below `under`, at any depth; `undefined` when `under` names no term. */
  below(under: string): ReadonlySet<string> | undefined;
  /** The preferred labels, of the terms in `keys` when given. */
  labels(keys?: ReadonlySet<string>): string[];
}

const fold = (value: string): string => value.toLowerCase();

export function termScheme(terms: readonly TermLabel[]): TermScheme {
  // A term in several languages is several entries sharing one id.
  const byName = new Map<string, TermLabel>();
  for (const term of terms) {
    byName.set(fold(term.id), term);
    byName.set(fold(term.label), term);
  }
  const byAlt = new Map<string, TermLabel>();
  for (const term of terms) {
    for (const alt of term.altLabels ?? []) {
      if (!byName.has(fold(alt))) byAlt.set(fold(alt), term);
    }
  }
  const keyOf = (name: string): string | undefined => {
    const term = byName.get(fold(name));
    return term === undefined ? undefined : fold(term.id);
  };
  const children = new Map<string, Set<string>>();
  const link = (parent: string | undefined, child: string | undefined): void => {
    if (parent === undefined || child === undefined) return;
    const set = children.get(parent) ?? new Set<string>();
    set.add(child);
    children.set(parent, set);
  };
  for (const term of terms) {
    const self = fold(term.id);
    for (const name of term.narrower ?? []) link(self, keyOf(name));
    for (const name of term.broader ?? []) link(keyOf(name), self);
  }
  const branches = new Map<string, ReadonlySet<string>>();
  return {
    find(value) {
      const named = byName.get(fold(value));
      const term = named ?? byAlt.get(fold(value));
      if (term === undefined) return undefined;
      return { key: fold(term.id), label: term.label, alt: named === undefined };
    },
    below(under) {
      const root = keyOf(under);
      if (root === undefined) return undefined;
      let found = branches.get(root);
      if (found === undefined) {
        const seen = new Set<string>();
        const queue = [...(children.get(root) ?? [])];
        for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
          if (seen.has(next)) continue;
          seen.add(next);
          queue.push(...(children.get(next) ?? []));
        }
        // A cycle back to the root never makes the root its own value.
        seen.delete(root);
        found = seen;
        branches.set(root, found);
      }
      return found;
    },
    labels(keys) {
      return terms.filter((t) => keys === undefined || keys.has(fold(t.id))).map((t) => t.label);
    },
  };
}
