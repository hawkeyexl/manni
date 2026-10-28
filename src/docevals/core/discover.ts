/**
 * Page discovery: resolve the run's document set (positional paths, or the
 * family `collections:`), read each file, and extract its metadata with the
 * metadata tool's own extractor for its format (identical fence handling and
 * JSON-Pointer -> line maps as `manni meta validate`). Every format meta reads
 * is a page here (proposal 0125, decision 21).
 */
import { readFileSync, statSync } from "node:fs";
import { resolve, relative, extname } from "node:path";
import fg from "fast-glob";
import { extractFrontmatter, type ExtractedMetadata } from "../../meta/index.js";
import { bodyOffset, extractorForExtension, supportedExtensions } from "../../meta/internal.js";
import { selectCollections } from "../../shared/collections.js";
import { errorMessage } from "../../shared/errors.js";
import { RECORD_TYPES } from "../../strategy/types.js";
import { DocevalsError } from "../types.js";
import type { PageExternal } from "./external.js";
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
  /**
   * What graders read as the page (judge input, `target: body`). For a fenced
   * format, the content with its leading frontmatter block removed. For HTML
   * and XML, the source after the page's metadata, sliced from the file so a
   * grader's line numbers are the file's (`bodyOffset`).
   */
  body: string;
  /**
   * The page's metadata, with every key an owning manifest supplies already
   * merged in (`core/external.ts`). Identical to the frontmatter block when no
   * collection of this page's declares a manifest, which is the common case.
   */
  frontmatter: ExtractedMetadata;
  /**
   * Where a merged value lives, when a manifest supplied it. Absent when the
   * run read no manifest, and its `locate` answers `undefined` for every key
   * the page itself carries.
   */
  external?: PageExternal;
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

/**
 * Remove a leading fenced frontmatter block, mirroring the metadata tool's fence rules.
 *
 * The body is sliced out of the page rather than rebuilt from its lines, so it
 * keeps the page's own line endings. `target: raw` reads the file as written,
 * and `target: body` has to read the same bytes past the fence; a CRLF page
 * whose body came back LF would show a regex eval two different pages.
 */
export function stripFrontmatterBlock(content: string): string {
  const body =
    content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  const fence = FENCES.find((f) => f.open.test(body));
  if (!fence) return body;
  // Split after each newline, so every line keeps its own ending. The fence
  // test above guarantees an opening line.
  const [openLine = "", ...rest] = body.split(/(?<=\n)/);
  let offset = openLine.length;
  for (const line of rest) {
    offset += line.length;
    if (fence.isClose(line.replace(/\r?\n$/, ""))) return body.slice(offset);
  }
  return body;
}

/**
 * `HTML` or `XML` for a page in either, whose body is markup (proposal 0125,
 * decision 21). The judge reads it as text, and no YAML block is written to
 * it. `undefined` for every other format.
 */
export function markupFormat(absPath: string): "HTML" | "XML" | undefined {
  const name = extractorForExtension(extname(absPath))?.name;
  return name === "html" ? "HTML" : name === "xml" ? "XML" : undefined;
}

/**
 * Read and extract a single page. Extraction errors are captured, not thrown.
 * Discovery reads only extensions an extractor claims. A caller naming any
 * other file reads it as Markdown, as every page read before decision 21.
 */
export function readPage(absPath: string, root: string): PageFile {
  const content = readFileSync(absPath, "utf8");
  const file = relative(root, absPath).replace(/\\/g, "/");
  const extractor = extractorForExtension(extname(absPath));
  const format = extractor?.name ?? "markdown";
  try {
    const frontmatter = extractor
      ? extractor.extract(content, absPath)
      : extractFrontmatter(content, format);
    const offset = bodyOffset(content, absPath);
    return {
      file,
      absPath,
      content,
      body: offset === undefined ? stripFrontmatterBlock(content) : content.slice(offset),
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

/** Every extension meta reads (proposal 0125, decision 21). */
const SUPPORTED_EXTENSIONS = new Set(supportedExtensions().map((e) => e.toLowerCase()));

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
  // A strategy record (0102) is not a page. Its `evals:` are a journey's
  // golden evals for `manni test tasks` (0104), in tracevals' vocabulary.
  const pages = files
    .sort()
    .map((p) => readPage(resolve(p), root))
    .filter((page) => !isStrategyRecord(page));
  // No page read means none resolves an eval. A collection of files no
  // extractor reads is that, so the family reads the code as docevals not
  // being set up.
  if (pages.length === 0) {
    throw new DocevalsError(
      `No documentation pages found (patterns: ${patterns.join(", ")})`,
      "nothing-resolved",
    );
  }
  return pages;
}

const RECORD_TYPE_SET: ReadonlySet<unknown> = new Set(RECORD_TYPES);

function isStrategyRecord(page: PageFile): boolean {
  return RECORD_TYPE_SET.has(page.frontmatter.data["type"]);
}
