/**
 * Choosing an inference provider and model, for every tool that sends content
 * to one: `manni meta fill` and `manni docevals`.
 *
 * The names a tool accepts, the refusals, what `--local` overrides and the
 * detection call are one implementation, so a provider added upstream reaches both tools on the same
 * day and a message reads the same in both. What differs is only what the
 * caller passes in: the config key its user writes, and its own error class,
 * which is what maps the refusal to exit 2.
 */
import { resolve } from "node:path";
import {
  DEFAULT_MODELS,
  DEFAULT_OPENAI_BASE_URL,
  InferenceError,
  resolveProviderIdentityAsync,
  type ProviderName,
  type ProviderSelector,
  type ProviderSpec,
} from "@hawkeyexl/inference";
import { errorMessage } from "./errors.js";

/** Builds the caller's own error from a message. */
export type ToErrorFn = (message: string) => Error;

/**
 * `auto` detects the highest-priority provider this machine can actually use —
 * an Anthropic key, then an OpenAI key, then the Claude CLI, then a local model
 * that needs no credentials at all. Defaulting to a named provider instead meant
 * a tool failed outright for anyone who did not happen to hold that vendor's
 * key.
 */
export const DEFAULT_PROVIDER = "auto";

/**
 * Provider names the inference layer accepts, taken from the library rather
 * than copied. A hardcoded list silently went stale when `llama-cpp` was added
 * upstream; deriving it means a new provider works the day it ships.
 */
export const PROVIDERS: ReadonlySet<string> = new Set<string>([
  ...Object.keys(DEFAULT_MODELS),
  DEFAULT_PROVIDER,
]);

/** Refuse a name the library does not offer. */
export function assertKnownProvider(
  name: string,
  toError: ToErrorFn,
): asserts name is ProviderSelector {
  if (PROVIDERS.has(name)) return;
  throw toError(
    `Unknown provider "${name}". Available: ${[...PROVIDERS].join(", ")}.`,
  );
}

/**
 * A model name belongs to exactly one provider, so it cannot be handed to
 * whichever provider detection picks: `--model gpt-4o-mini` on a machine with an
 * Anthropic key selected anthropic and then 404'd mid-run, after file discovery
 * had already been paid for.
 *
 * The library enforces this too. It is repeated here to name the flag and the
 * config key rather than the API fields, since that is what the user typed.
 *
 * `name` is the EFFECTIVE provider, so a provider in config satisfies this just
 * as `--provider` does; only an unresolved `auto` is ambiguous. `configKey` is
 * the key as the user writes it (`fill.provider`, `docevals.provider`).
 */
export function assertModelHasProvider(
  name: ProviderSelector,
  model: string | undefined,
  configKey: string,
  toError: ToErrorFn,
): void {
  if (name !== DEFAULT_PROVIDER || model == null) return;
  throw toError(
    `Model "${model}" was given without a provider: a model name does not say ` +
      `which provider owns it. Set --provider or ${configKey} to one of ` +
      `${Object.keys(DEFAULT_MODELS).join(", ")}, or drop the model to take the ` +
      `detected provider's default.`,
  );
}

/**
 * Connection settings, per provider, as the family's top-level `providers:`
 * map states them. Only what the user wrote: `providerSpecFor` supplies the
 * defaults, so detection can tell a configured value from a default one.
 */
export interface ProviderConnections {
  anthropic?: { apiKeyEnv?: string };
  openai?: { baseUrl?: string; apiKeyEnv?: string };
  "claude-cli"?: { command?: string };
  /** `modelsDir` is absolute: resolved against the config file's directory. */
  "llama-cpp"?: { modelsDir?: string; thoughtTokens?: number };
}

/** The family's top-level `providers:` map, parsed. */
export interface ProvidersConfig extends ProviderConnections {
  /** Absent when not written. */
  provider?: ProviderSelector;
  /** Absent when not written. Never present without a named `provider`. */
  model?: string;
}

/** The family's top-level key for provider settings. */
export const PROVIDERS_KEY = "providers";

/** What each provider's section may carry, in the order messages list it. */
const CONNECTION_KEYS = {
  anthropic: ["apiKeyEnv"],
  openai: ["baseUrl", "apiKeyEnv"],
  "claude-cli": ["command"],
  "llama-cpp": ["modelsDir", "thoughtTokens"],
} as const;

