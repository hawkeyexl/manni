/**
 * The `cite:` section of manni.config.yaml, and the run resolution every
 * command shares (meta's rule: positional inputs resolve from cwd, config
 * `paths` from the config directory; `root` and `baseline` are config-dir
 * relative). Unknown keys, rules or levels are errors that name the supported
 * keys and never echo a value. Root resolution: `--root` (cwd-relative) >
 * `cite.root` > git root > cwd, with a notice on the last fallback. Salt:
 * env `MANNI_CITE_SALT` > `cite.salt` > "".
 */
import { resolve } from "node:path";
import {
  findConfigFile,
  readConfigFile,
  type ConfigFileOptions,
} from "../../shared/config-file.js";
import { findGitRoot } from "../../shared/git-root.js";
import { CiteError } from "../errors.js";
import {
  CITE_RULES,
  type CiteConfig,
  type CiteRule,
  type CiteRun,
  type CiteSeverity,
  type LoadedCiteConfig,
} from "../types.js";
import { isCiteRule } from "./severity.js";

export const CITE_SECTION = "cite";
export const SALT_ENV = "MANNI_CITE_SALT";
export const DEFAULT_CITE_BASELINE_PATH = ".manni-cite-baseline.json";

/** The keys `cite:` accepts, in the order the reference table lists them. */
const CONFIG_KEYS: readonly (keyof CiteConfig)[] = [
  "paths",
  "exclude",
  "allowEmpty",
  "respectGitignore",
  "root",
  "baseline",
  "git",
  "sources",
  "salt",
  "obfuscate",
  "severity",
];

const SEVERITY_LEVELS: readonly CiteSeverity[] = ["error", "warning", "off"];

const CONFIG_FILE: ConfigFileOptions = {
  section: CITE_SECTION,
  // The citation tool never had a file of its own before the family file.
  legacyNames: [],
  toError: (message) => new CiteError(message),
};

/**
 * A key the parser does not know is a typo, not a no-op. Dropping it in
 * silence would let `allowEmtpy: true` read as configured and be nothing.
 * `where` is the mapping as the user spells it: `cite` or `cite.severity`.
 */
function rejectUnknownKeys(
  obj: Record<string, unknown>,
  allowed: readonly string[],
  where: string,
  source: string,
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      throw new CiteError(
        `Unknown key "${key}" under ${where}: in ${source}. Supported keys: ${allowed.join(", ")}.`,
      );
    }
  }
}

/**
 * Every type error names the key and the type it wanted, and nothing else.
 * `salt` is a secret, and a message that quoted the offending value would put
 * it in a CI log; the same shape for every key keeps that a rule rather than
 * a special case.
 */
function wrongType(key: string, expected: string, source: string): CiteError {
  return new CiteError(`cite.${key} in ${source} must be ${expected}.`);
}

function asStringList(value: unknown, key: string, source: string): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw wrongType(key, "a list of strings", source);
  }
  return value as string[];
}

function asBoolean(value: unknown, key: string, source: string): boolean {
  if (typeof value !== "boolean") throw wrongType(key, "a boolean", source);
  return value;
}

function asString(value: unknown, key: string, source: string): string {
  if (typeof value !== "string") throw wrongType(key, "a string", source);
  return value;
}

function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSeverity(
  value: unknown,
  source: string,
): Partial<Record<CiteRule, CiteSeverity>> {
  if (!isMapping(value)) throw wrongType("severity", "a mapping", source);
  rejectUnknownKeys(value, CITE_RULES, "cite.severity", source);
  const severity: Partial<Record<CiteRule, CiteSeverity>> = {};
  for (const [rule, level] of Object.entries(value)) {
    // `rejectUnknownKeys` already settled this; the guard is for the type.
    if (!isCiteRule(rule)) continue;
    if (typeof level !== "string" || !(SEVERITY_LEVELS as readonly string[]).includes(level)) {
      // A level is not a secret, so a string one is quoted back: `eror` reads
      // as the typo it is. Anything else is described by type only.
      const got = typeof level === "string" ? `, not "${level}"` : "";
      throw new CiteError(
        `cite.severity.${rule} in ${source} must be one of ${SEVERITY_LEVELS.join(", ")}${got}.`,
      );
    }
    severity[rule] = level as CiteSeverity;
  }
  return severity;
}

/**
 * Validate the `cite:` slice of a family file. `raw` is what the loader cut
 * out: `null` for an empty section, which is the same as no keys at all.
 * `source` is the file as the user would name it, for the messages.
 */
