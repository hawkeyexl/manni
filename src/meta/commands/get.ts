/**
 * `get` command core. Prints one or more metadata field values from each file.
 * Input handling (positional paths, globs, directories, `-` for stdin, and
 * config `paths:` fallback) mirrors `validate` so the two commands behave
 * identically.
 */
import { readFile } from "node:fs/promises";
import { loadSidecars, mergeSidecars } from "../core/sidecars.js";
import { resolve, extname } from "node:path";
import { resolveElements } from "../core/resolve-schema.js";
import { DocmetaError } from "../types.js";
import {
  extractorByName,
  extractorForExtension,
  supportedExtensions,
} from "../extractors/index.js";
import {
  assertNonEmpty,
  gitignoreOptions,
  resolveTargetSet,
  STDIN_LABEL,
  STDIN_TOKEN,
} from "../core/load-files.js";
import {
  resolveRunConfig,
  type ConfigNotice,
  type DocmetaConfig,
} from "../core/config.js";
import {
  assertSourcesAvailable,
  deriveMetadata,
} from "../core/derive/index.js";
import { commandsOf } from "../core/derive/table.js";
import {
  DERIVE_SOURCES,
  isBuiltinField,
  type DerivableField,
  type DeriveCommand,
  type DerivedRecord,
  type DerivedValue,
  type DeriveInput,
} from "../core/derive/types.js";

export interface GetOptions {
  fields: string[];
  inputs: string[];
  as?: string;
  exclude?: string[];
  exts?: string[];
  configPath?: string;
  /** `--no-config`: skip config discovery and use the built-in defaults. */
  noConfig?: boolean;
  cwd?: string;
  /** Content for the `-` (stdin) input, injected by the CLI/tests. */
  stdinContent?: string;
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
  /**
   * `--offline`, accepted for surface parity with `validate` and `fill`.
   *
   * It has **no effect here**, and that is a property of the command rather
   * than an omission: `get` prints extracted field values and never resolves or
   * loads a schema, so it has no network dependency to suppress. Accepting it
   * keeps one flag set across the three commands, so a script can pass
   * `--offline` uniformly without knowing which subcommand needs it.
   */
  offline?: boolean;
  /**
   * `--derived`: beside each asserted value, what the evidence (git history,
   * CODEOWNERS, GitHub or GitLab reviews — proposal 0040) says the field should be. Consults
   * the sources `derive.sources` allows, all four when the config says
   * nothing, for the requested fields that are derivable. Stdin is refused:
   * there is no history behind it.
   */
  derived?: boolean;
}

export interface GetFileResult {
  file: string;
  present: boolean;
  values: Record<string, unknown>;
  /**
   * With `derived`, the evidence per requested field. A derivable field is
   * always a key here: a `DerivedValue` when a source answered, `null` when
   * every consulted source had nothing to say (a file with no commits, a
   * path no CODEOWNERS rule matches). A requested field that is **not**
   * derivable is absent from the record — that is the whole signal, and the
   * reporter prints it as `(not derivable)`. Absent altogether without the
   * flag, and on a file that did not parse.
   */
  derived?: Record<string, DerivedValue | null>;
  /**
   * Why this file yielded no values, when it yielded none for a reason.
   *
   * Set only when the document's metadata block could not be read at all — the
   * same throw `validate` turns into a `(parse)` finding. Absent on every file
   * that parsed, including one with no metadata block and one where every
   * requested field was unset: those are answers, and this is the absence of
   * one. A run carrying any `error` exits 1.
   */
  error?: string;
}

