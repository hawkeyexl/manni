/**
 * `validate` command core. Resolves targets, extracts metadata, resolves a
 * schema set per file, validates, and returns structured results. Kept free of
 * CLI/IO plumbing so it can be tested directly.
 */
import { readFile } from "node:fs/promises";
import {
  loadExternalMetadata,
  mergeExternalMetadata,
  orphanEntries,
  orphanError,
  orphanJoins,
  externalMetadataPointer,
  EXTERNAL_DUPLICATE_SCHEMA,
  EXTERNAL_KEYWORD,
  EXTERNAL_OWNED_SCHEMA,
} from "../core/external-metadata.js";
import { resolve, extname } from "node:path";
import {
  DocmetaError,
  isErrorSeverity,
  type FieldError,
  type RunSummary,
  type ValidationResult,
} from "../types.js";
import {
  DEFAULT_BASELINE_PATH,
  LEGACY_BASELINE_PATH,
  type FingerprintContext,
  resolveBaselineRequest,
  settleBaseline,
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
import { memberOf, retainMembers } from "../core/collections.js";
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
  encryptionFindings,
  encryptionView,
  lazyKey,
  settleFindings,
  unverifiedWarning,
} from "../core/encrypted.js";
import { errorMessage } from "../../shared/errors.js";

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
  /**
   * `--collection <name>`, repeatable: run over the named configured
   * collections instead of every declared one (proposal 0041). Cannot be
   * combined with positional paths; `-` is allowed beside it.
   */
  collections?: string[];
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
   * `--no-checks` (false): skip the config's named corpus checks for this
   * run. Absent leaves them on — they still only run when the resolved file
   * set is the config-resolved corpus (proposal 0026).
   */
  checks?: boolean;
  /**
   * The environment `MANNI_ENCRYPTION_KEY` is read from (proposal 0045).
   * Defaults to `process.env`; tests pass their own so a developer's key is
   * never read.
   */
  env?: NodeJS.ProcessEnv;
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

