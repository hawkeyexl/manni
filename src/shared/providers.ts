/**
 * Choosing an inference provider and model, for every tool that sends content
 * to one: `manni meta fill` and `manni docevals`.
 *
 * The names a tool accepts, the two refusals and the detection call are one
 * implementation, so a provider added upstream reaches both tools on the same
 * day and a message reads the same in both. What differs is only what the
 * caller passes in: the config key its user writes, and its own error class,
 * which is what maps the refusal to exit 2.
 */
import {
  DEFAULT_MODELS,
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
