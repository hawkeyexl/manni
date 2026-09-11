/**
 * `collections:`, the family-level home for document sets (proposal 0041).
 *
 * A collection names a set of documents once, at the top level of
 * `manni.config.yaml`, and every tool reads the same declaration: the metadata
 * tool validates its members, `query` exposes it as a view, and `a11y check`
 * seeds from its `url`. Only the *declaration* is shared. Loading a manifest
 * and merging it into `ExtractedMetadata` stays with the metadata tool,
 * because that type is the metadata tool's.
 *
 * Every refusal in this parser is a shape that would otherwise read as
 * configured and do nothing, or do something nobody can see. The manifest
 * rules are 0037's, moved here unchanged in substance: an entry with no keys
 * owns nothing, one key under two manifests of a collection would need a
 * tiebreak (0020 refuses tiebreaks), and `$schema` from external metadata
 * would let a private file pick the schema a public document is judged by
 * (0015) with the provenance lost at the merge.
 */
import picomatch from "picomatch";
import { matchesFileGlob } from "./globs.js";

/** One external-metadata manifest (proposals 0037, 0038, 0039) joined to a collection. */
export interface ExternalMetadataConfig {
  file: string;
  keys: string[];
  tokenEnv?: string;
  join?: string;
}

/** One named document set, as declared under the top-level `collections:` key. */
export interface CollectionConfig {
  name: string;
  paths: string[];
  exclude: string[];
  externalMetadata: ExternalMetadataConfig[];
  /** Where the collection is published; `manni a11y check` seeds from it. */
  url?: string;
}

const COLLECTION_KEYS = [
  "name",
  "paths",
  "exclude",
  "url",
  "externalMetadata",
] as const;

const EXTERNAL_METADATA_KEYS = ["file", "keys", "tokenEnv", "join"] as const;

/**
 * The document-level schema key. The metadata tool spells it
 * `FILE_SCHEMA_KEY` in `src/meta/core/resolve-schema.ts`; the literal is
 * repeated here so the shared layer does not import a tool's module. Keep the
 * two in step.
 */
const SCHEMA_KEY = "$schema";

/**
 * The label `load-files.ts` gives stdin (`STDIN_LABEL`). Repeated as a literal
 * for the same reason as `SCHEMA_KEY`: the shared layer does not depend on the
 * metadata tool. Stdin has no path, so it is a member of nothing.
 */
const STDIN = "<stdin>";

/** Is this manifest reference a URL? The `url` branch of `classifyRef`. */
function isUrlRef(ref: string): boolean {
  return /^https?:\/\//i.test(ref);
}

/**
 * Whether a URL may name an external-metadata manifest: `https://` anywhere,
 * or `http://` on a loopback host only, where plaintext leaks nothing.
 * Userinfo is refused because the URL is printed in every diagnostic and a
 * secret in it would print too. Returns the reason it may not, or `null`.
 */
export function externalMetadataUrlProblem(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "is not a valid URL";
  }
  if (parsed.username !== "" || parsed.password !== "") {
    return 'carries a credential in the URL; put the token in an environment variable and name it with "tokenEnv"';
  }
  if (parsed.protocol === "https:") return null;
  if (parsed.protocol === "http:" && isLoopback(parsed.hostname)) return null;
  if (parsed.protocol === "http:") {
    return "is plain http://; a bearer token over plaintext is a leak, and a public manifest is served over https too";
  }
  return `has the unsupported scheme "${parsed.protocol}"`;
}

function isLoopback(host: string): boolean {
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    host === "::1" ||
    host.startsWith("127.")
  );
}

function rejectUnknownKeys(
  raw: Record<string, unknown>,
  allowed: readonly string[],
  where: string,
  source: string,
  toError: (message: string) => Error,
): void {
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) {
      throw toError(
        `${source}: ${where} has unknown key "${key}". Supported keys: ${allowed.join(", ")}.`,
      );
    }
  }
}

function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Parse the top-level `collections:` value. Errors are built with `toError`,
 * so each tool reports a bad family file in its own error class.
 */
