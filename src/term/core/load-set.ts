/**
 * Load a term set: resolve the run's files, extract each one's metadata with
 * meta's extractor, and offer it to every reader of its format. Every command
 * that reads terms goes through here, so a construct added as a reader is read
 * by `list`, `get`, `check`, `lint` and `write` at once.
 *
 * Every loaded file contributes its references too, term file or not: a
 * guide's `concepts:` is what `undefined-term` and `unused-term` are about.
 * Its `graph:` block joins the hierarchy `broader-cycle` reads (proposal 0086).
 *
 * A file that cannot be read or parsed is an error, not a skip. A term set that
 * quietly lost a file would pass `check` on what was left, and report the
 * missing terms as undefined on pages that spell them correctly.
 */
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import {
  STDIN_LABEL,
  STDIN_TOKEN,
  assertNonEmpty,
  extractorByName,
  extractorForExtension,
  gitignoreOptions,
  resolveTargetSet,
  supportedExtensions,
} from "../../meta/internal.js";
import { errorMessage } from "../../shared/errors.js";
import { CONCEPT_FIELDS, type FieldPath, fieldPointer, valueAt } from "../../shared/reference-fields.js";
import { TermError } from "../errors.js";
import type { TermBlock, TermInput, TermReader, TermReference, TermRun, TermSet } from "../types.js";
import { TERM_READERS, readersForFormat } from "./readers/index.js";

/** The `TermInput.format` a manifest is offered as. */
export const MANIFEST_FORMAT = "manifest";

/** The extensions a file named on the command line is read as a manifest by. */
const MANIFEST_EXTENSIONS: ReadonlySet<string> = new Set([".yaml", ".yml", ".json"]);

/** The `TermInput.format` a TBX file is offered as, and the `--as` value that reads stdin as one. */
export const TBX_FORMAT = "tbx";

/** The extension a TBX file is read by, named or walked. It is the term loader's, not an extractor's. */
const TBX_EXTENSION = ".tbx";

/** A TBX file carries no page metadata either; its reader parses the content itself. */
export function tbxInput(content: string, file: string, path?: string): TermInput {
  return { content, file, ...(path === undefined ? {} : { path }), format: TBX_FORMAT, metadata: {}, lineFor: () => undefined };
}

/** What a directory or glob walk keeps when `--ext` is not given: every extractor's extensions, and TBX. */
function defaultExtensions(): string[] {
  return [...supportedExtensions(), TBX_EXTENSION];
}

/** A manifest carries no page metadata; its reader parses the content itself. */
function manifestInput(content: string, file: string, path: string): TermInput {
  return { content, file, path, format: MANIFEST_FORMAT, metadata: {}, lineFor: () => undefined };
}

export interface LoadTermSetOptions {
  run: TermRun;
  /** Stdin's content, when `-` is among the run's inputs. */
  stdin?: string;
  /** `--as <format>`, which stdin needs. */
  as?: string;
  /** `--exclude <glob>`, repeatable. */
  exclude?: string[];
  /** `--ext <list>`: the extensions a directory or glob walk keeps. */
  exts?: string[];
  /** `--allow-empty`: wins over `term.allowEmpty`. */
  allowEmpty?: boolean;
  /** `--no-gitignore`. */
  noGitignore?: boolean;
  onNotice?: (message: string) => void;
  /** The readers to offer files to. Tests hand in their own. */
  readers?: readonly TermReader[];
  /** Every page the run extracted, term page or not, as it was read. */
  onPage?: (input: TermInput) => void;
}

/** One value or a list of them, as `concepts:` is spelled. Anything else contributes nothing. */
function labelsOf(value: unknown): string[] {
  if (typeof value === "string") return value.trim() === "" ? [] : [value];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
  }
  return [];
}

/** The page's `language`, which its names resolve in first. */
function languageOf(input: TermInput): { language?: string } {
  const language = input.metadata["language"];
  return typeof language === "string" && language !== "" ? { language } : {};
}

function lineAt(input: TermInput, path: FieldPath): { line?: number } {
  const line = input.lineFor(fieldPointer(path));
  return line === undefined ? {} : { line };
}

function referencesOf(input: TermInput): TermReference[] {
  const references: TermReference[] = [];
  for (const path of CONCEPT_FIELDS) {
    for (const label of labelsOf(valueAt(input.metadata, path))) {
      references.push({
        file: input.file,
        label,
        ...lineAt(input, path),
        ...(path.length > 1 ? { field: path.join(".") } : {}),
        ...languageOf(input),
      });
    }
  }
  return references;
}

const BLOCK_HIERARCHY_FIELDS = ["broader", "narrower", "related-concepts"] as const;

/** The page's `graph:` block, when it has a label: the concept it is about, and that concept's place in the hierarchy. */
function blocksOf(input: TermInput): TermBlock[] {
  const label = valueAt(input.metadata, ["graph", "label"]);
  if (typeof label !== "string" || label.trim() === "") return [];
  const edges = BLOCK_HIERARCHY_FIELDS.flatMap((field) =>
    labelsOf(valueAt(input.metadata, ["graph", field])).map((value) => ({
      field,
      value,
      ...lineAt(input, ["graph", field]),
    })),
  );
  const altLabels = labelsOf(valueAt(input.metadata, ["graph", "alt-labels"]));
  const definition = valueAt(input.metadata, ["graph", "definition"]);
  return [
    {
      file: input.file,
      ...lineAt(input, ["graph"]),
      ...languageOf(input),
      label,
      edges,
      ...(altLabels.length > 0 ? { altLabels } : {}),
      ...(typeof definition === "string" && definition.trim() !== "" ? { definition } : {}),
    },
  ];
}