type ConnectionName = keyof typeof CONNECTION_KEYS;

const CONNECTION_NAMES = Object.keys(CONNECTION_KEYS) as ConnectionName[];

const TOP_LEVEL_KEYS: readonly string[] = ["provider", "model", ...CONNECTION_NAMES];

/**
 * The providers a user can name for a model. `mock` is the library's test
 * double, answered only when asked for by name, so it is not advice.
 */
const NAMEABLE_PROVIDERS = Object.keys(DEFAULT_MODELS).filter((name) => name !== "mock");

function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectUnknown(
  raw: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
  source: string,
  toError: ToErrorFn,
): void {
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) {
      throw toError(
        `${source}: "${label}" has unknown key "${key}". Supported keys: ${allowed.join(", ")}.`,
      );
    }
  }
}

/**
 * Parse the family's `providers:` map. Every message names `source`, and a
 * relative `llama-cpp.modelsDir` resolves from `dir`, the directory holding
 * the file, as every other path written in the config does.
 */
export function parseProviders(
  value: unknown,
  source: string,
  dir: string,
  toError: ToErrorFn,
): ProvidersConfig {
  if (value == null) return {};
  if (!isMapping(value)) {
    throw toError(`${source}: "${PROVIDERS_KEY}" must be a mapping.`);
  }
  rejectUnknown(value, TOP_LEVEL_KEYS, PROVIDERS_KEY, source, toError);

  const string = (raw: Record<string, unknown>, key: string, label: string): string | undefined => {
    const v = raw[key];
    if (v === undefined) return undefined;
    if (typeof v !== "string") {
      throw toError(`${source}: "${label}" must be a string.`);
    }
    return v;
  };

  const parsed: ProvidersConfig = {};
  const provider = string(value, "provider", `${PROVIDERS_KEY}.provider`);
  if (provider !== undefined) {
    assertKnownProvider(provider, (message) => toError(`${source}: ${message}`));
    parsed.provider = provider;
  }
  const model = string(value, "model", `${PROVIDERS_KEY}.model`);
  if (model !== undefined) {
    if (provider === undefined || provider === DEFAULT_PROVIDER) {
      throw toError(
        `${source}: "${PROVIDERS_KEY}.model" was given without a provider: a model name does not ` +
          `say which provider owns it. Set ${PROVIDERS_KEY}.provider to one of ` +
          `${NAMEABLE_PROVIDERS.join(", ")}, or drop the model to take the detected provider's default.`,
      );
    }
    parsed.model = model;
  }

  for (const name of CONNECTION_NAMES) {
    const section = value[name];
    if (section == null) continue;
    const label = `${PROVIDERS_KEY}.${name}`;
    if (!isMapping(section)) {
      throw toError(`${source}: "${label}" must be a mapping.`);
    }
    rejectUnknown(section, CONNECTION_KEYS[name], label, source, toError);
    const field = (key: string): string | undefined => string(section, key, `${label}.${key}`);
    switch (name) {
      case "anthropic": {
        const apiKeyEnv = field("apiKeyEnv");
        parsed.anthropic = apiKeyEnv === undefined ? {} : { apiKeyEnv };
        break;
      }
      case "openai": {
        const baseUrl = field("baseUrl");
        const apiKeyEnv = field("apiKeyEnv");
        parsed.openai = {
          ...(baseUrl !== undefined ? { baseUrl } : {}),
          ...(apiKeyEnv !== undefined ? { apiKeyEnv } : {}),
        };
        break;
      }
      case "claude-cli": {
        const command = field("command");
        parsed["claude-cli"] = command === undefined ? {} : { command };
        break;
      }
      case "llama-cpp": {
        const modelsDir = field("modelsDir");
        const thoughtTokens = section["thoughtTokens"];
        if (
          thoughtTokens !== undefined &&
          (typeof thoughtTokens !== "number" || !Number.isInteger(thoughtTokens) || thoughtTokens < 0)
        ) {
          throw toError(
            `${source}: "${label}.thoughtTokens" must be a whole number of 0 or more, got ${JSON.stringify(thoughtTokens)}.`,
          );
        }
        parsed["llama-cpp"] = {
          ...(modelsDir !== undefined ? { modelsDir: resolve(dir, modelsDir) } : {}),
          ...(thoughtTokens !== undefined ? { thoughtTokens } : {}),
        };
        break;
      }
    }
  }
  return parsed;
}