export function parseCiteConfig(raw: unknown, source: string): CiteConfig {
  if (raw == null) return {};
  if (!isMapping(raw)) {
    throw new CiteError(`cite: in ${source} must be a mapping.`);
  }
  rejectUnknownKeys(raw, CONFIG_KEYS, "cite", source);
  const config: CiteConfig = {};
  if (raw.paths !== undefined) config.paths = asStringList(raw.paths, "paths", source);
  if (raw.exclude !== undefined)
    config.exclude = asStringList(raw.exclude, "exclude", source);
  if (raw.allowEmpty !== undefined)
    config.allowEmpty = asBoolean(raw.allowEmpty, "allowEmpty", source);
  if (raw.respectGitignore !== undefined)
    config.respectGitignore = asBoolean(raw.respectGitignore, "respectGitignore", source);
  if (raw.root !== undefined) config.root = asString(raw.root, "root", source);
  if (raw.baseline !== undefined)
    config.baseline = asString(raw.baseline, "baseline", source);
  if (raw.git !== undefined) config.git = asBoolean(raw.git, "git", source);
  if (raw.sources !== undefined)
    config.sources = asBoolean(raw.sources, "sources", source);
  if (raw.salt !== undefined) config.salt = asString(raw.salt, "salt", source);
  if (raw.obfuscate !== undefined)
    config.obfuscate = asBoolean(raw.obfuscate, "obfuscate", source);
  if (raw.severity !== undefined) config.severity = parseSeverity(raw.severity, source);
  return config;
}

/**
 * Load the config from an explicit path (an error if missing) or by
 * discovery: cwd and each ancestor up to the nearest `.git` boundary, reading
 * `manni.config.yaml` at its `cite:` key. A family file that has no `cite:`
 * belongs to a sibling tool and discovery keeps looking. See
 * src/shared/config-file.ts for the rules. `null` when discovery finds nothing.
 */
export async function loadCiteConfig(
  explicitPath?: string,
  cwd: string = process.cwd(),
): Promise<LoadedCiteConfig | null> {
  const file = explicitPath
    ? await readConfigFile(explicitPath, cwd, CONFIG_FILE)
    : await findConfigFile(cwd, CONFIG_FILE);
  if (file === null) return null;
  return {
    config: parseCiteConfig(file.value, file.source),
    path: file.path,
    dir: file.dir,
  };
}

export interface CiteRunOptions {
  cwd: string;
  /** `-c/--config`. */
  configPath?: string;
  /** `--no-config`: skip discovery and run on the built-in defaults. */
  noConfig?: boolean;
  /** Positional inputs; empty means fall back to the config's `paths:`. */
  inputs: string[];
  /** `--root`, cwd-relative. */
  root?: string;
  onConfigLoaded?: (info: { path: string; dir: string }) => void;
  /** Told once when the root fell back to cwd. */
  onNotice?: (message: string) => void;
  /** Defaults to `process.env`; a test hands in its own. */
  env?: NodeJS.ProcessEnv;
}

/**
 * Settle what every command core needs before it touches a file: which
 * config governs the run, what to resolve and from where, the root `src:`
 * paths resolve against, and the salt.
 */
export async function resolveCiteRun(opts: CiteRunOptions): Promise<CiteRun> {
  const cwd = resolve(opts.cwd);
  const env = opts.env ?? process.env;

  // `--no-config` wins over an explicit path, as in meta: the CLI cannot
  // supply both, but the cores are public API.
  const loaded = opts.noConfig ? null : await loadCiteConfig(opts.configPath, cwd);
  if (loaded) opts.onConfigLoaded?.({ path: loaded.path, dir: loaded.dir });
  const config = loaded ? loaded.config : null;

  // One base per run: positional paths are typed from a shell and stay
  // cwd-relative; `paths:` was written next to the config and resolves there.
  const fromConfig = opts.inputs.length === 0;
  const inputs = fromConfig ? (config?.paths ?? []) : opts.inputs;
  const base = fromConfig && inputs.length > 0 && loaded ? loaded.dir : cwd;

  let root: string;
  if (opts.root !== undefined) {
    root = resolve(cwd, opts.root);
  } else if (loaded && config?.root !== undefined) {
    root = resolve(loaded.dir, config.root);
  } else {
    const gitRoot = findGitRoot(cwd);
    if (gitRoot !== null) {
      root = gitRoot;
    } else {
      root = cwd;
      opts.onNotice?.(`No git root found; resolving src: paths from ${cwd}`);
    }
  }

  const salt = env[SALT_ENV] ?? config?.salt ?? "";

  return {
    config,
    inputs,
    base,
    ...(loaded ? { configDir: loaded.dir, configPath: loaded.path } : {}),
    root,
    salt,
  };
}
