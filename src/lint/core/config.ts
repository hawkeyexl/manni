/**
 * The `lint:` section of `manni.config.yaml`.
 *
 * The file is shared across the manni family - manni docevals, manni meta and
 * this tool all read one file per repo, each taking its own top-level key. So
 * the root is a mapping of tool name to that tool's settings, and manni lint
 * reads `lint:` and nothing else: sibling keys are neither read nor validated,
 * which is what keeps the family decoupled - no registry of known tools, no
 * coordination, no version coupling. See agentevals ADR 01009.
 *
 * Finding the file is the family's job (`src/shared/config-file.ts`): it walks
 * up from the working directory to the repository root, reads the `lint:` key
 * of the first family file that has one, and hands this module the slice. What
 * the slice may contain is decided here. The pre-family
 * `doc-structure-lint.config.yaml` is no longer discovered: its whole document
 * was a `lint:` section written in keys this one no longer takes, so reading it
 * could only produce the moved-key refusal from a file the author is not
 * looking at.
 *
 * The document set is not a `lint:` key. Proposal 0041 declares it once for
 * every tool, under the family-level `collections:`, which the shared loader
 * parses and `resolveLintRun` selects from; `paths:` and `exclude:` under
 * `lint:` are refused by name.
 *
 * That leaves the root unvalidatable by any single tool, so the two ways an
 * author can lose a whole config to this convention are caught by shape
 * instead: keys left at the top level, and a wrapper differing only in case. A
 * wrapper misspelled any other way (`lnt:`) is indistinguishable from another
 * tool's section and still yields defaults - the accepted cost of having no
 * registry.
 *
 * Inside the section, `config.json` is the authority and `additionalProperties`
 * is false at every level, so a typo'd key is a loud failure rather than a
 * silent default. Defaults themselves live with the consumers, not here: this
 * returns exactly what the author wrote.
 */