/** A provider and a model as one level states them; either half may be absent. */
export interface ProviderChoice {
  provider?: string;
  model?: string;
  /**
   * Where the level's provider was written, as a `--local` notice names it:
   * `providers.provider`, `docevals.provider`, `fill.provider`, or
   * `eval "<id>" in <file>`.
   */
  origin?: string;
}

/** The command line's say: `--provider`, `--model` and `--local`. */
export interface ProviderFlags {
  provider?: string;
  model?: string;
  /** Run inference on this machine, with llama-cpp, whatever a level asks for. */
  local?: boolean;
}

/** A configured choice that `--local` set aside. */
export interface ReplacedChoice {
  provider: string;
  source: string;
}

/** The effective choice, before it is checked or detected. */
export interface ProviderSelection {
  provider: string;
  model: string | undefined;
  /** Under `--local`, the configured provider that would otherwise have run. */
  replaced?: ReplacedChoice;
}

/**
 * The provider `--local` runs. `claude-cli` does not qualify: the binary runs
 * on this machine, the inference does not (proposal 0017).
 */
export const LOCAL_PROVIDER = "llama-cpp";

/** `--local`'s help, one wording on every command that takes the flag. */
export const LOCAL_FLAG_HELP =
  "run inference on this machine (llama-cpp); overrides any configured or eval-level provider";

/**
 * Names `--provider` may carry beside `--local`. `auto` under `--local` can
 * only mean the local provider, and `mock` is the library's test double, which
 * sends nothing anywhere.
 */
const LOCAL_COMPATIBLE: ReadonlySet<string> = new Set([LOCAL_PROVIDER, DEFAULT_PROVIDER, "mock"]);

/**
 * Refuse `--local` beside a `--provider` it contradicts. An unknown name is
 * refused as unknown first: `--local` would otherwise set it aside unread.
 */
export function assertLocalFlag(flag: ProviderFlags, toError: ToErrorFn): void {
  if (flag.local !== true || flag.provider === undefined) return;
  assertKnownProvider(flag.provider, toError);
  if (LOCAL_COMPATIBLE.has(flag.provider)) return;
  throw toError(
    `--local and --provider ${flag.provider} contradict each other: --local runs inference ` +
      `on this machine with ${LOCAL_PROVIDER}. Drop one of them.`,
  );
}

/**
 * The provider and model in force.
 *
 * `flag` is the command line. `levels` are the config's statements, highest
 * precedence first: for docevals an eval's own choice, then `docevals.provider`,
 * then the family's `providers:`; for `meta fill`, `meta.fill`, then the
 * family's. The provider is the flag's, else the first level that names one,
 * else `auto`.
 *
 * A model belongs to the provider its level names, so it is carried only to
 * that provider: a level whose provider lost does not lend its model to the
 * winner, which could not run it. A level naming no provider gives its model
 * to whichever provider is in force, which is how `--provider` supplies the
 * provider a configured model needs. The flag's model applies to whatever
 * wins.
 *
 * `--local` makes the provider llama-cpp, over every level. A level's model
 * then applies only where that level named llama-cpp, and the level whose
 * provider would otherwise have run is returned as `replaced`, unless it was
 * `auto`, which chose no hosted provider. Check the flag with
 * `assertLocalFlag` first: a contradicting `--provider` is not selected here.
 */
export function selectProvider(
  flag: ProviderFlags,
  levels: readonly ProviderChoice[],
): ProviderSelection {
  if (flag.local === true) return selectLocal(flag, levels);
  const provider =
    flag.provider ?? levels.find((level) => level.provider !== undefined)?.provider ?? DEFAULT_PROVIDER;
  const model =
    flag.model ??
    levels.find(
      (level) =>
        level.model !== undefined && (level.provider === undefined || level.provider === provider),
    )?.model;
  return { provider, model };
}

