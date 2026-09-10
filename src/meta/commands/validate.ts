/**
 * `validate` command core. Resolves targets, extracts metadata, resolves a
 * schema set per file, validates, and returns structured results. Kept free of
 * CLI/IO plumbing so it can be tested directly.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import {
  loadSidecars,
  mergeSidecars,
  orphanEntries,
  orphanError,
  orphanJoins,
  sidecarPointer,
  SIDECAR_DUPLICATE_SCHEMA,
  SIDECAR_KEYWORD,
  SIDECAR_OWNED_SCHEMA,
} from "../core/sidecars.js";
import { resolve, extname } from "node:path";
import pkg from "../../../package.json" with { type: "json" };
import { warn } from "../../shared/warn.js";
import {
  DocmetaError,
  type BaselineSummary,
  type FieldError,
  type RunSummary,
  type ValidationResult,
} from "../types.js";
import {
  DEFAULT_BASELINE_PATH,
  LEGACY_BASELINE_PATH,
  type FingerprintContext,
  applyBaseline,
  buildBaseline,
  countFingerprints,
  diffBaselines,
  readBaseline,
  writeBaselineFile,
} from "../core/baseline.js";
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
  schemaTrustRoot,
  type ConfigNotice,
} from "../core/config.js";
import {
  collectSchemaPins,
  resolveSchemaSetWithSource,
  FILE_SCHEMA_KEY,
  type ResolvedSchemaSet,
  resolveElements,
} from "../core/resolve-schema.js";
import { Validator } from "../core/validator.js";
import { schemaLoadOptions } from "../core/schema-registry.js";
import { runChecks, type CheckEntry } from "../core/checks.js";
import {
  assertSourcesAvailable,
  deriveMetadata,
  type DeriveResult,
} from "../core/derive/index.js";
import { commandsOf } from "../core/derive/config.js";
import { fieldsForSql, mentionsDerived } from "../core/derive/table.js";
import {
  compareDerived,
  derivableFields,
  DERIVE_SOURCES,
  staleFindings,
  type DerivedRecord,
  type DeriveInput,
} from "../core/derive/types.js";

export interface ValidateOptions {
  inputs: string[];
  cliSchemas?: string[];
  exts?: string[];
  exclude?: string[];
  /** `--as` format override (extractor name). */
  as?: string;
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
  /**
   * `--baseline [path]`: compare findings against a recorded baseline and fail
   * only on new ones. A string is a path relative to `cwd`; `true` means the
   * default path; `false` is `--no-baseline`, which suppresses a baseline the
   * config supplied. Absent means "whatever the config says".
   */
  baseline?: string | boolean;
  /**
   * `--write-baseline [path]`: record this run's findings as the baseline
   * instead of comparing against one. Wins over `baseline`.
   */
  writeBaseline?: string | boolean;
  /** Called once when a config governs the run, so the CLI can report it. */
  onConfigLoaded?: (info: ConfigNotice) => void;
  /**
   * `--offline`: never fetch a remote schema. Absent leaves config `offline:`
   * in charge, which itself defaults to off.
   */
  offline?: boolean;
  /**
   * `--no-cache` (false): ask GitHub or GitLab again rather than reading the
   * review cache. It reaches the comparison and any check reading the
   * `derived` table; absent leaves the cache on.
   */
  cache?: boolean;
  /**
   * `--no-checks` (false): skip the config's named corpus checks for this
   * run. Absent leaves them on — they still only run when the resolved file
   * set is the config-resolved corpus (proposal 0026).
   */
  checks?: boolean;
  /**
   * `--no-derive` (false): skip comparing each managed field (`derive.fields`
   * in the config, proposal 0040) with what the evidence says. Absent leaves
   * the comparison on whenever `derive:` is configured — on scoped runs too,
   * since it is per file rather than a corpus rule.
   */
  derive?: boolean;
}

