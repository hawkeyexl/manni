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
  type ConfigFileOptions,
} from "../../shared/config-file.js";
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
 * The tool's own file from before the family config. Still read, whole, with
 * a warning from the shared discovery.
 */
const LEGACY_CONFIG_FILENAME = "moose-tracevals.config.yaml";

const CONFIG_FILE: ConfigFileOptions = {
  section: CONFIG_SECTION_KEY,
  legacyNames: [LEGACY_CONFIG_FILENAME],
  toError: (message) => new TracevalsError(message),
};

/** USD per million tokens; overrides the inference library's built-in table. */
export interface Pricing {
  inputPerMTok: number;
  outputPerMTok: number;
}

/**
 * Per-provider settings. Configure as many as you like and select one with
 * `provider.default` or `--provider`; only the selected section is mapped onto
 * the inference library's `ProviderSpec` (see judge/provider.ts).
 */
export interface ProviderConfig {
  default: "anthropic" | "openai" | "claude-cli" | "mock";
  anthropic: { model: string; apiKeyEnv: string; pricing?: Pricing };
  openai: {
    baseUrl: string;
    model: string;
    apiKeyEnv: string;
    pricing?: Pricing;
  };
  "claude-cli": { model: string; command: string };
}

export interface TracevalsConfig {
  provider: ProviderConfig;
  judge: {
    ensembleRuns: number;
    temperature: number;
    zones: { autoPass: number; autoFail: number };
    cacheDir: string;
    maxCostUsd?: number;
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
    maxCostUsd?: number;
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

const ajv = new Ajv2020({ allErrors: true });
const validate = ajv.compile(configSchema);

/**
 * The section as the schema admits it: every key optional, because
 * `parseConfig` supplies the defaults. Ajv has checked the document against
 * `config-schema.json` before it is read as this, so the one cast below is
 * where the validated document becomes a typed one.
 */
interface RawConfig {
  provider?: {
    default?: ProviderConfig["default"];
    anthropic?: { model?: string; apiKeyEnv?: string; pricing?: Pricing };
    openai?: {
      baseUrl?: string;
      model?: string;
      apiKeyEnv?: string;
      pricing?: Pricing;
    };
    "claude-cli"?: { model?: string; command?: string };
  };
  judge?: {
    ensembleRuns?: number;
    temperature?: number;
    zones?: { autoPass?: number; autoFail?: number };
    cacheDir?: string;
    maxCostUsd?: number;
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
    maxCostUsd?: number;
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

export function parseConfig(raw: unknown): TracevalsConfig {
  if (!validate(raw)) {
    const detail = (validate.errors ?? [])
      .map((e) => `${e.instancePath || "/"} ${e.message ?? "invalid"}`)
      .join("; ");
    throw new TracevalsError(`invalid config: ${detail}`);
  }
  const r = raw as RawConfig;
  const config: TracevalsConfig = {
    provider: {
      // claude-cli by default: it uses the local Claude CLI's own auth, so a
      // fresh checkout judges without anyone provisioning an API key.
      default: r.provider?.default ?? "claude-cli",
      anthropic: {
        model: r.provider?.anthropic?.model ?? "claude-sonnet-4-5",
        apiKeyEnv: r.provider?.anthropic?.apiKeyEnv ?? "ANTHROPIC_API_KEY",
        ...(r.provider?.anthropic?.pricing
          ? { pricing: r.provider.anthropic.pricing }
          : {}),
      },
      openai: {
        baseUrl: r.provider?.openai?.baseUrl ?? "https://api.openai.com/v1",
        model: r.provider?.openai?.model ?? "gpt-4o-mini",
        apiKeyEnv: r.provider?.openai?.apiKeyEnv ?? "OPENAI_API_KEY",
        ...(r.provider?.openai?.pricing
          ? { pricing: r.provider.openai.pricing }
          : {}),
      },
      "claude-cli": {
        model: r.provider?.["claude-cli"]?.model ?? "claude-sonnet-4-5",
        command: r.provider?.["claude-cli"]?.command ?? "claude",
      },
    },
    judge: {
      ensembleRuns: r.judge?.ensembleRuns ?? 3,
      temperature: r.judge?.temperature ?? 0,
      zones: {
        autoPass: r.judge?.zones?.autoPass ?? 0.8,
        autoFail: r.judge?.zones?.autoFail ?? 0.8,
      },
      cacheDir: r.judge?.cacheDir ?? ".manni/tracevals/cache",
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
  if (typeof r.judge?.maxCostUsd === "number") {
    config.judge.maxCostUsd = r.judge.maxCostUsd;
  }
  if (typeof r.fill?.maxCostUsd === "number") {
    config.fill.maxCostUsd = r.fill.maxCostUsd;
  }
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

/**
 * Discover the family config from `dir` (cwd by default) upward to the
 * repository root and return this tool's section (`src/shared/config-file.ts`:
 * `manni.config.yaml` read at its `tracevals:` key, the pre-rename
 * `manni.config.yaml` with a warning, then `moose-tracevals.config.yaml`
 * whole). An absent file — or one that carries only other tools' sections —
 * yields defaults.
 */
export async function discoverConfig(dir = process.cwd()): Promise<LoadedConfig> {
  const file = await Promise.resolve().then(() =>
    findConfigFileSync(dir, CONFIG_FILE),
  );
  if (file === null) return { config: parseConfig({}), dir };
  return { config: parseConfig(file.value ?? {}), dir: file.dir };
}

/** `discoverConfig`, for callers that only want the settings. */
export async function loadConfig(dir = process.cwd()): Promise<TracevalsConfig> {
  return (await discoverConfig(dir)).config;
}