function selectLocal(flag: ProviderFlags, levels: readonly ProviderChoice[]): ProviderSelection {
  // The mock seam survives, so a test can drive `--local` without a runtime.
  const provider = flag.provider === "mock" ? "mock" : LOCAL_PROVIDER;
  const model =
    flag.model ??
    levels.find((level) => level.model !== undefined && level.provider === provider)?.model;
  // A flag's provider is the command line's own choice, never a replaced one.
  const chosen =
    flag.provider === undefined ? levels.find((level) => level.provider !== undefined) : undefined;
  const replaced =
    chosen?.provider !== undefined &&
    chosen.origin !== undefined &&
    chosen.provider !== provider &&
    chosen.provider !== DEFAULT_PROVIDER
      ? { provider: chosen.provider, source: chosen.origin }
      : undefined;
  return replaced === undefined ? { provider, model } : { provider, model, replaced };
}

/** What a selection's `--local` notice says, if it replaced anything. */
export function localNotice(selection: ProviderSelection): string | undefined {
  const { replaced } = selection;
  if (replaced === undefined) return undefined;
  return `--local: using ${LOCAL_PROVIDER} instead of "${replaced.provider}" from ${replaced.source}.`;
}

/**
 * The library's spec for a selection, with the connection settings from
 * `connections` for the provider it names.
 *
 * A named provider gets its own section, defaults filled. Under `auto` the
 * spec carries every setting detection reads, but only as the user wrote it:
 * the library counts a `baseUrl` as a reason openai is usable, so the default
 * endpoint must not reach detection. `apiKeyEnv` is left out there: the spec
 * has one for every provider, and detection looks for the default variables.
 */
export function providerSpecFor(
  connections: ProviderConnections,
  selection: { provider: ProviderSelector; model: string | null },
): ProviderSpec {
  const { provider, model } = selection;
  const local = connections["llama-cpp"] ?? {};
  const llamaCpp = {
    thoughtTokens: local.thoughtTokens ?? 0,
    ...(local.modelsDir !== undefined ? { modelsDirectory: local.modelsDir } : {}),
  };
  switch (provider) {
    case "anthropic":
      return {
        provider,
        model,
        apiKeyEnv: connections.anthropic?.apiKeyEnv ?? "ANTHROPIC_API_KEY",
      };
    case "openai":
      return {
        provider,
        model,
        apiKeyEnv: connections.openai?.apiKeyEnv ?? "OPENAI_API_KEY",
        baseUrl: connections.openai?.baseUrl ?? DEFAULT_OPENAI_BASE_URL,
      };
    case "claude-cli":
      return { provider, model, command: connections["claude-cli"]?.command ?? "claude" };
    case "llama-cpp":
      // Local weights, in-process: no API key, and no network once they are
      // downloaded.
      return { provider, model, llamaCpp };
    case "mock":
      return { provider, model };
    case "auto": {
      const baseUrl = connections.openai?.baseUrl;
      const command = connections["claude-cli"]?.command;
      const configuredLocal = local.thoughtTokens !== undefined || local.modelsDir !== undefined;
      return {
        provider,
        model,
        ...(baseUrl !== undefined ? { baseUrl } : {}),
        ...(command !== undefined ? { command } : {}),
        ...(configuredLocal ? { llamaCpp } : {}),
      };
    }
  }
}

/**
 * The concrete provider and model a spec resolves to, without constructing the
 * provider: a fully cached run needs no API key. Under `auto` this is where
 * detection runs. It probes the environment, the Claude CLI and the local
 * runtime, but never authenticates.
 *
 * The model returned is the RESOLVED one (the provider's default when none was
 * named, a llama-cpp tier's concrete weights), which is what makes it safe as
 * cache-key material: a library default that changes changes the key.
 */
export async function resolveIdentity(
  spec: ProviderSpec,
  toError: ToErrorFn,
): Promise<{ provider: ProviderName; model: string }> {
  try {
    return await resolveProviderIdentityAsync(spec);
  } catch (err) {
    // Detection failing with nothing available is operational, not per-file:
    // the aggregate message names every provider it tried and why each was out.
    throw toError(
      err instanceof InferenceError
        ? err.message
        : `Could not resolve provider "${String(spec.provider)}": ${errorMessage(err)}`,
    );
  }
}
