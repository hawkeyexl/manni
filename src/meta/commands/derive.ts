/**
 * `derive` — stamp the managed stewardship fields into each document from
 * evidence: git history, CODEOWNERS, and the review record on GitHub or GitLab.
 *
 * The shape is `fill`'s (load, extract, decide, write through the extractor)
 * with the deciding step replaced by the derived channel: every requested
 * field is compared with what the sources say, and a field that is `stale`
 * or `unset` is written. `current` and `unknown` fields are left alone. Under
 * `--check` nothing is written and every stale or unset field becomes a
 * finding, which is how CI turns a forgotten stamp into a red run.
 *
 * Three refusals are operational (exit 2) rather than per-file, because each
 * leaves the run with no honest verdict: stdin, which has no history behind
 * it; a field or source the channel does not know; and a consulted source
 * that cannot answer, since a skipped source would let a stale stamp read as
 * current — the false green the whole channel exists to end.
 */
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import {
  DocmetaError,
  type FieldError,
  type MetadataExtractor,
  type MetadataPatch,
} from "../types.js";
import { manifestOwning, resolveRunConfig, type ConfigNotice } from "../core/config.js";
import type { FingerprintContext } from "../core/baseline.js";
import {
  assertNonEmpty,
  gitignoreOptions,
  resolveTargetSet,
  STDIN_TOKEN,
} from "../core/load-files.js";
import { memberOf, retainMembers } from "../core/collections.js";
import {
  extractorByName,
  extractorForExtension,
  listFormats,
  supportedExtensions,
} from "../extractors/index.js";
import { resolveElements } from "../core/resolve-schema.js";
import { writeFileAtomic } from "../core/write-file.js";
import { assertSourcesAvailable, deriveMetadata } from "../core/derive/index.js";
import { commandsOf } from "../core/derive/config.js";
import {
  compareDerived,
  DERIVABLE_FIELDS,
  DERIVE_SOURCES,
  isBuiltinField,
  isDeriveSource,
  staleFindings,
  type DerivableField,
  type DeriveCommand,
  type DerivedField,
  type DeriveInput,
  type DeriveSource,
  type ReviewClient,
  type SourceStatus,
} from "../core/derive/types.js";

export interface DeriveOptions {
  inputs: string[];
  /**
   * `--collection <name>`, repeatable: stamp only the named configured
   * collections instead of every declared one (proposal 0041). Cannot be
   * combined with paths.
   */
  collections?: string[];
  /** `--fields`: the managed fields to stamp this run; config `derive.fields` otherwise. */
  fields?: string[];
  /** `--sources`: the sources to consult; config `derive.sources`, else all four. */
  sources?: string[];
  /** `--dry-run`: report what would change and write nothing. */
  dryRun?: boolean;
  /** `--check`: implies `dryRun`; stale and unset fields are findings. */
  check?: boolean;
  /** Use the on-disk GitHub or GitLab review cache. Default true. */
  cache?: boolean;
  /** `--as` format override (extractor name). */
  as?: string;
  exts?: string[];
  exclude?: string[];
  configPath?: string;
  /** `--no-config`: skip config discovery and use the built-in defaults. */
  noConfig?: boolean;
  cwd?: string;
  /** Permit an input set that resolves to zero files (see `assertNonEmpty`). */
  allowEmpty?: boolean;
  /**
   * `--no-gitignore` (false). Absent leaves config `respectGitignore:` in
   * charge, which itself defaults to on.
   */
  respectGitignore?: boolean;
  /** Diagnostics for the user; the CLI writes these to stderr. */
  onNotice?: (message: string) => void;
  /** Called once when a config governs the run, so the CLI can report it. */
  onConfigLoaded?: (info: ConfigNotice) => void;
  /** The clock an uncommitted body change is dated by. Test seam; default `new Date()`. */
  now?: () => Date;
  /** The review client, for every repository in the run. Test seam; default `gh` / `glab`. */
  reviews?: ReviewClient;
}

