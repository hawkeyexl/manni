/**
 * Choosing the provider and model, and mapping `docevals.providers`' connection
 * settings onto the shared inference library's `ProviderSpec`.
 *
 * The providers themselves live in `@hawkeyexl/inference` (ADR 01002). The
 * names a provider may have, the two refusals and the detection call are
 * `src/shared/providers.ts`, the same code `manni meta fill` runs. What stays
 * here is what only manni docevals can decide: the precedence between a flag,
 * an eval's own `provider:`/`model:` and the config, and which connection
 * setting reaches which provider.
 */
import {
  DEFAULT_MODELS,
  makeProvider as makeInferenceProvider,
  type InferenceProvider,
  type ProviderName as ConcreteProvider,
  type ProviderSpec,
} from "@hawkeyexl/inference";
import { DocevalsError } from "../types.js";
import type { DocevalsConfig } from "../core/config.js";
import {
  assertKnownProvider,
  assertModelHasProvider,
  resolveIdentity,
} from "../../shared/providers.js";
import { errorMessage } from "../../shared/errors.js";

/** A provider and a model as one level states them; either half may be absent. */
export interface ProviderChoice {
  provider?: string;
  model?: string;
}

/** The effective choice, before it is checked or detected. */
export interface ProviderSelection {
  provider: string;
  model: string | undefined;
}

/** The key a docevals user writes, named by the refusal a bare model gets. */
const CONFIG_KEY = "docevals.provider";

const toDocevalsError = (message: string): Error => new DocevalsError(message);

/**
 * The provider and model in force: a flag, then the eval's own choice, then
 * the config. Each half is taken on its own, as `manni meta fill` takes
 * `--provider` and `--model`, with one exception: the config's model belongs
 * to the config's provider, so an eval that names a different provider takes
 * that provider's default instead of a model it cannot run.
 */
export function selectProvider(
  config: DocevalsConfig,
  flags: ProviderChoice = {},
  ev: ProviderChoice = {},
): ProviderSelection {
  const ownProvider = ev.provider === undefined || ev.provider === config.provider;
  return {
    provider: flags.provider ?? ev.provider ?? config.provider,
    model: flags.model ?? ev.model ?? (ownProvider ? (config.model ?? undefined) : undefined),
  };
}

/**
 * Refuse a selection that cannot be right, with `manni meta fill`'s messages:
 * an unknown name, or a model under `auto`. Both are `DocevalsError`s.
 */
export function assertProviderSelection(selection: ProviderSelection): void {
  assertKnownProvider(selection.provider, toDocevalsError);
  assertModelHasProvider(selection.provider, selection.model, CONFIG_KEY, toDocevalsError);
}

/** The spec for a named provider, with the connection settings it reads. */
export function providerSpecFor(
  config: DocevalsConfig,
  identity: { provider: ConcreteProvider; model: string | null },
): ProviderSpec {
  const { provider, model } = identity;
  switch (provider) {
    case "anthropic":
      return {
        provider,
        model,
        apiKeyEnv: config.providers.anthropic.apiKeyEnv,
        // A verdict-shaped tool name steers the model better than a generic
        // one, and it is free to keep.
        anthropic: { toolName: "record_verdict" },
      };
    case "openai":
      return {
        provider,
        model,
        apiKeyEnv: config.providers.openai.apiKeyEnv,
        baseUrl: config.providers.openai.baseUrl,
        openai: { schemaName: "verdict" },
      };
    case "claude-cli":
      return { provider, model, command: config.providers["claude-cli"].command };
    case "llama-cpp": {
      // Local weights, in-process: no API key, and no network at judge time
      // once they are downloaded.
      const local = config.providers["llama-cpp"];
      return {
        provider,
        model,
        llamaCpp: {
          thoughtTokens: local.thoughtTokens,
          ...(local.modelsDir !== null ? { modelsDirectory: local.modelsDir } : {}),
        },
      };
    }
    case "mock":
      return { provider, model };
  }
}

/**
 * The concrete provider and model, WITHOUT constructing the provider: cache
 * keys need it, and a fully cached run must not require an API key.
 *
 * Under `auto` this is where detection runs, exactly as `manni meta fill` runs
 * it. The model is the RESOLVED one (the provider's default when none was
 * named, a llama-cpp tier's concrete weights), so a library default that
 * changes changes every cache key built from it.
 */
export async function resolveProviderIdentity(
  config: DocevalsConfig,
  flags: ProviderChoice = {},
  ev: ProviderChoice = {},
): Promise<{ provider: ConcreteProvider; model: string }> {
  const selection = selectProvider(config, flags, ev);
  assertProviderSelection(selection);
  const model = selection.model ?? null;
  // The name was checked just above, so anything not concrete is `auto`.
  const spec: ProviderSpec =
    !isConcrete(selection.provider)
      ? { provider: "auto", model }
      : providerSpecFor(config, { provider: selection.provider, model });
  return resolveIdentity(spec, toDocevalsError);
}

/** Construct a provider for an identity already resolved. */
export function constructProvider(
  config: DocevalsConfig,
  identity: { provider: ConcreteProvider; model: string },
): InferenceProvider {
  try {
    return makeInferenceProvider(providerSpecFor(config, identity));
  } catch (e) {
    // The library raises its own InferenceError (missing API key). It must
    // surface as a DocevalsError: `run` degrades to deterministic-only evals on
    // a DocevalsError and rethrows anything else, and cli.ts fail() maps only
    // DocevalsError to exit 2. Letting a foreign error type through turns "no
    // API key configured" from a warning into an unhandled stack trace.
    throw new DocevalsError(errorMessage(e));
  }
}

/** Select, check, detect and construct: the provider a verb sends pages to. */
export async function makeProvider(
  config: DocevalsConfig,
  flags: ProviderChoice = {},
  ev: ProviderChoice = {},
): Promise<InferenceProvider> {
  return constructProvider(config, await resolveProviderIdentity(config, flags, ev));
}

/** Every provider but `auto`, from the library as the shared list is. */
const CONCRETE: ReadonlySet<string> = new Set(Object.keys(DEFAULT_MODELS));

function isConcrete(name: string): name is ConcreteProvider {
  return CONCRETE.has(name);
}