export function parseCollections(
  raw: unknown,
  source: string,
  toError: (message: string) => Error,
): CollectionConfig[] {
  if (!Array.isArray(raw)) {
    throw toError(`${source}: "collections" must be a list.`);
  }
  if (raw.length === 0) {
    throw toError(
      `${source}: "collections" must name at least one collection; remove the key if there are none.`,
    );
  }
  // Names become SQL view names, and SQLite compares identifiers without
  // regard to case, so two names that differ only in case are one view.
  const taken = new Map<string, number>();
  return raw.map((entry, i) => {
    const where = `collections[${i}]`;
    if (!isMapping(entry)) {
      throw toError(`${source}: ${where} must be a mapping.`);
    }
    rejectUnknownKeys(entry, COLLECTION_KEYS, where, source, toError);

    if (!isNonEmptyString(entry.name)) {
      throw toError(`${source}: ${where}.name must be a non-empty string.`);
    }
    const name = entry.name;
    const folded = name.toLowerCase();
    if (folded === "docs") {
      throw toError(
        `${source}: ${where}.name "${name}" collides with the docs table every query reads. Pick another name, such as "site" or "pages".`,
      );
    }
    if (folded.startsWith("sqlite_")) {
      throw toError(
        `${source}: ${where}.name "${name}" starts with "sqlite_", which SQLite reserves for its own objects. Pick another name.`,
      );
    }
    const owner = taken.get(folded);
    if (owner !== undefined) {
      throw toError(
        `${source}: ${where}.name "${name}" is already taken by collections[${owner}]; names are compared case-insensitively because they become SQL views.`,
      );
    }
    taken.set(folded, i);

    if (
      !Array.isArray(entry.paths) ||
      entry.paths.length === 0 ||
      entry.paths.some((p) => !isNonEmptyString(p))
    ) {
      throw toError(
        `${source}: ${where}.paths must be a non-empty list of files, directories or globs.`,
      );
    }
    const paths = entry.paths as string[];

    let exclude: string[] = [];
    if (entry.exclude !== undefined) {
      if (
        !Array.isArray(entry.exclude) ||
        entry.exclude.some((g) => !isNonEmptyString(g))
      ) {
        throw toError(`${source}: ${where}.exclude must be a list of globs.`);
      }
      exclude = entry.exclude as string[];
    }

    let url: string | undefined;
    if (entry.url !== undefined) {
      if (typeof entry.url !== "string" || !isHttpUrl(entry.url)) {
        throw toError(`${source}: ${where}.url must be an http(s) URL.`);
      }
      url = entry.url;
    }

    let externalMetadata: ExternalMetadataConfig[] = [];
    if (entry.externalMetadata !== undefined) {
      if (!Array.isArray(entry.externalMetadata)) {
        throw toError(`${source}: ${where}.externalMetadata must be a list.`);
      }
      externalMetadata = parseExternalMetadata(
        entry.externalMetadata,
        where,
        source,
        toError,
      );
    }

    return {
      name,
      paths,
      exclude,
      externalMetadata,
      ...(url === undefined ? {} : { url }),
    };
  });
}

function isHttpUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:";
}

/**
 * Parse one collection's `externalMetadata:`. 0037's rules, with the error
 * path rewritten and the noun changed: ownership is now disjoint within a
 * collection rather than across the whole config, because two collections may
 * each own the same key.
 */
function parseExternalMetadata(
  raw: readonly unknown[],
  collectionWhere: string,
  source: string,
  toError: (message: string) => Error,
): ExternalMetadataConfig[] {
  const owners = new Map<string, number>();
  return raw.map((entry, i) => {
    const where = `${collectionWhere}.externalMetadata[${i}]`;
    if (!isMapping(entry)) {
      throw toError(`${source}: ${where} must be a mapping.`);
    }
    rejectUnknownKeys(entry, EXTERNAL_METADATA_KEYS, where, source, toError);
    if (!isNonEmptyString(entry.file)) {
      throw toError(
        `${source}: ${where}.file must be a non-empty string naming the manifest, relative to the config file.`,
      );
    }
    if (
      !Array.isArray(entry.keys) ||
      entry.keys.length === 0 ||
      entry.keys.some((k) => !isNonEmptyString(k))
    ) {
      throw toError(
        `${source}: ${where}.keys must be a non-empty list of key names.`,
      );
    }
    const isUrl = isUrlRef(entry.file);
    if (isUrl) {
      const problem = externalMetadataUrlProblem(entry.file);
      if (problem !== null) {
        throw toError(`${source}: ${where}.file ${problem}.`);
      }
    }
    if (entry.tokenEnv !== undefined) {
      if (!isNonEmptyString(entry.tokenEnv)) {
        throw toError(
          `${source}: ${where}.tokenEnv must be the name of an environment variable.`,
        );
      }
      if (!isUrl) {
        throw toError(
          `${source}: ${where}.tokenEnv is set, but "file" is a path, so no request is made and the token would go nowhere. Remove it, or make "file" a URL.`,
        );
      }
    }
    const keys = entry.keys as string[];
    if (entry.join !== undefined) {
      if (!isNonEmptyString(entry.join)) {
        throw toError(
          `${source}: ${where}.join must be "path" or the name of a top-level frontmatter field.`,
        );
      }
      if (entry.join === SCHEMA_KEY) {
        throw toError(`${source}: ${where}.join may not be "${SCHEMA_KEY}".`);
      }
      if (keys.includes(entry.join)) {
        throw toError(
          `${source}: ${where}.join names "${entry.join}", which the same entry owns — the value that selects an entry cannot come from the entry.`,
        );
      }
    }
    const seen = new Set<string>();
    for (const key of keys) {
      if (key === SCHEMA_KEY) {
        throw toError(
          `${source}: ${where}.keys may not include "${SCHEMA_KEY}" — a manifest never chooses the schema a document is judged by; use "overrides".`,
        );
      }
      if (seen.has(key)) {
        throw toError(`${source}: ${where}.keys lists "${key}" twice.`);
      }
      seen.add(key);
      const owner = owners.get(key);
      if (owner !== undefined) {
        throw toError(
          `${source}: ${where}.keys claims "${key}", which externalMetadata[${owner}] already owns — a key has exactly one manifest in a collection.`,
        );
      }
      owners.set(key, i);
    }
    return {
      file: entry.file,
      keys,
      ...(typeof entry.tokenEnv === "string" ? { tokenEnv: entry.tokenEnv } : {}),
      ...(typeof entry.join === "string" ? { join: entry.join } : {}),
    };
  });
}

