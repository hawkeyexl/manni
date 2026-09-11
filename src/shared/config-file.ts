/**
 * The family config file.
 *
 * One file per repository, `manni.config.yaml`, with one top-level key per
 * tool: `meta:` for the metadata tool, `docevals:`, `tracevals:`, `lint:`,
 * `kg:` as each lands. A tool reads its own key and leaves its siblings alone,
 * so adding a tool never invalidates a config that predates it.
 *
 * This module only finds the file and hands a tool its slice. What the slice
 * may contain is the tool's business; it validates the value with its own
 * parser and its own error class, which is why `toError` is an option rather
 * than an import. Two top-level keys belong to the family rather than to a
 * tool, and are parsed here once for every tool: `collections:` (proposal
 * 0041) and `encryptionKey:` (proposal 0045).
 *
 * Two older spellings are still read, each with a warning on discovery:
 *
 * - `moose.config.yaml`, the family file under the pre-rename name. Same
 *   shape, so only the filename is wrong.
 * - each tool's pre-family file (`docmeta.config.yaml` for the metadata
 *   tool), whose whole document is the tool's section with no wrapper key.
 *
 * Within one directory the order is manni, moose, then the legacy names, and
 * `.yaml` before `.yml`. A family file that exists but has neither a key for
 * this tool nor a family key is not this tool's config: discovery keeps
 * looking, first at the legacy names beside it (a repository mid-migration,
 * where a sibling tool moved to the family file first) and then up the tree.
 * The walk stops at the nearest `.git` boundary, nearest directory first, and
 * the first hit wins; ancestor files are never merged.
 *
 * An explicit path is read the same way minus the warning: the section key is
 * unwrapped when present, a document carrying a family key is a family file
 * with an empty section, and the whole document is taken otherwise, so a
 * `-c ./anything.yaml` needs no filename sniffing and no flag.
 */
import { readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { parseCollections, type CollectionConfig } from "./collections.js";
import { isValidEncryptionKey } from "./encryption.js";
import { searchPath } from "./git-root.js";
import { warn } from "./warn.js";

/** The canonical family filenames, in discovery order. */
export const FAMILY_CONFIG_NAMES: readonly string[] = [
  "manni.config.yaml",
  "manni.config.yml",
];

/** The family filenames before the rename, still read with a warning. */
export const MOOSE_CONFIG_NAMES: readonly string[] = [
  "moose.config.yaml",
  "moose.config.yml",
];

/** The top-level key holding the family encryption key (proposal 0045). */
export const ENCRYPTION_KEY_FIELD = "encryptionKey";

export interface ConfigFileOptions {
  /** The tool's key in a family file, e.g. `"meta"`. */
  section: string;
  /**
   * The tool's own filenames from before the family file, in discovery order.
   * Their whole document is the tool's section.
   */
  legacyNames: readonly string[];
  /** Build the error for an unreadable document, in the tool's own class. */
  toError: (message: string) => Error;
}

export interface ConfigFile {
  /** Absolute path to the file. */
  path: string;
  /** Directory holding it; relative paths in the config resolve from here. */
  dir: string;
  /**
   * The file as the user would name it: relative to `cwd`, posix separators,
   * or the spelling they typed for an explicit path. For error messages.
   */
  source: string;
  /** The file's text, for a tool that rewrites the file in place. */
  text: string;
  /**
   * The tool's slice: the value under `section:` when `wrapped`, otherwise
   * the whole document. `null` for an empty file or an empty section; the
   * tool decides what empty means.
   */
  value: unknown;
  /** Whether `value` came from under `section:`. */
  wrapped: boolean;
  /** How the file was found. Explicit paths are never warned about. */
  kind: "manni" | "moose" | "legacy" | "explicit";
  /**
   * The document's top-level `collections:` (proposal 0041), parsed once here
   * because every tool reads the same declaration. `[]` when the key is
   * absent, and always `[]` for a `legacy` file: a per-tool file's whole
   * document *is* the tool's section, so it carries no family-wide keys.
   */
  collections: CollectionConfig[];
  /**
   * The document's top-level `encryptionKey:` (proposal 0045), validated
   * here. Absent when the key is, and always absent for a `legacy` file, for
   * the same reason as `collections`. `MANNI_ENCRYPTION_KEY` wins over it;
   * read it through `resolveEncryptionKey`, not directly.
   */
  encryptionKey?: string;
}

type ToError = (message: string) => Error;

interface Document {
  text: string;
  /** Parsed YAML: a mapping, or `null` for an empty file. */
  doc: Record<string, unknown> | null;
}

async function readDocument(
  path: string,
  source: string,
  toError: ToError,
): Promise<Document | null> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return null;
  }
  return { text, doc: parseMapping(text, source, toError) };
}

