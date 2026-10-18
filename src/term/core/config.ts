/**
 * The `term:` section of manni.config.yaml, and the run resolution every
 * command shares (proposal 0052). It follows cite's rules: positional inputs
 * resolve from cwd, a collection's `paths` and `term.manifests` from the config
 * directory. Unknown keys, rules or levels are errors that name what is
 * supported and never echo a value.
 *
 * Two things a reader might look for here are not `term:` keys. The document
 * set is the family `collections:` (proposal 0041). Vale's config path is the
 * family `tools.vale.config`, because Vale is not the term tool's alone.
 * Both are refused by name under `term:`, so the mistake says where the
 * setting went rather than calling it a typo.
 */
import { resolve } from "node:path";
import { selectCollections } from "../../shared/collections.js";
import {
  findConfigFile,
  readConfigFile,
  type ConfigFile,
  type ConfigFileOptions,
} from "../../shared/config-file.js";
import { SEVERITIES } from "../../shared/severity.js";
import { TermError } from "../errors.js";
import {
  TERM_RULES,
  type LoadedTermConfig,
  type TermConfig,
  type TermFillConfig,
  type TermRule,
  type TermRun,
  type TermSeverity,
} from "../types.js";

export const TERM_SECTION = "term";

export const DEFAULT_TERM_BASELINE_PATH = ".manni-term-baseline.json";

export const DEFAULT_ABSTRACT_MAX_LENGTH = 60;

/** The keys `term:` accepts, in the order the reference table lists them. */
const CONFIG_KEYS: readonly (keyof TermConfig)[] = [
  "manifests",
  "abstractMaxLength",
  "baseline",
  "severity",
  "allowEmpty",
  "respectGitignore",
  "provider",
  "model",
  "fill",
];

/** The keys `term.fill` accepts, and `term.fill.crawl`. */
const FILL_KEYS: readonly string[] = ["out", "confidenceThreshold", "maxTurns", "cacheDir", "crawl"];
const CRAWL_KEYS: readonly string[] = ["minPages"];

/** `term.fill` when a key is unset. */
export const DEFAULT_FILL_CONFIDENCE = 0.7;
export const DEFAULT_FILL_CACHE_DIR = ".manni/term/cache";
export const DEFAULT_CRAWL_MIN_PAGES = 2;

/** Keys that belong to the family, refused by name with where they live. */
const COLLECTION_KEYS: readonly string[] = ["paths", "exclude"];
const TOOL_KEYS: readonly string[] = ["vale"];

/** The family scale, least severe first as the reference spells it, then `off`. */
const SEVERITY_LEVELS: readonly TermSeverity[] = [...SEVERITIES, "off"];

const CONFIG_FILE: ConfigFileOptions = {
  section: TERM_SECTION,
  legacyNames: [],
  toError: (message) => new TermError(message),
};

function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLevel(value: unknown): value is TermSeverity {
  return typeof value === "string" && (SEVERITY_LEVELS as readonly string[]).includes(value);
}

function isTermRule(value: string): value is TermRule {
  return (TERM_RULES as readonly string[]).includes(value);
}

function rejectUnknownKeys(
  obj: Record<string, unknown>,
  allowed: readonly string[],
  where: string,
  source: string,
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      throw new TermError(
        `Unknown key "${key}" under ${where}: in ${source}. Supported keys: ${allowed.join(", ")}.`,
      );
    }
  }
}

/**
 * Every type error names the key and the type it wanted, and nothing else. A
 * value can be a secret pasted under the wrong key, and quoting it would put it
 * in a CI log.
 */
function wrongType(key: string, expected: string, source: string): TermError {
  return new TermError(`term.${key} in ${source} must be ${expected}.`);
}

function asBoolean(value: unknown, key: string, source: string): boolean {
  if (typeof value !== "boolean") throw wrongType(key, "a boolean", source);
  return value;
}

function asString(value: unknown, key: string, source: string): string {
  if (typeof value !== "string") throw wrongType(key, "a string", source);
  return value;
}