export interface DeriveFileResult {
  file: string;
  /** Extractor/format used; `unknown` when none matched the file. */
  format: string;
  /** One entry per requested field, in the requested order. Empty on `error`. */
  fields: DerivedField[];
  /**
   * Whether writing the stale and unset fields changed the document, or
   * would have but for `dryRun`. Computed from the writer's output, so a
   * patch the format serializes to the same bytes is not a change.
   */
  changed: boolean;
  /** Why the file could not be derived or written; the run goes on without it. */
  error?: string;
  /**
   * Under `check`, the findings for this file: one per stale or unset field,
   * at the field's line, plus one for an `error`. Absent otherwise.
   */
  findings?: FieldError[];
}

export interface DeriveSummary {
  files: number;
  /** Files whose document changed, or would have under `dryRun`. */
  changed: number;
  /** Fields whose write reached the disk: always 0 under `dryRun` and `check`. */
  written: number;
  stale: number;
  unset: number;
  unknown: number;
  errors: number;
}

export interface DeriveRun {
  results: DeriveFileResult[];
  summary: DeriveSummary;
  dryRun: boolean;
  check: boolean;
  /** One status per source the run consulted; a source nobody asked for is absent. */
  sources: Partial<Record<DeriveSource, SourceStatus>>;
  /** Where the run stood, for the SARIF reporter under `check`. See `ValidateRun.frame`. */
  frame: FingerprintContext;
}

/** The hint `assertSourcesAvailable` appends: this command's own way out. */
const SOURCE_HINT = "narrow --sources or --fields";

