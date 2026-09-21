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

/** The document's top-level `tools:`, one namespace per outside tool. */
export interface ToolsConfig {
  vale?: ValeToolConfig;
}

const TOOL_KEYS = ["vale"] as const;
const VALE_KEYS = ["config"] as const;

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
    tools.vale = parseVale(raw["vale"], source, toError);
  }
  return tools;
}

function parseVale(
  raw: unknown,
  source: string,
  toError: (message: string) => Error,
): ValeToolConfig {
  if (!isMapping(raw)) {
    throw toError(`${source}: tools.vale must be a mapping.`);
  }
  rejectUnknownKeys(raw, VALE_KEYS, "tools.vale", source, toError);

  const vale: ValeToolConfig = {};
  if (Object.hasOwn(raw, "config")) {
    const config = raw["config"];
    if (typeof config !== "string" || config.trim() === "") {
      throw toError(`${source}: tools.vale.config must be a non-empty string.`);
    }
    vale.config = config;
  }
  return vale;
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
