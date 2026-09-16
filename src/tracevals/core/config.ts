/**
 * Config loading. Every knob flows config → Ajv validate → defaults → CLI
 * override (`??` at the read site) → runtime; parseConfig() fills every
 * default so downstream code never re-applies one.
 *
 * Settings live under a `tracevals:` key in `manni.config.yaml`, one file
 * shared by the whole manni family. Sibling keys belong to other tools and are
 * ignored here, so parseConfig() validates the section — never the file root.
 * Finding the file is the shared loader's job (`src/shared/config-file.ts`).
 */
import { Ajv2020 } from "ajv/dist/2020.js";
import configSchemaJson from "./config-schema.json" with { type: "json" };
import {
  FAMILY_CONFIG_NAMES,
  findConfigFileSync,
  readConfigFileSync,
  type ConfigFileOptions,
} from "../../shared/config-file.js";
import {
  assertKnownProvider,
  type ProvidersConfig,
} from "../../shared/providers.js";
import { compileRedactPatterns } from "../judge/redact.js";
import { DEFAULT_CAPTURE_DIR } from "../capture/types.js";
import { DEFAULT_LABELS_FILE } from "../calibrate/labels.js";
import { TracevalsError } from "../types.js";

const configSchema = configSchemaJson as Record<string, unknown>;

export const DEFAULT_CONFIG_FILENAME =
  FAMILY_CONFIG_NAMES[0] ?? "manni.config.yaml";

/**
 * Top-level key holding this tool's settings inside the shared family config.
 * Sibling tools (meta, docevals) own their own keys in the same file.
 */
export const CONFIG_SECTION_KEY = "tracevals";

/**
 * The section key as an error's instance path spells it. The schema describes
 * the section rather than the file, so Ajv's own paths start below it; a
 * message that said `/provider` would name a key nobody writes at the root.
 */
const CONFIG_SECTION_KEY_PATH = `/${CONFIG_SECTION_KEY}`;

/**
 * No legacy filename. The family file is the only one read, so a file named
 * for the tool is not config however it is spelled, and nothing warns about
 * one because nothing looks for it.
 */
const CONFIG_FILE: ConfigFileOptions = {
  section: CONFIG_SECTION_KEY,
  legacyNames: [],
  toError: (message) => new TracevalsError(message),
};

export interface TracevalsConfig {
  /**
   * Which provider judges, as `tracevals.provider` names it. `null` when the
   * key is absent, which defers to the family's `providers.provider`. The
   * connection settings are never here: they are `providers` below.
   */
  provider: string | null;
  /** The model within `provider`; `null` when unset. manni pins none. */
  model: string | null;
  /** The family's top-level `providers:` map, parsed by the shared loader. */
  providers: ProvidersConfig;
  /** The file as the user would name it, for messages. */
  configSource: string;
  judge: {
    ensembleRuns: number;
    temperature: number;
    zones: { autoPass: number; autoFail: number };
    cacheDir: string;
    /**
     * Ensemble runs this invocation may spend, or `null` for unbounded. A
     * cached ensemble spends none, and an eval the budget cannot cover is
     * `skipped` with the `turn budget` reason rather than dropped.
     */
    maxTurns: number | null;
    /**
     * Extra patterns scrubbed from the session digest before it reaches a
     * provider, applied *on top of* the built-in secret shapes (ADR 01020).
     * Always a list; validated for compilability at load time.
     */
    redact: string[];
  };
  render: {
    maxBlockChars: number;
    maxTotalChars: number;
  };
  /**
   * Per-grader settings, for the graders that have a knob outside the eval
   * entry that names them.
   */
  graders: {
    /**
     * `command` runs by default — ADR 01011's reasoning is unchanged. This is
     * the opt-out that decision never provided, for the person evaluating a
     * trace whose project they do not trust (ADR 01019).
     */
    command: { enabled: boolean };
  };
  history: {
    file: string;
  };
  /**
   * Session manifests (ADR 01024). `capture` writes one here; `run` looks here
   * for the trace's own, and reports a `skipped` hash check when there is none.
   */
  capture: {
    /** Resolved against the project root, not the working directory. */
    dir: string;
  };
  fill: {
    /** Minimum self-reported confidence a proposal needs to be written. */
    confidenceThreshold: number;
    maxEvalsPerArtifact: number;
    temperature: number;
    cacheDir: string;
    /** Inference calls this invocation may spend, or `null` for unbounded. */
    maxTurns: number | null;
  };
  /**
   * `calibrate` — measuring the judge against a human's answers (ADR 01022).
   * The sweep grid lives here rather than behind flags because the useful
   * range is a property of a corpus, and a corpus outlives an invocation.
   */
  calibrate: {
    /** Labels sidecar, resolved against the config file's directory. */
    labels: string;
    /** Thresholds. Unset means the run measures without gating. */
    maxFalsePass?: number;
    maxFalseFail?: number;
    maxReview?: number;
    sweep: {
      ensembleRuns: number[];
      autoPass: number[];
      autoFail: number[];
    };
  };
  failOnNeedsReview: boolean;
  /**
   * Module specifiers imported before evals are planned, so a `registerGrader`
   * call from outside this package lands in time (ADR 01017). Resolved against
   * the config file's directory, in order — a later entry wins a colliding
   * kind. `--require` appends to this list rather than replacing it.
   */
  plugins: string[];
  /** List offered-but-unused artifacts in coverage, not just count them. */
  reportUnusedArtifacts: boolean;
}

