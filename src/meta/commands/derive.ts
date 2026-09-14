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
import { extname, relative, resolve, sep } from "node:path";
import {
  DocmetaError,
  type FieldError,
  type MetadataExtractor,
  type MetadataPatch,
} from "../types.js";
import {
  resolveRunConfig,
  schemaTrustRoot,
  urlManifestMessage,
  urlManifestOwning,
  type ConfigNotice,
} from "../core/config.js";
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
import {
  collectSchemaPins,
  FILE_SCHEMA_KEY,
  resolveElements,
  resolveSchemaSetWithSource,
  type ResolvedSchemaSet,
} from "../core/resolve-schema.js";
import { schemaLoadOptions } from "../core/schema-registry.js";
import { Validator } from "../core/validator.js";
import {
  ENCRYPTED_PLACEHOLDER,
  EncryptionRefusal,
  META_CONTEXT,
  encryptionView,
  isAtOrUnder,
  lazyKey,
  pointerOf,
  redactedDerived,
  unreadableMessage,
  valueAt,
  withValueAt,
} from "../core/encrypted.js";
import { encryptValue } from "../../shared/encryption.js";
import { ENCRYPTION_KEY_ENV } from "../../shared/encryption-key.js";
import { ensureEncryptionKey, type Confirm } from "../../shared/prompt.js";
import { writeFileAtomic } from "../core/write-file.js";
import { errorMessage } from "../../shared/errors.js";
import { assertSourcesAvailable, deriveMetadata } from "../core/derive/index.js";
import { commandsOf, machinesOf } from "../core/derive/config.js";
import { provenanceFenced } from "../core/derive/git.js";
import {
  compareProvenance,
  parseProvenanceTarget,
  planProvenanceWrite,
  provenanceEntries,
  provenanceFindings,
  rangeResults,
  readProvenancePage,
  type ProvenanceComparison,
  type ProvenanceDerivation,
  type ProvenanceEntry,
} from "../core/derive/provenance.js";
import {
  provenanceManifests,
  provenancePlace,
  type ProvenanceManifest,
  type ProvenancePlace,
} from "../core/derive/provenance-place.js";
import {
  loadExternalMetadata,
  mergeExternalMetadata,
  type ExternalMetadataIndex,
  type SourceLocation,
} from "../core/external-metadata.js";
import { classifyRef } from "../core/schema-registry.js";
import type { FieldLocation } from "../core/location.js";
import type { CollectionConfig } from "../../shared/collections.js";
import { warn } from "../../shared/warn.js";
import {
  keyHome,
  relocationContext,
  type KeyHome,
  type RelocateResult,
} from "../core/relocation.js";
import {
  externalWriteWarnings,
  manifestKeyLine,
  offerExternalHomes,
  type ExternalWrite,
} from "../core/location-writes.js";
import { removeManifestKey, spliceManifestValue } from "../core/external-metadata-write.js";
import { lineSpec, parseLines } from "../../shared/pin.js";
import {
  compareDerived,
  DERIVABLE_FIELDS,
  DERIVE_SOURCES,
  isBuiltinField,
  isDeriveSource,
  PROVENANCE_FIELD,
  staleFindings,
  type DerivableField,
  type DeriveCommand,
  type DerivedField,
  type DerivedRecord,
  type DerivedStatus,
  type DerivedValue,
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
  /**
   * How to ask for a new encryption key when a field its schema marks
   * `x-manni-encrypt` is about to be stamped and no key is available
   * (proposal 0045). The CLI passes `terminalConfirm()`, which is `undefined`
   * off a terminal; absent, such a stamp refuses (exit 2). A dry run never
   * asks: it writes nothing.
   */
  confirm?: Confirm;
  /**
   * The environment `MANNI_ENCRYPTION_KEY` is read from. Defaults to
   * `process.env`; tests pass their own.
   */
  env?: NodeJS.ProcessEnv;
  /**
   * `--generated-by <name>` (proposal 0046): the machine uncommitted body
   * lines go to, or the lines a `<path>:L1-L2` positional names. Absent reads
   * `MANNI_GENERATED_BY` from `env`; an empty value is unset either way.
   */
  generatedBy?: string;
  /**
   * Called with relocate's result after the user accepts a P1 offer
   * (proposal 0047), so the CLI can print what moved before the report.
   */
  onRelocated?: (result: RelocateResult) => void;
}

