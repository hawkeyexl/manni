/**
 * Loads and validates the `kg:` section of `manni.config.yaml`. Discovery is
 * the family's (`src/shared/config-file.ts`); validation is JSON Schema
 * (2020-12) via Ajv; defaults are applied in code afterward so the resolved
 * shape is fully typed. Mirrors the docevals config pattern.
 */
import { dirname, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { Ajv2020 } from "ajv/dist/2020.js";
import configSchema from "./config-schema.json" with { type: "json" };
import {
  findConfigFileSync,
  readConfigFileSync,
  type ConfigFileOptions,
} from "../../shared/config-file.js";
import type { CollectionConfig } from "../../shared/collections.js";
import { parseCollections } from "../../shared/collections.js";
import { errorMessage } from "../../shared/errors.js";
import { KgError } from "../types.js";
import { resolveBaseIri } from "./iri.js";
import { COVERAGE_FIELD_NAMES } from "./coverage.js";
// Pure data module (no transformers import), so config stays Node-light.
import { DEFAULT_MODEL as DEFAULT_EMBED_MODEL } from "../embed/types.js";

/**
 * Every provider `fill` accepts, as data.
 *
 * A runtime list, not just a type: `fill.provider` is validated by Ajv against
 * the schema enum, but the `--provider` CLI override is a raw string, and
 * `providerSpecFor` casts whichever arrives to `ProviderName`. That cast is
 * only sound if both paths are checked against the same list — so the CLI
 * checks against this one, and `test/unit/schema-sync.test.ts` pins it to the
 * schema enum so the two cannot drift.
 *
 * `llama-cpp` is an in-process local model via node-llama-cpp: no key, no
 * network, no spend.
 */
export const PROVIDER_NAMES = [
  "anthropic",
  "openai",
  "claude-cli",
  "llama-cpp",
  "mock",
] as const;

export type ProviderName = (typeof PROVIDER_NAMES)[number];

export type DeriveSource =
  | "frontmatter"
  | "sections"
  | "links"
  | "tags"
  | "images"
  | "code"
  | "provenance";

export type FillField =
  // SKOS concept fields
  | "label"
  | "alt-labels"
  | "broader"
  | "narrower"
  | "related-concepts"
  | "concepts"
  // iiRDS typing + negative scope (ADR 01015)
  | "type"
  | "applies-to"
  | "about-product-lifecycle"
  | "about-product-aspect"
  | "not-applicable-to"
  | "not-about-product-aspect";

/** Every fillable field, in a stable order — the default `fill.fields`. */
export const ALL_FILL_FIELDS: FillField[] = [
  "label",
  "alt-labels",
  "broader",
  "narrower",
  "related-concepts",
  "concepts",
  "type",
  "applies-to",
  "about-product-lifecycle",
  "about-product-aspect",
  "not-applicable-to",
  "not-about-product-aspect",
];

export interface Pricing {
  inputPerMTok: number;
  outputPerMTok: number;
}

/** Maps published-site routes back to source files. */
export interface RouteMapping {
  /** Site prefix, normalized: leading `/`, no trailing `/`; `""` = site root. */
  basePath: string;
  /** Repo-relative directory routes resolve into (no trailing slash). */
  root: string;
  /** Extensions to try when the route names a page without one. */
  extensions: string[];
  /** Basenames to try for directory routes (`/docs/actions/`). */
  indexFiles: string[];
  /**
   * BCP-47 tag labelling every document under `root` (ADR 01037). A page's own
   * `lang`/`language` frontmatter wins; absent that, the nearest enclosing
   * route that declares one applies. Omitted, the route says nothing about
   * language.
   */
  language?: string;
}

export interface DockgConfig {
  /**
   * The family's document sets, from the file's top-level `collections:`
   * (proposal 0041). `[]` when the key is absent or no file governs the run.
   */
  collections: CollectionConfig[];
  /**
   * The config file as the user would name it, for messages; `null` when no
   * file governs the run and every value is a built-in default.
   */
  configSource: string | null;
  /** Normalized base IRI (trailing slash for http(s); `urn:dockg:` default). */
  baseIri: string;
  /** Output path of the built Turtle file, relative to configDir. */
  out: string;
  routes: RouteMapping[];
  build: { derive: DeriveSource[] };
  validate: { schemas: string[] };
  /** Graph-level SHACL validation (`manni kg check`). */
  check: {
    /** Shapes .ttl paths; empty = the shapes bundled with dockg. */
    shapes: string[];
  };
  provenance: {
    /**
     * Emit qualified attribution/association nodes with roles.
     *
     * The one provenance setting left. `git` was tri-state until proposal
     * 0051 §6: git history is *detected* now, used wherever git can run over a
     * repository and degraded to a warning where it cannot (kg ADR 01010's
     * `"auto"`, minus the switch). `qualified` stays because it switches what
     * is written, not what is discovered.
     */
    qualified: boolean;
  };
  fill: {
    provider: ProviderName;
    /** Model override; null = provider default. */
    model: string | null;
    /** Env var NAME holding the API key; null = provider default. */
    apiKeyEnv: string | null;
    baseUrl: string;
    /** Executable for the claude-cli provider. */
    command: string;
    temperature: number;
    maxCostUsd: number | null;
    cacheDir: string;
    fields: FillField[];
    /**
     * Minimum model self-confidence (0..1) to write a proposed field; below
     * this it is reported but not written (ADR 01015). Default 0.7.
     */
    minConfidence: number;
    /** Record kg.provenance on filled docs. */
    writeProvenance: boolean;
    /** Reject proposals that would violate the SHACL shapes contract. */
    validateGraph: boolean;
    /** Also propose per-section metadata (ADR 01032). Opt-in: more output. */
    sections: boolean;
    pricing?: Pricing;
  };
  stats: {
    /**
     * Per-field minimum coverage percentages (0–100) enforced under
     * `stats --check`. Resolved shape is always a map; a uniform number in the
     * config expands across every measured field. Default `{}` gates nothing.
     * See ADR 01011.
     */
    coverageThreshold: Record<string, number>;
  };
  embed: {
    /**
     * Embedding model id (ADR 01020). An open string, not an enum: the
     * documented table is the *tested* set, not the permitted set, so a newer
     * model works without a dockg release.
     */
    model: string;
    /** Weight quantization. `q8` keeps int32 accumulation, which is associative. */
    dtype: string;
    /**
     * Directory the sidecars are written into (ADR 01038). One file per
     * language, named by `vectorIndexFilename`, so this is a directory rather
     * than the single path it was before the fan-out.
     */
    out: string;
    /**
     * Per-language model overrides, keyed by BCP-47 tag (ADR 01038). A German
     * corpus embedded with an English-only model returns confident, meaningless
     * vectors and fails nothing, so this is the knob that makes the fan-out
     * worth having. Unset languages use `model`/`dtype`.
     */
    byLanguage: Record<string, { model?: string; dtype?: string }>;
    /** Per-text vector cache, keyed on text+model+dtype. */
    cacheDir: string;
  };
  export: {
    /** iiRDS package export metadata (ADR 01017); all fields optional. */
    iirds: {
      /** Package title; when absent the exporter uses a default. */
      title?: string;
      /** Creator organization name → a Creator iirds:Party + vcard:Organization. */
      creator?: string;
      /** iiRDS version literal written to the package. Default "1.3". */
      version: "1.2" | "1.3";
    };
  };
  /** Absolute path of the loaded config file. */
  configPath: string;
  /** Directory containing the config file; relative paths resolve against it. */
  configDir: string;
}

/** The family config file; this tool reads its `kg:` key. */
export const DEFAULT_CONFIG_FILENAME = "manni.config.yaml";
/** The tool's key in the family file. */
export const CONFIG_SECTION = "kg";
/** The family's top-level key for document sets (proposal 0041). */
const COLLECTIONS_KEY = "collections";

/**
 * Where the metadata tool's configuration reference documents `collections:`.
 * The literal docevals', cite's and meta's config modules carry, repeated
 * because those modules are theirs.
 */
const CONFIG_REF =
  "https://hawkeyexl.github.io/manni/meta/reference/configuration/";

/**
 * The keys proposal 0041 moved out of `kg:` and up to the family level.
 * Refused rather than aliased, as meta, cite and docevals refuse theirs: an
 * alias would be a second place to declare a document set that is meant to be
 * declared once. Checked before Ajv, which would call them unknown keys.
 */
const MOVED_KEYS = ["inputs", "exclude"] as const;

export const ALL_DERIVE_SOURCES: DeriveSource[] = [
  "frontmatter",
  "sections",
  "links",
  "tags",
  "images",
  "code",
  "provenance",
];

/** Default candidates for extensionless link targets (routes AND relative links). */
export const DEFAULT_LINK_EXTENSIONS = [".md", ".mdx"];
export const DEFAULT_INDEX_FILES = ["index", "README"];

/** `/docs/` -> `/docs`; `/` or `` -> `` (site root). */
function normalizeBasePath(basePath: string): string {
  let out = basePath.trim();
  if (!out.startsWith("/")) out = `/${out}`;
  out = out.replace(/\/+$/, "");
  return out;
}

const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
const validateConfig = ajv.compile(configSchema);

/**
 * One Ajv error, as a line a reader can act on.
 *
 * Ajv reports an unknown key against the *parent* object, so the bare message
 * ("must NOT have additional properties") leaves the reader to diff their file
 * against the schema to find which key it meant. Name it, as docevals does
 * (PR #10): the common case here is a key that was removed — `version:` and
 * `provenance.git:` after proposal 0051 — and a message that makes you guess
 * is one people work around.
 */
function configErrorLine(e: {
  instancePath: string;
  keyword: string;
  params: unknown;
  message?: string | undefined;
}): string {
  const extra =
    e.keyword === "additionalProperties"
      ? (e.params as { additionalProperty?: string }).additionalProperty
      : undefined;
  const where = e.instancePath || "/";
  return extra === undefined
    ? `  ${where}: ${e.message ?? "is invalid"}`
    : `  ${where}: unknown key "${extra}"`;
}

/**
 * Normalize `stats.coverageThreshold` to a per-field map. Ajv has already
 * validated the input as a number, an object of known fields, or absent; a
 * uniform number expands across every measured field so the resolved shape is
 * always a map (default `{}`).
 */
function resolveCoverageThreshold(
  raw: number | Record<string, number> | undefined,
): Record<string, number> {
  if (raw == null) return {};
  if (typeof raw === "number")
    return Object.fromEntries(COVERAGE_FIELD_NAMES.map((f) => [f, raw]));
  return { ...raw };
}

/** What the file the section came from carries beside it. */
export interface ConfigFileContext {
  /** The file as the user would name it, for messages. */
  source: string;
  /** The file's top-level `collections:`. */
  collections: CollectionConfig[];
}

/**
 * Parse and validate config YAML text. A document with a `kg:` key is a family
 * file, so its top-level `collections:` is read too; anything else is the
 * tool's section on its own.
 */
export function parseConfig(text: string, configPath: string): DockgConfig {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (e) {
    throw new KgError(
      `Invalid YAML in ${configPath}: ${errorMessage(e)}`,
    );
  }
  if (raw == null) return parseConfigSection(null, configPath);
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new KgError(`Invalid config in ${configPath}: root must be an object`);
  }
  const doc = raw as Record<string, unknown>;
  const wrapped = Object.hasOwn(doc, CONFIG_SECTION);
  const collections = Object.hasOwn(doc, COLLECTIONS_KEY)
    ? parseCollections(
        doc[COLLECTIONS_KEY],
        configPath,
        (message) => new KgError(message),
      )
    : [];
  return parseConfigSection(wrapped ? doc[CONFIG_SECTION] : doc, configPath, {
    source: configPath,
    collections,
  });
}

