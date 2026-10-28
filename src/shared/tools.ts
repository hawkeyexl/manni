/**
 * `tools:`, the family-level home for an outside tool's settings (proposal
 * 0052, in the shape lint's proposal 0050 recorded).
 *
 * An outside tool is not any one domain's, so its settings do not sit under a
 * domain's key. Vale is the case in point: `manni term lint` runs it, and so
 * does a docevals grader. Each should read one description of where Vale's
 * config lives, not two that can disagree.
 *
 * Each tool gets a namespace of its own keys rather than a shared
 * `{tool, config}` shape, because tools do not have the same settings. A
 * lowest-common-denominator shape would either lie or grow a passthrough blob.
 *
 * Only the declaration is shared. Running a tool stays with the domain that
 * runs it. Paths are kept as the user spelled them and resolved on use,
 * against the config file's directory, the way `collections:` keeps its globs;
 * whether the file exists is a question for the run that needs it.
 */
import { isAbsolute, resolve } from "node:path";

/** Vale's settings under `tools.vale`. */
export interface ValeToolConfig {
  /** Vale's config file, as written, relative to `manni.config.yaml`. */
  config?: string;
}

/** DITA Open Toolkit's settings under `tools.dita-ot`. */
export interface DitaOtToolConfig {
  /**
   * DITA-OT's installation directory, as written, relative to
   * `manni.config.yaml`. Unset means the `dita` on PATH.
   *
   * A directory rather than a path to the launcher, because that is the unit
   * DITA-OT is distributed and documented as: the download unpacks to one
   * directory, and `bin/dita` inside it will not run from anywhere else.
   */
  home?: string;
}

/** Doc Detective's settings under `tools.doc-detective`. */
export interface DocDetectiveToolConfig {
  /**
   * Doc Detective's config file, as written, relative to `manni.config.yaml`.
   * Unset means Doc Detective finds its own in the working directory.
   */
  config?: string;
}

/** Claude Code's settings under `tools.claude-cli`, for `manni test tasks`'s synthetic user. */
export interface ClaudeCliToolConfig {
  /** Passed as `--model`. Unset means Claude Code's own default. */
  model?: string;
  /** Passed as `--max-turns`. Unset means {@link DEFAULT_CLAUDE_CLI_MAX_TURNS}. */
  maxTurns?: number;
  /** MCP servers the synthetic user gets, as written, relative to `manni.config.yaml`. */
  mcpConfig?: string;
}

/** MadCap Flare's settings under `tools.flare` (proposal 0125). */
export interface FlareToolConfig {
  /**
   * The target whose conditions and variable overrides apply, in every
   * domain. Unset means the project's only target, else none.
   */
  target?: string;
  /**
   * The folder holding `madbuild.exe`, as written, relative to
   * `manni.config.yaml`. Unset means the `madbuild` on PATH.
   */
  home?: string;
}

/** The synthetic user's turn limit when `tools.claude-cli.maxTurns` is unset. */
export const DEFAULT_CLAUDE_CLI_MAX_TURNS = 50;

/** The document's top-level `tools:`, one namespace per outside tool. */
export interface ToolsConfig {
  vale?: ValeToolConfig;
  "dita-ot"?: DitaOtToolConfig;
  "doc-detective"?: DocDetectiveToolConfig;
  "claude-cli"?: ClaudeCliToolConfig;
  flare?: FlareToolConfig;
}

const TOOL_KEYS = ["vale", "dita-ot", "doc-detective", "claude-cli", "flare"] as const;
const CLAUDE_CODE_KEYS = ["model", "maxTurns", "mcpConfig"] as const;
const FLARE_KEYS = ["target", "home"] as const;

function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectUnknownKeys(
  raw: Record<string, unknown>,
  allowed: readonly string[],
  where: string,
  source: string,
  toError: (message: string) => Error,
): void {
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) {
      throw toError(
        `${source}: ${where} has unknown key "${key}". Supported keys: ${allowed.join(", ")}.`,
      );
    }
  }
}

/**
 * Parse the value under the top-level `tools:` key. A bare `tools:` (YAML
 * null) is no tools. Every refusal is a shape that would otherwise read as
 * configured and do nothing: a misspelled tool, or a key a tool never reads.
 */
export function parseTools(
  raw: unknown,
  source: string,
  toError: (message: string) => Error,
): ToolsConfig {
  if (raw === null || raw === undefined) return {};
  if (!isMapping(raw)) {
    throw toError(`${source}: "tools" must be a mapping.`);
  }
  rejectUnknownKeys(raw, TOOL_KEYS, "tools", source, toError);

  const tools: ToolsConfig = {};
  if (Object.hasOwn(raw, "vale")) {
    tools.vale = parseStringKey(raw["vale"], "vale", "config", source, toError);
  }
  if (Object.hasOwn(raw, "dita-ot")) {
    tools["dita-ot"] = parseStringKey(raw["dita-ot"], "dita-ot", "home", source, toError);
  }
  if (Object.hasOwn(raw, "doc-detective")) {
    tools["doc-detective"] = parseStringKey(
      raw["doc-detective"],
      "doc-detective",
      "config",
      source,
      toError,
    );
  }
  if (Object.hasOwn(raw, "claude-cli")) {
    tools["claude-cli"] = parseClaudeCode(raw["claude-cli"], source, toError);
  }
  if (Object.hasOwn(raw, "flare")) {
    tools.flare = parseFlare(raw["flare"], source, toError);
  }
  return tools;
}

