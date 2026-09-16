/**
 * `manni term write` (proposal 0052 § 5): the set written back to its sources,
 * or rendered somewhere new.
 *
 * With no `-f`, each file's entries go back through the reader that read them,
 * construct by construct. With `-f`, the registered writer renders the whole
 * set into `-o`, whose spelling decides the shape: a trailing separator, an
 * existing directory, or the Vale style make it a directory; anything else is
 * a file. `-f vale` without `-o` asks Vale where its styles live.
 *
 * Writers are pure, so `--check` and `--dry-run` run the same render a write
 * does and differ only in what happens to the result.
 */
import { existsSync, statSync } from "node:fs";
import { lstat, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { extractorForExtension } from "../../meta/internal.js";
import { errorMessage } from "../../shared/errors.js";
import { MANIFEST_FORMAT, extractInput } from "../core/load-set.js";
import { TERM_READERS, readerForConstruct } from "../core/readers/index.js";
import { valeLsConfig, type ValeResolvedConfig } from "../core/vale.js";
import { TERM_WRITERS } from "../core/writers/index.js";
import { TermError } from "../errors.js";
import {
  TERM_WRITE_FORMATS,
  type DroppedField,
  type RenderedFile,
  type Term,
  type TermConstruct,
  type TermInput,
  type TermReader,
  type TermShape,
  type TermTarget,
  type TermWriteFormat,
  type TermWriter,
} from "../types.js";
import { DOCUMENT_RENDERS } from "./formats.js";
import { displayPath, formatChoice, loadTerms, valeConfigFor, type TermCommandOptions } from "./run.js";

export interface WriteOptions extends TermCommandOptions {
  /** `-f, --format`. Absent writes in place. */
  format?: string;
  /** `-o, --out <path>`. */
  out?: string;
  /** `--check`. */
  check?: boolean;
  /** `--dry-run`. */
  dryRun?: boolean;
  /** The writers to render with. Tests hand in their own. */
  writers?: readonly TermWriter[];
  /** `vale ls-config`. Tests hand in a stub. */
  lsConfig?: (opts: { config?: string; cwd: string }) => Promise<ValeResolvedConfig | null>;
}

/** One file the write would change, as a person in `cwd` would name it. */
export interface WriteChange {
  path: string;
  action: "create" | "change" | "remove";
}

/** The `BasedOnStyles` line the notice suggests, when no section uses `Terms`. */
export interface ValeWiring {
  /** The config file Vale resolved, relative to cwd. */
  rootIni: string;
  /** The section glob to add the style to. */
  section: string;
  /** The section's styles with `Terms` appended. */
  styles: string[];
}

export interface WriteReport {
  mode: "in-place" | "render";
  format?: TermWriteFormat;
  shape?: TermShape;
  /** `-o` as typed, or the Vale style directory; relative to cwd. */
  target?: string;
  terms: number;
  /** Files that differ from disk. Under `--check` and `--dry-run` nothing was written. */
  changes: WriteChange[];
  /** The rendered files, relative to cwd, with their content. */
  files: RenderedFile[];
  dropped: DroppedField[];
  /** What a dropped field was dropped from, and a skipped term left out of: `a definition list`, `tbx`. */
  droppedFrom?: string;
  /** Ids of the terms left out because the target construct cannot read them back, in set order. */
  skipped: string[];
  check: boolean;
  dryRun: boolean;
  wiring?: ValeWiring;
}

const STYLE = "Terms";

/** The registered `-f` values, in the order the reference lists them. */
export function writeFormats(writers: readonly TermWriter[] = TERM_WRITERS): TermWriteFormat[] {
  return TERM_WRITE_FORMATS.filter((format) => writers.some((writer) => writer.format === format));
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The largest file under a render target a write reads into the render context.
 * A larger one is there as an empty string: a render never produces an empty
 * file, so it still differs, and the Vale writer refuses it as not its own.
 */
export const MAX_EXISTING_FILE_BYTES = 1024 * 1024;

/** Every regular file under `dir`. A symlink is skipped, never followed. */
async function filesUnder(dir: string, into: Map<string, string>): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    // A Dirent describes the entry itself, so a symlink is neither of these.
    if (entry.isDirectory()) await filesUnder(path, into);
    else if (entry.isFile()) {
      const { size } = await lstat(path);
      into.set(path, size > MAX_EXISTING_FILE_BYTES ? "" : await readFile(path, "utf8"));
    }
  }
}

