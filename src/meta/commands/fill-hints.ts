/**
 * The values `fill` offers for the fields that name something else in the
 * docset (`src/shared/reference-fields.ts`).
 *
 * - A term field is offered the termbase's labels. The offer is firm: a value
 *   that is not a term fails its per-value check, as `term check` would fail
 *   it, and gets the one retry every failing value gets.
 * - A page field is offered the ids of the page's fellow collection members.
 *   The offer is a hint: a URL or a line of prose stays valid, as the schema
 *   says.
 *
 * An empty list is never offered, since an empty `enum` admits nothing. Nor
 * is a list over `MAX_OFFERED`, which keeps the prompt bounded. Either way the
 * field is asked for as it would be with no offer at all.
 */
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { isMember, type CollectionConfig } from "../../shared/collections.js";
import {
  CONCEPT_FIELDS,
  PAGE_FIELDS,
  TERM_FIELDS,
  fieldPointer,
  samePath,
  valueAt,
  type FieldPath,
} from "../../shared/reference-fields.js";
import { resolveTargetSet } from "../core/load-files.js";
import { TERM_KEYWORD, isTermMark, type TermScheme } from "../core/term-keyword.js";
import { extractorForExtension } from "../extractors/index.js";
import { DocmetaError } from "../types.js";
import { resolvePointer, type ProjectionDefs } from "./fill-projection.js";
import type { Candidate, FieldHint } from "./fill-types.js";

/**
 * The most values one field is offered. Past it, the field gets no hint at
 * all, so its term check lapses too and any string passes. A termbase this
 * large is not in sight; revisit the cap before one is.
 */
export const MAX_OFFERED = 500;

/** What a term value that names no term fails with, after its pointer. */
export const NOT_A_TERM = "must be a glossary term label";

/** The values as offered: deduped and sorted, or `undefined` when empty or too many. */
export function offered(values: Iterable<string>): string[] | undefined {
  const list = [...new Set(values)].filter((value) => value.trim() !== "").sort();
  if (list.length === 0 || list.length > MAX_OFFERED) return undefined;
  return list;
}

/** The run's offers, each already through `offered`. */
export interface Offer {
  terms?: readonly string[] | undefined;
  pages?: readonly string[] | undefined;
}

/** The hint for each table field one of the candidates holds, in table order. */
export function fieldHints(candidates: readonly Candidate[], offer: Offer): FieldHint[] {
  const keys = new Set(candidates.map((c) => c.key));
  const hints: FieldHint[] = [];
  const add = (fields: readonly FieldPath[], kind: FieldHint["kind"], values: readonly string[] | undefined): void => {
    if (values === undefined) return;
    for (const path of fields) {
      const [key] = path;
      if (key !== undefined && keys.has(key)) hints.push({ path: [...path], kind, values });
    }
  };
  add(TERM_FIELDS, "term", offer.terms);
  add(PAGE_FIELDS, "page", offer.pages);
  return hints;
}

/** The termbase a term value is checked against. */
export interface TermIndex {
  labels: readonly string[];
  ids: readonly string[];
  /** The same terms, with their hierarchy, for a field marked `x-manni-term`. */
  scheme: TermScheme;
}

/** One place a candidate's subschema marks `x-manni-term`. */
export interface TermMarkAt {
  /** The field, from the page root: its first key is the candidate's. */
  path: string[];
  under?: string;
}

/**
 * Where a candidate's subschema marks `x-manni-term`: on the field itself, on
 * its `items`, or on a property nested in it, through `$ref`, `allOf`, `anyOf`
 * and `oneOf`. Read from the schema rather than recorded by Ajv, as validate
 * records it, because the value fill asks for is not there yet.
 *
 * Every branch's mark is collected, so `anyOf`/`oneOf` branches that mark one
 * field under different terms make fill ask for a value under all of them,
 * where the schema needs only one. Such a schema is almost certainly a mistake.
 */
export function termMarksIn(candidate: Candidate, defs: ProjectionDefs): TermMarkAt[] {
  const out: TermMarkAt[] = [];
  const stack = new Set<unknown>();
  const walk = (node: unknown, path: string[]): void => {
    if (typeof node !== "object" || node === null || Array.isArray(node) || stack.has(node)) return;
    stack.add(node);
    const schema = node as Record<string, unknown>;
    const mark = schema[TERM_KEYWORD];
    if (isTermMark(mark)) out.push({ path, ...(mark.under === undefined ? {} : { under: mark.under }) });
    if (typeof schema.$ref === "string") walk(resolvePointer(schema.$ref, defs), path);
    for (const keyword of ["allOf", "anyOf", "oneOf"]) {
      const branches = schema[keyword];
      if (Array.isArray(branches)) for (const branch of branches) walk(branch, path);
    }
    walk(schema.items, path);
    const properties = schema.properties;
    if (typeof properties === "object" && properties !== null) {
      for (const [key, sub] of Object.entries(properties)) walk(sub, [...path, key]);
    }
    // Off the stack once walked: the stack only breaks cycles, so a `$defs`
    // entry two branches share is still walked from each.
    stack.delete(node);
  };
  walk(candidate.subschema, [candidate.key]);
  return out;
}

/**
 * The hint for each marked field: the labels of the terms below its `under`,
 * or every label when it names none, as the firm offer a term field gets.
 * `schemas` names the file's schema set in the error for an `under` that
 * names no term.
 */