/** The variable `--generated-by` defaults to (proposal 0046). */
export const GENERATED_BY_ENV = "MANNI_GENERATED_BY";

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
  /**
   * `provenance` ranges whose write reached the disk (proposal 0046): always
   * 0 under `dryRun` and `check`. Present only when the run derives
   * `provenance`.
   */
  ranges?: number;
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
  // Proposal 0046: `<path>:L` and `<path>:L1-L2` scope `--generated-by` to
  // file lines of one page. Split before anything resolves the inputs, so the
  // walk sees the page, and a range on stdin (`-:9`) is stdin all the same.
  const targets: { target: string; page: string }[] = [];
  const typedInputs = opts.inputs.map((arg) => {
    if (arg === STDIN_TOKEN) return arg;
    const { page, lines } = parseProvenanceTarget(arg);
    if (lines === undefined) return arg;
    if (page === STDIN_TOKEN) return STDIN_TOKEN;
    targets.push({ target: arg, page });
    return page;
  });
  const env = opts.env ?? process.env;
  // The option, once given, wins over the variable even when it is empty.
  // Either is trimmed, since trailer evidence is compared trimmed, and a
  // value that is blank after trimming is unset.
  const flagGeneratedBy = machineName(opts.generatedBy);
  const generatedBy =
    opts.generatedBy !== undefined ? flagGeneratedBy : machineName(env[GENERATED_BY_ENV]);

  const runConfig = await resolveRunConfig({
    cwd,
    configPath: opts.configPath,
    noConfig: opts.noConfig,
    inputs: typedInputs,
    ...(opts.collections !== undefined ? { collections: opts.collections } : {}),
    onConfigLoaded: opts.onConfigLoaded,
  });
  const { config, inputs, base, collections, declaredCollections, fromCollections, configFile } =
    runConfig;
  // Reassigned when an accepted relocation (0047) creates the config file.
  let configDir = runConfig.configDir;
  // Refused before any file is read: every other command takes `-`
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
  const wantsProvenance = fields.includes(PROVENANCE_FIELD);
  const firstTarget = targets[0];
  if (firstTarget !== undefined && generatedBy === undefined) {
    throw new DocmetaError(
      `${firstTarget.target} names lines, which only --generated-by uses. Pass --generated-by, or drop the range.`,
    );
  }
  // The variable alone never refuses: an agent session exports it once, and
  // a run that manages other fields has nothing for it to attribute.
  if ((flagGeneratedBy !== undefined || firstTarget !== undefined) && !wantsProvenance) {
    throw new DocmetaError(
      "--generated-by attributes provenance, which is not in --fields. Add provenance, or drop --generated-by.",
    );
  }
  // `loadConfig` refuses a `derive.fields` entry a URL manifest owns (0047,
  // M6); the same rule holds for `--fields`, which bypasses the config. A
  // local manifest that owns a field is where derive writes it. Every
  // declared collection counts, not only the selected ones, and the config's
  // `keys:` list is the whole claim, so no manifest is loaded. `provenance`
  // keeps its own refusal, raised where its record is placed (0046).
  for (const field of fields) {
    if (field === PROVENANCE_FIELD) continue;
    const owner = urlManifestOwning(field, declaredCollections);
    if (owner !== undefined) throw new DocmetaError(urlManifestMessage(field, owner.file));
  }
  const sources = resolveSources(opts.sources, config?.derive?.sources);
  const check = Boolean(opts.check);
  // `--check` judges and exits; it never writes.
  const dryRun = Boolean(opts.dryRun) || check;

  // Proposal 0045: a managed field its schema marks `x-manni-encrypt` is
  // compared by its plaintext and stamped encrypted, as every other write of
  // a marked value is. The schemas are read for their marks alone; `derive`
  // judges nothing else about the document.
  const schemaOptions = schemaLoadOptions({
    root: configDir ?? cwd,
    // A relative file ref belongs to the run's directory, not the cache root.
    fileBase: cwd,
    ttlHours: config?.schemaCache?.ttlHours,
    offline: config?.offline,
    pins: collectSchemaPins(config),
  });
  const trustRoot = schemaTrustRoot(cwd, configDir);
  const validator = new Validator(schemaOptions);
  const configuredKey = lazyKey(configFile, opts.env);
  let ensuredKey: string | undefined;
  const currentKey = (): string | undefined => ensuredKey ?? configuredKey();
  /**
   * A marked value as it lands in the patch. A dry run writes nothing, so it
   * neither prompts nor refuses: it encrypts under a key it already has, and
   * otherwise holds `(encrypted)`, as `fill --dry-run` does.
   */
  const seal = async (value: unknown, pointer: string): Promise<unknown> => {
    const have = currentKey();
    if (have !== undefined) return encryptValue(value, have, META_CONTEXT);
    if (dryRun) return ENCRYPTED_PLACEHOLDER;
    const { key } = await ensureEncryptionKey({
      subject: pointer,
      cwd,
      file: configFile ?? null,
      ...(opts.env === undefined ? {} : { env: opts.env }),
      ...(opts.confirm === undefined ? {} : { confirm: opts.confirm }),
      notice: (message) => opts.onNotice?.(message),
      toError: (message) => new EncryptionRefusal(message),
    });
    ensuredKey = key;
    return encryptValue(value, key, META_CONTEXT);
  };

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
  // A range names lines of one file, and that file must be one this run
  // reads. A directory, a glob, or a file --ext, --exclude or .gitignore
  // dropped would otherwise leave the range unused, and --generated-by would
  // attribute every uncommitted line of every page instead.
  const rangesByPage = new Map<string, string[]>();
  for (const t of targets) {
    const label = relative(base, resolve(base, t.page)).split(sep).join("/");
    if (!files.includes(label)) {
      throw new DocmetaError(
        `${t.target} does not name one file that derive reads; a range names lines of one file.`,
      );
    }
    const named = rangesByPage.get(label) ?? [];
    if (!named.includes(t.target)) named.push(t.target);
    rangesByPage.set(label, named);
  }
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
  interface Loaded extends DeriveInput {
    format: string;
    elements: string[];
    apply: MetadataExtractor["apply"];
  }
  interface Prepared {
    loaded: Map<string, Loaded>;
    errors: Map<string, { format: string; message: string }>;
    places: Map<string, ProvenancePlace>;
    provenanceCollections: CollectionConfig[];
    provenanceIndex: ExternalMetadataIndex | null;
    /** Collections with a local manifest owning a managed field other than `provenance` (0047). */
    ownedCollections: CollectionConfig[];
    ownedIndex: ExternalMetadataIndex | null;
    derived: Awaited<ReturnType<typeof deriveMetadata>>;
  }
  let sourcesNoted = false;
  /**
   * Read every page, place each `provenance` record, load the manifests that
   * own a managed field, and derive. Run again after an accepted relocation
   * (0047) moves values and declares manifests, so nothing below reads a page
   * or a config from before the move.
   */
  const prepare = async (): Promise<Prepared> => {
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
        errors.set(label, { format: extractor.name, message: errorMessage(err) });
      }
    }

    // ---- Provenance (0046): where each record lives, and what it says ------
    const provenanceRoot = configDir ?? cwd;
    const manifests = wantsProvenance
      ? provenanceManifests(declaredCollections, provenanceRoot, base)
      : [];
    // Only the manifests that own `provenance` are read, as cite reads only
    // the ones that own `citations`: a sibling manifest is none of derive's
    // business, and a URL one is never fetched here.
    const provenanceCollections = declaredCollections
      .map((c) => ({
        ...c,
        externalMetadata: c.externalMetadata.filter((m) => m.keys.includes(PROVENANCE_FIELD)),
      }))
      .filter((c) => c.externalMetadata.length > 0);
    const provenanceIndex =
      manifests.length === 0
        ? null
        : await loadExternalMetadata(provenanceCollections, { configDir: provenanceRoot, base });
    const places = new Map<string, ProvenancePlace>();
    for (const doc of loaded.values()) {
      if (!wantsProvenance) break;
      const place = provenancePlace(
        doc.label,
        doc.extracted.data,
        manifests,
        declaredCollections,
        provenanceRoot,
        base,
      );
      if (place !== undefined) {
        places.set(doc.label, place);
        doc.provenanceManifest = { absPath: place.absPath, entry: place.entry, join: place.join };
      }
      // Every range named for the page, each refused on its own terms; ranges
      // that overlap attribute their union.
      const named = rangesByPage.get(doc.label);
      if (named !== undefined && generatedBy !== undefined) {
        doc.attribution = { targets: named, generatedBy };
      }
    }

    // ---- Manifests that own a managed field (0047) ---------------------------
    // Read so a field kept in a manifest is compared by the manifest's value.
    // Only local manifests owning one of this run's fields: a URL manifest
    // cannot own one (the config and `--fields` refuse it), and a sibling
    // manifest is none of derive's business.
    const ownedCollections = declaredCollections
      .map((c) => ({
        ...c,
        externalMetadata: c.externalMetadata.filter(
          (m) =>
            classifyRef(m.file).kind !== "url" &&
            m.keys.some((k) => k !== PROVENANCE_FIELD && fields.includes(k)),
        ),
      }))
      .filter((c) => c.externalMetadata.length > 0);
    const ownedIndex =
      ownedCollections.length === 0
        ? null
        : await loadExternalMetadata(ownedCollections, { configDir: provenanceRoot, base });

    // ---- Derive ------------------------------------------------------------
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
      machines: machinesOf(config?.derive),
      ...(generatedBy !== undefined ? { generatedBy } : {}),
    });
    assertSourcesAvailable(derived.sources, SOURCE_HINT);
    // A source that answered, with a caveat worth one line: a repository with
    // no CODEOWNERS file derives null owners rather than failing.
    if (!sourcesNoted) {
      sourcesNoted = true;
      for (const [name, status] of Object.entries(derived.sources)) {
        if (status.available && status.reason !== undefined) {
          opts.onNotice?.(`${name}: ${status.reason}`);
        }
      }
    }
    return {
      loaded,
      errors,
      places,
      provenanceCollections,
      provenanceIndex,
      ownedCollections,
      ownedIndex,
      derived,
    };
  };
  let prepared = await prepare();
  /** The page's `provenance` as its record holds it: the manifest's, or the page's own. */
  const stampOf = (doc: Loaded): unknown => {
    if (!prepared.places.has(doc.label)) return doc.extracted.data[PROVENANCE_FIELD];
    const root = configDir ?? cwd;
    const members = memberOf(prepared.provenanceCollections, root, base, doc.label);
    return mergeExternalMetadata(doc.label, doc.extracted, prepared.provenanceIndex, members, base)
      .extracted.data[PROVENANCE_FIELD];
  };

  // ---- Encryption (0045) -----------------------------------------------------
  /**
   * What encryption makes of one document's managed fields. `data` is the
   * page's metadata with every readable encrypted value decrypted, and
   * `marked` the pointers its schema marks, read over the page as it would
   * be stamped: an absent property is one Ajv never evaluates, so an unset
   * field's mark only shows once its value is in place. A managed field
   * holding a ciphertext no key can read cannot be compared, so it is the
   * file's error rather than a guess either way.
   */
  interface Marks {
    data: Record<string, unknown>;
    marked: string[];
    /** Where a value a manifest supplied lives (0047), for a finding's line. */
    locate: (pointer: string) => SourceLocation | undefined;
    /** Each top-level key's `x-manni-location`, read over the page as it would be stamped (0047). */
    prefs: ReadonlyMap<string, FieldLocation>;
  }
  // A schema notice names its file. Each page's marks are read for the P1
  // offer and again for its write, and relocation reads the same schemas, so
  // each notice is said once.
  const noticed = new Set<string>();
  const noticeOnce =
    opts.onNotice === undefined
      ? undefined
      : (message: string): void => {
          if (noticed.has(message)) return;
          noticed.add(message);
          opts.onNotice?.(message);
        };
  const markFields = async (
    doc: Loaded,
    record: DerivedRecord | undefined,
  ): Promise<Marks | { error: string }> => {
    // Proposal 0047: a managed field a manifest owns is compared by the
    // manifest's value, so the page's own metadata is merged with it first.
    let own = doc.extracted;
    let locate: Marks["locate"] = () => undefined;
    if (prepared.ownedIndex !== null) {
      try {
        const members = memberOf(prepared.ownedCollections, configDir ?? cwd, base, doc.label);
        const merged = mergeExternalMetadata(doc.label, doc.extracted, prepared.ownedIndex, members, base, {
          encryptionKey: currentKey,
        });
        own = merged.extracted;
        locate = merged.locate;
      } catch (err) {
        if (err instanceof EncryptionRefusal || !(err instanceof DocmetaError)) throw err;
        return { error: err.message };
      }
    }
    let resolved: ResolvedSchemaSet;
    try {
      resolved = resolveSchemaSetWithSource({
        filePath: doc.label,
        fileSchema: doc.extracted.data[FILE_SCHEMA_KEY],
        config,
        memberOf: membersFor(doc.label),
        // The trust boundary `validate` and `fill` apply to a document's own
        // `$schema`, since that schema decides what gets encrypted.
        fileBase: cwd,
        trustRoot,
        onNotice: noticeOnce,
      });
    } catch (err) {
      return { error: errorMessage(err) };
    }
    try {
      const view = await encryptionView({
        data: own.data,
        refs: resolved.schemas,
        validator,
        key: currentKey,
        locate,
      });
      for (const field of fields) {
        const at = pointerOf(field);
        if (view.unverified.some((p) => isAtOrUnder(p, at))) {
          return {
            error: `${at} is encrypted, and no encryption key is available to compare it. Set ${ENCRYPTION_KEY_ENV}, or run \`manni key set\`.`,
          };
        }
        const unreadable = view.unreadable.find((p) => isAtOrUnder(p, at));
        if (unreadable !== undefined) return { error: unreadableMessage(unreadable) };
      }
      const stamped: Record<string, unknown> = { ...view.data };
      for (const field of fields) {
        const d = record?.fields[field];
        if (d != null) stamped[field] = d.value;
      }
      const marks = await validator.markedPointers(stamped, resolved.schemas);
      const prefs = new Map<string, FieldLocation>();
      for (const [key, p] of await validator.locationPreferences(stamped, resolved.schemas)) {
        prefs.set(key, p.location);
      }
      return { data: view.data, marked: [...new Set([...view.marked, ...marks])], locate, prefs };
    } catch (err) {
      if (err instanceof EncryptionRefusal) throw err;
      // As in `validate` and `fill`: a schema the document chose failing to
      // load is that document's failure; one the operator configured is the
      // run's.
      if (!(err instanceof DocmetaError) || resolved.source !== "document") throw err;
      return { error: err.message };
    }
  };
  /**
   * A value about to be stamped, with every marked pointer at or under its
   * field encrypted, shallowest first: a mark inside a value already sealed
   * is covered by the one on the whole.
   */
  const sealField = async (
    field: string,
    value: unknown,
    marked: readonly string[],
  ): Promise<unknown> => {
    const at = pointerOf(field);
    let holder: Record<string, unknown> = { [field]: value };
    const sealed: string[] = [];
    const under = marked.filter((p) => isAtOrUnder(p, at)).sort((a, b) => a.length - b.length);
    for (const pointer of under) {
      if (sealed.some((s) => isAtOrUnder(pointer, s))) continue;
      const inner = valueAt(holder, pointer);
      if (inner === undefined) continue;
      holder = withValueAt(holder, pointer, await seal(inner, pointer));
      sealed.push(pointer);
    }
    return holder[field];
  };

  const stale = (f: DerivedField): boolean => f.status === "stale" || f.status === "unset";

  // ---- Location (0047): a field that prefers external metadata -------------
  // A stale or unset field whose schema prefers external metadata, and which
  // no manifest owns, is offered a manifest on a terminal (P1) before anything
  // is written. A yes relocates, and the run re-reads what the move changed.
  // Otherwise the value goes to the page, and W1 or W2 says so afterwards.
  const ctx = relocationContext(runConfig, {
    cwd,
    targets: fromCollections ? [] : typedInputs,
    validator,
    ...(opts.noConfig === true ? { noConfig: true } : {}),
    ...(opts.env !== undefined ? { env: opts.env } : {}),
    ...(noticeOnce !== undefined ? { onNotice: noticeOnce } : {}),
  });
  const externalWrites = async (): Promise<ExternalWrite[]> => {
    const out: ExternalWrite[] = [];
    for (const doc of prepared.loaded.values()) {
      const record = prepared.derived.records.get(doc.label);
      const marks = await markFields(doc, record);
      if ("error" in marks) continue;
      for (const field of fields) {
        if (field === PROVENANCE_FIELD || marks.prefs.get(field) !== "external") continue;
        if (!stale(compareDerived(field, marks.data[field], record?.fields[field]))) continue;
        const home = keyHome(ctx, doc.label, doc.extracted.data, field);
        if (home.kind === "unowned") out.push({ label: doc.label, key: field, home: home.home });
      }
    }
    return out;
  };
  // `--check` judges; it neither asks nor warns about where a write would go.
  let flagged = check ? [] : await externalWrites();
  if (flagged.length > 0 && !dryRun && opts.confirm !== undefined) {
    const applied = await offerExternalHomes(ctx, flagged, {
      confirm: opts.confirm,
      ...(opts.onNotice !== undefined ? { onNotice: opts.onNotice } : {}),
      ...(opts.onRelocated !== undefined ? { onRelocated: opts.onRelocated } : {}),
    });
    if (applied.size > 0) {
      configDir = ctx.configDir ?? configDir;
      prepared = await prepare();
      flagged = flagged.filter((w) => !(w.home.kind === "collection" && applied.has(w.home.collection)));
    }
  }
  const { loaded, errors, places, derived } = prepared;

  // ---- Compare, and write ----------------------------------------------------
  /**
   * Each manifest this run writes, read once and spliced in memory (as cite
   * holds them). `text` holds every committed edit; `written` is what is on disk.
   */
  const heldManifests = new Map<string, { path: string; written: string; text: string }>();
  /** A field written into a manifest, whose line the report names once the manifest is settled. */
  const lineRequests: { field: DerivedField; absPath: string; entry: string; join: string }[] = [];
  const holdManifest = async (
    manifest: Pick<ProvenanceManifest, "absPath" | "file">,
  ): Promise<{ path: string; written: string; text: string }> => {
    const already = heldManifests.get(manifest.absPath);
    if (already !== undefined) return already;
    let before: string;
    try {
      before = await readFile(manifest.absPath, "utf8");
    } catch (err) {
      throw new DocmetaError(`Manifest ${manifest.file} could not be read: ${errorMessage(err)}`);
    }
    const held = { path: manifest.absPath, written: before, text: before };
    heldManifests.set(manifest.absPath, held);
    return held;
  };
  const results: DeriveFileResult[] = [];
  /** Save every held manifest a committed edit changed. */
  const saveManifests = async (): Promise<void> => {
    for (const held of heldManifests.values()) {
      if (held.text !== held.written) {
        await writeFileAtomic(held.path, held.text);
        held.written = held.text;
      }
    }
  };
  // A run that aborts part-way (a declined key prompt on a later file) still
  // saves the manifest edits of the pages it already wrote; a dry run saves
  // nothing either way.
  let settled = false;
  try {
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
      // A marked field (0045) is compared by its plaintext, stamped encrypted,
      // and reported as `(encrypted)`, as `fill` and `query` report one.
      const marks = await markFields(doc, record);
      if ("error" in marks) {
        results.push(errorResult(label, doc.format, marks.error, check));
        continue;
      }
      const isMarked = (field: string): boolean => {
        const at = pointerOf(field);
        return marks.marked.some((p) => isAtOrUnder(p, at));
      };
      // Proposal 0046: `provenance` is judged range by range against the
      // record wherever it lives, never by `compareDerived`.
      const place = places.get(label);
      const provenance = wantsProvenance
        ? judgeProvenance(stampOf(doc), derived.provenance?.get(label), record?.fields[PROVENANCE_FIELD] ?? null, place)
        : undefined;
      const compared = fields.map((field) =>
        field === PROVENANCE_FIELD && provenance !== undefined
          ? provenance.field
          : compareDerived(field, marks.data[field], record?.fields[field]),
      );
      // Read when reporting, after `written` is set on `compared` below.
      const shown = (): DerivedField[] =>
        compared.map((f) =>
          f.field !== PROVENANCE_FIELD && isMarked(f.field) ? redactedDerived(f) : f,
        );
      const findingsOf = (reported: readonly DerivedField[]): FieldError[] =>
        reported.flatMap((f) =>
          f.field === PROVENANCE_FIELD && provenance?.judged !== undefined
            ? provenanceFindings(provenance.judged.comparisons, provenance.judged.derivation.page.bodyLine)
            : staleFindings([f], doc.extracted.lineFor, marks.locate),
        );
      if (
        provenance?.judged !== undefined &&
        flagGeneratedBy !== undefined &&
        doc.attribution === undefined &&
        ![...provenance.judged.derivation.evidenceByLine.values()].some((e) => e.rule === 1)
      ) {
        opts.onNotice?.(
          `${label}: no uncommitted body lines; --generated-by attributes only what is not yet committed.`,
        );
      }
      // A manifest-held record is written into the manifest, not the page.
      const toManifest =
        provenance !== undefined && place !== undefined && stale(provenance.field) ? provenance : undefined;
      const due = compared.filter((f) => stale(f) && !(f.field === PROVENANCE_FIELD && toManifest !== undefined));
      // Proposal 0047: a field a manifest of the page's collections owns is
      // written into the page's entry there, whatever its schema prefers; the
      // config's ownership decides where a write lands. A URL manifest cannot
      // be written, and a field join the page lacks has no entry to write to.
      const toEntries: { f: DerivedField; home: Extract<KeyHome, { kind: "manifest" }>; entry: string }[] = [];
      let refusal: string | undefined;
      for (const f of due) {
        if (f.field === PROVENANCE_FIELD) continue;
        const home = keyHome(ctx, label, doc.extracted.data, f.field);
        if (home.kind === "url") {
          refusal = urlManifestMessage(f.field, home.file);
          break;
        }
        if (home.kind !== "manifest") continue;
        if (home.entry === undefined) {
          refusal = `${label} carries no ${home.join}, which ${home.file} joins on, so its ${f.field} has no entry there.`;
          break;
        }
        f.destination = home.file;
        toEntries.push({ f, home, entry: home.entry });
      }
      if (refusal !== undefined) {
        results.push(errorResult(label, doc.format, refusal, check, shown()));
        continue;
      }
      const pending = due.filter((f) => !toEntries.some((t) => t.f === f));
      const onPage = pending.find((f) => f.field === PROVENANCE_FIELD);
      // Stress test 8: where the metadata is part of the body, a stamp on the
      // page would change the very lines it pins.
      if (onPage !== undefined && !provenanceFenced(doc.extracted)) {
        results.push(
          errorResult(
            label,
            doc.format,
            `provenance cannot be stamped into the page: in the "${doc.format}" format the metadata is part of the body it pins. Keep provenance in an externalMetadata manifest.`,
            check,
            shown(),
          ),
        );
        continue;
      }
      // `changed` is what the writer would do, not what the comparison found:
      // as in `fill`, the patch is applied and the result compared with the
      // document, so a field is `written` only when bytes went to disk. Under
      // `dryRun` the same patch is computed and nothing is written.
      let changed = false;
      // This file's manifest edits are staged over the held texts and committed
      // only once its page write has succeeded (or it had none to make), so a
      // file that fails contributes no manifest edit.
      const staged = new Map<string, string>();
      const stage = async (
        manifest: Pick<ProvenanceManifest, "absPath" | "file">,
        edit: (text: string) => string,
      ): Promise<boolean> => {
        const held = await holdManifest(manifest);
        const before = staged.get(held.path) ?? held.text;
        const after = edit(before);
        staged.set(held.path, after);
        return after !== before;
      };
      /** Fields a staged manifest edit writes, marked written at the commit. */
      const manifestWritten: DerivedField[] = [];
      const entryWritten: DerivedField[] = [];
      if (toManifest?.judged !== undefined && place !== undefined) {
        const where = { entry: place.entry, key: PROVENANCE_FIELD, join: place.join, file: place.manifest.file };
        const plan = toManifest.judged.plan;
        // An empty record is no record, as on the page: `provenance` has
        // `minItems: 1`, so the key leaves the entry rather than holding `[]`.
        const edited = await stage(place.manifest, (text) =>
          plan.length === 0
            ? removeManifestKey(text, where).text
            : spliceManifestValue(text, { ...where, value: plan }).text,
        );
        if (edited) {
          changed = true;
          manifestWritten.push(toManifest.field);
        }
      }
      try {
        for (const { f, home, entry } of toEntries) {
          const value = isMarked(f.field) ? await sealField(f.field, f.derived, marks.marked) : f.derived;
          const edited = await stage(home, (text) =>
            spliceManifestValue(text, {
              entry,
              key: f.field,
              value,
              join: home.join,
              file: home.file,
            }).text,
          );
          if (edited) {
            changed = true;
            manifestWritten.push(f);
            entryWritten.push(f);
          }
        }
      } catch (err) {
        if (err instanceof EncryptionRefusal || !(err instanceof DocmetaError)) throw err;
        results.push(errorResult(label, doc.format, err.message, check, shown()));
        continue;
      }
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
                shown(),
              ),
            );
            continue;
          }
          changed = true;
        } else {
          const patch: MetadataPatch = {};
          const deletions: string[] = [];
          for (const f of pending) {
            if (f.field === PROVENANCE_FIELD) {
              // An empty record is no record: `provenance` has `minItems: 1`.
              if (Array.isArray(f.derived) && f.derived.length === 0) deletions.push(f.field);
              else patch[f.field] = f.derived;
              continue;
            }
            patch[f.field] = isMarked(f.field)
              ? await sealField(f.field, f.derived, marks.marked)
              : f.derived;
          }
          const apply = doc.apply;
          const write = (value: MetadataPatch): string =>
            apply(doc.content, value, {
              filePath: label,
              elements: doc.elements,
              ...(deletions.length > 0 ? { deletions } : {}),
            });
          let next: string;
          try {
            next = write(patch);
            // A page with no block yet gets one, and the writer may leave a
            // blank line after it: the body then starts a line later, and every
            // body line the stamp names moves with it.
            const plan = patch[PROVENANCE_FIELD];
            const shift = bodyShift(doc.content, next);
            if (shift > 0 && Array.isArray(plan)) {
              next = write({ ...patch, [PROVENANCE_FIELD]: shiftEntries(provenanceEntries(plan), shift) });
            }
          } catch (err) {
            results.push(errorResult(label, doc.format, errorMessage(err), check, shown()));
            continue;
          }
          changed = changed || next !== doc.content;
          if (next !== doc.content && !dryRun) {
            await writeFileAtomic(doc.absPath, next);
            for (const f of pending) markWritten(f);
          }
        }
      }

      // The page is written (or needed no write): commit this file's manifest
      // edits to the held texts.
      for (const [path, text] of staged) {
        const held = heldManifests.get(path);
        if (held !== undefined) held.text = text;
      }
      if (!dryRun) for (const f of manifestWritten) markWritten(f);

      const reported = shown();
      for (const { f, home, entry } of toEntries) {
        const shownField = reported.find((r) => r.field === f.field);
        if (shownField !== undefined && entryWritten.includes(f)) {
          lineRequests.push({ field: shownField, absPath: home.absPath, entry, join: home.join });
        }
      }
      results.push({
        file: label,
        format: doc.format,
        fields: reported,
        changed,
        ...(check ? { findings: findingsOf(reported) } : {}),
      });
    }
    settled = true;
  } finally {
    if (!dryRun && !settled) {
      await saveManifests().catch(() => undefined);
    }
  }

  // One write per manifest, after every page that touches it is settled.
  if (!dryRun) {
    await saveManifests();
    for (const req of lineRequests) {
      const held = heldManifests.get(req.absPath);
      const line = held === undefined ? undefined : manifestKeyLine(held.text, req.entry, req.field.field, req.join);
      if (line !== undefined) req.field.destinationLine = line;
    }
  }

  // W1 and W2 (0047): a value its schema prefers in external metadata that
  // went to the page, or would have. One line per collection, not per page.
  if (flagged.length > 0) {
    const landed = flagged.filter((w) => {
      const r = results.find((x) => x.file === w.label);
      const f = r?.fields.find((x) => x.field === w.key);
      if (r === undefined || r.error !== undefined || f === undefined || f.destination !== undefined) return false;
      return dryRun ? stale(f) && r.changed : f.written;
    });
    for (const line of externalWriteWarnings(landed, dryRun)) warn(line);
  }

  const summary = summarize(results);
  return {
    results,
    summary: wantsProvenance ? { ...summary, ranges: countRanges(results) } : summary,
    dryRun,
    check,
    sources: derived.sources,
    frame: { cwd, base: configDir ?? cwd, runBase: base },
  };
}