async function existingFor(target: TermTarget): Promise<Map<string, string>> {
  const existing = new Map<string, string>();
  if (target.shape === "directory") {
    await filesUnder(target.path, existing);
  } else if (existsSync(target.path) && !isDirectory(target.path)) {
    existing.set(target.path, await readFile(target.path, "utf8"));
  }
  return existing;
}

/** A writer's refusal, with every absolute path it names spelled from cwd. */
function relativized(error: TermError, paths: readonly string[], cwd: string): TermError {
  let message = error.message;
  for (const path of [...paths].sort((a, b) => b.length - a.length)) {
    if (message.includes(path)) message = message.replaceAll(path, displayPath(path, cwd));
  }
  return message === error.message ? error : new TermError(message);
}

/** The noun a dropped field was dropped from. */
function droppedFrom(format: TermWriteFormat, shape: TermShape, readers: readonly TermReader[]): string {
  const construct = DOCUMENT_RENDERS[format]?.shapes[shape];
  const reader = construct === undefined ? undefined : readerForConstruct(construct, readers);
  return reader === undefined ? format : `a ${reader.label}`;
}

async function applyChanges(
  files: readonly RenderedFile[],
  removals: readonly string[],
  existing: ReadonlyMap<string, string>,
  cwd: string,
  write: boolean,
): Promise<WriteChange[]> {
  const changes: WriteChange[] = [];
  for (const file of files) {
    const before = existing.get(file.path) ?? (existsSync(file.path) ? await readFile(file.path, "utf8") : undefined);
    if (before === file.content) continue;
    changes.push({ path: displayPath(file.path, cwd), action: before === undefined ? "create" : "change" });
    if (write) {
      await mkdir(dirname(file.path), { recursive: true });
      await writeFile(file.path, file.content, "utf8");
    }
  }
  for (const path of removals) {
    if (!existsSync(path)) continue;
    changes.push({ path: displayPath(path, cwd), action: "remove" });
    if (write) await rm(path, { force: true });
  }
  return changes;
}

export async function runWrite(opts: WriteOptions): Promise<WriteReport> {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const writers = opts.writers ?? TERM_WRITERS;
  const readers = opts.readers ?? TERM_READERS;
  const check = opts.check === true;
  const dryRun = opts.dryRun === true;
  if (check && dryRun) throw new TermError("--check and --dry-run cannot be combined.");

  if (opts.format === undefined) {
    if (opts.out !== undefined) throw new TermError("-o needs -f <format>.");
    return writeInPlace({ ...opts, cwd, readers }, check, dryRun);
  }

  const format = formatChoice(opts.format, writeFormats(writers));
  const writer = writers.find((w) => w.format === format);
  if (writer === undefined) throw new TermError(`unknown format "${format}".`);
  if (opts.out === undefined && format !== "vale") {
    throw new TermError(`-f ${format} needs -o <path>.`);
  }

  const { run, set } = await loadTerms({ ...opts, cwd, readers });

  // Where the render goes, and in which shape.
  let targetPath: string;
  let wiring: ValeWiring | undefined;
  if (opts.out === undefined) {
    const lsConfig = opts.lsConfig ?? ((o) => valeLsConfig(o));
    const config = valeConfigFor(run);
    const resolved = await lsConfig({ cwd, ...(config === undefined ? {} : { config }) });
    if (resolved === null) {
      throw new TermError(
        "Vale found no config file. Set tools.vale.config in manni.config.yaml, or pass -o <styles directory>.",
      );
    }
    targetPath = resolve(cwd, resolved.stylesPath);
    if (!Object.values(resolved.baseStyles).some((styles) => styles.includes(STYLE))) {
      const [section, styles] = Object.entries(resolved.baseStyles)[0] ?? ["*", []];
      wiring = { rootIni: displayPath(resolve(cwd, resolved.rootIni), cwd), section, styles: [...styles, STYLE] };
    }
  } else {
    targetPath = resolve(cwd, opts.out);
  }
  const shape: TermShape =
    format === "vale" || /[\\/]$/.test(opts.out ?? "") || isDirectory(targetPath) ? "directory" : "file";
  const target: TermTarget = { path: targetPath, shape };
  const existing = await existingFor(target);

  let render;
  try {
    render = writer.render(set.terms, target, { existing });
  } catch (error) {
    if (error instanceof TermError) throw relativized(error, [...existing.keys(), targetPath], cwd);
    throw error;
  }

  const changes = await applyChanges(render.files, render.removals, existing, cwd, !check && !dryRun);
  const shown =
    format === "vale" ? displayPath(join(targetPath, STYLE), cwd) : (opts.out ?? displayPath(targetPath, cwd));
  return {
    mode: "render",
    format,
    shape,
    target: shown,
    terms: set.terms.length,
    changes,
    files: render.files.map((file) => ({ path: displayPath(file.path, cwd), content: file.content })),
    // A Vale style holds designations only, by design; its dropped definitions are not news.
    dropped: format === "vale" ? [] : render.dropped,
    droppedFrom: droppedFrom(format, shape, readers),
    skipped: render.skipped,
    check,
    dryRun,
    ...(wiring === undefined ? {} : { wiring }),
  };
}

