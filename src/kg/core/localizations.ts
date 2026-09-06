/**
 * The localization manifest (ADR 01038) — `kg/localizations.json`, the index of
 * indexes.
 *
 * Retrieval artifacts fan out per language: one `search.<lang>.json` and one
 * `vectors.<lang>.bin` each, because a single flat index over every locale
 * ranks across the boundary it exists to respect, and because one embedding
 * model cannot serve every language. The manifest is what makes that navigable
 * — a browser fetches this one small file, learns which localizations exist and
 * what each costs, and downloads only the pair it needs.
 *
 * Written by `manni kg export --format search`; `manni kg embed` fills in the
 * `vectors` block as it produces each sidecar, so a manifest entry without one
 * means exactly "this language has no vectors yet".
 *
 * No `node:` imports: the CLI writes it and the browser runtime reads it.
 */
import { byCodeUnit } from "./sort.js";

/** Conventional filename, written beside the graph. */
export const LOCALIZATIONS_FILENAME = "localizations.json";

/**
 * BCP-47's tag for undetermined, used as the bucket for documents that declare
 * no language. A real tag rather than a dockg invention, so a consumer that
 * knows BCP-47 already knows what it means — and so the bucket sorts, filters,
 * and names a file like any other language.
 */
export const UNDETERMINED = "und";

/**
 * BCP-47's common shape: language(2-3) + optional script(4) + optional
 * region(2 alpha or 3 digit) + variants. Accepts de, de-DE, zh-Hans,
 * zh-Hans-CN, pt-BR and und; rejects English and de_DE.
 *
 * The same grammar appears in `config-schema.json` (for `routes[].language` and
 * `embed.byLanguage`) and in `shapes/dockg-1.0.0.ttl` (for `dcterms:language`).
 * This copy exists because a tag also becomes a **filename**, and the shapes
 * only run under `manni kg check` — an unvalidated literal from the graph would
 * otherwise reach `writeFileSync` as a path segment. `test/unit/schema-sync.test.ts`
 * pins all three to each other.
 */
export const LANGUAGE_TAG =
  /^[A-Za-z]{2,3}(-[A-Za-z]{4})?(-([A-Za-z]{2}|[0-9]{3}))?(-([A-Za-z0-9]{5,8}|[0-9][A-Za-z0-9]{3}))*$/;

/** Whether a string is usable as a language tag — and so as a filename segment. */
export function isLanguageTag(value: string): boolean {
  return LANGUAGE_TAG.test(value);
}

/** Where one language's lexical index lives, and what it holds. */
export interface SearchArtifact {
  /** Filename, relative to the manifest. */
  path: string;
  /** Indexed nodes. */
  entries: number;
  /** `sha256:…` of the file, so a consumer can detect a stale pair. */
  digest: string;
}

/** Where one language's vector sidecar lives, and what produced it. */
export interface VectorArtifact {
  path: string;
  /** The embedding model this language was embedded with. */
  model: string;
  dtype: string;
  dims: number;
  count: number;
}

export interface LocalizationEntry {
  /** BCP-47 tag, or `und` for the undeclared bucket. */
  language: string;
  /** Documents in this language (sections excluded). */
  documents: number;
  search: SearchArtifact;
  /** Absent until `manni kg embed` has run for this language. */
  vectors?: VectorArtifact;
}

export interface LocalizationsDoc {
  version: 1;
  /** One entry per language present, sorted by tag. */
  languages: LocalizationEntry[];
}

/** `search.de.json` — the lexical index for one language. */
export function searchIndexFilename(language: string): string {
  return `search.${language}.json`;
}

/** `vectors.de.bin` — the vector sidecar for one language. */
export function vectorIndexFilename(language: string): string {
  return `vectors.${language}.bin`;
}

/**
 * Serialize the manifest: sorted by language, two-space indent, trailing
 * newline — byte-stable like every other dockg artifact.
 */