/**
 * Whether the run fails, exit 1. A file the run could not read or write fails
 * it whether or not it wrote the rest, as it does for `fill`: a stamp that was
 * never applied must not read as done. Under `check`, any finding fails it,
 * which is exactly what `validate` would file. A moved `provenance` pin is
 * `stale` so that `derive` rewrites its lines, but it files no finding and
 * does not fail `--check`. An applied run is the work done.
 */
export function deriveFailed(run: Pick<DeriveRun, "results" | "summary" | "check">): boolean {
  if (run.summary.errors > 0) return true;
  return run.check && run.results.some((r) => (r.findings ?? []).length > 0);
}

/** A `--generated-by` or `MANNI_GENERATED_BY` value, trimmed; blank is unset. */
function machineName(value: string | undefined): string | undefined {
  const name = value?.trim();
  return name === undefined || name === "" ? undefined : name;
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

/** A field marked written, and for `provenance` every range that was not already current. */
function markWritten(field: DerivedField): void {
  field.written = true;
  for (const range of field.ranges ?? []) {
    if (range.status !== "current") range.written = true;
  }
}

/** Ranges written across the run. */
function countRanges(results: readonly DeriveFileResult[]): number {
  let n = 0;
  for (const r of results) {
    for (const f of r.fields) n += (f.ranges ?? []).filter((range) => range.written).length;
  }
  return n;
}

interface JudgedProvenance {
  derivation: ProvenanceDerivation;
  comparisons: ProvenanceComparison[];
  /** What `derive` writes: current entries kept, moved ones re-lined, the rest re-derived. */
  plan: ProvenanceEntry[];
}

/**
 * One page's `provenance` as a `DerivedField`: the record against the
 * derivation, range by range (proposal 0046). `status` is `current` when
 * every range is, and otherwise `unset` for a page with no record or
 * `stale` for one whose record is wrong; `unknown` when git had nothing to
 * say about the page at all.
 */
function judgeProvenance(
  asserted: unknown,
  derivation: ProvenanceDerivation | undefined,
  value: DerivedValue | null,
  place: ProvenancePlace | undefined,
): { field: DerivedField; judged?: JudgedProvenance } {
  const base = {
    field: PROVENANCE_FIELD,
    ...(asserted !== undefined ? { asserted } : {}),
    ...(place !== undefined ? { manifest: place.manifest.file } : {}),
  };
  if (derivation === undefined) {
    return { field: { ...base, derived: null, status: "unknown", written: false } };
  }
  const comparisons = compareProvenance(provenanceEntries(asserted), derivation);
  const plan = planProvenanceWrite(comparisons, derivation);
  const settled = comparisons.every((c) => c.status === "current");
  const status: DerivedStatus = settled
    ? "current"
    : asserted === undefined || comparisons.every((c) => c.status === "unset")
      ? "unset"
      : "stale";
  return {
    field: {
      ...base,
      derived: plan,
      source: "git",
      ...(value !== null ? { evidence: value.evidence } : {}),
      status,
      written: false,
      ranges: rangeResults(comparisons, derivation.page.bodyLine),
    },
    judged: { derivation, comparisons, plan },
  };
}

/**
 * How many lines further down the body starts after a write: a writer that
 * adds a block may leave a blank line after it. Zero when the body is the
 * same, and when it changed in some other way.
 */
function bodyShift(before: string, after: string): number {
  const was = readProvenancePage(before).body;
  const now = readProvenancePage(after).body;
  const shift = now.length - was.length;
  if (shift <= 0) return 0;
  return now.slice(shift).join("\n") === was.join("\n") ? shift : 0;
}

function shiftEntries(entries: readonly ProvenanceEntry[], shift: number): ProvenanceEntry[] {
  return entries.map((e) => {
    const span = parseLines(e.lines);
    if (span === undefined) return e;
    return { ...e, lines: lineSpec({ start: span.start + shift, end: span.end + shift }) };
  });
}