import { dirname, isAbsolute, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import * as AjvNs from "ajv";
import type { ErrorObject, SchemaObject, ValidateFunction } from "ajv";
import configSchema from "../../../schemas/lint/config.json" with { type: "json" };
import { selectCollections, type CollectionConfig } from "../../shared/collections.js";
import {
  FAMILY_CONFIG_NAMES,
  findConfigFile,
  readConfigFile,
  type ConfigFile,
  type ConfigFileOptions,
} from "../../shared/config-file.js";
import { LintError } from "../types.js";
import { errorMessage } from "../../shared/errors.js";
import type { TemplateOverride } from "./resolve-template.js";
import { refRelativeTo } from "./template-registry.js";

// ajv is CommonJS with a default export; under NodeNext the constructable
// value is on `.default`, which the namespace import reaches without the
// esModuleInterop-only call signature TypeScript otherwise complains about.
type AjvCtor = typeof import("ajv").default;
const Ajv = AjvNs.default as unknown as AjvCtor;

/**
 * Everything the `lint:` section can carry. Every key is optional, and an
 * absent one means "the consumer's default", never a value written in here.
 *
 * `overrides[].template` and the `types` values are template refs, left as the
 * strings they were written as: `resolve-template.ts` owns what a ref means.
 */
export interface LintConfig {
  /** Zero matched files is a success, not an operational error. */
  allowEmpty?: boolean;
  /** The structure job: what `lint structure` runs and `lint check` includes. */
  structure?: LintJobConfig;
  /** Template files to load; their `types:` join the routing table. */
  templates?: string[];
  /** Template for a page that declares no doctype. */
  template?: string;
  /** Explicit doctype -> template ref map. */
  types?: Record<string, string>;
  /** Repo policy, first matching glob wins. */
  overrides?: TemplateOverride[];
}

export type { TemplateOverride };

/** One job's settings. The tool that performs it is all a job configures. */
export interface LintJobConfig {
  tool?: LintTool;
}

/** The tools that can perform a lint job: manni's own engine. */
export const LINT_TOOLS = ["manni"] as const;
export type LintTool = (typeof LINT_TOOLS)[number];

/** The jobs `lint check` runs: `structure`. */
export const LINT_JOBS = ["structure"] as const;
export type LintJob = (typeof LINT_JOBS)[number];

/** The tools each job accepts, in the order its message lists them. */
export const TOOLS_BY_JOB: Readonly<Record<LintJob, readonly LintTool[]>> = {
  structure: ["manni"],
};

export function isLintTool(value: string): value is LintTool {
  return (LINT_TOOLS as readonly string[]).includes(value);
}

/** The top-level key manni lint owns inside the shared manni config. */
export const SECTION_KEY = "lint";

/** The family filenames discovery accepts, in the order it tries them. */
export const CONFIG_FILENAMES: readonly string[] = FAMILY_CONFIG_NAMES;

/**
 * How the family loader finds and slices this tool's config.
 *
 * `legacyNames` is empty on purpose. `doc-structure-lint.config.yaml` was this
 * tool's file before the family file, and its whole document was the `lint:`
 * section - written in `paths:` and `exclude:`, which the section no longer
 * takes. Reading one now could only refuse it, from a file the author is not
 * looking at, so discovery no longer knows the name at all.
 */
const CONFIG_FILE: ConfigFileOptions = {
  section: SECTION_KEY,
  legacyNames: [],
  toError: (message) => new LintError(message),
};

/**
 * The keys this tool owns, read off the schema rather than restated here.
 *
 * Finding any of them at the root of a manni config means the file was never
 * nested under `lint:`. Deriving the list from `config.json` is what stops it
 * drifting from the real key set the next time a key is added - a restated
 * list that fell behind would let exactly the un-nested config it exists to
 * catch fall through to defaults instead.
 */
const SECTION_KEYS: readonly string[] = Object.keys(configSchema.properties);

/** The keys one job takes. Read off the schema for the same reason. */
const STRUCTURE_KEYS: readonly string[] = Object.keys(
  configSchema.properties.structure.properties,
);

/**
 * Where the metadata tool's configuration reference documents `collections:`.
 * The literal cite's `config.ts` carries, repeated for the same reason: that
 * module is meta's own, and sibling tools import only its public and family
 * barrels.
 */
const CONFIG_REF = "https://hawkeyexl.github.io/manni/meta/reference/configuration/";

/**
 * The two keys proposal 0041 moved out of `lint:` and up to the family level.
 * Refused rather than aliased, as meta and cite refuse them: an alias would be
 * a second place to declare a document set that is meant to be declared once.
 */
const MOVED_KEYS: readonly string[] = ["paths", "exclude"];

/**
 * Refuse a moved key before the unknown-key check, which would otherwise call
 * `paths` a typo. Same sentence as meta's and cite's, with the section renamed.
 */
function assertNoMovedKeys(raw: Record<string, unknown>, source: string): void {
  for (const key of MOVED_KEYS) {
    if (Object.hasOwn(raw, key)) {
      throw new LintError(
        `${source}: "${key}" is no longer a ${SECTION_KEY} key. Document sets are declared once for every tool, under a top-level collections: list. See ${CONFIG_REF}#collections`,
      );
    }
  }
}

/**
 * A key the parser does not know is a typo, not a no-op. Naming every key the
 * mapping takes is what turns `allowEmtpy: true` from a line that reads as
 * configured and does nothing into a failure the author can act on. `where` is
 * the mapping as the user spells it: `lint` or `lint.structure`.
 */
function rejectUnknownKeys(
  obj: Record<string, unknown>,
  allowed: readonly string[],
  where: string,
  source: string,
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      throw new LintError(
        `Unknown key "${key}" under ${where}: in ${source}. Supported keys: ${allowed.join(", ")}.`,
      );
    }
  }
}

/**
 * The job mappings, checked before Ajv so the messages name the key set and
 * the tool list rather than restating a schema keyword. A tool nobody
 * implements is refused by name: silently falling back to manni's engine would
 * make `tool: vale` read as configured and lint with something else.
 */