export async function runDerive(opts: DeriveOptions): Promise<DeriveRun> {
  const cwd = opts.cwd ?? process.cwd();
  const { config, inputs, base, configDir, collections, declaredCollections, fromCollections } =
    await resolveRunConfig({
      cwd,
      configPath: opts.configPath,
      noConfig: opts.noConfig,
      inputs: opts.inputs,
      ...(opts.collections !== undefined ? { collections: opts.collections } : {}),
      onConfigLoaded: opts.onConfigLoaded,
    });
  // Refused before anything else is looked at: every other command takes `-`
  // as one more input, but a piped document has no commits, no path a
  // CODEOWNERS rule could match, and no pull request. There is nothing to
  // derive from, so the answer would be "unknown" for every field — and a
  // run that cannot answer is exit 2, not a quiet no-op.
  if (inputs.includes(STDIN_TOKEN)) {
    throw new DocmetaError("cannot derive <stdin>: no history behind it");
  }
  if (inputs.length === 0) {
    throw new DocmetaError(
      "No files to derive. Pass paths/globs, or declare a collection under `collections:` in manni.config.yaml.",
    );
  }

  // The configured commands (0042): a key of theirs is as derivable as a
  // built-in field, and the source runs them where the config lives.
  const commands = commandsOf(config?.derive);
  const fields = resolveFields(opts.fields, config?.derive?.fields, commands);
  // `loadConfig` refuses a `derive.fields` entry a manifest owns; the same
  // rule holds for `--fields`, which bypasses the config. Every declared
  // collection counts, not only the selected ones, and the config's `keys:`
  // list is the whole claim, so no manifest is loaded.
  for (const field of fields) {
    const owner = manifestOwning(field, declaredCollections);
    if (owner !== undefined) {
      throw new DocmetaError(
        `"${field}" is owned by the manifest ${owner.file} on collection ${owner.name}; a managed field has one authority, and a manifest key already has one.`,
      );
    }
  }
  const sources = resolveSources(opts.sources, config?.derive?.sources);
  const check = Boolean(opts.check);
  // `--check` judges and exits; it never writes.
  const dryRun = Boolean(opts.dryRun) || check;

  const forcedExtractor = opts.as ? extractorByName(opts.as) : undefined;
  if (opts.as && !forcedExtractor) {
    throw new DocmetaError(
      `Unknown format "${opts.as}". Known formats: ${listFormats()
        .map((f) => f.name)
        .join(", ")}.`,
    );
  }

  const allowEmpty = opts.allowEmpty ?? config?.allowEmpty;
  const exts = opts.exts ?? forcedExtractor?.extensions;
  // Only `--exclude`: a collection's `exclude:` governs membership, not the
  // walk of a path someone typed (0041 rule 3).
  const exclude = opts.exclude ?? [];
  /** The collections one label belongs to, computed once per file. */
  const membersFor = (label: string): string[] =>
    memberOf(collections, configDir ?? cwd, base, label);
  const { files: walked, gitignoreSkipped } = await resolveTargetSet({
    inputs,
    exts,
    exclude,
    cwd: base,
    allowEmpty,
    ...gitignoreOptions({
      flag: opts.respectGitignore,
      configured: config?.respectGitignore,
      onNotice: opts.onNotice,
    }),
  });
  // Rule 9: narrow the walk to actual members, or a collection's `exclude:`
  // would shape its SQL view and not what a bare run stamps. Skipped for
  // typed paths: those are the operator's (rule 3).
  const files = fromCollections ? retainMembers(walked, membersFor) : walked;
  assertNonEmpty({
    files,
    inputs,
    usingStdin: false,
    allowEmpty,
    exclude,
    exts,
    gitignoreSkipped,
    action: "derived",
  });

  // ---- Load and extract ----------------------------------------------------
  // A document that will not parse is that file's error, not the run's: the
  // rest of the corpus still gets its stamps. Only the parseable ones go to
  // the sources.
  interface Loaded {
    label: string;
    absPath: string;
    content: string;
    format: string;
    elements: string[];
    extracted: DeriveInput["extracted"];
    apply: MetadataExtractor["apply"];
  }
  const loaded = new Map<string, Loaded>();
  const errors = new Map<string, { format: string; message: string }>();
  for (const label of files) {
    const absPath = resolve(base, label);
    const extractor = forcedExtractor ?? extractorForExtension(extname(label));
    if (!extractor) {
      errors.set(label, {
        format: "unknown",
        message: `Unsupported file type "${extname(label)}". Supported: ${supportedExtensions().join(", ")}. Use --as to override.`,
      });
      continue;
    }
    const content = await readFile(absPath, "utf8");
    const elements = resolveElements(label, config, membersFor(label));
    try {
      loaded.set(label, {
        label,
        absPath,
        content,
        format: extractor.name,
        elements,
        extracted: extractor.extract(content, label, { elements }),
        apply: extractor.apply,
      });
    } catch (err) {
      errors.set(label, { format: extractor.name, message: (err as Error).message });
    }
  }

  // ---- Derive --------------------------------------------------------------
  const derived = await deriveMetadata([...loaded.values()], {
    cwd,
    base,
    configDir,
    sources,
    fields,
    codeowners: config?.derive?.codeowners,
    commands,
    cache: opts.cache ?? true,
    now: opts.now ?? (() => new Date()),
    reviews: opts.reviews,
  });
  assertSourcesAvailable(derived.sources, SOURCE_HINT);
  // A source that answered, with a caveat worth one line: a repository with
  // no CODEOWNERS file derives null owners rather than failing.
  for (const [name, status] of Object.entries(derived.sources)) {
    if (status.available && status.reason !== undefined) {
      opts.onNotice?.(`${name}: ${status.reason}`);
    }
  }

  // ---- Compare, and write ----------------------------------------------------
  const results: DeriveFileResult[] = [];
  for (const label of files) {
    const failure = errors.get(label);
    if (failure) {
      results.push(errorResult(label, failure.format, failure.message, check));
      continue;
    }
    const doc = loaded.get(label);
    /* c8 ignore next -- every file is in exactly one of the two maps. */
    if (!doc) continue;

    const record = derived.records.get(label);
    const compared = fields.map((field) =>
      compareDerived(field, doc.extracted.data[field], record?.fields[field]),
    );
    const pending = compared.filter((f) => f.status === "stale" || f.status === "unset");
    // `changed` is what the writer would do, not what the comparison found:
    // as in `fill`, the patch is applied and the result compared with the
    // document, so a field is `written` only when bytes went to disk. Under
    // `dryRun` the same patch is computed and nothing is written.
    let changed = false;
    if (pending.length > 0) {
      // Same writer `fill` and `query` use, so a format they cannot write is
      // refused here the same way — and refused loudly, as this file's error,
      // rather than by leaving a stale stamp in place with exit 0. Under
      // `check` a read-only format still gets its findings, since nothing was
      // going to be written anyway.
      if (typeof doc.apply !== "function") {
        if (!dryRun) {
          results.push(
            errorResult(
              label,
              doc.format,
              `The "${doc.format}" format is read-only; manni meta derive cannot write metadata back to it.`,
              check,
              compared,
            ),
          );
          continue;
        }
        changed = true;
      } else {
        const patch: MetadataPatch = {};
        for (const f of pending) patch[f.field] = f.derived;
        let next: string;
        try {
          next = doc.apply(doc.content, patch, { filePath: label, elements: doc.elements });
        } catch (err) {
          results.push(errorResult(label, doc.format, (err as Error).message, check, compared));
          continue;
        }
        changed = next !== doc.content;
        if (changed && !dryRun) {
          await writeFileAtomic(doc.absPath, next);
          for (const f of pending) f.written = true;
        }
      }
    }

    results.push({
      file: label,
      format: doc.format,
      fields: compared,
      changed,
      ...(check ? { findings: staleFindings(compared, doc.extracted.lineFor) } : {}),
    });
  }

  return {
    results,
    summary: summarize(results),
    dryRun,
    check,
    sources: derived.sources,
    frame: { cwd, base: configDir ?? cwd, runBase: base },
  };
}

