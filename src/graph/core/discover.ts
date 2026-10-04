/**
 * Input discovery: expand the run's document set to a stable, sorted,
 * deduplicated list of cwd-relative forward-slash paths. Determinism starts
 * here — the file list order is independent of glob order and filesystem
 * enumeration order.
 *
 * The set itself is the family's (proposal 0041, and 0051 §1 copying 0048 §1):
 * positional paths, or the collections declared once at the top level of
 * `manni.config.yaml`. `graph.inputs` and `graph.exclude` are gone, and a run that
 * names neither is an operational error rather than a silent walk of every
 * markdown file beneath the working directory (proposal 0014).
 */
import { statSync } from "node:fs";
import { extname, relative, resolve } from "node:path";
import fg from "fast-glob";
import { STDIN_REQUIRES_AS } from "../../shared/cli-options.js";
import { selectCollections } from "../../shared/collections.js";
import { GraphError } from "../types.js";
import { DOC_FORMATS, type DocFormat } from "./analyze.js";
import {
  assertCollectionWithoutPaths,
  DEFAULT_CONFIG_FILENAME,
  type GraphConfig,
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
 * ignore; it replaced graph's own `exclude` default (proposal 0041).
 */
const FAMILY_EXCLUDE = ["**/node_modules/**", "**/.git/**"];

/**
 * What graph can read. `analyzeDoc` parses markdown, and MDX when the path or
 * `--as` says so; nothing else is a document. A file named on the command line
 * is kept when its extension is one of these, or when `--as` names its format.
 */
const SUPPORTED_EXTENSIONS = new Set([".md", ".markdown", ".mdx"]);

/**
 * What a directory walk or a glob keeps when `--ext` is not given. The filter
 * matters because a positional path may be a *directory*, which expands to
 * everything beneath it. Without it, `manni graph build docs` would mint a
 * graph node for every image and data file in the tree, and a node's IRI is
 * the part of the output a consumer stores.
 */
export const DEFAULT_EXTENSIONS = [".md", ".mdx", ".markdown"];

/** The positional that reads stdin. One more input, never instead of the rest. */
export const STDIN = "-";

/**
 * Hold `--as` to the formats graph parses, and require it with `-`: stdin has
 * no file name to choose a parser by. Returns the format, or undefined when
 * none was forced.
 */
export function assertInputFormat(
  paths: readonly string[],
  as: string | undefined,
): DocFormat | undefined {
  if (as !== undefined && !(DOC_FORMATS as readonly string[]).includes(as)) {
    throw new GraphError(
      `Unknown format "${as}". Known formats: ${DOC_FORMATS.join(", ")}.`,
    );
  }
  if (paths.includes(STDIN) && as === undefined) {
    throw new GraphError(STDIN_REQUIRES_AS);
  }
  return as as DocFormat | undefined;
}

/** The word the empty-input message uses for what the command would do. */
export type DocumentVerb = "build" | "fill";

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
  /**
   * `--ext <list>`: what a directory walk or a glob keeps. Absent means
   * `.md,.mdx,.markdown`. A file named outright is never filtered by it.
   */
  ext?: string[];
  /** `--as <format>`: parse every input as this format. Required with `-`. */
  as?: string;
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
 * Every file `inputs` match beneath `base`, as absolute paths, split by how
 * they were reached. A file named outright is `named`. A directory expands to
 * everything beneath it, and a glob is left for fast-glob to interpret; both
 * land in `walked`, the half `--ext` filters. A literal path with `(` or `[`
 * in its name still means itself, because only the glob is a pattern.
 */
function expandInputs(
  inputs: string[],
  base: string,
  ignore: string[],
): { named: string[]; walked: string[] } {
  const named: string[] = [];
  const patterns: string[] = [];
  for (const input of inputs) {
    if (fg.isDynamicPattern(input)) {
      patterns.push(input.replace(/\\/g, "/"));
      continue;
    }
    let isDirectory: boolean;
    try {
      isDirectory = statSync(resolve(base, input)).isDirectory();
    } catch {
      // Missing: kept as written, so it matches nothing and the caller's
      // empty-match error names it.
      patterns.push(input.replace(/\\/g, "/"));
      continue;
    }
    const literal = fg.convertPathToPattern(input);
    if (isDirectory) patterns.push(`${literal.replace(/\/$/, "")}/**/*`);
    else named.push(...glob([literal], base, ignore));
  }
  return { named, walked: glob(patterns, base, ignore) };
}

function glob(patterns: string[], base: string, ignore: string[]): string[] {
  if (patterns.length === 0) return [];
  return fg.sync(patterns, {
    cwd: base,
    ignore,
    absolute: true,
    dot: false,
    onlyFiles: true,
  });
}

/** `--ext` values as lower-case extensions with their dot. */
function normalizeExtensions(exts: readonly string[]): Set<string> {
  return new Set(
    exts.map((e) => {
      const lower = e.toLowerCase();
      return lower.startsWith(".") ? lower : `.${lower}`;
    }),
  );
}

/**
 * The documents a run covers. Positional `paths` are what the operator typed,
 * resolved from `cwd`. Without them the run reads the selected collections,
 * each collection's `paths:` resolved from the config file's directory and
 * narrowed by its own `exclude:`. The family-wide exclusions and `--exclude`
 * apply to both. Labels stay relative to `cwd` either way, because a graph
 * node's IRI is derived from the path the build was asked about.
 *
 * `-` is not a file, so it is left out of what this returns: the caller reads
 * stdin itself. It still counts as a positional path, so a run given only `-`
 * reads stdin alone and never falls back to the collections.
 */
export function resolveDocumentSet(
  config: GraphConfig,
  options: DocumentSetOptions = {},
  verb: DocumentVerb = "build",
  cwd = process.cwd(),
): string[] {
  const paths = options.paths ?? [];
  const wanted = options.collection ?? [];
  assertCollectionWithoutPaths(wanted, paths);
  const format = assertInputFormat(paths, options.as);
  if (wanted.length > 0 && config.configSource === null) {
    throw new GraphError("--collection needs a config file to select from.");
  }
  const collections = selectCollections(
    config.collections,
    wanted,
    config.configSource ?? DEFAULT_CONFIG_FILENAME,
    (message) => new GraphError(message),
  );

  const exclude = [...FAMILY_EXCLUDE, ...(options.exclude ?? [])];
  let named: string[] = [];
  let walked: string[];
  if (paths.length > 0) {
    ({ named, walked } = expandInputs(
      paths.filter((p) => p !== STDIN),
      cwd,
      exclude,
    ));
  } else {
    // A collection's `exclude:` shapes that collection only, so each is walked
    // with its own and the results are joined.
    const patterns = collections.flatMap((c) => c.paths);
    if (patterns.length === 0) {
      throw new GraphError(
        `No files to ${verb}. Pass paths/globs, or declare a collection under \`collections:\` in manni.config.yaml.`,
      );
    }
    walked = collections.flatMap((c) => {
      const found = expandInputs(c.paths, config.configDir, [
        ...exclude,
        ...c.exclude,
      ]);
      return [...found.named, ...found.walked];
    });
  }

  const exts = normalizeExtensions(options.ext ?? DEFAULT_EXTENSIONS);
  const keepNamed = (p: string): boolean =>
    format !== undefined || SUPPORTED_EXTENSIONS.has(extname(p).toLowerCase());
  const keepWalked = (p: string): boolean => exts.has(extname(p).toLowerCase());
  return [
    ...new Set(
      [...named.filter(keepNamed), ...walked.filter(keepWalked)].map((p) =>
        relative(cwd, p).replace(/\\/g, "/"),
      ),
    ),
  ].sort(byCodeUnit);
}

/** The patterns a run asked about, for the empty-match message. */
export function documentSetPatterns(
  config: GraphConfig,
  options: DocumentSetOptions = {},
): string[] {
  const paths = options.paths ?? [];
  if (paths.length > 0) return paths;
  return selectCollections(
    config.collections,
    options.collection ?? [],
    config.configSource ?? DEFAULT_CONFIG_FILENAME,
    (message) => new GraphError(message),
  ).flatMap((c) => c.paths);
}
