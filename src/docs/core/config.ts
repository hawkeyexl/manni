/**
 * The `docs:` key of the family config file (`manni.config.yaml`). Finding
 * the file is the shared layer's job; what the section may hold is decided
 * here, with a11y's posture: an unknown key or a wrong type names the file and
 * the key, because a misspelled `comands:` silently ignored would run the
 * detected command instead of the one the user wrote.
 */
import { resolve } from "node:path";
import type { CollectionConfig } from "../../shared/collections.js";
import {
  findConfigFileSync,
  readConfigFileSync,
  type ConfigFileOptions,
} from "../../shared/config-file.js";
import { DocsError } from "../errors.js";
import type { Verb } from "../types.js";

export interface DocsConfig {
  /** Absolute; `docs.dir` resolved against the config file's directory. */
  dir?: string;
  commands: Partial<Record<Verb, string>>;
  /** The family file's `collections:`, for the local `url:` port and path. */
  collections: CollectionConfig[];
  /** Directory of the config file; `null` when none was found. */
  configDir: string | null;
}

const SECTION = "docs";
const CONFIG_KEYS = ["dir", "commands"] as const;
const COMMAND_KEYS = ["start", "build", "preview"] as const;

const CONFIG_FILE: ConfigFileOptions = {
  section: SECTION,
  legacyNames: [],
  toError: (message) => new DocsError(message),
};

/** Discover the config from `cwd`, or read `configPath` when given. */
export function loadDocsConfig(cwd: string, configPath?: string): DocsConfig {
  const file =
    configPath === undefined
      ? findConfigFileSync(cwd, CONFIG_FILE)
      : readConfigFileSync(configPath, cwd, CONFIG_FILE);
  if (file === null) return { commands: {}, collections: [], configDir: null };
  return {
    ...parseDocsConfig(file.value, file.source, file.dir),
    collections: file.collections,
    configDir: file.dir,
  };
}

/** Pure parser, exported for tests. */
export function parseDocsConfig(
  value: unknown,
  source: string,
  configDir: string,
): Pick<DocsConfig, "dir" | "commands"> {
  const obj = asMapping(value, SECTION, CONFIG_KEYS, source);
  const config: Pick<DocsConfig, "dir" | "commands"> = { commands: {} };
  if (obj.dir !== undefined) {
    config.dir = resolve(configDir, asString(obj.dir, "dir", source));
  }
  const commands = asMapping(obj.commands, `${SECTION}.commands`, COMMAND_KEYS, source);
  for (const verb of COMMAND_KEYS) {
    const command = commands[verb];
    if (command !== undefined) {
      config.commands[verb] = asString(command, `commands.${verb}`, source);
    }
  }
  return config;
}

function asMapping(
  value: unknown,
  name: string,
  keys: readonly string[],
  source: string,
): Record<string, unknown> {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new DocsError(`${source}: \`${name}:\` must be a mapping.`);
  }
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!keys.includes(key)) {
      throw new DocsError(
        `${source}: \`${name}:\` has unknown key "${key}". Supported keys: ${keys.join(", ")}.`,
      );
    }
  }
  return obj;
}

function asString(value: unknown, key: string, source: string): string {
  if (typeof value !== "string") {
    throw new DocsError(`${source}: ${SECTION}.${key} must be a string.`);
  }
  return value;
}