export async function runGet(opts: GetOptions): Promise<GetFileResult[]> {
  const cwd = opts.cwd ?? process.cwd();
  if (opts.fields.length === 0) {
    throw new DocmetaError("Specify at least one field to get.");
  }

  // Explicit CLI inputs win, else config `paths:`; `base` is whichever of the
  // two directories those inputs were written relative to.
  const { config, inputs, base, configDir } = await resolveRunConfig({
    cwd,
    configPath: opts.configPath,
    noConfig: opts.noConfig,
    inputs: opts.inputs,
    onConfigLoaded: opts.onConfigLoaded,
  });
  const usingStdin = inputs.includes(STDIN_TOKEN);

  if (inputs.length === 0) {
    throw new DocmetaError(
      "No files to read. Pass paths/globs, or add `paths:` under `meta:` in manni.config.yaml.",
    );
  }

  const forced = opts.as ? extractorByName(opts.as) : undefined;
  if (opts.as && !forced) {
    throw new DocmetaError(
      `Unknown format "${opts.as}". Supported extensions: ${supportedExtensions().join(", ")}.`,
    );
  }

  const exts = opts.exts ?? (forced ? forced.extensions : undefined);
  const fileInputs = inputs.filter((i) => i !== STDIN_TOKEN);
  const allowEmpty = opts.allowEmpty ?? config?.allowEmpty;
  const exclude = [...(config?.exclude ?? []), ...(opts.exclude ?? [])];
  const { files, gitignoreSkipped } = await resolveTargetSet({
    inputs: fileInputs,
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
  assertNonEmpty({
    files,
    inputs: fileInputs,
    usingStdin,
    allowEmpty,
    exclude,
    exts,
    gitignoreSkipped,
    action: "read",
  });

  const out: GetFileResult[] = [];
  // Sidecar manifests (0037), read once per run.
  const sidecars = await loadSidecars(config, {
    configDir: configDir ?? cwd,
    base,
    offline: opts.offline ?? config?.offline ?? false,
  });

  // The derived channel (0040): the requested fields a source can state,
  // and one input per parsed file — the document's OWN extraction, since a
  // managed key is never sidecar-owned and the git source reads its lines.
  // A field is derivable when a built-in source claims it, or when the
  // config runs a command for it (0041).
  const commands: Readonly<Record<string, DeriveCommand>> = commandsOf(config?.derive) ?? {};
  const derivableFields: DerivableField[] = opts.derived
    ? opts.fields.filter((f) => isBuiltinField(f) || Object.hasOwn(commands, f))
    : [];
  const deriveInputs: DeriveInput[] = [];
  if (opts.derived && usingStdin) {
    throw new DocmetaError("cannot derive <stdin>: no history behind it");
  }

  const readOne = (label: string, content: string, extension: string): void => {
    const extractor = forced ?? extractorForExtension(extension);
    if (!extractor) {
      throw new DocmetaError(
        `Unsupported file type "${extension}" for "${label}". Supported: ${supportedExtensions().join(", ")}. Use --as to override.`,
      );
    }
    let extracted;
    try {
      const own = extractor.extract(content, label, {
        elements: resolveElements(label, config),
      });
      if (opts.derived && label !== STDIN_LABEL) {
        deriveInputs.push({
          label,
          absPath: resolve(base, label),
          content,
          extracted: own,
        });
      }
      extracted = mergeSidecars(label, own, sidecars, base).extracted;
    } catch (err) {
      // A `DocmetaError` is already operational and already carries a message
      // written for a person — rethrow it untouched, exactly as `validate`
      // does with the same call.
      if (err instanceof DocmetaError) throw err;
      // Anything else is a document that will not parse, which is a fact about
      // the document and not about the run. It is recorded against the file and
      // the walk continues, the same call `validate` turns into a `(parse)`
      // finding. Promoting it to an operational error put it on the wrong side
      // of the 0/1/2 contract and, worse, made one malformed file hide the
      // values of every other file in the directory.
      //
      // `err` is `unknown` and an extractor is not obliged to throw an `Error`,
      // so the reason is narrowed rather than cast: `(err as Error).message`
      // would record `undefined` and lose the reason entirely.
      const reason = err instanceof Error ? err.message : String(err);
      out.push({ file: label, present: false, values: {}, error: reason });
      return;
    }
    const values: Record<string, unknown> = {};
    for (const f of opts.fields) values[f] = resolveField(extracted.data, f);
    out.push({ file: label, present: extracted.present, values });
  };

  if (usingStdin) {
    if (!forced) {
      throw new DocmetaError(
        "Reading from stdin (`-`) requires --as <format> to choose an extractor.",
      );
    }
    readOne(STDIN_LABEL, opts.stdinContent ?? "", forced.extensions[0] ?? "");
  }

  for (const file of files) {
    const content = await readFile(resolve(base, file), "utf8");
    readOne(file, content, extname(file));
  }

  if (opts.derived) {
    await attachDerived(out, deriveInputs, derivableFields, {
      cwd,
      base,
      configDir,
      config,
    });
  }

  return out;
}

/**
 * One derivation for the run, then a `derived` record on every parsed file:
 * the requested derivable fields, each a value or `null`. Nothing is derived
 * when no requested field is derivable — no source is consulted, and each
 * file still gets an (empty) record so the reporter can say so per field.
 * A consulted source that cannot answer is the run's error, with the way out.
 */
async function attachDerived(
  out: GetFileResult[],
  inputs: readonly DeriveInput[],
  fields: readonly DerivableField[],
  run: {
    cwd: string;
    base: string;
    configDir: string | undefined;
    config: DocmetaConfig | null;
  },
): Promise<void> {
  const derive = run.config?.derive;
  const commands = commandsOf(derive);
  const records: ReadonlyMap<string, DerivedRecord> =
    fields.length === 0 || inputs.length === 0
      ? new Map<string, DerivedRecord>()
      : await (async () => {
          const result = await deriveMetadata(inputs, {
            cwd: run.cwd,
            base: run.base,
            ...(run.configDir !== undefined ? { configDir: run.configDir } : {}),
            sources: derive?.sources ?? [...DERIVE_SOURCES],
            fields,
            ...(derive?.codeowners !== undefined
              ? { codeowners: derive.codeowners }
              : {}),
            ...(commands !== undefined ? { commands } : {}),
            cache: true,
            now: () => new Date(),
          });
          assertSourcesAvailable(
            result.sources,
            "drop --derived, or narrow derive.sources",
          );
          return result.records;
        })();
  for (const r of out) {
    if (r.error !== undefined) continue;
    const record = records.get(r.file);
    const derived: Record<string, DerivedValue | null> = {};
    for (const field of fields) derived[field] = record?.fields[field] ?? null;
    r.derived = derived;
  }
}

/**
 * Resolve a single field reference against extracted metadata.
 *
 * A reference starting with `/` is a JSON Pointer (RFC 6901) — the same
 * convention the validator and reporters already use for nested error paths,
 * so a pointer copied from a validation error works verbatim. Any other
 * reference is dot-notation (`author.name`, `tags.0`). Pointers also escape
 * keys that contain literal dots or slashes (`/odd.key`, `/a~1b` for `a/b`).
 *
 * Returns `undefined` when any segment is missing or descends into a scalar.
 * A bare top-level key (no `/`, no `.`) resolves to a single segment, so the
 * historical `get title` behavior is unchanged.
 *
 * **A key that literally contains a dot is tried as a fallback**, after descent
 * fails. Element-derived metadata makes those ordinary — `article.title`,
 * `prolog.author`, `ms.date` — and without this, `get article.title` returned
 * an *empty* result rather than an error, which is a silent wrong answer.
 * Descent still wins wherever it resolves, so a document with a genuine
 * `author: { name: … }` object answers `author.name` exactly as it always has;
 * the fallback only fires where the old behavior was to give up.
 */
function resolveField(data: Record<string, unknown>, field: string): unknown {
  const segments = field.startsWith("/")
    ? parseJsonPointer(field)
    : field.split(".");
  const descended = descend(data, segments);
  if (descended !== undefined) return descended;
  if (
    !field.startsWith("/") &&
    field.includes(".") &&
    Object.prototype.hasOwnProperty.call(data, field)
  ) {
    return data[field];
  }
  return undefined;
}

/** Walk `segments` into `data`, or `undefined` at the first miss. */
function descend(data: Record<string, unknown>, segments: string[]): unknown {
  let current: unknown = data;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(segment)) return undefined;
      current = current[Number(segment)];
    } else if (current !== null && typeof current === "object") {
      // Own-property check only: never resolve inherited members like
      // `toString` or `__proto__` — those are "missing", not values.
      if (!Object.prototype.hasOwnProperty.call(current, segment)) {
        return undefined;
      }
      current = (current as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

/** Decode a JSON Pointer into path segments, unescaping `~1`→`/` and `~0`→`~`. */
function parseJsonPointer(pointer: string): string[] {
  return pointer
    .split("/")
    .slice(1)
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
}
