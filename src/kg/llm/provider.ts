/**
 * Provider construction for `manni kg fill`: map the config's `fill` section onto
 * the shared inference library's `ProviderSpec`.
 *
 * The providers themselves, the response cache, the price table, and the
 * schema-validated retry all live in `@hawkeyexl/inference` (ADR 01021). What
 * stays here is the one thing only dockg can decide: which of its own config
 * keys mean what.
 */
import {
  makeProvider as makeInferenceProvider,
  resolveProviderIdentity as resolveIdentity,
  type InferenceProvider,
  type ProviderSpec,
} from "@hawkeyexl/inference";
import type { DockgConfig, ProviderName } from "../core/config.js";
import { DockgError } from "../types.js";

export interface ProviderOptions {
  provider?: string;
  model?: string;
}

/** Translate `config.fill` (plus CLI overrides) into a library ProviderSpec. */
export function providerSpecFor(
  config: DockgConfig,
  options: ProviderOptions = {},
): ProviderSpec {
  const fill = config.fill;
  // The cast is narrower than it looks, and deliberately so. Since 0.2.0 the
  // library's `ProviderSpec["provider"]` is `ProviderSelector | undefined`,
  // which admits `undefined` and `"auto"` — both of which the synchronous
  // `makeProvider` throws on, and neither of which the compiler would flag
  // through a cast. dockg's own ProviderName is the narrower union, so cast
  // from there.
  //
  // Both inputs are checked against PROVIDER_NAMES before they arrive:
  // `fill.provider` by Ajv against the schema enum, `options.provider` by
  // `enumOption` in cli.ts. They were not always — the CLI override used to be
  // an arbitrary string — so `schema-sync.test.ts` pins the two lists together
  // rather than leaving the soundness of this cast to a comment.
  const name: ProviderName = (options.provider ??
    fill.provider) as ProviderName;
  const spec: ProviderSpec = {
    provider: name,
    baseUrl: fill.baseUrl,
    command: fill.command,
  };
  // `null` in config means "use the provider default", which is exactly what
  // omitting the key means to the library — so don't pass the nulls through.
  const model = options.model ?? fill.model;
  if (model !== null && model !== undefined) spec.model = model;

  // `llama-cpp`'s library default is the selector "auto", which resolves
  // against this machine's memory and therefore cannot be resolved
  // synchronously — the library throws rather than guess. dockg keeps the
  // provider chain synchronous (going async would make makeProvider, which
  // src/index.ts re-exports, a breaking API change), so the model must be
  // concrete. Say that, instead of surfacing the library's message about a
  // selector the user never typed.
  if (name === "llama-cpp" && spec.model === undefined) {
    throw new DockgError(
      "fill.provider is llama-cpp but no fill.model is set. A local model must be named " +
        'explicitly — try fill.model: "granite-4.1-3b-q2", a curated alias, an hf: URI, or a ' +
        ".gguf path. Selectors like `auto` are resolved against the machine and are not supported.",
    );
  }
  if (fill.apiKeyEnv !== null) spec.apiKeyEnv = fill.apiKeyEnv;
  if (fill.pricing) spec.pricing = fill.pricing;
  return spec;
}

/**
 * Resolve the provider name and model WITHOUT constructing the provider — a
 * fully-cached or fully-complete run must not require an API key, but its
 * cache keys and pricing still need the identity.
 */
export function resolveProviderIdentity(
  config: DockgConfig,
  options: ProviderOptions = {},
): { provider: string; model: string } {
  return resolveIdentity(providerSpecFor(config, options));
}

export function makeProvider(
  config: DockgConfig,
  options: ProviderOptions = {},
): InferenceProvider {
  return makeInferenceProvider(providerSpecFor(config, options));
}