function asStringList(value: unknown, key: string, source: string): string[] {
  if (
    !Array.isArray(value) ||
    !value.every((item): item is string => typeof item === "string" && item.trim() !== "")
  ) {
    throw wrongType(key, "a list of non-empty strings", source);
  }
  return value;
}

function asNonNegativeInteger(value: unknown, key: string, source: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw wrongType(key, "a non-negative integer", source);
  }
  return value;
}

function parseFill(value: unknown, source: string): TermFillConfig {
  if (!isMapping(value)) throw wrongType("fill", "a mapping", source);
  rejectUnknownKeys(value, FILL_KEYS, "term.fill", source);
  const fill: TermFillConfig = {};
  if (value.out !== undefined) fill.out = asString(value.out, "fill.out", source);
  if (value.cacheDir !== undefined) fill.cacheDir = asString(value.cacheDir, "fill.cacheDir", source);
  const threshold = value.confidenceThreshold;
  if (threshold !== undefined) {
    if (typeof threshold !== "number" || !(threshold >= 0 && threshold <= 1)) {
      throw wrongType("fill.confidenceThreshold", "a number from 0 to 1", source);
    }
    fill.confidenceThreshold = threshold;
  }
  const turns = value.maxTurns;
  if (turns !== undefined) {
    if (turns !== null && (typeof turns !== "number" || !Number.isInteger(turns) || turns < 1)) {
      throw wrongType("fill.maxTurns", "a positive integer or null", source);
    }
    fill.maxTurns = turns;
  }
  if (value.crawl !== undefined) {
    if (!isMapping(value.crawl)) throw wrongType("fill.crawl", "a mapping", source);
    rejectUnknownKeys(value.crawl, CRAWL_KEYS, "term.fill.crawl", source);
    const minPages = value.crawl.minPages;
    fill.crawl = {};
    if (minPages !== undefined) {
      if (typeof minPages !== "number" || !Number.isInteger(minPages) || minPages < 1) {
        throw wrongType("fill.crawl.minPages", "a positive integer", source);
      }
      fill.crawl.minPages = minPages;
    }
  }
  return fill;
}

function parseSeverity(value: unknown, source: string): Partial<Record<TermRule, TermSeverity>> {
  if (!isMapping(value)) throw wrongType("severity", "a mapping", source);
  rejectUnknownKeys(value, TERM_RULES, "term.severity", source);
  const severity: Partial<Record<TermRule, TermSeverity>> = {};
  for (const [rule, level] of Object.entries(value)) {
    if (!isTermRule(rule)) continue;
    if (!isLevel(level)) {
      // A level is not a secret, so a string one is quoted back: `eror` reads
      // as the typo it is. Anything else is described without its value.
      const quoted = typeof level === "string" ? ` "${level}"` : "";
      throw new TermError(
        `${source}: term.severity.${rule}${quoted} is not a level. Expected ${SEVERITY_LEVELS.join(" | ")}.`,
      );
    }
    severity[rule] = level;
  }
  return severity;
}

/**
 * Validate the `term:` slice of a family file. `raw` is `null` for an empty
 * section, which is the same as no keys at all.
 */
export function parseTermConfig(raw: unknown, source: string): TermConfig {
  if (raw == null) return {};
  if (!isMapping(raw)) {
    throw new TermError(`term: in ${source} must be a mapping.`);
  }
  // Before the unknown-key check, which would call a family setting a typo.
  for (const key of COLLECTION_KEYS) {
    if (Object.hasOwn(raw, key)) {
      throw new TermError(
        `${source}: term does not carry "${key}". Name a collection under collections:.`,
      );
    }
  }
  for (const key of TOOL_KEYS) {
    if (Object.hasOwn(raw, key)) {
      throw new TermError(
        `${source}: term does not carry "${key}". Vale's settings live under tools.${key}.`,
      );
    }
  }
  rejectUnknownKeys(raw, CONFIG_KEYS, "term", source);

  const config: TermConfig = {};
  if (raw.manifests !== undefined) config.manifests = asStringList(raw.manifests, "manifests", source);
  if (raw.abstractMaxLength !== undefined) {
    config.abstractMaxLength = asNonNegativeInteger(raw.abstractMaxLength, "abstractMaxLength", source);
  }
  if (raw.baseline !== undefined) config.baseline = asString(raw.baseline, "baseline", source);
  if (raw.severity !== undefined) config.severity = parseSeverity(raw.severity, source);
  if (raw.allowEmpty !== undefined) config.allowEmpty = asBoolean(raw.allowEmpty, "allowEmpty", source);
  if (raw.respectGitignore !== undefined) {
    config.respectGitignore = asBoolean(raw.respectGitignore, "respectGitignore", source);
  }
  if (raw.provider !== undefined) config.provider = asString(raw.provider, "provider", source);
  if (raw.model !== undefined) config.model = asString(raw.model, "model", source);
  if (raw.fill !== undefined) config.fill = parseFill(raw.fill, source);
  return config;
}