export function termMarkHints(marks: readonly TermMarkAt[], index: TermIndex, schemas: string): FieldHint[] {
  return marks.flatMap(({ path, under }) => {
    const branch = under === undefined ? undefined : index.scheme.below(under);
    if (under !== undefined && branch === undefined) {
      throw new DocmetaError(`${schemas}: ${TERM_KEYWORD} under "${under}" names no term.`);
    }
    const labels = branch === undefined ? index.labels : index.scheme.labels(branch);
    const values = offered(labels);
    if (values === undefined) return [];
    const accepts = [...labels, ...(branch === undefined ? index.ids : branch)];
    return [{ path, kind: "term" as const, values, accepts, ...(under === undefined ? {} : { under }) }];
  });
}

/**
 * The per-value check for term fields: one error per value that names no term,
 * such as `/concepts/1: must be a glossary term label`. Labels and ids compare
 * ignoring case, as `term check` compares them. A concept field takes a label
 * only, since `term check` resolves a page's `concepts` by label. A term
 * relation takes a label or an id, as `term check` resolves those.
 *
 * The offer itself lists labels only, so a model held to it never proposes an
 * id. Accepting ids here keeps an id a provider proposes anyway, as `term
 * check` would. A schema that requires ids would see every label refused.
 *
 * A field marked `x-manni-term` accepts what its hint `accepts`, and a value
 * outside a branch is refused naming it: `must be a glossary term label under
 * "Audience"`.
 */
export function termValueCheck(
  hints: readonly FieldHint[],
  index: TermIndex,
): (key: string, value: unknown) => string[] {
  const fold = (value: string): string => value.toLowerCase();
  const labels = new Set(index.labels.map(fold));
  const either = new Set([...labels, ...index.ids.map(fold)]);
  const terms = hints.filter((hint) => hint.kind === "term");
  return (key, value) =>
    terms
      .filter((hint) => hint.path[0] === key)
      .flatMap((hint) => {
        const accepted =
          hint.accepts !== undefined
            ? new Set(hint.accepts.map(fold))
            : CONCEPT_FIELDS.some((path) => samePath(path, hint.path))
              ? labels
              : either;
        const refusal = hint.under === undefined ? NOT_A_TERM : `${NOT_A_TERM} under "${hint.under}"`;
        const pointer = fieldPointer(hint.path);
        const held = valueAt(value, hint.path.slice(1));
        if (typeof held === "string") {
          return accepted.has(fold(held)) ? [] : [`${pointer}: ${refusal}`];
        }
        // Anything else, null included, is not this check's to judge: the
        // full subschema refuses a wrong type, and fill reads a null value as
        // the model declining before any value is checked.
        if (!Array.isArray(held)) return [];
        const items: unknown[] = held;
        return items.flatMap((item, i) =>
          typeof item === "string" && !accepted.has(fold(item)) ? [`${pointer}/${String(i)}: ${refusal}`] : [],
        );
      });
}

export interface PageIdReaderOptions {
  /** The declared collections. */
  collections: readonly CollectionConfig[];
  /** What the collections' globs are measured from. */
  configDir: string;
  /** Skip files `.gitignore` covers when walking a collection. Default true. */
  respectGitignore?: boolean;
}

/**
 * Reads page ids by collection: the `id` of every member, read with the
 * extractor for its extension. Each collection is walked once, on first
 * need. A member that cannot be read or parsed, or carries no `id`, is not
 * offered. The reader returns the ids of every member of the named
 * collections, except `file` itself, sorted.
 */
export function pageIdReader(
  opts: PageIdReaderOptions,
): (file: string, collections: readonly string[]) => Promise<string[]> {
  const walked = new Map<string, Promise<ReadonlyMap<string, string>>>();
  const idsOf = (collection: CollectionConfig): Promise<ReadonlyMap<string, string>> => {
    let held = walked.get(collection.name);
    if (held === undefined) {
      held = readIds(collection, opts);
      walked.set(collection.name, held);
    }
    return held;
  };
  return async (file, names) => {
    const self = resolve(file);
    const ids = new Set<string>();
    for (const name of names) {
      const collection = opts.collections.find((c) => c.name === name);
      if (collection === undefined) continue;
      for (const [path, id] of await idsOf(collection)) {
        if (path !== self) ids.add(id);
      }
    }
    return [...ids].sort();
  };
}

/** Each member's absolute path and its `id`. */
async function readIds(
  collection: CollectionConfig,
  opts: PageIdReaderOptions,
): Promise<ReadonlyMap<string, string>> {
  const { files } = await resolveTargetSet({
    inputs: collection.paths,
    cwd: opts.configDir,
    allowEmpty: true,
    respectGitignore: opts.respectGitignore ?? true,
  });
  const ids = new Map<string, string>();
  for (const file of files) {
    if (!isMember(collection, file)) continue;
    const extractor = extractorForExtension(extname(file));
    if (extractor === undefined) continue;
    const path = resolve(opts.configDir, file);
    let id: unknown;
    try {
      id = extractor.extract(await readFile(path, "utf8"), file).data.id;
    } catch {
      continue;
    }
    if (typeof id === "string" && id.trim() !== "") ids.set(path, id);
  }
  return ids;
}
