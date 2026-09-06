/**
 * Judge-provider construction: map manni tracevals' provider config section onto
 * the shared inference library's `ProviderSpec`.
 *
 * This used to serialize the config section back to YAML and re-parse it
 * through docevals' `parseConfig` purely to obtain the config object docevals'
 * factory demanded. `ProviderSpec` is a flat, library-owned shape, so the
 * mapping is now direct — and `mock` is a real provider rather than a
 * special case handled before the factory (ADR 01006).
 */
import {
  makeProvider,
  type InferenceProvider,
  type MockResponse,
  type ProviderName,
  type Pricing,
  type ProviderSpec,
} from "@hawkeyexl/inference";
import { mockVerdict } from "@hawkeyexl/inference";
import { TracevalsError } from "../types.js";
import type { TracevalsConfig } from "../core/config.js";

export type { MockResponse };

export function makeJudgeProvider(
  config: TracevalsConfig,
  options: {
    provider?: string;
    model?: string;
    /**
     * Responses for the `mock` provider. The default is verdict-shaped, which
     * suits judging; callers with a different response schema (criteria
     * proposals, say) must supply their own.
     */
    mockResponses?: MockResponse[];
  } = {},
): InferenceProvider {
  const name = (options.provider ??
    config.provider.default ??
    "claude-cli") as ProviderName;

  try {
    return makeProvider(providerSpecFor(config, name, options));
  } catch (err) {
    throw new TracevalsError(
      `could not construct judge provider "${name}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * The configured price override for the selected provider, if any.
 *
 * Cost accounting has to go through this rather than bare `pricingFor(model)`:
 * a model the library's built-in table does not know prices at 0, which
 * silently disables every `maxCostUsd` budget. The override is the only way a
 * user can make budgets work for such a model, so dropping it on the floor
 * makes the config key a lie.
 */
export function pricingOverrideFor(
  config: TracevalsConfig,
  options: { provider?: string } = {},
): Pricing | undefined {
  const name = (options.provider ??
    config.provider.default ??
    "claude-cli") as ProviderName;
  return providerSpecFor(config, name).pricing;
}

/**
 * Narrow the config's per-provider sections down to the selected one.
 *
 * Exported so callers can resolve the provider *identity* — via the library's
 * `resolveProviderIdentity` — without constructing anything. A fully-cached
 * run must not require an API key, and the model that lands in a cache key
 * must be the one `makeProvider` would actually use, defaults included.
 */
export function providerSpecFor(
  config: TracevalsConfig,
  name: ProviderName,
  options: { model?: string; mockResponses?: MockResponse[] } = {},
): ProviderSpec {
  const { provider } = config;
  switch (name) {
    case "anthropic":
      return {
        provider: "anthropic",
        model: options.model ?? provider.anthropic.model,
        apiKeyEnv: provider.anthropic.apiKeyEnv,
        ...(provider.anthropic.pricing
          ? { pricing: provider.anthropic.pricing }
          : {}),
      };
    case "openai":
      return {
        provider: "openai",
        model: options.model ?? provider.openai.model,
        apiKeyEnv: provider.openai.apiKeyEnv,
        baseUrl: provider.openai.baseUrl,
        ...(provider.openai.pricing ? { pricing: provider.openai.pricing } : {}),
      };
    case "claude-cli":
      return {
        provider: "claude-cli",
        model: options.model ?? provider["claude-cli"].model,
        command: provider["claude-cli"].command,
      };
    case "mock":
      return {
        provider: "mock",
        ...(options.model !== undefined ? { model: options.model } : {}),
        mockResponses: options.mockResponses ?? [mockVerdict("pass", 0.95)],
      };
    default: {
      // Unreachable via config (the schema constrains the enum), but a CLI
      // --provider flag is free text and lands here.
      const unknownName: string = name;
      throw new TracevalsError(
        `unknown provider "${unknownName}". Available: anthropic, openai, claude-cli, mock.`,
      );
    }
  }
}