/** A page's free `keywords:`, which `keyword-candidate` reads. A term page's are about the term, so it has none. */
function keywordsOf(input: TermInput): TermReference[] {
  const type = input.metadata["type"];
  if (type === "term" || type === "term-set") return [];
  return labelsOf(input.metadata["keywords"]).map((label) => ({
    file: input.file,
    ...lineAt(input, ["keywords"]),
    label,
    field: "keywords",
    ...languageOf(input),
  }));
}

/** What every page contributes beside its terms: its references, its graph block and its keywords. */
function pageFacts(input: TermInput, set: TermSet, onPage?: (input: TermInput) => void): void {
  set.references.push(...referencesOf(input));
  set.blocks.push(...blocksOf(input));
  (set.keywords ??= []).push(...keywordsOf(input));
  onPage?.(input);
}

function read(input: TermInput, readers: readonly TermReader[], set: TermSet): void {
  for (const reader of readersForFormat(input.format, readers)) {
    const result = reader.read(input);
    set.terms.push(...result.terms);
    set.notices.push(...result.notices);
  }
}

export function extractInput(
  content: string,
  file: string,
  path: string | undefined,
  format: string,
): TermInput {
  const extractor = extractorByName(format);
  if (extractor === undefined) {
    throw new TermError(`${file}: no reader for format "${format}".`);
  }
  let extracted;
  try {
    extracted = extractor.extract(content, path ?? file);
  } catch (error) {
    throw new TermError(`${file}: could not be read as ${format}: ${errorMessage(error)}`);
  }
  return {
    content,
    file,
    ...(path === undefined ? {} : { path }),
    format: extractor.name,
    metadata: extracted.data,
    lineFor: extracted.lineFor,
  };
}

async function readInput(path: string, file: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    throw new TermError(`${file}: could not be read: ${errorMessage(error)}`);
  }
}

export async function loadTermSet(opts: LoadTermSetOptions): Promise<TermSet> {
  const { run } = opts;
  const readers = opts.readers ?? TERM_READERS;
  const exclude = opts.exclude ?? [];
  const allowEmpty = opts.allowEmpty ?? run.config?.allowEmpty === true;

  const usingStdin = run.inputs.includes(STDIN_TOKEN);
  const inputs = run.inputs.filter((input) => input !== STDIN_TOKEN);
  if (usingStdin && (opts.as === undefined || opts.as === "")) {
    throw new TermError("reading stdin needs --as <format>.");
  }
  if (inputs.length === 0 && !usingStdin && run.manifests.length === 0) {
    throw new TermError(
      "No files to read. Pass paths/globs, or declare a collection under `collections:` in manni.config.yaml.",
    );
  }

  const set: TermSet = { terms: [], references: [], blocks: [], keywords: [], notices: [] };

  if (inputs.length > 0) {
    const { files, gitignoreSkipped, named } = await resolveTargetSet({
      inputs,
      cwd: run.base,
      exclude,
      exts: opts.exts ?? defaultExtensions(),
      allowEmpty,
      ...gitignoreOptions({
        ...(opts.noGitignore === true ? { flag: false } : {}),
        ...(run.config?.respectGitignore === undefined
          ? {}
          : { configured: run.config.respectGitignore }),
        ...(opts.onNotice ? { onNotice: opts.onNotice } : {}),
      }),
    });
    assertNonEmpty({
      files,
      inputs,
      usingStdin,
      allowEmpty,
      exclude,
      ...(opts.exts === undefined ? {} : { exts: opts.exts }),
      gitignoreSkipped,
      action: "read",
    });

    const namedFiles = new Set(named);
    for (const file of files) {
      const path = resolve(run.base, file);
      // A manifest is read when it is named, never when a walk passes it: a
      // directory of pages can hold YAML and JSON that are not terms at all.
      if (namedFiles.has(file) && MANIFEST_EXTENSIONS.has(extname(file).toLowerCase())) {
        read(manifestInput(await readInput(path, file), file, path), readers, set);
        continue;
      }
      if (extname(file).toLowerCase() === TBX_EXTENSION) {
        read(tbxInput(await readInput(path, file), file, path), readers, set);
        continue;
      }
      const extractor = extractorForExtension(extname(file));
      // A file the walk returned always has a known extension; a path typed
      // with another one is refused here rather than read as nothing.
      if (extractor === undefined) {
        throw new TermError(`${file}: no reader for its extension. Pass --as <format> through stdin to read it.`);
      }
      const input = extractInput(await readInput(path, file), file, path, extractor.name);
      pageFacts(input, set, opts.onPage);
      read(input, readers, set);
    }
  }

  if (usingStdin && opts.as !== undefined) {
    const input =
      opts.as.toLowerCase() === TBX_FORMAT
        ? tbxInput(opts.stdin ?? "", STDIN_LABEL)
        : extractInput(opts.stdin ?? "", STDIN_LABEL, undefined, opts.as);
    pageFacts(input, set, opts.onPage);
    read(input, readers, set);
  }

  for (const { path, written } of run.manifests) {
    let content: string;
    try {
      content = await readFile(path, "utf8");
    } catch {
      const source = run.configSource ?? "manni.config.yaml";
      throw new TermError(`${source}: term.manifests "${written}" does not exist.`);
    }
    const isTbx = extname(path).toLowerCase() === TBX_EXTENSION;
    read(isTbx ? tbxInput(content, path, path) : manifestInput(content, path, path), readers, set);
  }

  if (set.terms.length === 0 && !allowEmpty) {
    throw new TermError(
      "no terms found. A term is a page declaring type: term, or an entry in a file declaring type: term-set.",
    );
  }
  return set;
}