/**
 * The fields this run stamps: `--fields`, else config `derive.fields`.
 * Validated here as well as in the config parser, because `--fields` is typed
 * by a person and `runDerive` is public API.
 */
function resolveFields(
  flag: string[] | undefined,
  configured: readonly DerivableField[] | undefined,
  commands: Readonly<Record<string, DeriveCommand>> | undefined,
): DerivableField[] {
  const names = flag ?? configured;
  if (names === undefined || names.length === 0) {
    throw new DocmetaError(
      "nothing to derive: set derive.fields in manni.config.yaml or pass --fields",
    );
  }
  const out: DerivableField[] = [];
  for (const name of names) {
    if (!isBuiltinField(name) && !(commands !== undefined && Object.hasOwn(commands, name))) {
      throw new DocmetaError(
        `"${name}" is not derivable; derivable fields are ${DERIVABLE_FIELDS.join(", ")}, or any key with an entry in derive.commands`,
      );
    }
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

/** The sources this run consults: `--sources`, else config `derive.sources`, else all four. */
function resolveSources(
  flag: string[] | undefined,
  configured: readonly DeriveSource[] | undefined,
): DeriveSource[] {
  const names = flag ?? configured ?? DERIVE_SOURCES;
  const out: DeriveSource[] = [];
  for (const name of names) {
    if (!isDeriveSource(name)) {
      throw new DocmetaError(
        `"${name}" is not a source; sources are ${DERIVE_SOURCES.join(", ")}`,
      );
    }
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

/**
 * A file the run could not derive or write. Under `check` the error is a
 * finding too, shaped as `validate` shapes a parse failure, so the reporters
 * give it the reserved `manni/parse-error` rule rather than inventing one.
 */
function errorResult(
  file: string,
  format: string,
  message: string,
  check: boolean,
  fields: DerivedField[] = [],
): DeriveFileResult {
  return {
    file,
    format,
    fields,
    changed: false,
    error: message,
    ...(check
      ? {
          findings: [
            { schema: "(parse)", instancePath: "", message, keyword: "parse" },
          ],
        }
      : {}),
  };
}

function summarize(results: DeriveFileResult[]): DeriveSummary {
  const summary: DeriveSummary = {
    files: results.length,
    changed: 0,
    written: 0,
    stale: 0,
    unset: 0,
    unknown: 0,
    errors: 0,
  };
  for (const r of results) {
    if (r.changed) summary.changed++;
    if (r.error !== undefined) summary.errors++;
    for (const f of r.fields) {
      if (f.written) summary.written++;
      if (f.status === "stale") summary.stale++;
      else if (f.status === "unset") summary.unset++;
      else if (f.status === "unknown") summary.unknown++;
    }
  }
  return summary;
}
