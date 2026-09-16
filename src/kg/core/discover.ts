/**
 * Input discovery: expand the run's document set to a stable, sorted,
 * deduplicated list of cwd-relative forward-slash paths. Determinism starts
 * here — the file list order is independent of glob order and filesystem
 * enumeration order.
 *
 * The set itself is the family's (proposal 0041, and 0051 §1 copying 0048 §1):
 * positional paths, or the collections declared once at the top level of
 * `manni.config.yaml`. `kg.inputs` and `kg.exclude` are gone, and a run that
 * names neither is an operational error rather than a silent walk of every
 * markdown file beneath the working directory (proposal 0014).
 */
import { statSync } from "node:fs";
import { extname, relative, resolve } from "node:path";
import fg from "fast-glob";
import { selectCollections } from "../../shared/collections.js";
import { KgError } from "../types.js";
import {
  assertCollectionWithoutPaths,
  DEFAULT_CONFIG_FILENAME,
  type KgConfig,
} from "./config.js";
import { byCodeUnit } from "./sort.js";

export function discoverFiles(
  inputs: string[],
  exclude: string[],
  cwd: string,
): string[] {
  const matches = fg.sync(inputs, {
    cwd,
    ignore: exclude,
    onlyFiles: true,
    dot: false,
    unique: true,
  });
  return [...new Set(matches.map((m) => m.replace(/\\/g, "/")))].sort(
    byCodeUnit,
  );
}

/**
 * What every tool in the family never reads, whatever it was asked for. The
 * same pair meta's file walk, cite's source index and docevals' discovery
 * ignore; it replaced kg's own `exclude` default (proposal 0041).
 */
const FAMILY_EXCLUDE = ["**/node_modules/**", "**/.git/**"];

/**
 * What kg can read. `analyzeDoc` parses markdown, and MDX when the path says
 * so; nothing else is a document.
 *
 * The filter matters because a positional path may now be a *directory*, which
 * expands to everything beneath it. Without it, `manni kg build docs` would
 * mint a graph node for every image and data file in the tree — and a node's
 * IRI is the part of the output a consumer stores.
 */
const SUPPORTED_EXTENSIONS = new Set([".md", ".markdown", ".mdx"]);

/** The word the empty-input message uses for what the command would do. */
export type DocumentVerb = "build" | "fill" | "validate";

export interface DocumentSetOptions {
  /**
   * Positional paths: files, directories and globs, relative to the working
   * directory. Empty or absent means the selected collections' `paths:`.
   */
  paths?: string[];
  /**
   * `--collection <name>`, repeatable. Empty or absent means every declared
   * collection, because commander's collector hands `[]` over when the flag
   * was never typed (see `selectCollections`).
   */
  collection?: string[];
  /** `--exclude <glob>`, repeatable. Applies to paths and collections alike. */
  exclude?: string[];
}

/**
 * The document-set options every command that reads documents takes beside its
 * positional paths: `-c`, `--no-config`, `--collection` and `--exclude`.
 */
export interface DocumentInputOptions extends DocumentSetOptions {
  /** `-c/--config`. */
  config?: string;
  /** `--no-config`: skip discovery and run on the built-in defaults. */
  noConfig?: boolean;
}

/**
 * One input as fast-glob patterns: a glob as written, an existing file as its
 * escaped literal, and an existing directory as everything beneath it. Only
 * the glob is left for fast-glob to interpret, so a literal path with `(` or
 * `[` in its name still means itself.
 */
function toPatterns(input: string, base: string): string[] {
  if (fg.isDynamicPattern(input)) return [input.replace(/\\/g, "/")];
  let isDirectory: boolean;
  try {
    isDirectory = statSync(resolve(base, input)).isDirectory();
  } catch {
    // Missing: kept as written, so it matches nothing and the caller's
    // empty-match error names it.
    return [input.replace(/\\/g, "/")];
  }
  const literal = fg.convertPathToPattern(input);
  return [isDirectory ? `${literal.replace(/\/$/, "")}/**/*` : literal];
}

/** Every file `patterns` match beneath `base`, as absolute paths. */
function globAbsolute(
  patterns: string[],
  base: string,
  ignore: string[],
): string[] {
  return fg.sync(
    patterns.flatMap((p) => toPatterns(p, base)),
    { cwd: base, ignore, absolute: true, dot: false, onlyFiles: true },
  );
}

/**
 * The documents a run covers. Positional `paths` are what the operator typed,
 * resolved from `cwd`. Without them the run reads the selected collections,
 * each collection's `paths:` resolved from the config file's directory and
 * narrowed by its own `exclude:`. The family-wide exclusions and `--exclude`
 * apply to both. Labels stay relative to `cwd` either way, because a graph
 * node's IRI is derived from the path the build was asked about.
 */
export function resolveDocumentSet(
  config: KgConfig,
  options: DocumentSetOptions = {},
  verb: DocumentVerb = "build",
  cwd = process.cwd(),
): string[] {
  const paths = options.paths ?? [];
  const wanted = options.collection ?? [];
  assertCollectionWithoutPaths(wanted, paths);
  // A graph node's IRI is derived from the file's path, so there is nothing to
  // call a document that arrived on stdin. Refused by name rather than read as
  // a file called "-", which would be a confusing miss.
  if (paths.includes("-")) {
    throw new KgError(
      `kg ${verb} reads files, not stdin: a graph node needs a path.`,
    );
  }
  if (wanted.length > 0 && config.configSource === null) {
    throw new KgError("--collection needs a config file to select from.");
  }
  const collections = selectCollections(
    config.collections,
    wanted,
    config.configSource ?? DEFAULT_CONFIG_FILENAME,
    (message) => new KgError(message),
  );

  const exclude = [...FAMILY_EXCLUDE, ...(options.exclude ?? [])];
  let entries: string[];
  if (paths.length > 0) {
    entries = globAbsolute(paths, cwd, exclude);
  } else {
    // A collection's `exclude:` shapes that collection only, so each is walked
    // with its own and the results are joined.
    const patterns = collections.flatMap((c) => c.paths);
    if (patterns.length === 0) {
      throw new KgError(
        `No files to ${verb}. Pass paths/globs, or declare a collection under \`collections:\` in manni.config.yaml.`,
      );
    }
    entries = collections.flatMap((c) =>
      globAbsolute(c.paths, config.configDir, [...exclude, ...c.exclude]),
    );
  }

  return [
    ...new Set(
      entries
        .filter((p) => SUPPORTED_EXTENSIONS.has(extname(p).toLowerCase()))
        .map((p) => relative(cwd, p).replace(/\\/g, "/")),
    ),
  ].sort(byCodeUnit);
}

/** The patterns a run asked about, for the empty-match message. */
export function documentSetPatterns(
  config: KgConfig,
  options: DocumentSetOptions = {},
): string[] {
  const paths = options.paths ?? [];
  if (paths.length > 0) return paths;
  return selectCollections(
    config.collections,
    options.collection ?? [],
    config.configSource ?? DEFAULT_CONFIG_FILENAME,
    (message) => new KgError(message),
  ).flatMap((c) => c.paths);
}
