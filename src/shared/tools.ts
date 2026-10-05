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

/** The document's top-level `tools:`, one namespace per outside tool. */
export interface ToolsConfig {
  vale?: ValeToolConfig;
  "dita-ot"?: DitaOtToolConfig;
  "doc-detective"?: DocDetectiveToolConfig;
}

const TOOL_KEYS = ["vale", "dita-ot", "doc-detective"] as const;

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
  return tools;
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

/**
 * The absolute path of Vale's config file, resolved against the directory of
 * the config file that declared it. `undefined` when none is set, which means
 * Vale finds its own config, as it does when a person runs it.
 */
export function valeConfigPath(tools: ToolsConfig, configDir: string): string | undefined {
  const config = tools.vale?.config;
  if (config === undefined) return undefined;
  return isAbsolute(config) ? config : resolve(configDir, config);
}

/**
 * The absolute path of DITA-OT's installation directory, resolved against the
 * directory of the config file that declared it. `undefined` when none is set,
 * which means the `dita` on PATH, as when a person runs it.
 */
export function ditaOtHome(tools: ToolsConfig, configDir: string): string | undefined {
  const home = tools["dita-ot"]?.home;
  if (home === undefined) return undefined;
  return isAbsolute(home) ? home : resolve(configDir, home);
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
  return isAbsolute(config) ? config : resolve(configDir, config);
}
