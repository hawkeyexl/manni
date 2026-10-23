/**
 * Load a strategy set: resolve the run's files, extract each one's metadata
 * with meta's extractor, merge in what its `{page}.meta.yaml` manifests
 * supply through `metaPageView`, and read the records and references out of
 * the merged view. Every value's file and line come from `declaredAt`, so a
 * value a sidecar holds is filed at the sidecar's line.
 *
 * A file that cannot be read or parsed is an error, not a skip: a set that
 * quietly lost a record would report the pages naming it as broken.
 */
import { readFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import {
  STDIN_LABEL,
  STDIN_TOKEN,
  assertNonEmpty,
  declaredAt,
  extractorByName,
  extractorForExtension,
  gitignoreOptions,
  metaPageView,
  resolveTargetSet,
  supportedExtensions,
} from "../../meta/internal.js";
import type { ExtractedMetadata } from "../../meta/index.js";
import { STDIN_REQUIRES_AS } from "../../shared/cli-options.js";
import { errorMessage } from "../../shared/errors.js";
import { StrategyError } from "../errors.js";
import {
  PAGE_FIELDS,
  PARENTS,
  RECORD_TYPES,
  type At,
  type RecordType,
  type StrategyRecord,
  type StrategyReference,
  type StrategyRun,
  type StrategySet,
} from "../types.js";

export interface LoadStrategySetOptions {
  run: StrategyRun;
  /** Stdin's content, when `-` is among the run's inputs. */
  stdin?: string;
  /** `--as <format>`, which stdin needs. */
  as?: string;
  /** `--exclude <glob>`, repeatable. */
  exclude?: string[];
  /** `--ext <list>`: the extensions a directory or glob walk keeps. */
  exts?: string[];
  /** `--allow-empty`: wins over `strategy.allowEmpty`. */
  allowEmpty?: boolean;
  /** `--no-gitignore`. */
  noGitignore?: boolean;
  onNotice?: (message: string) => void;
}

interface Extracted {
  label: string;
  extracted: ExtractedMetadata;
}

function isRecordType(value: unknown): value is RecordType {
  return typeof value === "string" && (RECORD_TYPES as readonly string[]).includes(value);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function extract(content: string, label: string, path: string | undefined, format: string): Extracted {
  const extractor = extractorByName(format);
  if (extractor === undefined) throw new StrategyError(`${label}: no reader for format "${format}".`);
  try {
    return { label, extracted: extractor.extract(content, path ?? label) };
  } catch (error) {
    throw new StrategyError(`${label}: could not be read as ${format}: ${errorMessage(error)}`);
  }
}

async function readInput(path: string, label: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    throw new StrategyError(`${label}: could not be read: ${errorMessage(error)}`);
  }
}

/** The files the run names, extracted. Stdin comes last, as one more input. */
async function extractAll(opts: LoadStrategySetOptions, allowEmpty: boolean): Promise<Extracted[]> {
  const { run } = opts;
  const exclude = opts.exclude ?? [];
  const usingStdin = run.inputs.includes(STDIN_TOKEN);
  const inputs = run.inputs.filter((input) => input !== STDIN_TOKEN);
  if (usingStdin && (opts.as === undefined || opts.as === "")) throw new StrategyError(STDIN_REQUIRES_AS);
  if (inputs.length === 0 && !usingStdin) {
    throw new StrategyError(
      "No files to read. Pass paths/globs, or declare a collection under `collections:` in manni.config.yaml.",
    );
  }

  const out: Extracted[] = [];
  if (inputs.length > 0) {
    const { files, gitignoreSkipped } = await resolveTargetSet({
      inputs,
      cwd: run.base,
      exclude,
      exts: opts.exts ?? supportedExtensions(),
      allowEmpty,
      ...gitignoreOptions({
        ...(opts.noGitignore === true ? { flag: false } : {}),
        ...(run.config?.respectGitignore === undefined ? {} : { configured: run.config.respectGitignore }),
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
      const extractor = extractorForExtension(extname(file));
      if (extractor === undefined) {
        throw new StrategyError(`${file}: no reader for its extension. Pass --as <format> through stdin to read it.`);
      }
      const path = resolve(run.base, file);
      out.push(extract(await readInput(path, file), file, path, extractor.name));
    }
  }
  if (usingStdin && opts.as !== undefined) out.push(extract(opts.stdin ?? "", STDIN_LABEL, undefined, opts.as));
  return out;
}

/** One value or a list of them, with the pointer each sits at. Anything else contributes nothing. */
function valuesOf(data: Record<string, unknown>, field: string): { value: string; pointer: string }[] {
  const raw = data[field];
  if (typeof raw === "string") return raw.trim() === "" ? [] : [{ value: raw, pointer: `/${field}` }];
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item: unknown, i) =>
    typeof item === "string" && item.trim() !== "" ? [{ value: item, pointer: `/${field}/${String(i)}` }] : [],
  );
}

function stem(label: string): string {
  const name = basename(label);
  return name.slice(0, name.length - extname(name).length);
}

export async function loadStrategySet(opts: LoadStrategySetOptions): Promise<StrategySet> {
  const { run } = opts;
  const allowEmpty = opts.allowEmpty ?? run.config?.allowEmpty === true;
  const inputs = await extractAll(opts, allowEmpty);

  // Meta's view over the same config file, so a sidecar counts exactly as
  // `manni meta validate` merges it. Labels are relative to the run's base.
  const view = await metaPageView({
    cwd: run.base,
    ...(run.configPath === undefined ? { noConfig: true } : { configPath: run.configPath }),
    pages: inputs.filter((i) => i.label !== STDIN_LABEL).map((i) => resolve(run.base, i.label)),
  });

  const set: StrategySet = { records: [], references: [] };
  for (const { label, extracted } of inputs) {
    const merged = await view.merge(label, extracted);
    const data = merged.extracted.data;
    const at = (pointer: string): At => declaredAt(label, pointer, { extracted: merged.extracted, locate: merged.locate });
    const type = data["type"];
    const isRecord = isRecordType(type);

    if (isRecord) {
      const declaredId = text(data["id"]);
      const title = text(data["title"]);
      const description = text(data["description"]);
      const record: StrategyRecord = {
        id: declaredId ?? stem(label),
        type,
        ...(title === undefined ? {} : { title }),
        ...(description === undefined ? {} : { description }),
        file: label,
        line: 1,
        ...(declaredId === undefined ? {} : { idAt: at("/id") }),
        parents:
          type === "audience" ? [] : valuesOf(data, PARENTS[type]).map(({ value, pointer }) => ({ value, ...at(pointer) })),
      };
      set.records.push(record);
    }

    // A journey's `personas:` is its parent field, read above, so it is not a reference too.
    const parentField = isRecord && type !== "audience" ? PARENTS[type] : undefined;
    for (const field of Object.values(PAGE_FIELDS)) {
      if (field === parentField) continue;
      for (const { value, pointer } of valuesOf(data, field)) {
        const reference: StrategyReference = { field, value, page: label, record: isRecord, ...at(pointer) };
        set.references.push(reference);
      }
    }
  }

  if (set.records.length === 0 && !allowEmpty) {
    throw new StrategyError(
      "no strategy records found. A record is a page declaring type: audience, type: persona or type: journey.",
    );
  }
  return set;
}