/** The family file, found by discovery or named with `-c`, before its `term:` slice is parsed. */
export function readTermConfigFile(
  explicitPath: string | undefined,
  cwd: string,
): Promise<ConfigFile | null> {
  return explicitPath
    ? readConfigFile(explicitPath, cwd, CONFIG_FILE)
    : findConfigFile(cwd, CONFIG_FILE);
}

function toLoaded(file: ConfigFile): LoadedTermConfig {
  return {
    config: parseTermConfig(file.value, file.source),
    path: file.path,
    dir: file.dir,
    source: file.source,
    collections: file.collections,
    tools: file.tools,
  };
}

/** Load the config from an explicit path, or by discovery. `null` when discovery finds nothing. */
export async function loadTermConfig(
  explicitPath?: string,
  cwd: string = process.cwd(),
): Promise<LoadedTermConfig | null> {
  const file = await readTermConfigFile(explicitPath, cwd);
  return file === null ? null : toLoaded(file);
}

export interface TermRunOptions {
  cwd: string;
  /** `-c/--config`. */
  configPath?: string;
  /** Skip discovery and run on the built-in defaults. */
  noConfig?: boolean;
  /** Positional inputs; empty means fall back to the selected collections' `paths:`. */
  inputs: string[];
  /** `--collection <name>`, repeatable. Empty means every declared collection. */
  collection?: string[];
  onConfigLoaded?: (info: { path: string; dir: string }) => void;
}

/** The stdin token, repeated so this module does not depend on the file loader. */
const STDIN = "-";

/**
 * Settle what every command core needs before it touches a file: which config
 * governs the run, what to resolve and from where, the manifests, and the
 * family's tools.
 */
export async function resolveTermRun(opts: TermRunOptions): Promise<TermRun> {
  const cwd = resolve(opts.cwd);

  // The same two sentences meta, a11y and cite use. Stdin is one more input
  // rather than a path, so it rides beside the flag.
  const wanted = opts.collection ?? [];
  if (wanted.length > 0 && opts.inputs.some((input) => input !== STDIN)) {
    throw new TermError(
      "--collection selects a configured collection; it cannot be combined with paths.",
    );
  }

  const file = opts.noConfig ? null : await readTermConfigFile(opts.configPath, cwd);
  const loaded = file === null ? null : toLoaded(file);
  if (wanted.length > 0 && loaded === null) {
    throw new TermError("--collection needs a config file to select from.");
  }
  if (loaded) opts.onConfigLoaded?.({ path: loaded.path, dir: loaded.dir });

  const collections = loaded
    ? selectCollections(loaded.collections, wanted, loaded.source, (message) => new TermError(message))
    : [];

  const fromCollections = opts.inputs.length === 0;
  const inputs = fromCollections ? collections.flatMap((c) => c.paths) : opts.inputs;
  const base = fromCollections && inputs.length > 0 && loaded ? loaded.dir : cwd;

  const manifests = loaded
    ? (loaded.config.manifests ?? []).map((written) => ({ path: resolve(loaded.dir, written), written }))
    : [];

  return {
    config: loaded ? loaded.config : null,
    inputs,
    base,
    collections,
    fromCollections,
    manifests,
    tools: loaded ? loaded.tools : {},
    ...(loaded ? { configDir: loaded.dir, configPath: loaded.path, configSource: loaded.source } : {}),
    ...(file === null ? {} : { configFile: file }),
  };
}