export async function runValidate(
  opts: ValidateOptions,
): Promise<ValidateRun> {
  const cwd = opts.cwd ?? process.cwd();

  // Explicit CLI inputs win, else config `paths:`; `base` is whichever of the
  // two directories those inputs were written relative to.
  const {
    config,
    inputs,
    base,
    configDir,
    collections,
    declaredCollections,
    fromCollections,
    configFile,
  } =
    await resolveRunConfig({
      cwd,
      configPath: opts.configPath,
      noConfig: opts.noConfig,
      inputs: opts.inputs,
      ...(opts.collections !== undefined
        ? { collections: opts.collections }
        : {}),
      onConfigLoaded: opts.onConfigLoaded,
    });
  /** The collections one label belongs to, computed once per file. */
  const membersFor = (label: string): string[] =>
    memberOf(collections, configDir ?? cwd, base, label);
  const usingStdin = inputs.includes(STDIN_TOKEN);

  if (inputs.length === 0) {
    throw new DocmetaError(
      "No files to validate. Pass paths/globs, or declare a collection under `collections:` in manni.config.yaml.",
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
  // Only `--exclude`. A collection's `exclude:` governs *membership*, not the
  // walk of a path someone typed (0041 rule 3): the tool has no basis to pick
  // which collection's exclusions to honour once there are several.
  const exclude = opts.exclude ?? [];
  const { files: walked, gitignoreSkipped } = await resolveTargetSet({
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
  // Rule 9: the walk applied only the family ignores and `--exclude`, so it saw
  // just the first half of each collection's statement. Narrow it to actual
  // members, or a collection's `exclude:` would shape its SQL view and not what
  // a bare run reads. Skipped for typed paths: those are the operator's (rule 3).
  const files = fromCollections ? retainMembers(walked, membersFor) : walked;
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

  // External metadata (0037), read once per run: a manifest the config names
  // that cannot be read is the run's problem, not a document's.
  const externalMetadata = await loadExternalMetadata(collections, {
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
    Map<string, { label: string; line?: number; file: string; shown: string }[]>
  >();
  // Corpus checks (0026) run only when the resolved file set IS the
  // config-resolved corpus — an invariant, not a flag list: any CLI reshaping
  // of the input set (positional paths, stdin, --as/--ext, --exclude,
  // --no-gitignore) disqualifies the run, because a corpus rule computed over
  // half a corpus reports wrong answers. `--collection` is the same reshaping
  // by name (0041 rule 11): every unselected collection's view holds only what
  // the run happened to load, so a `FROM blog` check would pass by having
  // nothing to fail on. `-s/--schema` disqualifies too even though the file
  // set is unchanged: a CLI schema override reshapes the corpus *contract* —
  // cliSchemas outranks every override, so every file is judged against a set
  // the config never assigned it, and a check written against the configured
  // contract would be reporting on a corpus that does not exist outside this
  // run. Config `exclude:` and `respectGitignore:` do not disqualify — they
  // *define* the corpus; the CLI flags redefine the run.
  const scopedToCollections = (opts.collections?.length ?? 0) > 0;
  const scopedByFlags =
    opts.inputs.length > 0 ||
    // redundant with inputs.length (stdin is an input) — kept as belt-and-suspenders
    usingStdin ||
    opts.as !== undefined ||
    opts.exts !== undefined ||
    (opts.exclude !== undefined && opts.exclude.length > 0) ||
    opts.respectGitignore !== undefined ||
    (opts.cliSchemas?.length ?? 0) > 0;
  // Corpus checks need the whole corpus: a reshaping flag disqualifies, and so
  // does narrowing by name, because every unselected collection's view then
  // holds only what the run happened to load (0041 rule 11).
  const scoped = scopedByFlags || scopedToCollections;
  const configuredChecks = config?.checks ?? [];

  // A manifest entry naming a document this run did not load (0037 rule 4):
  // 0014's named-file-that-is-not-there, and 0026 §4's row outside the run.
  // Only when the run is a corpus — a positional path or a reshaping flag means
  // the operator chose to look at part of it, and entries for the rest are
  // expected rather than orphaned.
  //
  // `--collection` is not such a reshaping. It makes each named collection the
  // corpus (0041 rule 6): the run loaded all of every collection it named, so
  // an entry of one of those pointing at a document that is not there is a
  // stale entry, and a CI job narrowed to one collection would otherwise lose
  // the check it relies on. Entries of unselected collections are skipped.
  if (!scopedByFlags) {
    const covered = scopedToCollections ? collections.map((c) => c.name) : undefined;
    const orphans = orphanEntries(externalMetadata, files, base, covered);
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
  // The run's encryption key (proposal 0045), resolved the first time a
  // ciphertext needs it, and the encrypted values no key could verify.
  const encryptionKey = lazyKey(configFile, opts.env);
  let unverified = 0;
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

    const members = membersFor(label);
    let extracted;
    try {
      extracted = extractor.extract(content, label, {
        elements: resolveElements(label, config, members),
      });
    } catch (err) {
      // A `DocmetaError` out of an extractor is operational, not a bad
      // document — it aborts the run rather than counting as a file failure.
      if (err instanceof DocmetaError) throw err;
      results.push(
        parseErrorResult(label, extractor.name, errorMessage(err), "parse"),
      );
      return;
    }
    // The external-metadata merge sits between extraction and everything downstream,
    // so schema resolution, validation, and the corpus checks all see the one
    // object the document and its manifest entry make together.
    // `merged.extracted` keeps the document's own `lineFor`/`colFor`: a
    // manifest key is not in the document, so those answer `undefined` for it
    // and `merged.locate` answers instead. Rebound rather than shadowed, so
    // every read below — resolution, validation, the collision loop — sees
    // the one merged object.
    const merged = mergeExternalMetadata(label, extracted, externalMetadata, members, base, {
      encryptionKey,
    });
    extracted = merged.extracted;
    for (const j of merged.joins) {
      const byValue =
        joinHits.get(j.field) ??
        new Map<string, { label: string; line?: number; file: string; shown: string }[]>();
      const line = extracted.lineFor(j.field);
      const hits = byValue.get(j.value) ?? [];
      // A finding names the join value as the page holds it: the ciphertext
      // of an encrypted field, never its plaintext.
      hits.push({
        label,
        file: j.file,
        shown: j.pageValue ?? j.value,
        ...(line != null ? { line } : {}),
      });
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
        memberOf: members,
        // A document's own `$schema` is measured from the run's directory, the
        // same base `loadSchema` will read it from, and contained to the
        // repository the run is standing in.
        fileBase: cwd,
        trustRoot,
        onNotice: opts.onNotice,
      });
    } catch (err) {
      results.push(
        parseErrorResult(label, extractor.name, errorMessage(err), "schema"),
      );
      return;
    }

    const schemaSet = resolved.schemas;
    let errors: FieldError[];
    try {
      // Proposal 0045: marked values are validated as their plaintext, on a
      // copy; the page's own object is never mutated, and no finding may say
      // more about an encrypted value than the page did.
      const view = await encryptionView({
        data: extracted.data,
        refs: schemaSet,
        validator,
        key: encryptionKey,
        locate: merged.locate,
      });
      unverified += view.unverified.length;
      errors = [
        ...settleFindings(
          await validator.validate(
            view.data,
            schemaSet,
            extracted.lineFor,
            extracted.colFor,
            merged.locate,
          ),
          view,
          extracted,
        ),
        ...encryptionFindings(view, extracted),
      ];
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
    // A document carrying a key a manifest owns (0020 across files: neither
    // channel wins, and the discarded value would be exactly the one nobody
    // checked). Filed against the document at the key's own line.
    for (const { key, file, collection } of merged.collisions) {
      const line = extracted.lineFor(key);
      errors.push({
        schema: EXTERNAL_OWNED_SCHEMA,
        keyword: EXTERNAL_KEYWORD,
        subject: key,
        instancePath: externalMetadataPointer(key),
        message: `"${key}" is owned by manifest ${file} (collection ${collection}); remove it from the document`,
        ...(line != null ? { line } : {}),
      });
    }
    results.push({
      file: label,
      format: extractor.name,
      ok: !errors.some(isErrorSeverity),
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

  // Once per run, however many files held them (proposal 0045): the exit code
  // is unaffected, and the count is of values, not of the findings dropped.
  if (unverified > 0) opts.onNotice?.(unverifiedWarning(unverified));

  // Two documents carrying one join value (0039): one entry matched both,
  // and the manifest cannot tell them apart. A finding on each, at the
  // field's own line, whether or not the run is scoped — it is about the
  // documents loaded, not the corpus. Then, on a corpus run, a field entry
  // nothing matched is the same orphan a path entry is.
  if (externalMetadata) {
    const byLabel = new Map(results.map((r) => [r.file, r]));
    const matched = new Map<string, Set<string>>();
    for (const [field, byValue] of joinHits) {
      matched.set(field, new Set(byValue.keys()));
      for (const hits of byValue.values()) {
        if (hits.length < 2) continue;
        for (const hit of hits) {
          const others = hits
            .filter((h) => h.label !== hit.label)
            .map((h) => h.label)
            .join(", ");
          const result = byLabel.get(hit.label);
          if (!result) continue;
          result.errors.push({
            schema: EXTERNAL_DUPLICATE_SCHEMA,
            keyword: EXTERNAL_KEYWORD,
            subject: hit.shown,
            instancePath: externalMetadataPointer(field),
            message: `${hits.length} documents carry ${field} "${hit.shown}"; ${hit.file} cannot tell them apart (${others})`,
            ...(hit.line != null ? { line: hit.line } : {}),
          });
          result.ok = false;
        }
      }
    }
    // Same corpus invariant as the path-entry orphans above, and the same
    // reading of `--collection`: a named collection is a corpus of its own.
    if (!scopedByFlags) {
      const covered = scopedToCollections ? collections.map((c) => c.name) : undefined;
      const orphans = orphanJoins(externalMetadata, matched, covered);
      if (orphans.length > 0) throw orphanError(orphans);
    }
  }

  // Corpus checks (0026), after the per-file loop and before the baseline so
  // their findings ride the same ratchet the schemas get. The disqualifying
  // conditions live with `scoped`, computed before the loop above.
  if (configuredChecks.length > 0 && opts.checks !== false) {
    if (scoped) {
      // Name the reason when it is `--collection`: "scoped" alone reads as a
      // stray positional path, and the operator who narrowed the run by name
      // is the one most likely to expect the checks to have run.
      opts.onNotice?.(
        scopedToCollections
          ? `corpus checks skipped: run is scoped to collections ${collections
              .map((c) => c.name)
              .join(", ")}`
          : "corpus checks skipped: run is scoped",
      );
    } else {
      const findings = await runChecks(configuredChecks, checkEntries, {
        // Every declared collection is a view (0041 rule 7), holding the
        // members this run loaded — decided by the same path arithmetic
        // `membersFor` uses, so a check and a `manni meta query` over the same
        // corpus see the same collections.
        collections: declaredCollections,
        ...(configDir !== undefined ? { configDir } : {}),
        base,
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
        result.ok = result.ok && !errs.some(isErrorSeverity);
      }
    }
  }

  // Fingerprints must not depend on where the command was run from, so a
  // local file schema ref is measured against the config's directory.
  const frame: FingerprintContext = { cwd, base: configDir ?? cwd, runBase: base };

  const { results: reported, baseline } = await settleBaseline(
    results,
    resolveBaselineRequest(opts, config?.baseline, configDir, cwd, {
      current: DEFAULT_BASELINE_PATH,
      legacy: LEGACY_BASELINE_PATH,
    }),
    frame,
  );

  const failed = reported.filter((r) => !r.ok).length;
  const count = (keep: (e: FieldError) => boolean): number =>
    reported.reduce((n, r) => n + r.errors.filter(keep).length, 0);
  const warnings = count((e) => !isErrorSeverity(e));
  const summary: RunSummary = {
    files: reported.length,
    passed: reported.length - failed,
    failed,
    errors: count(isErrorSeverity),
    // Omitted at zero, like `gitignoreSkipped` below: nothing meta validates
    // produces a warning today, so the summary stays as it was.
    ...(warnings > 0 ? { warnings } : {}),
    // Omitted when nothing was skipped: there is nothing to audit, and the
    // JSON summary stays as it was for every run in a clean repo.
    ...(gitignoreSkipped > 0 ? { gitignoreSkipped } : {}),
    ...(baseline ? { baseline } : {}),
  };

  return { results: reported, summary, frame };
}