function checkJobs(section: Record<string, unknown>, source: string): void {
  for (const job of LINT_JOBS) {
    const value = section[job];
    if (value == null || !isRecord(value)) continue;
    rejectUnknownKeys(value, STRUCTURE_KEYS, `${SECTION_KEY}.${job}`, source);
    const tool = value.tool;
    if (tool === undefined) continue;
    if (typeof tool !== "string" || !TOOLS_BY_JOB[job].includes(tool as LintTool)) {
      throw new LintError(
        `${source}: ${SECTION_KEY}.${job}.tool must be one of: ${TOOLS_BY_JOB[job].join(", ")}.`,
      );
    }
  }
}

// No `useDefaults`: the schema declares no defaults, deliberately. A default
// written into the parsed object is indistinguishable from a value the author
// wrote, which is the trap `template.json` documents on its `required` key.
const ajv = new Ajv({ allErrors: true });

let compiled: ValidateFunction<LintConfig> | null = null;

function sectionValidator(): ValidateFunction<LintConfig> {
  compiled ??= ajv.compile<LintConfig>(configSchema as SchemaObject);
  return compiled;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * One Ajv error, as a path an author can find in their file.
 *
 * Ajv's `instancePath` is relative to the section, so it is prefixed back to
 * `lint`: a bare `/overrides/0/files` names a path that is not in the file.
 */
function describeError(error: ErrorObject): string {
  const params = error.params as { additionalProperty?: unknown };
  const extra =
    typeof params.additionalProperty === "string"
      ? ` ("${params.additionalProperty}")`
      : "";
  return `${SECTION_KEY}${error.instancePath} ${error.message ?? "is invalid"}${extra}`;
}

/** The un-nested config: our own keys at the root, with no `lint:` wrapper. */
function rejectUnNested(root: Record<string, unknown>, source: string): void {
  const stray = SECTION_KEYS.filter((key) => key in root);
  if (stray.length === 0) return;
  // The convention is named after the shared file, but the message must
  // describe the file the user actually passed: telling someone who ran
  // `-c my-custom.yaml` about `manni.config.yaml` reads as a complaint about a
  // file they never mentioned, and sends them looking for the wrong one.
  throw new LintError(
    `${source}: found ${stray.map((key) => `"${key}:"`).join(", ")} at the top level, ` +
      `but no "${SECTION_KEY}:" key. This file is shared across the manni family, ` +
      `so every manni lint setting belongs under a top-level "${SECTION_KEY}:" key. ` +
      `Indent the file's contents one level and add that key.`,
  );
}

/**
 * The miscased wrapper: `Lint:`, which the stray-key check cannot see, because
 * the keys under it are nested rather than at the top level.
 */
function rejectMiscasedWrapper(
  root: Record<string, unknown>,
  source: string,
): void {
  const miscased = Object.keys(root).find(
    (key) => key !== SECTION_KEY && key.toLowerCase() === SECTION_KEY,
  );
  if (miscased === undefined) return;
  throw new LintError(
    `${source}: found "${miscased}:" at the top level, but the key is case-sensitive ` +
      `and manni lint reads "${SECTION_KEY}:" exactly. Rename "${miscased}:" to "${SECTION_KEY}:".`,
  );
}

/**
 * Validate the `lint:` section itself, whatever file it came from.
 *
 * `source` names the file in every message. `null` is the section written
 * with nothing under it, which an author means as "defaults"; it is not a
 * broken section.
 */
export function parseConfigSection(section: unknown, source: string): LintConfig {
  if (section == null) return {};

  // Before Ajv, which would call a moved key an additional property and an
  // unknown one a schema keyword. Both messages have to name what to do.
  if (isRecord(section)) {
    assertNoMovedKeys(section, source);
    rejectUnknownKeys(section, SECTION_KEYS, SECTION_KEY, source);
    checkJobs(section, source);
  }

  const validate = sectionValidator();
  if (!validate(section)) {
    const detail =
      (validate.errors ?? []).map(describeError).join("; ") ||
      `does not match the ${SECTION_KEY} config schema`;
    throw new LintError(
      `${source}: invalid "${SECTION_KEY}" section: ${detail}.`,
    );
  }
  return section;
}

/**
 * Parse a whole `manni.config.yaml` and return its `lint:` section.
 *
 * `source` names the file in every message. A file that is empty, or that
 * carries only other tools' sections, returns `{}` rather than throwing - that
 * is the case that keeps one shared file usable by a project which has not
 * adopted this tool yet.
 */
export function parseConfig(text: string, source: string): LintConfig {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (err) {
    throw new LintError(
      `${source}: invalid YAML: ${errorMessage(err)}`,
    );
  }

  // An empty file configures nothing; it is not a broken one.
  if (raw == null) return {};
  if (!isRecord(raw)) {
    throw new LintError(
      `${source}: top level must be a mapping of tool name to that tool's settings, ` +
        `with manni lint's under "${SECTION_KEY}:".`,
    );
  }

  if (!(SECTION_KEY in raw)) {
    rejectUnNested(raw, source);
    rejectMiscasedWrapper(raw, source);
    // Every remaining root key belongs to a sibling tool. Reading none of them
    // is the whole point of the convention.
    return {};
  }

  return parseConfigSection(raw[SECTION_KEY], source);
}

/**
 * Load the config from an explicit path, or by walking up from `cwd`.
 *
 * Discovery is the family's: the nearest `manni.config.yaml` with a `lint:`
 * key or a family key wins, and a family file with neither belongs to a
 * sibling and is passed over. An explicit path skips discovery and errors if
 * it is missing; its `lint:` key is unwrapped when present and the whole
 * document is the section otherwise, so a file passed by hand may be called
 * anything.
 *
 * A wrapper differing from `lint:` only in case is still caught on an
 * un-wrapped document: nothing else in the section's schema would name it.
 *
 * Returns null when discovery finds no config, which is not an error - a repo
 * whose pages all declare their `type` needs no config at all.
 */
export async function loadConfig(
  explicitPath?: string,
  cwd: string = process.cwd(),
): Promise<{ config: LintConfig; path: string } | null> {
  const file = await readLintConfigFile(explicitPath, cwd);
  if (file === null) return null;
  return { config: sectionOf(file), path: file.path };
}

/** The family file itself, found or named, before its `lint:` slice is read. */
function readLintConfigFile(
  explicitPath: string | undefined,
  cwd: string,
): Promise<ConfigFile | null> {
  return explicitPath
    ? readConfigFile(explicitPath, cwd, CONFIG_FILE)
    : findConfigFile(cwd, CONFIG_FILE);
}

/** One found file's `lint:` section, parsed, with the shape checks a file gets. */
function sectionOf(file: ConfigFile): LintConfig {
  if (!file.wrapped && isRecord(file.value)) {
    rejectMiscasedWrapper(file.value, file.source);
  }
  return parseConfigSection(file.value, file.source);
}

/**
 * Re-base everything a config declares against the config file's own
 * directory.
 *
 * `loadConfig` returns the file's `path` precisely so this can happen, and
 * discarding it made the same config mean different things depending on where
 * the tool was invoked from. Running from a subdirectory turned `templates:`
 * into "file not found" - and turned `overrides:` into nothing at all,
 * silently: the glob stopped matching, every page fell through to its own
 * `type`, and the run exited 0 having applied none of the repo's policy.
 *
 * Refs go through `refRelativeTo`, which leaves built-in ids, URLs, and
 * absolute paths alone. Globs become absolute, which is what the run matches
 * them against. Every non-absolute glob is relative to the config, `**\/*.md`
 * included: exempting a leading `**` left the original bug half-open, because
 * from a subdirectory that pattern expanded against the working directory.
 */
export function rebaseConfig(
  found: { config: LintConfig; path: string } | null,
): LintConfig {
  if (!found) return {};
  const dir = dirname(resolve(found.path));
  const config = found.config;

  const ref = (value: string): string => refRelativeTo(found.path, value);
  const glob = (value: string): string =>
    isAbsolute(value) ? value : resolve(dir, value).replace(/\\/g, "/");

  return {
    ...config,
    ...(config.templates ? { templates: config.templates.map(ref) } : {}),
    ...(config.template ? { template: ref(config.template) } : {}),
    ...(config.types
      ? {
          types: Object.fromEntries(
            Object.entries(config.types).map(([type, value]) => [type, ref(value)]),
          ),
        }
      : {}),
    ...(config.overrides
      ? {
          overrides: config.overrides.map((o) => ({
            files: glob(o.files),
            template: ref(o.template),
          })),
        }
      : {}),
  };
}

/** The stdin token, repeated so this module does not depend on the file loader. */
const STDIN = "-";

export interface LintRunOptions {
  cwd: string;
  /** `-c/--config`. */
  configPath?: string;
  /** `--no-config`: skip discovery and run on the built-in defaults. */
  noConfig?: boolean;
  /** Positional inputs; empty means fall back to the selected collections' `paths:`. */
  inputs: string[];
  /**
   * `--collection <name>`, repeatable: the collections this run covers. Empty
   * or absent means every declared one, the same thing, because commander's
   * collector hands `[]` over when the flag was never typed.
   */
  collection?: string[];
  onConfigLoaded?: (info: { path: string; dir: string }) => void;
}

/** What every lint command settles before it touches a file. */
export interface ResolvedLintRun {
  /** The `lint:` section, rebased against the config's directory. */
  config: LintConfig;
  /** What to resolve: the positional inputs, or the collections' `paths:`. */
  inputs: string[];
  /** The directory `inputs` resolve from. */
  base: string;
  /** The collections this run covers; `[]` with no config. */
  collections: CollectionConfig[];
  /** Whether `inputs` came from the collections rather than the command line. */
  fromCollections: boolean;
  configDir?: string;
  configPath?: string;
  configSource?: string;
}

/**
 * Settle which config governs the run and what it covers. The same shape cite
 * uses, for the same reason: positional inputs are typed from a shell and stay
 * cwd-relative, while a collection's `paths:` was written next to the config
 * and resolves there, so one run has exactly one base.
 */
export async function resolveLintRun(
  opts: LintRunOptions,
): Promise<ResolvedLintRun> {
  const cwd = resolve(opts.cwd);

  // `--collection` names something only a config can define, and selects a set
  // the operator did not type, so it composes with neither positional paths
  // nor `--no-config`. The same two sentences meta, a11y and cite use. Stdin
  // is one more input rather than a path, so it rides beside the flag.
  const wanted = opts.collection ?? [];
  if (wanted.length > 0 && opts.inputs.some((input) => input !== STDIN)) {
    throw new LintError(
      "--collection selects a configured collection; it cannot be combined with paths.",
    );
  }

  const file = opts.noConfig ? null : await readLintConfigFile(opts.configPath, cwd);
  if (wanted.length > 0 && file === null) {
    throw new LintError("--collection needs a config file to select from.");
  }
  if (file !== null) opts.onConfigLoaded?.({ path: file.path, dir: file.dir });

  const config = rebaseConfig(
    file === null ? null : { config: sectionOf(file), path: file.path },
  );
  // Selected whatever the inputs are: a typed file is still a member of the
  // collections that contain it. An unknown name is the shared helper's error.
  const collections =
    file === null
      ? []
      : selectCollections(
          file.collections,
          wanted,
          file.source,
          (message) => new LintError(message),
        );

  // `--collection` is a request the run has to honour, as in cite and meta:
  // the named collection's pages are resolved even when stdin rides beside the
  // flag. Counting `-` as a path made `lint check - --as markdown --collection
  // guides` lint the piped document, open not one file of `guides`, and exit 0
  // over a docset nothing read. The implicit fallback is not a request, and a
  // lone `-` cancels it: a piped page is a run of its own.
  const fromCollections = wanted.length > 0 || opts.inputs.length === 0;
  const collectionPaths = fromCollections ? collections.flatMap((c) => c.paths) : [];
  // Stdin keeps its typed position; the globs follow it in declaration order.
  const inputs = fromCollections ? [...opts.inputs, ...collectionPaths] : opts.inputs;
  // Only a path needs a base, so it follows the globs when they contributed
  // and stays at the working directory otherwise, stdin included.
  const base = collectionPaths.length > 0 && file ? file.dir : cwd;

  return {
    config,
    inputs,
    base,
    collections,
    fromCollections,
    ...(file === null
      ? {}
      : { configDir: file.dir, configPath: file.path, configSource: file.source }),
  };
}
