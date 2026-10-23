/**
 * The `strategy:` section of manni.config.yaml, and the run resolution every
 * command shares (proposal 0102). Its keys mirror `term:`'s, and so do its
 * refusals: unknown keys, rules or levels are errors that name what is
 * supported and never echo a value. The document set is the family
 * `collections:`, so `paths` and `exclude` are refused by name.
 */
import { resolve } from "node:path";
import { selectCollections } from "../../shared/collections.js";
import { findConfigFile, readConfigFile, type ConfigFile, type ConfigFileOptions } from "../../shared/config-file.js";
import { SEVERITIES } from "../../shared/severity.js";
import { StrategyError } from "../errors.js";
import {
  STRATEGY_RULES,
  type StrategyConfig,
  type StrategyRule,
  type StrategyRun,
  type StrategySeverity,
} from "../types.js";
import { isStrategyRule } from "./severity.js";

export const STRATEGY_SECTION = "strategy";

export const DEFAULT_STRATEGY_BASELINE_PATH = ".manni-strategy-baseline.json";

/** The keys `strategy:` accepts, in the order the reference lists them. */
const CONFIG_KEYS: readonly (keyof StrategyConfig)[] = ["severity", "baseline", "allowEmpty", "respectGitignore"];

/** Keys that belong to the family, refused by name with where they live. */
const COLLECTION_KEYS: readonly string[] = ["paths", "exclude"];

/** The family scale, least severe first, then `off`. */
const SEVERITY_LEVELS: readonly StrategySeverity[] = [...SEVERITIES, "off"];

const CONFIG_FILE: ConfigFileOptions = {
  section: STRATEGY_SECTION,
  legacyNames: [],
  toError: (message) => new StrategyError(message),
};

function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLevel(value: unknown): value is StrategySeverity {
  return typeof value === "string" && (SEVERITY_LEVELS as readonly string[]).includes(value);
}

function rejectUnknownKeys(obj: Record<string, unknown>, allowed: readonly string[], where: string, source: string): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      throw new StrategyError(`Unknown key "${key}" under ${where}: in ${source}. Supported keys: ${allowed.join(", ")}.`);
    }
  }
}

/** A type error names the key and the type it wanted, never the value, which could be a pasted secret. */
function wrongType(key: string, expected: string, source: string): StrategyError {
  return new StrategyError(`strategy.${key} in ${source} must be ${expected}.`);
}

function asBoolean(value: unknown, key: string, source: string): boolean {
  if (typeof value !== "boolean") throw wrongType(key, "a boolean", source);
  return value;
}

function parseSeverity(value: unknown, source: string): Partial<Record<StrategyRule, StrategySeverity>> {
  if (!isMapping(value)) throw wrongType("severity", "a mapping", source);
  rejectUnknownKeys(value, STRATEGY_RULES, "strategy.severity", source);
  const severity: Partial<Record<StrategyRule, StrategySeverity>> = {};
  for (const [rule, level] of Object.entries(value)) {
    if (!isStrategyRule(rule)) continue;
    if (!isLevel(level)) {
      // A level is not a secret, so a string one is quoted back.
      const quoted = typeof level === "string" ? ` "${level}"` : "";
      throw new StrategyError(
        `${source}: strategy.severity.${rule}${quoted} is not a level. Expected ${SEVERITY_LEVELS.join(" | ")}.`,
      );
    }
    severity[rule] = level;
  }
  return severity;
}

/** Validate the `strategy:` slice of a family file. `null` is an empty section. */
export function parseStrategyConfig(raw: unknown, source: string): StrategyConfig {
  if (raw == null) return {};
  if (!isMapping(raw)) throw new StrategyError(`strategy: in ${source} must be a mapping.`);
  // Before the unknown-key check, which would call a family setting a typo.
  for (const key of COLLECTION_KEYS) {
    if (Object.hasOwn(raw, key)) {
      throw new StrategyError(`${source}: strategy does not carry "${key}". Name a collection under collections:.`);
    }
  }
  rejectUnknownKeys(raw, CONFIG_KEYS, "strategy", source);

  const config: StrategyConfig = {};
  if (raw.severity !== undefined) config.severity = parseSeverity(raw.severity, source);
  if (raw.baseline !== undefined) {
    if (typeof raw.baseline !== "string") throw wrongType("baseline", "a string", source);
    config.baseline = raw.baseline;
  }
  if (raw.allowEmpty !== undefined) config.allowEmpty = asBoolean(raw.allowEmpty, "allowEmpty", source);
  if (raw.respectGitignore !== undefined) {
    config.respectGitignore = asBoolean(raw.respectGitignore, "respectGitignore", source);
  }
  return config;
}

export interface StrategyRunOptions {
  cwd: string;
  /** `-c/--config`. */
  configPath?: string;
  /** Positional inputs; empty means fall back to the selected collections' `paths:`. */
  inputs: string[];
  /** `--collection <name>`, repeatable. Empty means every declared collection. */
  collection?: string[];
}

const STDIN = "-";

/** Which config governs the run, and what to resolve from where. */
export async function resolveStrategyRun(opts: StrategyRunOptions): Promise<StrategyRun> {
  const cwd = resolve(opts.cwd);
  const wanted = opts.collection ?? [];
  if (wanted.length > 0 && opts.inputs.some((input) => input !== STDIN)) {
    throw new StrategyError("--collection selects a configured collection; it cannot be combined with paths.");
  }

  const file: ConfigFile | null = opts.configPath
    ? await readConfigFile(opts.configPath, cwd, CONFIG_FILE)
    : await findConfigFile(cwd, CONFIG_FILE);
  if (wanted.length > 0 && file === null) {
    throw new StrategyError("--collection needs a config file to select from.");
  }
  const config = file === null ? null : parseStrategyConfig(file.value, file.source);

  const collections = file
    ? selectCollections(file.collections, wanted, file.source, (message) => new StrategyError(message))
    : [];
  const fromCollections = opts.inputs.length === 0;
  const inputs = fromCollections ? collections.flatMap((c) => c.paths) : opts.inputs;
  const base = fromCollections && inputs.length > 0 && file ? file.dir : cwd;

  return {
    config,
    inputs,
    base,
    collections,
    fromCollections,
    ...(file ? { configDir: file.dir, configPath: file.path, configSource: file.source, configFile: file } : {}),
  };
}
