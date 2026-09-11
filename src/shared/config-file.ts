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
 * than an import.
 *
 * Two older spellings are still read, each with a warning on discovery:
 *
 * - `moose.config.yaml`, the family file under the pre-rename name. Same
 *   shape, so only the filename is wrong.
 * - each tool's pre-family file (`docmeta.config.yaml` for the metadata
 *   tool), whose whole document is the tool's section with no wrapper key.
 *
 * Within one directory the order is manni, moose, then the legacy names, and
 * `.yaml` before `.yml`. A family file that exists but has no key for this
 * tool is not this tool's config: discovery keeps looking, first at the legacy
 * names beside it (a repository mid-migration, where a sibling tool moved to
 * the family file first) and then up the tree. The walk stops at the nearest
 * `.git` boundary, nearest directory first, and the first hit wins; ancestor
 * files are never merged.
 *
 * An explicit path is read the same way minus the warning: the section key is
 * unwrapped when present and the whole document is taken otherwise, so a
 * `-c ./anything.yaml` needs no filename sniffing and no flag.
 */
import { readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { parseCollections, type CollectionConfig } from "./collections.js";
import { searchPath } from "./git-root.js";
import { warn } from "./warn.js";
import { errorMessage } from "./errors.js";

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
}

interface Document {
  text: string;
  /** Parsed YAML: a mapping, or `null` for an empty file. */
  doc: Record<string, unknown> | null;
}

async function readDocument(
  path: string,
  source: string,
  opts: ConfigFileOptions,
): Promise<Document | null> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return null;
  }
  return { text, doc: parseMapping(text, source, opts) };
}

/**
 * Parse outside any "not found" handling. A discovered file with a typo must
 * be reported, not skipped: falling through to the next candidate, or to no
 * config at all, would run the tool on defaults and read as a clean pass.
 */
function parseMapping(
  text: string,
  source: string,
  opts: ConfigFileOptions,
): Record<string, unknown> | null {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (err) {
    throw opts.toError(`${source}: invalid YAML: ${errorMessage(err)}`);
  }
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw opts.toError(`${source}: top level must be a mapping.`);
  }
  return raw as Record<string, unknown>;
}

/** The top-level key holding the family's document sets. */
const COLLECTIONS_KEY = "collections";

function slice(
  document: Document,
  opts: ConfigFileOptions,
): { value: unknown; wrapped: boolean } | null {
  const { doc } = document;
  if (doc !== null && Object.hasOwn(doc, opts.section)) {
    return { value: doc[opts.section] ?? null, wrapped: true };
  }
  // A family file carrying `collections:` and no section is still this tool's
  // config: the documents are declared, the tool just has no options of its
  // own. Handing back an empty section is what stops discovery walking past a
  // file that says which documents exist (0041).
  if (doc !== null && Object.hasOwn(doc, COLLECTIONS_KEY)) {
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
  opts: ConfigFileOptions,
): CollectionConfig[] {
  const { doc } = document;
  if (doc === null || !Object.hasOwn(doc, COLLECTIONS_KEY)) return [];
  return parseCollections(doc[COLLECTIONS_KEY], source, opts.toError);
}

function relativeSource(cwd: string, path: string): string {
  return relative(cwd, path).replace(/\\/g, "/");
}

/**
 * Discover the tool's config from `cwd` upward. `null` when nothing exists.
 */
export async function findConfigFile(
  cwd: string,
  opts: ConfigFileOptions,
): Promise<ConfigFile | null> {
  const start = resolve(cwd);
  for (const dir of searchPath(start)) {
    const family: { names: readonly string[]; kind: "manni" | "moose" }[] = [
      { names: FAMILY_CONFIG_NAMES, kind: "manni" },
      { names: MOOSE_CONFIG_NAMES, kind: "moose" },
    ];
    for (const { names, kind } of family) {
      for (const name of names) {
        const path = join(dir, name);
        const source = relativeSource(start, path);
        const document = await readDocument(path, source, opts);
        if (document === null) continue;
        const found = slice(document, opts);
        // A family file without this tool's key belongs to a sibling. Keep
        // looking, rather than treating the file as an empty config.
        if (found === null) continue;
        if (kind === "moose") {
          warn(
            `"${name}" is the pre-rename name of the family config file. Rename it to "${FAMILY_CONFIG_NAMES[0] ?? "manni.config.yaml"}".`,
          );
        }
        return {
          path,
          dir,
          source,
          text: document.text,
          kind,
          collections: collectionsOf(document, source, opts),
          ...found,
        };
      }
    }
    for (const name of opts.legacyNames) {
      const path = join(dir, name);
      const source = relativeSource(start, path);
      const document = await readDocument(path, source, opts);
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
  const document = await readDocument(path, explicitPath, opts);
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
    collections: collectionsOf(document, explicitPath, opts),
    ...found,
  };
}
