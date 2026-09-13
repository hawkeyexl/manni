/**
 * Page discovery: resolve the run's document set (positional paths, or the
 * family `collections:`), read each file, and extract frontmatter using
 * docmeta's shared extractor (identical fence handling and JSON-Pointer ->
 * line maps as `docmeta validate`).
 */
import { readFileSync, statSync } from "node:fs";
import { resolve, relative, extname } from "node:path";
import fg from "fast-glob";
import { extractFrontmatter, type ExtractedMetadata } from "../../meta/index.js";
import { selectCollections } from "../../shared/collections.js";
import { errorMessage } from "../../shared/errors.js";
import { DocevalsError } from "../types.js";
import {
  assertCollectionWithoutPaths,
  DEFAULT_CONFIG_FILENAME,
  type DocevalsConfig,
  type RunConfigOptions,
} from "./config.js";

export interface PageFile {
  /** Path relative to the discovery root, forward slashes. */
  file: string;
  absPath: string;
  /** Full file content. */
  content: string;
  /** Content with the leading frontmatter block removed (judge input). */
  body: string;
  frontmatter: ExtractedMetadata;
  /** Set when frontmatter extraction failed; the page is reported as errored. */
  extractError?: string;
}

export type FrontmatterFormat = "yaml" | "toml" | "json";

const FENCES: {
  format: FrontmatterFormat;
  open: RegExp;
  isClose: (l: string) => boolean;
}[] = [
  { format: "yaml", open: /^---\r?\n/, isClose: (l) => l === "---" || l === "..." },
  { format: "toml", open: /^\+\+\+\r?\n/, isClose: (l) => l === "+++" },
  { format: "json", open: /^;;;\r?\n/, isClose: (l) => l === ";;;" },
];

/** The frontmatter format a page opens with, or undefined if it has none. */
export function leadingFrontmatterFormat(
  content: string,
): FrontmatterFormat | undefined {
  const body = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  return FENCES.find((f) => f.open.test(body))?.format;
}

/** Remove a leading fenced frontmatter block, mirroring docmeta's fence rules. */
export function stripFrontmatterBlock(content: string): string {
  const body =
    content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  const fence = FENCES.find((f) => f.open.test(body));
  if (!fence) return body;
  const lines = body.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    if (fence.isClose(lines[i] ?? "")) {
      return lines.slice(i + 1).join("\n");
    }
  }
  return body;
}

function formatForExtension(ext: string): string {
  switch (ext.toLowerCase()) {
    case ".md":
    case ".markdown":
      return "markdown";
    case ".mdx":
      return "mdx";
    default:
      return "markdown";
  }
}

/** Read and extract a single page. Extraction errors are captured, not thrown. */
export function readPage(absPath: string, root: string): PageFile {
  const content = readFileSync(absPath, "utf8");
  const file = relative(root, absPath).replace(/\\/g, "/");
  const format = formatForExtension(extname(absPath));
  try {
    const frontmatter = extractFrontmatter(content, format);
    return {
      file,
      absPath,
      content,
      body: stripFrontmatterBlock(content),
      frontmatter,
    };
  } catch (e) {
    return {
      file,
      absPath,
      content,
      body: stripFrontmatterBlock(content),
      frontmatter: {
        data: {},
        present: false,
        format,
        lineFor: () => undefined,
      },
      extractError: errorMessage(e),
    };
  }
}

/**
 * What every tool in the family never reads, whatever it was asked for. The
 * same pair meta's file walk and cite's source index ignore; it replaced
 * docevals' own `files.exclude` default (proposal 0041).
 */
const FAMILY_EXCLUDE = ["**/node_modules/**", "**/.git/**"];

/** The word the empty-input message uses for what the command would do. */
export type DocumentVerb = "evaluate" | "list" | "fill" | "read";

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
  /** Defaults to `evaluate`. */
  verb?: DocumentVerb;
}

/**
 * The document-set options every command that reads pages takes beside its
 * positional paths: `-c`, `--no-config`, `--collection` and `--exclude`.
 */
