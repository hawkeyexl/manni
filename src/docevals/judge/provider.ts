/**
 * Judge-provider construction: map manni docevals' `provider` config section onto
 * the shared inference library's `ProviderSpec`.
 *
 * The providers themselves live in `@hawkeyexl/inference` (ADR 01002). What
 * stays here is the one thing only manni docevals can decide: which of its own
 * config keys mean what, and which section a `--provider` flag selects.
 */
import {
  aliasForTier,
  isLlamaSelector,
  makeProvider as makeInferenceProvider,
  resolveProviderIdentity as resolveIdentity,
  type InferenceProvider,
  type ProviderSpec,
} from "@hawkeyexl/inference";
import { DocevalsError } from "../types.js";
import type { DocevalsConfig, ProviderName } from "../core/config.js";
import type { JudgeOptions } from "../core/engine.js";

/** Narrow the config's per-provider sections down to the selected one. */
export function providerSpecFor(
  config: DocevalsConfig,
  options: JudgeOptions = {},
): ProviderSpec {
  const name = (options.provider ?? config.provider.default) as ProviderName;
  switch (name) {
    case "anthropic":
      return {
        provider: "anthropic",
        model: options.model ?? config.provider.anthropic.model,
        apiKeyEnv: config.provider.anthropic.apiKeyEnv,
        // A verdict-shaped tool name steers the model better than a generic
        // one, and it is free to keep.
        anthropic: { toolName: "record_verdict" },
      };
    case "openai":
      return {
        provider: "openai",
        model: options.model ?? config.provider.openai.model,
        apiKeyEnv: config.provider.openai.apiKeyEnv,
        baseUrl: config.provider.openai.baseUrl,
        openai: { schemaName: "verdict" },
      };
    case "claude-cli":
      return {
        provider: "claude-cli",
        model: options.model ?? config.provider["claude-cli"].model,
        command: config.provider["claude-cli"].command,
      };
    case "llama-cpp": {
      // Local weights, in-process: no API key, and no network at judge time
      // once they are downloaded. That is what lets someone without provider
      // credentials regenerate the committed docs cache.
      const local = config.provider["llama-cpp"];
      const requested = options.model ?? local.model;
      // A *tier* is resolved to its concrete model here, synchronously.
      // `makeProvider` is sync all the way down, and the library refuses to
      // resolve a selector on that path — picking one probes GPU memory, and
      // returning the literal "balanced" as cache-key material would let a
      // 2 GB and a 12 GB model share cached verdicts. `aliasForTier` is the
      // static half of that mapping and is safe here; `auto` is the half that
      // genuinely needs hardware, so it is refused by name rather than
      // silently becoming something else.
      if (requested === "auto") {
        throw new DocevalsError(
          'provider.llama-cpp.model: "auto" needs hardware detection, which this ' +
            'code path cannot do. Name a tier (fast, balanced, quality) or a model.',
        );
      }
      const model =
        isLlamaSelector(requested) && requested !== "auto"
          ? aliasForTier(requested)
          : requested;
      return {
        provider: "llama-cpp",
        model,
        llamaCpp: {
          thoughtTokens: local.thoughtTokens,
          ...(local.modelsDir !== null ? { modelsDirectory: local.modelsDir } : {}),
        },
      };
    }
    default:
      throw new DocevalsError(`Unknown provider "${String(name)}"`);
  }
}

/**
 * Resolve provider identity WITHOUT constructing the provider — cache keys and
 * pricing need it, but a fully-cached run must not require an API key.
 */
export function resolveProviderIdentity(
  config: DocevalsConfig,
  options: JudgeOptions = {},
): { provider: string; model: string } {
  return resolveIdentity(providerSpecFor(config, options));
}

export function makeProvider(
  config: DocevalsConfig,
  options: JudgeOptions = {},
): InferenceProvider {
  try {
    return makeInferenceProvider(providerSpecFor(config, options));
  } catch (e) {
    // The library raises its own InferenceError (missing API key, unknown
    // provider). It must surface as a DocevalsError: `run` degrades to
    // deterministic-only evals on a DocevalsError and rethrows anything else,
    // and cli.ts fail() maps only DocevalsError to exit 2. Letting a foreign
    // error type through turns "no API key configured" from a warning into an
    // unhandled stack trace.
    if (e instanceof DocevalsError) throw e;
    throw new DocevalsError(e instanceof Error ? e.message : String(e));
  }
}
