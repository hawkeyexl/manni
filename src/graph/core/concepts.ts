/**
 * The termbase as the graph reads it (proposal 0086 §1): one concept per term
 * id, and one resolver every concept label in derivation goes through.
 *
 * A label resolves to a term by its label, then its id, then an alt-label,
 * ignoring case. The page's own language is tried first, then the same
 * primary language (`en` for `en-US`), then any. A `see:` entry is a
 * redirect, not a concept: it resolves to its target.
 */
import type { TermLabel } from "../../shared/term-labels.js";
import { canonicalLanguageTag } from "./localizations.js";
import { byCodeUnit } from "./sort.js";

/** What a key names: a term id, or a redirect to resolve in turn. */
type Target = { id: string } | { see: string; language: string | undefined };

interface Key {
  language: string | undefined;
  target: Target;
}

export interface TermIndex {
  /** Each concept's entries, one per language, keyed by id in code-unit order. */
  groups: ReadonlyMap<string, readonly TermLabel[]>;
  /** The `see:` entries, in a stable order. */
  redirects: readonly TermLabel[];
  /** The term id a label names, or `undefined` for a freeform label. */
  resolve(label: string, language?: string): string | undefined;
}

/** A term's or a page's language, canonical, or `undefined` when it has none. */
export function canonicalLanguage(tag: string | undefined): string | undefined {
  return tag === undefined || tag === "" ? undefined : canonicalLanguageTag(tag);
}

// `split` always yields at least one element; the `?? ""` only satisfies the
// index type.
const primary = (tag: string): string => (tag.split("-")[0] ?? "").toLowerCase();

/** A redirect chain longer than this is a loop, and names nothing. */
const MAX_REDIRECTS = 8;

/**
 * Each termbase's index, by the array it was built from: one `graph build`
 * asks for it twice (the concept count and the derivation), and builds it once.
 */
const built = new WeakMap<readonly TermLabel[], TermIndex>();

export function termIndex(terms: readonly TermLabel[]): TermIndex {
  const cached = built.get(terms);
  if (cached !== undefined) return cached;
  const index = buildTermIndex(terms);
  built.set(terms, index);
  return index;
}

function buildTermIndex(terms: readonly TermLabel[]): TermIndex {
  const sorted = [...terms]
    .map((t) => ({ term: t, language: canonicalLanguage(t.language) }))
    .sort(
      (a, b) =>
        byCodeUnit(a.term.id, b.term.id) ||
        byCodeUnit(a.language ?? "", b.language ?? "") ||
        byCodeUnit(a.term.label, b.term.label),
    );

  const groups = new Map<string, TermLabel[]>();
  const redirects: TermLabel[] = [];
  const byLabel = new Map<string, Key[]>();
  const byId = new Map<string, Key[]>();
  const byAlt = new Map<string, Key[]>();
  const put = (map: Map<string, Key[]>, value: string, key: Key) => {
    const k = value.toLowerCase();
    const list = map.get(k);
    if (list) list.push(key);
    else map.set(k, [key]);
  };

  for (const { term, language } of sorted) {
    const target: Target =
      term.see === undefined ? { id: term.id } : { see: term.see, language };
    if (term.see === undefined) {
      const group = groups.get(term.id);
      if (group) group.push(term);
      else groups.set(term.id, [term]);
    } else {
      redirects.push(term);
    }
    put(byLabel, term.label, { language, target });
    put(byId, term.id, { language, target });
    for (const alt of term.altLabels ?? []) put(byAlt, alt, { language, target });
  }

  const tiers = [byLabel, byId, byAlt];

  const resolve = (label: string, language: string | undefined, depth: number): string | undefined => {
    const wanted = canonicalLanguage(language);
    const passes: Array<(k: Key) => boolean> =
      wanted === undefined
        ? [() => true]
        : [
            (k) => k.language === wanted,
            (k) => k.language !== undefined && primary(k.language) === primary(wanted),
            () => true,
          ];
    const needle = label.toLowerCase();
    for (const pass of passes) {
      for (const tier of tiers) {
        const hit = tier.get(needle)?.find(pass);
        if (hit === undefined) continue;
        if ("id" in hit.target) return hit.target.id;
        if (depth >= MAX_REDIRECTS) return undefined;
        return resolve(hit.target.see, hit.target.language ?? wanted, depth + 1);
      }
    }
    return undefined;
  };

  return {
    groups,
    redirects,
    resolve: (label, language) => (groups.size === 0 ? undefined : resolve(label, language, 0)),
  };
}
