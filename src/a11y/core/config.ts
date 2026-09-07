/**
 * The `a11y:` key of the family config file (`manni.config.yaml`).
 *
 * Finding the file is the shared layer's job (src/shared/config-file.ts);
 * what the section may contain is decided here. The posture is meta's: an
 * unknown key or a wrong type is an error that names the file and the key,
 * because a misspelled `maxPages:` that was silently ignored would run the
 * crawl on defaults and read as a clean pass.
 */
import {
  findConfigFile,
  readConfigFile,
  type ConfigFileOptions,
} from "../../shared/config-file.js";
import { A11yError, SEVERITIES, isSeverity, type Severity } from "../types.js";
import { isHttpUrl } from "./url.js";

export interface A11yConfig {
  urls?: string[];
  crawl?: boolean;
  maxPages?: number;
  tags?: string[];
  severity?: Severity;
  timeout?: number;
}

export interface LoadedA11yConfig {
  config: A11yConfig;
  /** Where it came from, for messages. `null` when no file was found or `--no-config`. */
  source: string | null;
}

/** The tool's key in the family file. */
const SECTION = "a11y";

/**
 * The keys the section may carry. Adding a key to `A11yConfig` means adding
 * it here too, or a config using it is rejected; that coupling is the point.
 */
const CONFIG_KEYS = ["urls", "crawl", "maxPages", "tags", "severity", "timeout"] as const;

const CONFIG_FILE: ConfigFileOptions = {
  section: SECTION,
  // The a11y tool never had a pre-family file of its own.
  legacyNames: [],
  toError: (message) => new A11yError(message),
};

/**
 * Discover (or read `explicitPath`) through the shared family-file loader with
 * `{ section: "a11y", legacyNames: [], toError: (m) => new A11yError(m) }`.
 * Unknown keys, wrong types, empty `urls` entries and non-`http(s)` urls are
 * `A11yError`s naming the file and key. `null` config (empty section) is `{}`.
 */
export async function loadA11yConfig(
  cwd: string,
  explicitPath?: string,
): Promise<LoadedA11yConfig> {
  const file =
    explicitPath === undefined
      ? await findConfigFile(cwd, CONFIG_FILE)
      : await readConfigFile(explicitPath, cwd, CONFIG_FILE);
  if (file === null) return { config: {}, source: null };
  return { config: parseA11yConfig(file.value, file.source), source: file.source };
}

/** Pure parser, exported for tests. */
export function parseA11yConfig(value: unknown, source: string): A11yConfig {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new A11yError(`${source}: \`${SECTION}:\` must be a mapping.`);
  }
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!(CONFIG_KEYS as readonly string[]).includes(key)) {
      throw new A11yError(
        `${source}: \`${SECTION}:\` has unknown key "${key}". Supported keys: ${CONFIG_KEYS.join(", ")}.`,
      );
    }
  }

  const config: A11yConfig = {};
  if (obj.urls !== undefined) config.urls = asUrls(obj.urls, source);
  if (obj.crawl !== undefined) config.crawl = asBoolean(obj.crawl, "crawl", source);
  if (obj.maxPages !== undefined) {
    config.maxPages = asPositiveInteger(obj.maxPages, "maxPages", source);
  }
  if (obj.tags !== undefined) config.tags = asStringList(obj.tags, "tags", source);
  if (obj.severity !== undefined) config.severity = asSeverity(obj.severity, source);
  if (obj.timeout !== undefined) {
    config.timeout = asPositiveInteger(obj.timeout, "timeout", source);
  }
  return config;
}

function asStringList(value: unknown, field: string, source: string): string[] {
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
    throw new A11yError(`${source}: "${SECTION}.${field}" must be a list of strings.`);
  }
  return value;
}

function asUrls(value: unknown, source: string): string[] {
  const urls = asStringList(value, "urls", source);
  urls.forEach((url, i) => {
    if (!isHttpUrl(url)) {
      throw new A11yError(
        `${source}: "${SECTION}.urls[${i}]" must be an http(s) URL, got "${url}".`,
      );
    }
  });
  return urls;
}

function asBoolean(value: unknown, field: string, source: string): boolean {
  if (typeof value !== "boolean") {
    throw new A11yError(`${source}: "${SECTION}.${field}" must be a boolean.`);
  }
  return value;
}

function asPositiveInteger(value: unknown, field: string, source: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new A11yError(`${source}: "${SECTION}.${field}" must be an integer >= 1.`);
  }
  return value;
}

function asSeverity(value: unknown, source: string): Severity {
  if (typeof value !== "string" || !isSeverity(value)) {
    throw new A11yError(
      `${source}: "${SECTION}.severity" must be one of ${SEVERITIES.join(", ")}.`,
    );
  }
  return value;
}
