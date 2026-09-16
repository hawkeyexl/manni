/**
 * Near-miss detection for the page-level keys the harvest rule reads
 * (ADR 01024, ADR 01028).
 *
 * Five page-level keys are graph inputs — `type`, `concepts`, `applies-to`,
 * `not-applicable-to`, `supersedes` — and unlike the `kg` block, nothing
 * validates them. The `kg` block is `additionalProperties: false`, so a typo
 * inside it is a hard schema error; the same typo at the page level derives
 * silently nothing, because a page may legitimately carry any other key it
 * likes (a site generator's, a linter's, an author's).
 *
 * A schema is therefore the wrong instrument: rejecting unknown page keys would
 * reject every page. What is wrong with `applies_to` is not that dockg does not
 * know it — it is that it is one character from a key dockg *does* know, on a
 * page that declares nothing else of the kind. That is what this detects, and
 * it is the whole scope: dockg does not implement the vocabularies these keys
 * belong to and must not start claiming their facts (ADR 01024).
 *
 * Warnings only. A near miss is a suspicion, not a finding, and a suspicion
 * must never fail a build.
 */
import { PAGE_TYPE_TO_TOPIC_TYPE } from "./iirds.js";
import { byCodeUnit } from "./sort.js";
import type { DocModel } from "../types.js";

/**
 * The page-level keys dockg reads, in the spelling it expects.
 *
 * Five are `resolveKg`'s harvest inputs (ADR 01024). The localization three
 * are read straight by the emitter — `lang`/`language` into `dcterms:language`,
 * `translation-of` into the schema.org translation pair (ADR 01037) — and are
 * listed here for the same reason: a typo in any of them derives nothing while
 * looking exactly like a declared fact.
 */
export const HARVESTED_KEYS: readonly string[] = [
  "applies-to",
  "concepts",
  "lang",
  "language",
  "not-applicable-to",
  "supersedes",
  "translation-of",
  "type",
];

/**
 * Levenshtein distance, capped: anything past `max` returns `max + 1`, since
 * the caller only cares whether a candidate is *close*.
 */
function distance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        (prev[j] ?? 0) + 1,
        (row[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length] ?? max + 1;
}

/**
 * The known name a candidate was probably meant to be, or undefined.
 *
 * Distance 1 for short names, 2 for longer ones: `type` and `types` differ by
 * one and mean different things, while `not-applicable-to` can absorb two typos
 * and still be unmistakable. Separator-only differences (`applies_to`,
 * `appliesTo`) normalize to an exact match and are always caught.
 */
function nearestKnown(
  candidate: string,
  known: readonly string[],
): string | undefined {
  // Split camelCase BEFORE lowercasing — doing it after is a no-op, because
  // there is no uppercase left to match. `appliesTo` then reaches `applies-to`
  // exactly, instead of relying on the distance fallback to rescue it, and
  // `notApplicabelTo` (two typos plus a case boundary) becomes reachable at
  // all.
  const normalize = (s: string): string =>
    s
      .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
      .toLowerCase()
      .replace(/[_\s]+/g, "-");
  const c = normalize(candidate);
  for (const k of known) {
    if (c === normalize(k) && candidate !== k) return k;
  }
  let best: { key: string; d: number } | undefined;
  for (const k of known) {
    const max = k.length > 8 ? 2 : 1;
    const d = distance(c, normalize(k), max);
    if (d > max) continue;
    if (!best || d < best.d) best = { key: k, d };
  }
  return best?.key;
}

/**
 * Warnings for page-level keys and page `type` values that look like harvest
 * inputs but are not. Sorted, so the output is deterministic like everything
 * else dockg emits.
 */
export function harvestWarnings(docs: readonly DocModel[]): string[] {
  const out: string[] = [];
  const mappedTypes = Object.keys(PAGE_TYPE_TO_TOPIC_TYPE);

  for (const doc of docs) {
    const fm = doc.frontmatter;
    const present = new Set(Object.keys(fm));

    for (const key of present) {
      if (HARVESTED_KEYS.includes(key)) continue;
      const meant = nearestKnown(key, HARVESTED_KEYS);
      // Only suspicious if the page does not already declare the real key: a
      // page carrying both `applies-to` and `applies_to` has made its choice.
      if (meant === undefined || present.has(meant)) continue;
      out.push(
        `${doc.path}: page key "${key}" is not read by dockg and looks like "${meant}" — nothing was derived from it`,
      );
    }

    // A page `type` outside the map derives nothing, by design: dockg
    // references iiRDS terms and never mints them. That is correct for
    // `blog-post`, and almost never what the author meant for `how to`.
    const type = fm["type"];
    // Object.hasOwn, not `in`: `type: constructor` and `type: toString` walk
    // the prototype chain and would be read as mapped types, silently skipping
    // the check.
    if (
      typeof type === "string" &&
      !Object.hasOwn(PAGE_TYPE_TO_TOPIC_TYPE, type)
    ) {
      const meant = nearestKnown(type, mappedTypes);
      if (meant !== undefined) {
        out.push(
          `${doc.path}: page type "${type}" maps to no iiRDS topic type and looks like "${meant}" — no kg.type was derived`,
        );
      }
    }
  }

  return out.sort(byCodeUnit);
}