/**
 * The collections a run covers: every one when `names` is undefined, else the
 * named ones in **declaration** order, however they were named on the command
 * line. Repeats collapse; an unknown name is an error, because a typo that
 * silently narrowed the run to nothing would read as a clean pass.
 */
export function selectCollections(
  collections: readonly CollectionConfig[],
  names: readonly string[] | undefined,
  source: string,
  toError: (message: string) => Error,
): CollectionConfig[] {
  // An empty list means the same as no list: every collection. Commander's
  // repeatable-option collector defaults to `[]`, so "the user passed no
  // --collection" reaches this function as an empty array at least as often as
  // it reaches it as `undefined`. Were `[]` to select nothing, a plain
  // `manni meta validate` would validate zero files and exit 0 the moment a
  // caller forwarded the raw commander value — the false green proposal 0014
  // exists to end, and invisible in the exit code. Nothing needs to express
  // "select no collections", so the ambiguity is resolved in the safe
  // direction. Do not tighten this back.
  if (names === undefined || names.length === 0) return [...collections];
  const wanted = new Set(names);
  for (const name of wanted) {
    if (!collections.some((c) => c.name === name)) {
      const configured =
        collections.length === 0
          ? "(none)"
          : collections.map((c) => c.name).join(", ");
      // Names are unique case-insensitively (they become SQL views) but are
      // selected by their one spelling. When the miss is only a casing miss,
      // say so — "Configured: guides" beside "Guides" reads as a contradiction
      // to anyone who does not already know the rule.
      const nearMiss = collections.find(
        (c) => c.name.toLowerCase() === name.toLowerCase(),
      );
      const hint =
        nearMiss === undefined
          ? ""
          : ` Names are case-sensitive; did you mean "${nearMiss.name}"?`;
      throw toError(
        `no collection named "${name}" in ${source}. Configured: ${configured}.${hint}`,
      );
    }
  }
  return collections.filter((c) => wanted.has(c.name));
}

/**
 * Is this file a member of the collection? `relPath` is posix and already
 * relative to the config file's directory, so this is arithmetic on a string:
 * no `stat`, nothing that can fail, and nothing that costs per file. A path
 * that climbed out of the config directory, and stdin, are members of nothing.
 */
export function isMember(
  collection: CollectionConfig,
  relPath: string,
): boolean {
  if (relPath === STDIN) return false;
  if (relPath.startsWith("../")) return false;
  const matched = collection.paths.some((entry) => {
    const normalized = normalizeEntry(entry);
    if (normalized === "") return false;
    if (isGlob(normalized)) return matchesFileGlob(relPath, normalized);
    return relPath === normalized || relPath.startsWith(`${normalized}/`);
  });
  if (!matched) return false;
  // `exclude` is globs only, whatever `paths` was written as.
  return !collection.exclude.some((glob) => matchesFileGlob(relPath, glob));
}

/** A `paths` entry as a posix path with no `./` prefix and no trailing `/`. */
function normalizeEntry(entry: string): string {
  const posix = entry.replace(/\\/g, "/").replace(/^\.\//, "");
  return posix.endsWith("/") ? posix.slice(0, -1) : posix;
}

/**
 * Is this `paths` entry a glob, by picomatch's own definition, rather than a
 * bare file or directory to match by prefix?
 *
 * picomatch decides, not a character class of our own: an extended glob such
 * as `docs/!(drafts)/**` or `@(a|b)` has no `*`, `?`, `[` or `{` of its own
 * and a hand-rolled test read it as a literal path — matching nothing and
 * excluding nothing, silently. The one cost is that a literal directory whose
 * name carries parentheses, `docs/notes (old)`, is also read as a glob and so
 * matches itself only, not everything beneath it. Spell such a path as
 * `docs/notes (old)/**` to get the prefix behaviour back.
 */
function isGlob(entry: string): boolean {
  return picomatch.scan(entry).isGlob;
}