// `verbose` puts the parent schema on each error, so an unknown key can be
// checked against the keys its section does have.
const ajv = new Ajv2020({ allErrors: true, verbose: true });
const validate = ajv.compile(configSchema);

/**
 * `; did you mean "ensembleRuns"?` when `key` is the kebab spelling of a key
 * its section has. Only the exact counterpart: a guess at a near miss is
 * advice that can be wrong, and the kebab spelling is the one mistake a
 * reader of the frontmatter vocabulary is likely to make here.
 */
function camelCaseHint(key: string, parentSchema: unknown): string {
  const camel = key.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
  if (camel === key || parentSchema === null || typeof parentSchema !== "object") {
    return "";
  }
  const properties = (parentSchema as { properties?: unknown }).properties;
  return properties !== null &&
    typeof properties === "object" &&
    Object.hasOwn(properties, camel)
    ? `; did you mean "${camel}"?`
    : "";
}

/**
 * The hint on an old `provider:` object. The key used to hold a `default` and
 * a section per provider; it is now the provider's name, as `docevals.provider`
 * and `fill.provider` are, and the connection settings moved to the family's
 * top-level `providers:` map, which every tool reads. Ajv's own message says
 * it must be a string, which is true and leaves the reader to find out where
 * the settings went.
 */
function movedProviderHint(instancePath: string, keyword: string): string {
  return instancePath === "/provider" && keyword === "type"
    ? `; "provider" is now a provider name; per-provider settings moved to the top-level providers: map`
    : "";
}

/**
 * The section as the schema admits it: every key optional, because
 * `parseConfig` supplies the defaults. Ajv has checked the document against
 * `config-schema.json` before it is read as this, so the one cast below is
 * where the validated document becomes a typed one.
 */
interface RawConfig {
  provider?: string;
  model?: string;
  judge?: {
    ensembleRuns?: number;
    temperature?: number;
    zones?: { autoPass?: number; autoFail?: number };
    cacheDir?: string;
    maxTurns?: number;
    redact?: string[];
  };
  render?: { maxBlockChars?: number; maxTotalChars?: number };
  graders?: { command?: { enabled?: boolean } };
  history?: { file?: string };
  capture?: { dir?: string };
  fill?: {
    confidenceThreshold?: number;
    maxEvalsPerArtifact?: number;
    temperature?: number;
    cacheDir?: string;
    maxTurns?: number;
  };
  calibrate?: {
    labels?: string;
    maxFalsePass?: number;
    maxFalseFail?: number;
    maxReview?: number;
    sweep?: { ensembleRuns?: number[]; autoPass?: number[]; autoFail?: number[] };
  };
  failOnNeedsReview?: boolean;
  plugins?: string[];
  reportUnusedArtifacts?: boolean;
}