/**
 * Validate the tool's section. `raw` is what sat under `kg:` in a family
 * file, or the whole document of an explicit path with no wrapper key.
 * Messages name `configPath`; relative paths in the config resolve against its
 * directory. `file` carries the family keys; absent, the section is its own
 * source and declares no collections.
 *
 * `null` is an empty section, which is every default: a `kg:` key somebody
 * added while migrating and has not filled in yet is a config, not an error.
 */
export function parseConfigSection(
  raw: unknown,
  configPath: string,
  file: ConfigFileContext = { source: configPath, collections: [] },
): DockgConfig {
  if (raw == null) raw = {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new KgError(
      `Invalid config in ${configPath}: root must be an object`,
    );
  }
  for (const key of MOVED_KEYS) {
    if (Object.hasOwn(raw as Record<string, unknown>, key)) {
      throw new KgError(
        `${file.source}: "${key}" is no longer a kg key. Document sets are declared once for every tool, under a top-level collections: list. See ${CONFIG_REF}#${COLLECTIONS_KEY}`,
      );
    }
  }
  if (!validateConfig(raw)) {
    const details = (validateConfig.errors ?? [])
      .map((e) => configErrorLine(e))
      .join("\n");
    throw new KgError(`Invalid config in ${configPath}:\n${details}`);
  }

  // Past this point Ajv has validated `raw` against config-schema.json, so the
  // shape is known-good and reading fields off it is safe. `unknown` would buy
  // nothing here but a cast at every access.
  const r = raw as Record<string, any>;
  const abs = resolve(configPath);
  const dir = dirname(abs);

  return {
    collections: file.collections,
    configSource: file.source,
    baseIri: resolveBaseIri(r.baseIri),
    out: r.out ?? "kg/graph.ttl",
    routes: ((r.routes ?? []) as Array<Record<string, any>>).map((m) => ({
      basePath: normalizeBasePath(m.basePath ?? "/"),
      root: String(m.root)
        .replace(/\\/g, "/")
        .replace(/^\.\//, "")
        .replace(/\/+$/, ""),
      extensions: m.extensions ?? [...DEFAULT_LINK_EXTENSIONS],
      indexFiles: m.indexFiles ?? [...DEFAULT_INDEX_FILES],
      ...(m.language === undefined ? {} : { language: String(m.language) }),
    })),
    build: {
      derive: r.build?.derive ?? [...ALL_DERIVE_SOURCES],
    },
    validate: {
      // Empty means: use the newest schema bundled with dockg (see bundledSchemaPath).
      schemas: r.validate?.schemas ?? [],
    },
    check: {
      // Empty means: use the shapes bundled with dockg (see bundledShapesPath).
      shapes: r.check?.shapes ?? [],
    },
    provenance: {
      qualified: r.provenance?.qualified ?? true,
    },
    stats: {
      coverageThreshold: resolveCoverageThreshold(r.stats?.coverageThreshold),
    },
    fill: {
      provider: r.fill?.provider ?? "anthropic",
      model: r.fill?.model ?? null,
      apiKeyEnv: r.fill?.apiKeyEnv ?? null,
      baseUrl: r.fill?.baseUrl ?? "https://api.openai.com/v1",
      command: r.fill?.command ?? "claude",
      temperature: r.fill?.temperature ?? 0,
      maxCostUsd: r.fill?.maxCostUsd === undefined ? 5 : r.fill.maxCostUsd,
      cacheDir: r.fill?.cacheDir ?? ".manni/kg/cache",
      fields: r.fill?.fields ?? [...ALL_FILL_FIELDS],
      minConfidence: r.fill?.minConfidence ?? 0.7,
      writeProvenance: r.fill?.writeProvenance ?? true,
      validateGraph: r.fill?.validateGraph ?? true,
      sections: r.fill?.sections ?? false,
      pricing: r.fill?.pricing,
    },
    embed: {
      model: r.embed?.model ?? DEFAULT_EMBED_MODEL,
      dtype: r.embed?.dtype ?? "q8",
      out: r.embed?.out ?? "kg",
      cacheDir: r.embed?.cacheDir ?? ".manni/kg/embed-cache",
      byLanguage: r.embed?.byLanguage ?? {},
    },
    export: {
      iirds: {
        title: r.export?.iirds?.title,
        creator: r.export?.iirds?.creator,
        version: r.export?.iirds?.version ?? "1.3",
      },
    },
    configPath: abs,
    configDir: dir,
  };
}

const CONFIG_FILE: ConfigFileOptions = {
  section: CONFIG_SECTION,
  // kg published nothing under `dockg.config.yaml`, so, like cite, a11y and
  // docevals, it has no pre-family name to read (proposal 0051 §2).
  legacyNames: [],
  toError: (message) => new KgError(message),
};

/**
 * Load config from an explicit path, or discover the family file from the
 * working directory upward (`src/shared/config-file.ts`: `manni.config.yaml`
 * read at its `kg:` key). With no config file present, built-in defaults
 * apply.
 */
export function loadConfig(path?: string, cwd = process.cwd()): DockgConfig {
  const file = path
    ? readConfigFileSync(path, cwd, CONFIG_FILE)
    : findConfigFileSync(cwd, CONFIG_FILE);
  if (file === null) return defaultConfig(cwd);
  return parseConfigSection(file.value, file.path, {
    source: file.source,
    collections: file.collections,
  });
}

/**
 * Every built-in default, with no file behind it: what a run gets when
 * discovery finds nothing, or under `--no-config`. It declares no collections,
 * so such a run reads only the paths it was given.
 */
export function defaultConfig(cwd = process.cwd()): DockgConfig {
  return {
    ...parseConfigSection(null, resolve(cwd, DEFAULT_CONFIG_FILENAME)),
    configSource: null,
  };
}

export interface RunConfigOptions {
  /** `-c/--config`. */
  configPath?: string;
  /** `--no-config`: skip discovery and run on the built-in defaults. */
  noConfig?: boolean;
  /** Positional paths; checked here only for how they combine with `collection`. */
  paths?: string[];
  /** `--collection <name>`, repeatable. */
  collection?: string[];
}

/**
 * The config a command runs under. `--collection` names something only a
 * config can define and selects a set the operator did not type, so pairing it
 * with paths is refused before discovery, and the message is about the flags
 * rather than about whatever the walk found.
 */
export function loadRunConfig(
  opts: RunConfigOptions,
  cwd = process.cwd(),
): DockgConfig {
  assertCollectionWithoutPaths(opts.collection, opts.paths);
  return opts.noConfig ? defaultConfig(cwd) : loadConfig(opts.configPath, cwd);
}

/** The message meta, cite and docevals give, in kg's error class. */
export function assertCollectionWithoutPaths(
  collection: readonly string[] | undefined,
  paths: readonly string[] | undefined,
): void {
  if ((collection ?? []).length > 0 && (paths ?? []).length > 0) {
    throw new KgError(
      "--collection selects a configured collection; it cannot be combined with paths.",
    );
  }
}
