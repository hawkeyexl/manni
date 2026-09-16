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
import { DockgError } from "../types.js";
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

/**
 * How hard `provenance.git` insists: derive-where-possible (`"auto"`),
 * required (`true`), or off (`false`). See ADR 01010.
 */
export type GitMode = boolean | "auto";

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
  version: 1;
  /** Normalized base IRI (trailing slash for http(s); `urn:dockg:` default). */
  baseIri: string;
  inputs: string[];
  exclude: string[];
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
     * Gate for ALL git-derived provenance: per-file dates/authors, rename →
     * prov:wasRevisionOf edges, and the build activity's prov:endedAtTime
     * (HEAD committer date). Deterministic per commit; never the wall clock.
     *
     * `"auto"` (default) derives it wherever git can run and degrades with a
     * warning where it cannot; `true` requires it, so an unavailable git is an
     * operational error; `false` skips the subprocess entirely.
     */
    git: GitMode;
    /** Emit qualified attribution/association nodes with roles. */
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
/**
 * The tool's own config file from before the family file, whose whole
 * document is the `kg:` section. Still read, with a warning.
 */
export const LEGACY_CONFIG_FILENAME = "dockg.config.yaml";

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

/**
 * Parse and validate config YAML text as the tool's whole section. `configPath`
 * is used for messages and path resolution.
 */
export function parseConfig(text: string, configPath: string): DockgConfig {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (e) {
    throw new DockgError(
      `Invalid YAML in ${configPath}: ${e instanceof Error ? e.message : "parse error"}`,
    );
  }
  return parseConfigSection(raw, configPath);
}

/**
 * Validate the tool's section. `raw` is what sat under `kg:` in a family
 * file, or the whole document of a legacy file or an explicit path with no
 * wrapper key. Messages name `configPath`; relative paths in the config
 * resolve against its directory.
 */
export function parseConfigSection(
  raw: unknown,
  configPath: string,
): DockgConfig {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new DockgError(
      `Invalid config in ${configPath}: root must be an object`,
    );
  }
  if (!validateConfig(raw)) {
    const details = (validateConfig.errors ?? [])
      .map((e) => `  ${e.instancePath || "/"}: ${e.message ?? ""}`)
      .join("\n");
    throw new DockgError(`Invalid config in ${configPath}:\n${details}`);
  }

  // Past this point Ajv has validated `raw` against config-schema.json, so the
  // shape is known-good and reading fields off it is safe. `unknown` would buy
  // nothing here but a cast at every access.
  const r = raw as Record<string, any>;
  const abs = resolve(configPath);
  const dir = dirname(abs);

  return {
    version: 1,
    baseIri: resolveBaseIri(r.baseIri),
    inputs: r.inputs ?? ["**/*.md"],
    exclude: r.exclude ?? ["**/node_modules/**"],
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
      git: r.provenance?.git ?? "auto",
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
  legacyNames: [LEGACY_CONFIG_FILENAME],
  toError: (message) => new DockgError(message),
};

/**
 * Load config from an explicit path, or discover the family file from the
 * working directory upward (`src/shared/config-file.ts`: `manni.config.yaml`
 * read at its `kg:` key, the pre-rename `moose.config.yaml` and the tool's
 * own `dockg.config.yaml` with a warning). With no config file present,
 * built-in defaults apply.
 *
 * An empty section (`kg:` with nothing under it) is the defaults too, the
 * same as no file: a key someone added while migrating and has not filled in
 * yet is not a config with a missing `version`.
 */
export function loadConfig(path?: string, cwd = process.cwd()): DockgConfig {
  const file = path
    ? readConfigFileSync(path, cwd, CONFIG_FILE)
    : findConfigFileSync(cwd, CONFIG_FILE);
  if (file === null) {
    return parseConfig("version: 1\n", resolve(cwd, DEFAULT_CONFIG_FILENAME));
  }
  const value =
    file.wrapped && file.value === null ? { version: 1 } : file.value;
  return parseConfigSection(value, file.path);
}