export interface DocumentInputOptions
  extends Pick<DocumentSetOptions, "collection" | "exclude"> {
  /** `-c/--config`. */
  config?: string;
  /** `--no-config`: skip discovery and run on the built-in defaults. */
  noConfig?: boolean;
}

/** A command's inputs as `loadRunConfig` reads them. */
export function runConfigOptions(
  paths: string[],
  options: DocumentInputOptions,
): RunConfigOptions {
  return {
    paths,
    ...(options.config === undefined ? {} : { configPath: options.config }),
    ...(options.noConfig === undefined ? {} : { noConfig: options.noConfig }),
    ...(options.collection === undefined ? {} : { collection: options.collection }),
  };
}

/** A command's inputs as `discoverPages` reads them. */
export function documentSet(
  paths: string[],
  options: DocumentInputOptions,
  verb: DocumentVerb,
): DocumentSetOptions {
  return {
    paths,
    verb,
    ...(options.collection === undefined ? {} : { collection: options.collection }),
    ...(options.exclude === undefined ? {} : { exclude: options.exclude }),
  };
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
    // Missing: kept as written, so it matches nothing and the empty-match
    // error below names it.
    return [input.replace(/\\/g, "/")];
  }
  const literal = fg.convertPathToPattern(input);
  return [isDirectory ? `${literal.replace(/\/$/, "")}/**/*` : literal];
}

/** Every supported page `patterns` match beneath `base`, as absolute paths. */
function glob(patterns: string[], base: string, ignore: string[]): string[] {
  return fg.sync(patterns.flatMap((p) => toPatterns(p, base)), {
    cwd: base,
    ignore,
    absolute: true,
    dot: false,
    onlyFiles: true,
  });
}

const SUPPORTED_EXTENSIONS = new Set([".md", ".markdown", ".mdx"]);

/**
 * Discover pages (proposal 0041). Positional `paths` are what the operator
 * typed, resolved from `root` (the working directory). Without them the run
 * reads the selected collections, each collection's `paths:` resolved from the
 * config file's directory and narrowed by its own `exclude:`. The family-wide
 * exclusions and `--exclude` apply to both. Page labels stay relative to
 * `root` either way.
 */
export function discoverPages(
  config: DocevalsConfig,
  options: DocumentSetOptions = {},
  root = process.cwd(),
): PageFile[] {
  const paths = options.paths ?? [];
  const wanted = options.collection ?? [];
  assertCollectionWithoutPaths(wanted, paths);
  if (wanted.length > 0 && config.configSource === null) {
    throw new DocevalsError("--collection needs a config file to select from.");
  }
  const collections = selectCollections(
    config.collections,
    wanted,
    config.configSource ?? DEFAULT_CONFIG_FILENAME,
    (message) => new DocevalsError(message),
  );

  const exclude = [...FAMILY_EXCLUDE, ...(options.exclude ?? [])];
  let entries: string[];
  let patterns: string[];
  if (paths.length > 0) {
    patterns = paths;
    entries = glob(paths, root, exclude);
  } else {
    // A collection's `exclude:` shapes that collection only, so each is walked
    // with its own and the results are joined: a file excluded from one
    // collection is still read when another collection holds it.
    patterns = collections.flatMap((c) => c.paths);
    if (patterns.length === 0) {
      throw new DocevalsError(
        `No files to ${options.verb ?? "evaluate"}. Pass paths/globs, or declare a collection under \`collections:\` in manni.config.yaml.`,
      );
    }
    entries = collections.flatMap((c) =>
      glob(c.paths, config.configDir, [...exclude, ...c.exclude]),
    );
  }

  const files = [
    ...new Set(entries.filter((p) => SUPPORTED_EXTENSIONS.has(extname(p).toLowerCase()))),
  ];
  if (files.length === 0) {
    throw new DocevalsError(
      `No documentation pages found (patterns: ${patterns.join(", ")})`,
    );
  }
  return files.sort().map((p) => readPage(resolve(p), root));
}