export interface ValidateRun {
  results: ValidationResult[];
  summary: RunSummary;
  /**
   * Where the run stood: the working directory, the directory canonical paths
   * are measured from, and the directory `results[].file` labels are relative
   * to.
   *
   * Returned rather than kept private because a `ValidationResult.file` is only
   * meaningful *with* it. A reporter that has to name a file the same way from
   * anywhere — SARIF, whose `artifactLocation.uri` GitHub resolves against the
   * repository root — cannot reconstruct this after the fact, and guessing puts
   * it in the same false-green trap the baseline's canonical keys exist to
   * avoid.
   */
  frame: FingerprintContext;
}

/**
 * A violation docmeta raises itself rather than one Ajv produced.
 *
 * Two different failures land here and they are not the same thing: the
 * document's metadata block could not be parsed (`parse`), or a schema set
 * could not be resolved for it (`schema`). `keyword` is what tells them apart
 * downstream — the `schema` field stays `"(parse)"` for both, because it is the
 * documented literal machine consumers already match on.
 */
function parseErrorResult(
  file: string,
  format: string,
  message: string,
  keyword: "parse" | "schema",
): ValidationResult {
  const err: FieldError = {
    schema: "(parse)",
    instancePath: "",
    message,
    keyword,
  };
  return { file, format, ok: false, schemas: [], errors: [err] };
}

/** A resolved `--baseline` / `--write-baseline` / `baseline:` request. */
interface BaselineRequest {
  absPath: string;
  /** The path spelled as the user would type it, for messages. */
  label: string;
  write: boolean;
}

/**
 * Settle which baseline file (if any) governs this run, and where it lives.
 *
 * The one subtlety is the base directory. A path the user typed on the command
 * line is relative to where they are standing; a `baseline:` written in a config
 * file is relative to **the config**, because that is where the person editing
 * it can see the file. Resolving a configured path against `cwd` instead would
 * mean running from a subdirectory silently finds no baseline and reports the
 * entire backlog as new — the exact class of bug config discovery exists to fix.
 */
function resolveBaselineRequest(
  opts: ValidateOptions,
  configured: string | undefined,
  configDir: string | undefined,
  cwd: string,
): BaselineRequest | null {
  /** A path typed on the command line: relative to where the user is standing. */
  const named = (label: string): Omit<BaselineRequest, "write"> => ({
    absPath: resolve(cwd, label),
    label,
  });

  /**
   * The file this project's baseline lives in when no path was typed.
   *
   * A configured `baseline:` wins over the built-in default here, and that is
   * load-bearing rather than a nicety: read and write have to agree on one
   * file. A repo that points `baseline:` somewhere other than the default, then
   * runs a bare `--write-baseline`, would otherwise record into a second file
   * nothing ever reads — and the ratchet would silently do nothing at all.
   *
   * Both spellings resolve against the **config's** directory, not `cwd`. An
   * implied baseline is a property of the project, the same as the config that
   * governs it, so it has to be the same file wherever the command is run from.
   * Resolving it against `cwd` would break the ratchet the moment someone runs
   * from `docs/` — the subdirectory workflow config discovery exists to support
   * — and a later write from there would quietly give the project a second
   * baseline that nothing reads. An explicitly *typed* path stays relative to
   * where the user is standing, which is what a shell argument should mean.
   */
  const implied = (): Omit<BaselineRequest, "write"> => {
    const base = configDir ?? cwd;
    if (configured !== undefined) {
      return { absPath: resolve(base, configured), label: configured };
    }
    // A baseline recorded before the rename is still the project's baseline.
    // Only when the new name is absent, so a project that has moved is never
    // pulled back by a stale file it forgot to delete.
    const current = resolve(base, DEFAULT_BASELINE_PATH);
    const legacy = resolve(base, LEGACY_BASELINE_PATH);
    if (!existsSync(current) && existsSync(legacy)) {
      warn(
        `"${LEGACY_BASELINE_PATH}" is the pre-rename baseline file name. Rename it to "${DEFAULT_BASELINE_PATH}".`,
      );
      return { absPath: legacy, label: LEGACY_BASELINE_PATH };
    }
    return { absPath: current, label: DEFAULT_BASELINE_PATH };
  };

  const requested = (
    value: string | true,
  ): Omit<BaselineRequest, "write"> =>
    typeof value === "string" ? named(value) : implied();

  // Recording wins over comparing: `--write-baseline` must not depend on
  // whether the file it is about to replace could be read.
  if (opts.writeBaseline !== undefined && opts.writeBaseline !== false) {
    return { ...requested(opts.writeBaseline), write: true };
  }
  if (opts.baseline === false) return null; // --no-baseline
  if (opts.baseline !== undefined) {
    return { ...requested(opts.baseline), write: false };
  }
  if (configured) return { ...implied(), write: false };
  return null;
}