/** The `TermInput` a construct's reader reads from `content`, rebuilt as the loader built it. */
function inputFor(content: string, path: string, construct: TermConstruct, file: string): TermInput {
  if (construct === "manifest") {
    return { content, file, path, format: MANIFEST_FORMAT, metadata: {}, lineFor: () => undefined };
  }
  const extractor = extractorForExtension(extname(path));
  if (extractor === undefined) throw new TermError(`${file}: no reader for its extension.`);
  return extractInput(content, file, path, extractor.name);
}

/**
 * The caller's records carried onto `current`, the entries a construct's reader
 * read from content an earlier construct rewrote. An entry is matched by `id`;
 * where the id repeats in either list, by its position within the construct.
 * An entry the caller left out keeps the record it was read with.
 */
function carryRecords(current: readonly Term[], edited: readonly Term[]): Term[] {
  const count = (terms: readonly Term[], id: string): number => terms.filter((t) => t.id === id).length;
  return current.map((entry, index) => {
    const unique = count(current, entry.id) === 1 && count(edited, entry.id) === 1;
    const match = unique ? edited.find((t) => t.id === entry.id) : edited[index];
    return match?.id === entry.id ? { ...entry, record: match.record } : entry;
  });
}

/** One file's content with each construct's entries written back through its reader, in order. */
export function applyInPlace(
  original: string,
  path: string,
  file: string,
  constructs: ReadonlyMap<TermConstruct, readonly Term[]>,
  readers: readonly TermReader[],
): string {
  let content = original;
  let first = true;
  for (const [construct, terms] of constructs) {
    const reader = readerForConstruct(construct, readers);
    if (reader?.apply === undefined) continue;
    const input = inputFor(content, path, construct, file);
    // The loaded terms carry offsets into the file as it was read. Once an
    // earlier construct has rewritten it, this one's entries are read again for
    // offsets that are the content's own, and the caller's records carried over.
    content = reader.apply(input, first ? terms : carryRecords(reader.read(input).terms, terms));
    first = false;
  }
  return content;
}

async function writeInPlace(
  opts: WriteOptions & { cwd: string; readers: readonly TermReader[] },
  check: boolean,
  dryRun: boolean,
): Promise<WriteReport> {
  const { cwd, readers } = opts;
  const { set } = await loadTerms(opts);

  // Every file's terms, per construct, in load order.
  const byPath = new Map<string, { file: string; constructs: Map<TermConstruct, Term[]> }>();
  for (const term of set.terms) {
    const { path, construct } = term.location;
    if (path === undefined) {
      throw new TermError(`${term.location.file} has nowhere to write back to. Pass -f <format> -o <path>.`);
    }
    const reader = readerForConstruct(construct, readers);
    if (reader?.apply === undefined) {
      const name = reader?.label ?? construct;
      throw new TermError(
        `${displayPath(term.location.file, cwd)}: a ${name} cannot be written in place. Pass -f <format> -o <path>.`,
      );
    }
    const entry = byPath.get(path) ?? { file: term.location.file, constructs: new Map<TermConstruct, Term[]>() };
    entry.constructs.set(construct, [...(entry.constructs.get(construct) ?? []), term]);
    byPath.set(path, entry);
  }

  const files: RenderedFile[] = [];
  const existing = new Map<string, string>();
  for (const [path, { file, constructs }] of byPath) {
    let original: string;
    try {
      original = await readFile(path, "utf8");
    } catch (error) {
      throw new TermError(`${file}: could not be read: ${errorMessage(error)}`);
    }
    existing.set(path, original);
    files.push({ path, content: applyInPlace(original, path, file, constructs, readers) });
  }

  const changes = await applyChanges(files, [], existing, cwd, !check && !dryRun);
  return {
    mode: "in-place",
    terms: set.terms.length,
    changes,
    files: files.map((f) => ({ path: displayPath(f.path, cwd), content: f.content })),
    dropped: [],
    skipped: [],
    check,
    dryRun,
  };
}