/** What the file the section came from carries beside it. */
export interface ConfigFileContext {
  /** The file as the user would name it, for messages. */
  source?: string;
  /** The file's top-level `providers:`; `{}` when it declares none. */
  providers?: ProvidersConfig;
}

export function parseConfig(
  raw: unknown,
  file: ConfigFileContext = {},
): TracevalsConfig {
  const source = file.source ?? DEFAULT_CONFIG_FILENAME;
  if (!validate(raw)) {
    const detail = (validate.errors ?? [])
      .map((e) => {
        // Ajv reports an unknown key against the *parent* object, so the bare
        // message ("must NOT have additional properties") leaves the reader to
        // diff their file against the schema to find which key it meant. Name
        // it: the common case is a removed key in an unmigrated config —
        // `judge.maxCostUsd` after the turn budget landed, say — and a
        // migration error that makes you guess is one people work around.
        const extra =
          e.keyword === "additionalProperties"
            ? (e.params as { additionalProperty?: string }).additionalProperty
            : undefined;
        return extra !== undefined
          ? `unknown key "${extra}"${camelCaseHint(extra, e.parentSchema)}`
          : `${CONFIG_SECTION_KEY_PATH}${e.instancePath} ${e.message ?? "is invalid"}` +
              movedProviderHint(e.instancePath, e.keyword);
      })
      .join("; ");
    throw new TracevalsError(`${source}: ${detail}`);
  }
  const r = raw as RawConfig;
  // Checked here, with the message every other tool in the family gives, so a
  // typo is caught by every verb and not only the ones that reach a model.
  // Whether a model has a provider to own it waits for the flags: a
  // `--provider`, or the family's `providers.provider`, can supply the
  // provider a configured model needs.
  const provider = r.provider ?? null;
  if (provider !== null) {
    assertKnownProvider(provider, (message) => new TracevalsError(message));
  }
  const config: TracevalsConfig = {
    provider,
    model: r.model ?? null,
    providers: file.providers ?? {},
    configSource: source,
    judge: {
      ensembleRuns: r.judge?.ensembleRuns ?? 3,
      temperature: r.judge?.temperature ?? 0,
      zones: {
        autoPass: r.judge?.zones?.autoPass ?? 0.8,
        autoFail: r.judge?.zones?.autoFail ?? 0.8,
      },
      cacheDir: r.judge?.cacheDir ?? ".manni/tracevals/cache",
      // `null`, not a number: unbounded is a state, and any number here would
      // be a ceiling nobody asked for.
      maxTurns: r.judge?.maxTurns ?? null,
      // Always a list: the render site concatenates nothing onto it, but a
      // hole here would be a special case in every consumer.
      redact: [...(r.judge?.redact ?? [])],
    },
    render: {
      maxBlockChars: r.render?.maxBlockChars ?? 2000,
      maxTotalChars: r.render?.maxTotalChars ?? 150000,
    },
    graders: {
      command: { enabled: r.graders?.command?.enabled ?? true },
    },
    history: {
      file: r.history?.file ?? ".manni/tracevals/history.jsonl",
    },
    capture: {
      // Beside the judge cache, under the state directory that already travels
      // with the project — which is what puts a manifest next to its trace in
      // the CI patterns the docs describe.
      dir: r.capture?.dir ?? DEFAULT_CAPTURE_DIR,
    },
    fill: {
      // 0.7 matches the manuscript's calibration bar for judged agreement.
      confidenceThreshold: r.fill?.confidenceThreshold ?? 0.7,
      maxEvalsPerArtifact: r.fill?.maxEvalsPerArtifact ?? 8,
      temperature: r.fill?.temperature ?? 0,
      // Separate from the judge cache: different key scheme and value shape.
      cacheDir: r.fill?.cacheDir ?? ".manni/tracevals/cache/fill",
      maxTurns: r.fill?.maxTurns ?? null,
    },
    calibrate: {
      labels: r.calibrate?.labels ?? DEFAULT_LABELS_FILE,
      sweep: {
        // Spans the range rather than filling it: the first sweep judges the
        // corpus at the largest value here, so a wide grid is the one part of
        // calibration that does cost money.
        ensembleRuns: [...(r.calibrate?.sweep?.ensembleRuns ?? [1, 3, 5])],
        autoPass: [
          ...(r.calibrate?.sweep?.autoPass ?? [0.5, 0.6, 0.7, 0.8, 0.9, 0.95]),
        ],
        autoFail: [
          ...(r.calibrate?.sweep?.autoFail ?? [0.5, 0.6, 0.7, 0.8, 0.9, 0.95]),
        ],
      },
    },
    failOnNeedsReview: r.failOnNeedsReview ?? true,
    // Always a list, never undefined: the read site concatenates `--require`
    // onto it, and a hole there would be a special case in every caller.
    plugins: [...(r.plugins ?? [])],
    // An observation, not a gate: listing it is opt-in because a real roster
    // runs to hundreds of skills (ADR 01016).
    reportUnusedArtifacts: r.reportUnusedArtifacts ?? false,
  };
  // Compilability is not expressible in JSON Schema, and a pattern that cannot
  // compile must fail here rather than at the moment a digest is about to be
  // sent — a dropped redaction pattern is a silent leak.
  compileRedactPatterns(config.judge.redact);
  // Left absent rather than defaulted to a number: `0` is a meaningful limit
  // ("no false pass at all"), so it cannot double as "unset".
  for (const key of ["maxFalsePass", "maxFalseFail", "maxReview"] as const) {
    if (typeof r.calibrate?.[key] === "number") {
      config.calibrate[key] = r.calibrate[key];
    }
  }
  return config;
}

