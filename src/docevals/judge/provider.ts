/**
 * Choosing the provider and model, and building the shared inference
 * library's `ProviderSpec` for it.
 *
 * The providers themselves live in `@hawkeyexl/inference` (ADR 01002). The
 * names a provider may have, the two refusals, the detection call, the
 * level-bound precedence and the mapping of the family's `providers:`
 * connection settings are `src/shared/providers.ts`, the same code
 * `manni meta fill` runs. What stays here is what only manni docevals can
 * decide: which levels it reads (a flag, an eval's own `provider:`/`model:`,
 * `docevals.provider`/`model`, then the family's `providers:`), and the
 * judge-shaped options a verdict call wants.
 */
import {
  makeProvider as makeInferenceProvider,
  type InferenceProvider,
  type ProviderName as ConcreteProvider,
  type ProviderSelector,
  type ProviderSpec,
} from "@hawkeyexl/inference";
import { DocevalsError } from "../types.js";
import type { DocevalsConfig } from "../core/config.js";
import {
  assertKnownProvider,
  assertLocalFlag,
  assertModelHasProvider,
  localNotice,
  providerSpecFor as sharedProviderSpecFor,
  resolveIdentity,
  selectProvider as selectFromLevels,
  type ProviderChoice,
  type ProviderFlags,
  type ProviderSelection,
} from "../../shared/providers.js";
import { errorMessage } from "../../shared/errors.js";
import { noticeOnce } from "../../shared/warn.js";

export type { ProviderChoice, ProviderFlags, ProviderSelection };

/** The key a docevals user writes, named by the refusal a bare model gets. */
const CONFIG_KEY = "docevals.provider";

const toDocevalsError = (message: string): Error => new DocevalsError(message);

/**
 * The provider and model in force: a flag, then the eval's own choice, then
 * `docevals.provider`/`model`, then the family's `providers.provider`/`model`,
 * then `auto`. A model is carried only to the provider its own level names,
 * so an eval that names a different provider takes that provider's default
 * instead of a model it cannot run (`selectProvider` in the shared module).
 *
 * `--local` runs llama-cpp over all of them. A `--provider` it contradicts is
 * refused here, so no path selects past it. `ev.origin` names the eval in the
 * notice for a provider `--local` replaced; the caller knows its page.
 */
export function selectProvider(
  config: DocevalsConfig,
  flags: ProviderFlags = {},
  ev: ProviderChoice = {},
): ProviderSelection {
  assertLocalFlag(flags, toDocevalsError);
  return selectFromLevels(flags, [
    {
      ...(ev.provider !== undefined ? { provider: ev.provider } : {}),
      ...(ev.model !== undefined ? { model: ev.model } : {}),
      ...(ev.origin !== undefined ? { origin: ev.origin } : {}),
    },
    {
      ...(config.provider !== null ? { provider: config.provider } : {}),
      ...(config.model !== null ? { model: config.model } : {}),
      origin: CONFIG_KEY,
    },
    {
      ...(config.providers.provider !== undefined ? { provider: config.providers.provider } : {}),
      ...(config.providers.model !== undefined ? { model: config.providers.model } : {}),
      origin: "providers.provider",
    },
  ]);
}

/**
 * Say what `--local` set aside, once per source. Called where a selection is
 * about to be used, never where it is only checked, so a run that sends
 * nothing to a model says nothing.
 */
export function announceSelection(selection: ProviderSelection): void {
  const message = localNotice(selection);
  if (message !== undefined) noticeOnce(message);
}

/**
 * Refuse a selection that cannot be right, with `manni meta fill`'s messages:
 * an unknown name, or a model under `auto`. Both are `DocevalsError`s.
 */
export function assertProviderSelection(selection: ProviderSelection): void {
  assertKnownProvider(selection.provider, toDocevalsError);
  assertModelHasProvider(selection.provider, selection.model, CONFIG_KEY, toDocevalsError);
}

/**
 * The spec for a selection, with the family's connection settings for the
 * provider it names, and under `auto` the settings detection reads.
 */
export function providerSpecFor(
  config: DocevalsConfig,
  selection: { provider: ProviderSelector; model: string | null },
): ProviderSpec {
  const spec = sharedProviderSpecFor(config.providers, selection);
  switch (selection.provider) {
    case "anthropic":
      // A verdict-shaped tool name steers the model better than a generic
      // one, and it is free to keep.
      return { ...spec, anthropic: { toolName: "record_verdict" } };
    case "openai":
      return { ...spec, openai: { schemaName: "verdict" } };
    default:
      return spec;
  }
}

/**
 * The concrete provider and model, WITHOUT constructing the provider: cache
 * keys need it, and a fully cached run must not require an API key.
 *
 * Under `auto` this is where detection runs, exactly as `manni meta fill` runs
 * it, seeing the same connection settings. The model is the RESOLVED one (the
 * provider's default when none was named, a llama-cpp tier's concrete
 * weights), so a library default that changes changes every cache key built
 * from it.
 */
export async function resolveProviderIdentity(
  config: DocevalsConfig,
  flags: ProviderFlags = {},
  ev: ProviderChoice = {},
): Promise<{ provider: ConcreteProvider; model: string }> {
  const selection = selectProvider(config, flags, ev);
  const { provider, model } = selection;
  assertKnownProvider(provider, toDocevalsError);
  assertModelHasProvider(provider, model, CONFIG_KEY, toDocevalsError);
  announceSelection(selection);
  return resolveIdentity(providerSpecFor(config, { provider, model: model ?? null }), toDocevalsError);
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
  flags: ProviderFlags = {},
  ev: ProviderChoice = {},
): Promise<InferenceProvider> {
  return constructProvider(config, await resolveProviderIdentity(config, flags, ev));
}