/**
 * Parse outside any "not found" handling. A discovered file with a typo must
 * be reported, not skipped: falling through to the next candidate, or to no
 * config at all, would run the tool on defaults and read as a clean pass.
 */
function parseMapping(
  text: string,
  source: string,
  toError: ToError,
): Record<string, unknown> | null {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (err) {
    throw toError(`${source}: invalid YAML: ${(err as Error).message}`);
  }
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw toError(`${source}: top level must be a mapping.`);
  }
  return raw as Record<string, unknown>;
}

/** The top-level key holding the family's document sets. */
const COLLECTIONS_KEY = "collections";

/** The keys that belong to the family, not to any one tool. */
const FAMILY_KEYS: readonly string[] = [COLLECTIONS_KEY, ENCRYPTION_KEY_FIELD];

function slice(
  document: Document,
  opts: ConfigFileOptions,
): { value: unknown; wrapped: boolean } | null {
  const { doc } = document;
  if (doc !== null && Object.hasOwn(doc, opts.section)) {
    return { value: doc[opts.section] ?? null, wrapped: true };
  }
  // A family file carrying a family key and no section is still this tool's
  // config: the documents are declared (0041), or the key is (0045), and the
  // tool just has no options of its own. Handing back an empty section is
  // what stops discovery walking past it. For the key that matters twice: a
  // file the key prompt created holds nothing else, and the next run must
  // find it.
  if (doc !== null && FAMILY_KEYS.some((key) => Object.hasOwn(doc, key))) {
    return { value: null, wrapped: true };
  }
  return null;
}

/**
 * The document's collections. Parsed with the tool's own `toError`, so a bad
 * `collections:` is reported in the class the tool already catches.
 */
function collectionsOf(
  document: Document,
  source: string,
  toError: ToError,
): CollectionConfig[] {
  const { doc } = document;
  if (doc === null || !Object.hasOwn(doc, COLLECTIONS_KEY)) return [];
  return parseCollections(doc[COLLECTIONS_KEY], source, toError);
}

/**
 * The document's encryption key, as a spreadable field. A malformed one is an
 * error in the tool's class, and the message never repeats the value: it is
 * key material, and a CI log is not the place for it.
 */
function encryptionKeyOf(
  document: Document,
  source: string,
  toError: ToError,
): { encryptionKey?: string } {
  const { doc } = document;
  if (doc === null || !Object.hasOwn(doc, ENCRYPTION_KEY_FIELD)) return {};
  const value = doc[ENCRYPTION_KEY_FIELD];
  if (!isValidEncryptionKey(value)) {
    throw toError(
      `${source}: "${ENCRYPTION_KEY_FIELD}" must be at least 32 hex or base64url characters. Run \`manni key set\` to generate one.`,
    );
  }
  return { encryptionKey: value };
}

function relativeSource(cwd: string, path: string): string {
  return relative(cwd, path).replace(/\\/g, "/");
}

function mooseWarning(name: string): string {
  return `"${name}" is the pre-rename name of the family config file. Rename it to "${FAMILY_CONFIG_NAMES[0] ?? "manni.config.yaml"}".`;
}

const FAMILY_FILES: readonly {
  names: readonly string[];
  kind: "manni" | "moose";
}[] = [
  { names: FAMILY_CONFIG_NAMES, kind: "manni" },
  { names: MOOSE_CONFIG_NAMES, kind: "moose" },
];

/**
 * Discover the tool's config from `cwd` upward. `null` when nothing exists.
 */