export function emitLocalizations(doc: LocalizationsDoc): string {
  const languages = [...doc.languages].sort((a, b) =>
    byCodeUnit(a.language, b.language),
  );
  return `${JSON.stringify({ version: doc.version, languages }, null, 2)}\n`;
}

/**
 * Parse and shape-check a manifest. Returns undefined for anything else.
 *
 * Every entry is checked, not just the envelope: callers reach straight for
 * `entry.search.path`, and a truncated or hand-edited file would otherwise
 * dereference `undefined` and surface as a raw TypeError with exit 1 rather
 * than the operational error (exit 2) an unreadable artifact owes.
 */
export function parseLocalizations(text: string): LocalizationsDoc | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  const doc = parsed as LocalizationsDoc | null;
  if (!doc || doc.version !== 1 || !Array.isArray(doc.languages)) {
    return undefined;
  }
  for (const entry of doc.languages) {
    if (
      !entry ||
      typeof entry.language !== "string" ||
      !isLanguageTag(entry.language) ||
      typeof entry.documents !== "number" ||
      !entry.search ||
      typeof entry.search.path !== "string" ||
      typeof entry.search.entries !== "number" ||
      typeof entry.search.digest !== "string" ||
      !ownsFilename(entry.search.path, searchIndexFilename(entry.language))
    ) {
      return undefined;
    }
    if (entry.vectors !== undefined) {
      const v = entry.vectors;
      if (
        typeof v.path !== "string" ||
        typeof v.model !== "string" ||
        typeof v.dtype !== "string" ||
        typeof v.dims !== "number" ||
        typeof v.count !== "number" ||
        // Same constraint `search.path` gets: the last segment must be the
        // filename this language's sidecar would be given. Without it,
        // `isSafeRelativePath` alone leaves `vectors.path` far more reachable
        // than `search.path` — and `search --mode vector` opens it.
        !ownsFilename(v.path, vectorIndexFilename(entry.language))
      ) {
        return undefined;
      }
    }
  }
  return doc;
}

/**
 * A path from the manifest is joined onto a directory and opened, so it is
 * checked like any other untrusted path segment.
 *
 * `export` refuses to *write* a filename it built from a bad language tag; this
 * is the same hole on the read side, reached through a manifest instead of
 * through frontmatter. A hand-edited `"path": "../../etc/passwd"` would
 * otherwise be joined and read by `embed` and `search`.
 *
 * Rejects an absolute path, a Windows drive letter, a backslash, and any `.`
 * or empty segment. `..` is allowed **only as a prefix**, so `a/../../x` — an
 * escape wearing a normal first segment — is refused while `../vecs/x.bin`,
 * the layout `embed -o` produces, is not.
 *
 * How far up a leading run may climb is deliberately *not* capped. It was,
 * briefly, and the cap rejected manifests `embed -o` itself writes: a sidecar
 * directory two levels from the index directory produced an artifact set dockg
 * could not read back. The bound that matters is `ownsFilename` — a crafted
 * manifest can only ever name a file already called `search.<lang>.json` or
 * `vectors.<lang>.bin`, which is a long way from arbitrary-file read, and no
 * number of `..` segments widens it.
 */
function isSafeRelativePath(path: string): boolean {
  if (path === "" || path.startsWith("/") || /^[A-Za-z]:/.test(path)) {
    return false;
  }
  if (path.includes("\\")) return false;
  const segments = path.split("/");
  let leading = true;
  for (const segment of segments) {
    if (segment === "" || segment === ".") return false;
    if (segment === "..") {
      if (!leading) return false;
      continue;
    }
    leading = false;
  }
  return true;
}

/**
 * The path is relative-safe *and* its last segment is the filename this
 * language's artifact would be given.
 *
 * The filename check is the constraint that actually narrows what a crafted
 * manifest can reach: `isSafeRelativePath` bounds the directory it can point
 * into, this bounds the file.
 */
function ownsFilename(path: string, expected: string): boolean {
  if (!isSafeRelativePath(path)) return false;
  return path.slice(path.lastIndexOf("/") + 1) === expected;
}