/**
 * Run `fn` at most once and hand every caller the same promise, rejection
 * included: a derivation that failed for the checks has failed for the
 * comparison too, and must not be retried against the same evidence.
 */
function once<T>(fn: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => {
    pending ??= fn();
    return pending;
  };
}

export async function runValidate(
  opts: ValidateOptions,
): Promise<ValidateRun> {
  const cwd = opts.cwd ?? process.cwd();

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
      "No files to validate. Pass paths/globs, or add `paths:` under `meta:` in manni.config.yaml.",
    );
  }

  // Pick an explicit extractor for `--as`, validating it up front.
  const forcedExtractor = opts.as ? extractorByName(opts.as) : undefined;
  if (opts.as && !forcedExtractor) {
    throw new DocmetaError(
      `Unknown format "${opts.as}". Supported extensions: ${supportedExtensions().join(", ")}.`,
    );
  }

  const exts =
    opts.exts ?? (forcedExtractor ? forcedExtractor.extensions : undefined);

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
    action: "validated",
  });

  // Settled once per run, not per file: finding it is a filesystem walk, and
  // every file in one run shares the same repository.
  const trustRoot = schemaTrustRoot(cwd, configDir);

  // Sidecar manifests (0037), read once per run: a manifest the config names
  // that cannot be read is the run's problem, not a document's.
  const sidecars = await loadSidecars(config, {
    configDir: configDir ?? cwd,
    base,
    offline: opts.offline ?? config?.offline ?? false,
  });

  const validator = new Validator(
    schemaLoadOptions({
      // The config's directory when a config governs the run, so one project
      // keeps one cache no matter which directory the command was run from.
      root: configDir ?? cwd,
      // A relative file ref belongs to the run's directory, not the cache root.
      fileBase: cwd,
      ttlHours: config?.schemaCache?.ttlHours,
      offline: opts.offline ?? config?.offline,
      // Built from the rebased config, so a pinned local ref is keyed by the
      // same absolute spelling `resolveSchemaSet` will hand to `loadSchema`.
      pins: collectSchemaPins(config),
    }),
  );
  const results: ValidationResult[] = [];
  // Field-joined entries each document matched (0039), keyed by field then
  // value: the duplicate finding and the post-loop orphan check both need
  // to know which documents claimed which value.
  const joinHits = new Map<
    string,
    Map<string, { label: string; line?: number; file: string }[]>
  >();
  // Corpus checks (0026) run only when the resolved file set IS the
  // config-resolved corpus — an invariant, not a flag list: any CLI reshaping
  // of the input set (positional paths, stdin, --as/--ext, --exclude,
  // --no-gitignore) disqualifies the run, because a corpus rule computed over
  // half a corpus reports wrong answers. `-s/--schema` disqualifies too even
  // though the file set is unchanged: a schema override reshapes the corpus
  // *contract* — cliSchemas outranks every override, so all 0027 collection
  // views would be empty by construction and a `FROM <collection>` check
  // would green silently. Config `exclude:` and `respectGitignore:` do not
  // disqualify — they *define* the corpus; the CLI flags redefine the run.
  const scoped =
    opts.inputs.length > 0 ||
    // redundant with inputs.length (stdin is an input) — kept as belt-and-suspenders
    usingStdin ||
    opts.as !== undefined ||
    opts.exts !== undefined ||
    (opts.exclude !== undefined && opts.exclude.length > 0) ||
    opts.respectGitignore !== undefined ||
    (opts.cliSchemas?.length ?? 0) > 0;
  const configuredChecks = config?.checks ?? [];

  // A manifest entry naming a document this run did not load (0037 rule 4):
  // 0014's named-file-that-is-not-there, and 0026 §4's row outside the run.
  // Only when the run is the config corpus — a positional path means the
  // operator chose to look at part of it, and entries for the rest are
  // expected rather than orphaned.
  if (!scoped) {
    const orphans = orphanEntries(sidecars, files, base);
    if (orphans.length > 0) throw orphanError(orphans);
  }
  const checksWillRun =
    configuredChecks.length > 0 && opts.checks !== false && !scoped;
  // Every successful extraction, kept for the corpus checks (0026): the
  // projection they run over is these entries, exactly as `query` holds them.
  // 0021 measured that holding a docs corpus in memory is not the cost that
  // matters — but the common no-checks path should not retain every file's
  // extraction, so the list fills only when the checks will actually run.
  const checkEntries: CheckEntry[] = [];
  // Each file's resolution outcome from the loop below, so the checks'
  // collection-view membership (0027) reuses this walk instead of re-running
  // it per file. A file whose resolution threw has no entry — deliberately:
  // it was filed as a schema finding and is a member of no view.
  const checkResolved = new Map<string, ResolvedSchemaSet>();
  // The derived channel (0040): with `derive:` configured and the flag
  // absent, every file read is an input to one derivation after the loop,
  // and its managed fields are then compared with what the sources say.
  // Stdin is never an input — there is no history behind it.
  const deriveConfig = config?.derive;
  // A `derive:` carrying only `sources` or `codeowners` shapes the reads and
  // manages nothing, so there is nothing to compare.
  const deriveWillRun =
    deriveConfig !== undefined &&
    deriveConfig.fields.length > 0 &&
    opts.derive !== false;
  // A corpus check naming the `derived` table needs the same inputs, content
  // included (the git source hashes it to spot an uncommitted body), so the
  // one list serves both — and fills only when something will read it.
  const derivedChecks = checksWillRun
    ? configuredChecks.filter((c) => mentionsDerived(c.query))
    : [];
  const checksNeedDerived = derivedChecks.length > 0;
  const deriveInputs: DeriveInput[] = [];
  const keepDeriveInputs = deriveWillRun || checksNeedDerived;
  // One derivation for the run, over the union of what either reader needs:
  // the managed fields the comparison judges, and the columns the checks
  // can read. Memoized so a check that names the table and a managed field
  // share the git walk (and the gh or glab round-trip) rather than each paying
  // for one. A source that cannot answer is the run's error either way — a
  // half-derived comparison would read as "all current", the false green
  // the channel refuses — and the hint names the reader that asked.
  // The configured commands (0041) are part of both: a command's field is
  // managed like a built-in one, and is a column the checks can read.
  const deriveCommands = commandsOf(deriveConfig);
  const deriveFields = new Set<string>(deriveWillRun ? deriveConfig.fields : []);
  const readable = derivableFields(deriveCommands);
  for (const c of derivedChecks) for (const f of fieldsForSql(c.query, readable)) deriveFields.add(f);
  const derivedOnce = once(async (): Promise<DeriveResult> => {
    const derived = await deriveMetadata(deriveInputs, {
      cwd,
      base,
      ...(configDir !== undefined ? { configDir } : {}),
      sources: deriveConfig?.sources ?? [...DERIVE_SOURCES],
      fields: [...deriveFields],
      ...(deriveConfig?.codeowners !== undefined
        ? { codeowners: deriveConfig.codeowners }
        : {}),
      ...(deriveCommands !== undefined ? { commands: deriveCommands } : {}),
      cache: opts.cache ?? true,
      now: () => new Date(),
    });
    assertSourcesAvailable(
      derived.sources,
      deriveWillRun
        ? "pass --no-derive to skip the comparison, or narrow derive.sources"
        : "narrow derive.sources in manni.config.yaml",
    );
    // A source that answered, with a caveat worth one line: a repository
    // with no CODEOWNERS file derives null owners rather than failing.
    for (const [name, status] of Object.entries(derived.sources)) {
      if (status.available && status.reason !== undefined) {
        opts.onNotice?.(`${name}: ${status.reason}`);
      }
    }
    return derived;
  });

  const processOne = async (
    label: string,
    content: string,
    extension: string,
  ): Promise<void> => {
    const extractor =
      forcedExtractor ?? extractorForExtension(extension);
    if (!extractor) {
      throw new DocmetaError(
        `Unsupported file type "${extension}" for "${label}". Supported: ${supportedExtensions().join(", ")}. Use --as to override.`,
      );
    }

    let extracted;
    try {
      extracted = extractor.extract(content, label, {
        elements: resolveElements(label, config),
      });
    } catch (err) {
      // A `DocmetaError` out of an extractor is operational, not a bad
      // document — it aborts the run rather than counting as a file failure.
      if (err instanceof DocmetaError) throw err;
      results.push(
        parseErrorResult(label, extractor.name, (err as Error).message, "parse"),
      );
      return;
    }
    // The sidecar merge sits between extraction and everything downstream,
    // so schema resolution, validation, and the corpus checks all see the one
    // object the document and its manifest entry make together.
    // `merged.extracted` keeps the document's own `lineFor`/`colFor`: a
    // sidecar key is not in the document, so those answer `undefined` for it
    // and `merged.locate` answers instead. Rebound rather than shadowed, so
    // every read below — resolution, validation, the collision loop — sees
    // the one merged object.
    //
    // The derived comparison is the one reader that takes the document's
    // OWN extraction, from before the merge: a managed key can never be
    // sidecar-owned (the config parser refuses the overlap), so the asserted
    // value is the document's, and `lineFor` must answer for its own lines.
    if (keepDeriveInputs && label !== STDIN_LABEL) {
      deriveInputs.push({ label, absPath: resolve(base, label), content, extracted });
    }
    const merged = mergeSidecars(label, extracted, sidecars, base);
    extracted = merged.extracted;
    for (const j of merged.joins) {
      const byValue =
        joinHits.get(j.field) ??
        new Map<string, { label: string; line?: number; file: string }[]>();
      const line = extracted.lineFor(j.field);
      const hits = byValue.get(j.value) ?? [];
      hits.push({ label, file: j.file, ...(line != null ? { line } : {}) });
      byValue.set(j.value, hits);
      joinHits.set(j.field, byValue);
    }
    if (checksWillRun) checkEntries.push({ label, extracted });

    let resolved: ResolvedSchemaSet;
    try {
      resolved = resolveSchemaSetWithSource({
        filePath: label,
        fileSchema: extracted.data[FILE_SCHEMA_KEY],
        cliSchemas: opts.cliSchemas,
        config,
        // A document's own `$schema` is measured from the run's directory, the
        // same base `loadSchema` will read it from, and contained to the
        // repository the run is standing in.
        fileBase: cwd,
        trustRoot,
        onNotice: opts.onNotice,
      });
    } catch (err) {
      results.push(
        parseErrorResult(label, extractor.name, (err as Error).message, "schema"),
      );
      return;
    }
    if (checksWillRun) checkResolved.set(label, resolved);

    const schemaSet = resolved.schemas;
    let errors: FieldError[];
    try {
      errors = await validator.validate(
        extracted.data,
        schemaSet,
        extracted.lineFor,
        extracted.colFor,
        merged.locate,
      );
    } catch (err) {
      // A schema the *document* chose failing to load — unparseable, missing,
      // integrity mismatch — is that document's failure, and is filed as one.
      // Letting it escape meant a single contributed file naming any non-JSON
      // path in the repo aborted the whole run: exit 2, and nothing reported
      // about any file, including the ones that were fine.
      //
      // Every other source stays operational on purpose. A schema the operator
      // configured is not one document's problem; it invalidates the run, and
      // reporting it per-file would repeat the same error once per document
      // while implying the documents were at fault.
      if (!(err instanceof DocmetaError) || resolved.source !== "document") {
        throw err;
      }
      results.push(
        parseErrorResult(label, extractor.name, err.message, "schema"),
      );
      return;
    }
    // A document carrying a key a sidecar owns (0020 across files: neither
    // channel wins, and the discarded value would be exactly the one nobody
    // checked). Filed against the document at the key's own line.
    for (const { key, file } of merged.collisions) {
      const line = extracted.lineFor(key);
      errors.push({
        schema: SIDECAR_OWNED_SCHEMA,
        keyword: SIDECAR_KEYWORD,
        subject: key,
        instancePath: sidecarPointer(key),
        message: `"${key}" is owned by sidecar ${file}; remove it from the document`,
        ...(line != null ? { line } : {}),
      });
    }
    results.push({
      file: label,
      format: extractor.name,
      ok: errors.length === 0,
      schemas: schemaSet,
      errors,
    });
  };

  if (usingStdin) {
    const content = opts.stdinContent ?? "";
    if (!forcedExtractor) {
      throw new DocmetaError(
        "Reading from stdin (`-`) requires --as <format> to choose an extractor.",
      );
    }
    await processOne(STDIN_LABEL, content, forcedExtractor.extensions[0] ?? "");
  }

  for (const file of files) {
    const content = await readFile(resolve(base, file), "utf8");
    await processOne(file, content, extname(file));
  }

  // Two documents carrying one join value (0039): one entry matched both,
  // and the manifest cannot tell them apart. A finding on each, at the
  // field's own line, whether or not the run is scoped — it is about the
  // documents loaded, not the corpus. Then, on a corpus run, a field entry
  // nothing matched is the same orphan a path entry is.
  if (sidecars) {
    const byLabel = new Map(results.map((r) => [r.file, r]));
    const matched = new Map<string, Set<string>>();
    for (const [field, byValue] of joinHits) {
      matched.set(field, new Set(byValue.keys()));
      for (const [value, hits] of byValue) {
        if (hits.length < 2) continue;
        for (const hit of hits) {
          const others = hits
            .filter((h) => h.label !== hit.label)
            .map((h) => h.label)
            .join(", ");
          const result = byLabel.get(hit.label);
          if (!result) continue;
          result.errors.push({
            schema: SIDECAR_DUPLICATE_SCHEMA,
            keyword: SIDECAR_KEYWORD,
            subject: value,
            instancePath: sidecarPointer(field),
            message: `${hits.length} documents carry ${field} "${value}"; ${hit.file} cannot tell them apart (${others})`,
            ...(hit.line != null ? { line: hit.line } : {}),
          });
          result.ok = false;
        }
      }
    }
    if (!scoped) {
      const orphans = orphanJoins(sidecars, matched);
      if (orphans.length > 0) throw orphanError(orphans);
    }
  }

  // Corpus checks (0026), after the per-file loop and before the baseline so
  // their findings ride the same ratchet the schemas get. The disqualifying
  // conditions live with `scoped`, computed before the loop above.
  if (configuredChecks.length > 0 && opts.checks !== false) {
    if (scoped) {
      opts.onNotice?.("corpus checks skipped: run is scoped");
    } else {
      const findings = await runChecks(configuredChecks, checkEntries, {
        // The same resolution inputs the per-file loop used, so a check's
        // collection views (0027) hold exactly the files each override group
        // was validated as — and `resolved` hands over that loop's outcomes,
        // so membership is read from them instead of resolving twice.
        config,
        ...(opts.cliSchemas ? { cliSchemas: opts.cliSchemas } : {}),
        fileBase: cwd,
        trustRoot,
        resolved: checkResolved,
        ...(opts.onNotice ? { onNotice: opts.onNotice } : {}),
        // A check that names the `derived` table (0040) gets the same view
        // `query` builds, from the run's one derivation — which already
        // covers every field the checks can read, so the list handed back
        // here is not needed. Built only when asked for, because building
        // it spawns git.
        derive: async () => (await derivedOnce()).records,
      });
      const byFile = new Map(results.map((r) => [r.file, r]));
      for (const [file, errs] of findings) {
        // Unreachable while runChecks vets every path against the loaded set,
        // which is a subset of `results` by construction — but a missed merge
        // must be a loud failure, not findings silently dropped.
        const result = byFile.get(file);
        if (!result) {
          throw new DocmetaError(
            `check findings for "${file}" have no validation result to attach to.`,
          );
        }
        result.errors.push(...errs);
        result.ok = false;
      }
    }
  }

  // The derived comparison (0040): what each document asserts for its
  // managed fields against what the sources say. Per file, so it runs on
  // scoped runs too, and before the baseline so a stale stamp rides the same
  // ratchet every other finding does. Reads only the configured fields from
  // the run's one derivation, which may hold more for the checks' sake.
  if (deriveWillRun && deriveInputs.length > 0) {
    const derived = await derivedOnce();
    const byFile = new Map(results.map((r) => [r.file, r]));
    for (const input of deriveInputs) {
      const record: DerivedRecord | undefined = derived.records.get(input.label);
      const result = byFile.get(input.label);
      if (!record || !result) continue;
      const findings = staleFindings(
        deriveConfig.fields.map((field) =>
          compareDerived(field, input.extracted.data[field], record.fields[field]),
        ),
        input.extracted.lineFor,
      );
      if (findings.length === 0) continue;
      result.errors.push(...findings);
      result.ok = false;
    }
  }

  // Fingerprints must not depend on where the command was run from, so a
  // local file schema ref is measured against the config's directory.
  const frame: FingerprintContext = { cwd, base: configDir ?? cwd, runBase: base };

  const { results: reported, baseline } = await settleBaseline(
    results,
    resolveBaselineRequest(opts, config?.baseline, configDir, cwd),
    frame,
  );

  const failed = reported.filter((r) => !r.ok).length;
  const summary: RunSummary = {
    files: reported.length,
    passed: reported.length - failed,
    failed,
    errors: reported.reduce((n, r) => n + r.errors.length, 0),
    // Omitted when nothing was skipped: there is nothing to audit, and the
    // JSON summary stays as it was for every run in a clean repo.
    ...(gitignoreSkipped > 0 ? { gitignoreSkipped } : {}),
    ...(baseline ? { baseline } : {}),
  };

  return { results: reported, summary, frame };
}

