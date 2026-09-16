/**
 * Load a term set: resolve the run's files, extract each one's metadata with
 * meta's extractor, and offer it to every reader of its format. Every command
 * that reads terms goes through here, so a construct added as a reader is read
 * by `list`, `get`, `check`, `lint` and `write` at once.
 *
 * Every loaded file contributes its references too, term file or not: a
 * guide's `concepts:` is what `undefined-term` and `unused-term` are about.
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
} from "../../meta/internal.js";
import { errorMessage } from "../../shared/errors.js";
import { TermError } from "../errors.js";
import type { TermInput, TermReader, TermReference, TermRun, TermSet } from "../types.js";
import { TERM_READERS, readersForFormat } from "./readers/index.js";

/** The `TermInput.format` a manifest is offered as. */
export const MANIFEST_FORMAT = "manifest";

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
}

/** One value or a list of them, as `concepts:` is spelled. Anything else contributes nothing. */
function labelsOf(value: unknown): string[] {
  if (typeof value === "string") return value.trim() === "" ? [] : [value];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
  }
  return [];
}

function referencesOf(input: TermInput): TermReference[] {
  const references: TermReference[] = [];
  const add = (value: unknown, pointer: string): void => {
    for (const label of labelsOf(value)) {
      const line = input.lineFor(pointer);
      references.push({ file: input.file, label, ...(line === undefined ? {} : { line }) });
    }
  };
  add(input.metadata["concepts"], "/concepts");
  const kg = input.metadata["kg"];
  if (typeof kg === "object" && kg !== null && !Array.isArray(kg)) {
    add((kg as Record<string, unknown>)["concepts"], "/kg/concepts");
  }
  return references;
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

  const set: TermSet = { terms: [], references: [], notices: [] };

  if (inputs.length > 0) {
    const { files, gitignoreSkipped } = await resolveTargetSet({
      inputs,
      cwd: run.base,
      exclude,
      ...(opts.exts === undefined ? {} : { exts: opts.exts }),
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

    for (const file of files) {
      const path = resolve(run.base, file);
      const extractor = extractorForExtension(extname(file));
      // A file the walk returned always has a known extension; a path typed
      // with another one is refused here rather than read as nothing.
      if (extractor === undefined) {
        throw new TermError(`${file}: no reader for its extension. Pass --as <format> through stdin to read it.`);
      }
      let content: string;
      try {
        content = await readFile(path, "utf8");
      } catch (error) {
        throw new TermError(`${file}: could not be read: ${errorMessage(error)}`);
      }
      const input = extractInput(content, file, path, extractor.name);
      set.references.push(...referencesOf(input));
      read(input, readers, set);
    }
  }

  if (usingStdin && opts.as !== undefined) {
    const input = extractInput(opts.stdin ?? "", STDIN_LABEL, undefined, opts.as);
    set.references.push(...referencesOf(input));
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
    const input: TermInput = {
      content,
      file: path,
      path,
      format: MANIFEST_FORMAT,
      metadata: {},
      lineFor: () => undefined,
    };
    read(input, readers, set);
  }

  if (set.terms.length === 0 && !allowEmpty) {
    throw new TermError(
      "no terms found. A term is a page declaring type: term, or an entry in a file declaring type: term-set.",
    );
  }
  return set;
}
