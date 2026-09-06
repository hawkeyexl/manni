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
 * of the first family file that has one, still reads `moose.config.yaml` and
 * the pre-family `doc-structure-lint.config.yaml` with a warning, and hands
 * this module the slice. What the slice may contain is decided here.
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
import { parse as parseYaml } from "yaml";
import * as AjvNs from "ajv";
import type { ErrorObject, SchemaObject, ValidateFunction } from "ajv";
import configSchema from "../../../schemas/lint/config.json" with { type: "json" };
import {
  FAMILY_CONFIG_NAMES,
  findConfigFile,
  readConfigFile,
  type ConfigFileOptions,
} from "../../shared/config-file.js";
import { MooseLintError } from "../types.js";
import type { TemplateOverride } from "./resolve-template.js";

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
  /** Targets used when the command line names no positional paths. */
  paths?: string[];
  /** Globs added to the built-in `node_modules`/`.git` excludes. */
  exclude?: string[];
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

/** The top-level key manni lint owns inside the shared manni config. */
export const SECTION_KEY = "lint";

/** The family filenames discovery accepts, in the order it tries them. */
export const CONFIG_FILENAMES: readonly string[] = FAMILY_CONFIG_NAMES;

/**
 * The tool's own filenames from before the family file. Their whole document
 * is the `lint:` section; the family loader reads them with a warning.
 */
export const LEGACY_CONFIG_FILENAMES: readonly string[] = [
  "doc-structure-lint.config.yaml",
  "doc-structure-lint.config.yml",
];

/** How the family loader finds and slices this tool's config. */
const CONFIG_FILE: ConfigFileOptions = {
  section: SECTION_KEY,
  legacyNames: LEGACY_CONFIG_FILENAMES,
  toError: (message) => new MooseLintError(message),
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
  throw new MooseLintError(
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
  throw new MooseLintError(
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

  const validate = sectionValidator();
  if (!validate(section)) {
    const detail =
      (validate.errors ?? []).map(describeError).join("; ") ||
      `does not match the ${SECTION_KEY} config schema`;
    throw new MooseLintError(
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
    throw new MooseLintError(
      `${source}: invalid YAML: ${(err as Error).message}`,
    );
  }

  // An empty file configures nothing; it is not a broken one.
  if (raw == null) return {};
  if (!isRecord(raw)) {
    throw new MooseLintError(
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
 * key wins, a family file without one belongs to a sibling and is passed
 * over, and the pre-family `doc-structure-lint.config.yaml` is read whole
 * with a warning. An explicit path skips discovery and errors if it is
 * missing; its `lint:` key is unwrapped when present and the whole document is
 * the section otherwise, so a file passed by hand may be called anything.
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
  const file = explicitPath
    ? await readConfigFile(explicitPath, cwd, CONFIG_FILE)
    : await findConfigFile(cwd, CONFIG_FILE);
  if (file === null) return null;

  if (!file.wrapped && isRecord(file.value)) {
    rejectMiscasedWrapper(file.value, file.source);
  }
  return { config: parseConfigSection(file.value, file.source), path: file.path };
}