export async function findConfigFile(
  cwd: string,
  opts: ConfigFileOptions,
): Promise<ConfigFile | null> {
  const start = resolve(cwd);
  for (const dir of searchPath(start)) {
    for (const { names, kind } of FAMILY_FILES) {
      for (const name of names) {
        const path = join(dir, name);
        const source = relativeSource(start, path);
        const document = await readDocument(path, source, opts.toError);
        if (document === null) continue;
        const found = slice(document, opts);
        // A family file without this tool's key belongs to a sibling. Keep
        // looking, rather than treating the file as an empty config.
        if (found === null) continue;
        if (kind === "moose") warn(mooseWarning(name));
        return {
          path,
          dir,
          source,
          text: document.text,
          kind,
          collections: collectionsOf(document, source, opts.toError),
          ...encryptionKeyOf(document, source, opts.toError),
          ...found,
        };
      }
    }
    for (const name of opts.legacyNames) {
      const path = join(dir, name);
      const source = relativeSource(start, path);
      const document = await readDocument(path, source, opts.toError);
      if (document === null) continue;
      warn(
        `"${name}" is a deprecated config file name and will stop being read in a future major version. Move its keys under \`${opts.section}:\` in "${FAMILY_CONFIG_NAMES[0] ?? "manni.config.yaml"}", and its paths, exclude and sidecars keys to a top-level collections: list, where sidecars becomes externalMetadata.`,
      );
      return {
        path,
        dir,
        source,
        text: document.text,
        value: document.doc,
        wrapped: false,
        kind: "legacy",
        collections: [],
      };
    }
  }
  return null;
}

/**
 * Read the config at an explicit path. Missing is an error: a `-c` pointing
 * at a file that is not there is a mistake worth failing on, not a reason to
 * quietly run against something else.
 */
export async function readConfigFile(
  explicitPath: string,
  cwd: string,
  opts: ConfigFileOptions,
): Promise<ConfigFile> {
  const path = resolve(cwd, explicitPath);
  // Report the spelling the user typed, not the resolved absolute path.
  const document = await readDocument(path, explicitPath, opts.toError);
  if (document === null) {
    throw opts.toError(`Config file not found: "${explicitPath}".`);
  }
  const found = slice(document, opts) ?? {
    value: document.doc,
    wrapped: false,
  };
  return {
    path,
    dir: dirname(path),
    source: explicitPath,
    text: document.text,
    kind: "explicit",
    collections: collectionsOf(document, explicitPath, opts.toError),
    // An unwrapped document carries no family key (else it would be wrapped),
    // so this only ever reads a family file's key.
    ...encryptionKeyOf(document, explicitPath, opts.toError),
    ...found,
  };
}

/**
 * The nearest family file from `cwd` upward, whatever it carries: any tool's
 * section, a family key, or nothing at all. For `manni key`, which writes the
 * family's key and so belongs to no one tool's section. Never a legacy
 * per-tool file, whose whole document is one tool's section.
 *
 * `value` is `null` and `wrapped` is `true`: no tool's section is handed
 * over. `encryptionKey` is set only when the file holds a valid one. A
 * malformed key is not an error here, unlike in `findConfigFile`, because
 * replacing it is what the caller is for.
 */
export async function findFamilyConfigFile(
  cwd: string,
  toError: ToError,
): Promise<ConfigFile | null> {
  const start = resolve(cwd);
  for (const dir of searchPath(start)) {
    for (const { names, kind } of FAMILY_FILES) {
      for (const name of names) {
        const path = join(dir, name);
        const source = relativeSource(start, path);
        const document = await readDocument(path, source, toError);
        if (document === null) continue;
        if (kind === "moose") warn(mooseWarning(name));
        const key = document.doc?.[ENCRYPTION_KEY_FIELD];
        return {
          path,
          dir,
          source,
          text: document.text,
          value: null,
          wrapped: true,
          kind,
          collections: collectionsOf(document, source, toError),
          ...(isValidEncryptionKey(key) ? { encryptionKey: key } : {}),
        };
      }
    }
  }
  return null;
}