/** This tool's config, and the directory its relative paths resolve from. */
export interface LoadedConfig {
  config: TracevalsConfig;
  /**
   * The directory holding the config file, or `dir` when none was found.
   * Plugin specifiers and the labels default resolve against it, so a
   * committed config means the same thing from any working directory.
   */
  dir: string;
}

/** How a command was told to find its config: `-c` and `--no-config`. */
export interface ConfigLookup {
  /** `-c/--config`: read this file instead of discovering one. */
  configPath?: string;
  /** `--no-config`: skip discovery and run on the built-in defaults. */
  noConfig?: boolean;
}

/**
 * Discover the family config from `dir` (cwd by default) upward to the
 * repository root and return this tool's section (`src/shared/config-file.ts`:
 * `manni.config.yaml` read at its `tracevals:` key, with the family's
 * top-level `providers:` beside it). An absent file — or one that carries only
 * other tools' sections — yields defaults.
 *
 * `-c` names a file and skips the walk; `--no-config` skips the file
 * altogether and runs on the built-in defaults, with `dir` still anchoring
 * whatever the config would otherwise have anchored.
 */
export async function discoverConfig(
  dir = process.cwd(),
  lookup: ConfigLookup = {},
): Promise<LoadedConfig> {
  if (lookup.noConfig === true) return { config: parseConfig({}), dir };
  const file = await Promise.resolve().then(() =>
    lookup.configPath === undefined
      ? findConfigFileSync(dir, CONFIG_FILE)
      : readConfigFileSync(lookup.configPath, dir, CONFIG_FILE),
  );
  if (file === null) return { config: parseConfig({}), dir };
  return {
    config: parseConfig(file.value ?? {}, {
      source: file.source,
      ...(file.providers !== undefined ? { providers: file.providers } : {}),
    }),
    dir: file.dir,
  };
}

/** `discoverConfig`, for callers that only want the settings. */
export async function loadConfig(
  dir = process.cwd(),
  lookup: ConfigLookup = {},
): Promise<TracevalsConfig> {
  return (await discoverConfig(dir, lookup)).config;
}