/** `tools.flare`, two string keys. */
function parseFlare(
  raw: unknown,
  source: string,
  toError: (message: string) => Error,
): FlareToolConfig {
  if (!isMapping(raw)) {
    throw toError(`${source}: tools.flare must be a mapping.`);
  }
  rejectUnknownKeys(raw, FLARE_KEYS, "tools.flare", source, toError);
  const out: FlareToolConfig = {};
  for (const key of FLARE_KEYS) {
    if (!Object.hasOwn(raw, key)) continue;
    const value = raw[key];
    if (typeof value !== "string" || value.trim() === "") {
      throw toError(`${source}: tools.flare.${key} must be a non-empty string.`);
    }
    out[key] = value;
  }
  return out;
}

/** `tools.claude-cli`, a namespace with keys of more than one type. */
function parseClaudeCode(
  raw: unknown,
  source: string,
  toError: (message: string) => Error,
): ClaudeCliToolConfig {
  if (!isMapping(raw)) {
    throw toError(`${source}: tools.claude-cli must be a mapping.`);
  }
  rejectUnknownKeys(raw, CLAUDE_CODE_KEYS, "tools.claude-cli", source, toError);
  const out: ClaudeCliToolConfig = {};
  for (const key of ["model", "mcpConfig"] as const) {
    if (!Object.hasOwn(raw, key)) continue;
    const value = raw[key];
    if (typeof value !== "string" || value.trim() === "") {
      throw toError(`${source}: tools.claude-cli.${key} must be a non-empty string.`);
    }
    out[key] = value;
  }
  if (Object.hasOwn(raw, "maxTurns")) {
    const value = raw["maxTurns"];
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
      throw toError(`${source}: tools.claude-cli.maxTurns must be a positive integer.`);
    }
    out.maxTurns = value;
  }
  return out;
}

/**
 * One tool's namespace, whose single key is a non-empty string. Every tool
 * read today has that shape; a tool with a second key or another type gets a
 * parser of its own.
 */
function parseStringKey<K extends string>(
  raw: unknown,
  tool: string,
  key: K,
  source: string,
  toError: (message: string) => Error,
): Partial<Record<K, string>> {
  if (!isMapping(raw)) {
    throw toError(`${source}: tools.${tool} must be a mapping.`);
  }
  rejectUnknownKeys(raw, [key], `tools.${tool}`, source, toError);

  const out: Partial<Record<K, string>> = {};
  if (Object.hasOwn(raw, key)) {
    const value = raw[key];
    if (typeof value !== "string" || value.trim() === "") {
      throw toError(`${source}: tools.${tool}.${key} must be a non-empty string.`);
    }
    out[key] = value;
  }
  return out;
}

/** A path as written in the config, made absolute against the config file's directory. */
function fromConfigDir(path: string, configDir: string): string {
  return isAbsolute(path) ? path : resolve(configDir, path);
}

/**
 * The absolute path of Vale's config file, resolved against the directory of
 * the config file that declared it. `undefined` when none is set, which means
 * Vale finds its own config, as it does when a person runs it.
 */
export function valeConfigPath(tools: ToolsConfig, configDir: string): string | undefined {
  const config = tools.vale?.config;
  if (config === undefined) return undefined;
  return fromConfigDir(config, configDir);
}

/**
 * The absolute path of DITA-OT's installation directory, resolved against the
 * directory of the config file that declared it. `undefined` when none is set,
 * which means the `dita` on PATH, as when a person runs it.
 */
export function ditaOtHome(tools: ToolsConfig, configDir: string): string | undefined {
  const home = tools["dita-ot"]?.home;
  if (home === undefined) return undefined;
  return fromConfigDir(home, configDir);
}

/**
 * The absolute path of Doc Detective's config file, resolved against the
 * directory of the config file that declared it. `undefined` when none is set,
 * which means Doc Detective finds its own in the working directory.
 */
export function docDetectiveConfigPath(
  tools: ToolsConfig,
  configDir: string,
): string | undefined {
  const config = tools["doc-detective"]?.config;
  if (config === undefined) return undefined;
  return fromConfigDir(config, configDir);
}

/**
 * The absolute path of the MCP config Claude Code's synthetic user gets,
 * resolved against the directory of the config file that declared it.
 * `undefined` when none is set, which means no MCP servers.
 */
export function claudeCliMcpConfigPath(tools: ToolsConfig, configDir: string): string | undefined {
  const config = tools["claude-cli"]?.mcpConfig;
  if (config === undefined) return undefined;
  return fromConfigDir(config, configDir);
}

/**
 * The absolute path of the folder holding `madbuild.exe`, resolved against the
 * directory of the config file that declared it. `undefined` when none is set,
 * which means the `madbuild` on PATH.
 */
export function flareHome(tools: ToolsConfig, configDir: string): string | undefined {
  const home = tools.flare?.home;
  if (home === undefined) return undefined;
  return fromConfigDir(home, configDir);
}
