/**
 * The `vector:` section of `manni.config.yaml` (proposal 0128). Discovery is
 * the family's (`src/shared/config-file.ts`), validation is JSON Schema via
 * Ajv, and defaults are applied here so the resolved shape is total.
 *
 * The section's presence is a setting of its own: `vector: {}` and a bare
 * `vector:` both put the domain in play, and make `graph publish` build
 * vectors, with every default.
 */
import { parse as parseYaml } from "yaml";
import { Ajv2020 } from "ajv/dist/2020.js";
import configSchema from "./config-schema.json" with { type: "json" };
import {
  findConfigFileSync,
  readConfigFileSync,
  type ConfigFileOptions,
} from "../../shared/config-file.js";
// Pure data module (no transformers import), so config stays Node-light.
import { DEFAULT_MODEL } from "../../graph/embed/types.js";
import { VectorError } from "../types.js";

/** The domain's key in the family file. */
export const CONFIG_SECTION = "vector";

export interface VectorConfig {
  /** Embedding model id. An open string: the tested models are not the permitted ones. */
  model: string;
  /** Weight quantization. `q8` keeps int32 accumulation, which is associative. */
  dtype: string;
  /** The per-text vector cache, relative to the working directory. */
  cacheDir: string;
  /**
   * Per-language overrides, keyed by BCP-47 tag and matched canonically. A
   * German corpus embedded with an English-only model returns confident,
   * meaningless vectors and fails nothing, so this is the knob that matters.
   */
  byLanguage: Record<string, { model?: string; dtype?: string }>;
  /** The file has a top-level `vector:` section, empty or not. */
  declared: boolean;
}

interface RawVectorConfig {
  model?: string;
  dtype?: string;
  cacheDir?: string;
  byLanguage?: Record<string, { model?: string; dtype?: string }>;
}

const validate = new Ajv2020({ allErrors: true }).compile(configSchema);

const CONFIG_FILE: ConfigFileOptions = {
  section: CONFIG_SECTION,
  legacyNames: [],
  toError: (message) => new VectorError(message),
};

/**
 * Validate the section and apply its defaults. `null` is an empty section,
 * which is every default. `source` names the file in messages.
 */
export function parseVectorSection(raw: unknown, source: string, declared: boolean): VectorConfig {
  const value = raw ?? {};
  if (!validate(value)) {
    const details = (validate.errors ?? []).map((e) => {
      const where = `/${CONFIG_SECTION}${e.instancePath}`;
      const extra =
        e.keyword === "additionalProperties"
          ? (e.params as { additionalProperty?: string }).additionalProperty
          : undefined;
      return extra === undefined ? `  ${where}: ${e.message ?? "is invalid"}` : `  ${where}: unknown key "${extra}"`;
    });
    throw new VectorError(`Invalid config in ${source}:\n${details.join("\n")}`);
  }
  const r = value as RawVectorConfig;
  return {
    model: r.model ?? DEFAULT_MODEL,
    dtype: r.dtype ?? "q8",
    cacheDir: r.cacheDir ?? ".manni/vector/cache",
    byLanguage: r.byLanguage ?? {},
    declared,
  };
}

/**
 * The section of the config a run uses: `-c`, else the family file found from
 * `cwd`, else none. A file holding no `vector:` key, or another tool's
 * section on its own, leaves every default and `declared: false`.
 */
export function loadVectorConfig(
  opts: { configPath?: string; noConfig?: boolean },
  cwd = process.cwd(),
): VectorConfig {
  const file = opts.noConfig
    ? null
    : opts.configPath === undefined
      ? findConfigFileSync(cwd, CONFIG_FILE)
      : readConfigFileSync(opts.configPath, cwd, CONFIG_FILE);
  if (file === null || !file.wrapped) return parseVectorSection(null, "", false);
  // `vector:` with nothing under it reads as `null`, as an absent key does,
  // so presence comes from the document. The loader already parsed it once.
  const doc = parseYaml(file.text) as unknown;
  const declared = doc !== null && typeof doc === "object" && Object.hasOwn(doc, CONFIG_SECTION);
  return parseVectorSection(file.value, file.source, declared);
}