/**
 * Apply — or record — the baseline, and describe what it did.
 *
 * On a write, the freshly recorded baseline is then applied to the same
 * results, so `--write-baseline` reports the files it recorded as clean and
 * exits 0 without the exit code needing a special case anywhere.
 *
 * `<stdin>` is the one exception, and deliberately so: it is not a path anyone
 * can look up on the next run, so it is never recorded, never matches, and its
 * findings still fail the run. Reporting it clean would announce success for a
 * violation that was neither fixed nor baselined.
 */
async function settleBaseline(
  results: ValidationResult[],
  request: BaselineRequest | null,
  ctx: FingerprintContext,
): Promise<{ results: ValidationResult[]; baseline?: BaselineSummary }> {
  if (!request) return { results };

  const previous = await readBaseline(request.absPath, request.label);

  if (request.write) {
    // `<stdin>` is not a path anyone can look up on the next run, so recording
    // it would only leave an entry that can never match again.
    const recordable = results.filter((r) => r.file !== STDIN_LABEL);
    const next = buildBaseline(recordable, pkg.version, ctx);
    const { added, removed } = diffBaselines(previous, next);
    await writeBaselineFile(request.absPath, next, request.label);
    const applied = applyBaseline(results, next, ctx);
    return {
      results: applied.results,
      baseline: {
        path: request.label,
        written: true,
        recorded: countFingerprints(next),
        suppressed: applied.suppressed,
        stale: applied.stale,
        added,
        removed,
      },
    };
  }

  if (!previous) {
    throw new DocmetaError(
      `Baseline "${request.label}" not found. Record one with \`manni meta validate --write-baseline\`, or drop --baseline.`,
    );
  }

  const applied = applyBaseline(results, previous, ctx);
  return {
    results: applied.results,
    baseline: {
      path: request.label,
      written: false,
      recorded: applied.recorded,
      suppressed: applied.suppressed,
      stale: applied.stale,
    },
  };
}
