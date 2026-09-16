/**
 * Choosing the provider and model for `manni kg fill`, and building the shared
 * inference library's `ProviderSpec` for it.
 *
 * The providers themselves live in `@hawkeyexl/inference` (ADR 01021). The
 * names a provider may have, the two refusals, the detection call, the
 * level-bound precedence and the mapping of the family's `providers:`
 * connection settings are `src/shared/providers.ts`, the same code
 * `manni meta fill` and `manni docevals` run. What stays here is what only kg
 * can decide: which levels it reads — a flag, then `kg.provider`/`kg.model`,
 * then the family's top-level `providers:` map, then `auto` (proposal
 * 0051 §3).
 *
 * `kg.embed.model` is a local embedding model id, not a provider, and nothing
 * here touches it.
 */
import {
  makeProvider as makeInferenceProvider,
  type InferenceProvider,
  type ProviderName as ConcreteProvider,
  type ProviderSelector,
  type ProviderSpec,
} from "@hawkeyexl/inference";
import type { DockgConfig } from "../core/config.js";
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
import { KgError } from "../types.js";

export type { ProviderChoice, ProviderFlags, ProviderSelection };

/** The key a kg user writes, named by the refusal a bare model gets. */
const CONFIG_KEY = "kg.provider";

const toKgError = (message: string): Error => new KgError(message);

/**
 * The provider and model in force: a flag, then `kg.provider`/`kg.model`,
 * then the family's `providers.provider`/`model`, then `auto`. A model is
 * carried only to the provider its own level names, so a level whose provider
 * lost takes the winner's default rather than a model it cannot run
 * (`selectProvider` in the shared module).
 *
 * `--local` runs llama-cpp over both levels. A `--provider` it contradicts is
 * refused here, so no path selects past it.
 */
export function selectProvider(
  config: DockgConfig,
  flags: ProviderFlags = {},
): ProviderSelection {
  assertLocalFlag(flags, toKgError);
  return selectFromLevels(flags, [
    {
      ...(config.provider !== null ? { provider: config.provider } : {}),
      ...(config.model !== null ? { model: config.model } : {}),
      origin: CONFIG_KEY,
    },
    {
      ...(config.providers.provider !== undefined
        ? { provider: config.providers.provider }
        : {}),
      ...(config.providers.model !== undefined
        ? { model: config.providers.model }
        : {}),
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
 * an unknown name, or a model under `auto`. Both are `KgError`s, so both exit
 * 2 rather than reading as a finding.
 */
export function assertProviderSelection(selection: ProviderSelection): void {
  assertKnownProvider(selection.provider, toKgError);
  assertModelHasProvider(
    selection.provider,
    selection.model,
    CONFIG_KEY,
    toKgError,
  );
}

/**
 * The spec for a selection, with the family's connection settings for the
 * provider it names, and under `auto` the settings detection reads.
 */
export function providerSpecFor(
  config: DockgConfig,
  selection: { provider: ProviderSelector; model: string | null },
): ProviderSpec {
  return sharedProviderSpecFor(config.providers, selection);
}

/**
 * The concrete provider and model, WITHOUT constructing the provider: cache
 * keys need it, and a fully cached or fully complete run must not require an
 * API key.
 *
 * Under `auto` this is where detection runs, exactly as `manni meta fill`
 * runs it, seeing the same connection settings. The model is the RESOLVED one
 * (the provider's default when none was named, a llama-cpp tier's concrete
 * weights), so a library default that changes changes every cache key built
 * from it.
 */
export async function resolveProviderIdentity(
  config: DockgConfig,
  flags: ProviderFlags = {},
): Promise<{ provider: ConcreteProvider; model: string }> {
  const selection = selectProvider(config, flags);
  const { provider, model } = selection;
  assertKnownProvider(provider, toKgError);
  assertModelHasProvider(provider, model, CONFIG_KEY, toKgError);
  announceSelection(selection);
  return resolveIdentity(
    providerSpecFor(config, { provider, model: model ?? null }),
    toKgError,
  );
}

/** Construct a provider for an identity already resolved. */
export function constructProvider(
  config: DockgConfig,
  identity: { provider: ConcreteProvider; model: string },
): InferenceProvider {
  try {
    return makeInferenceProvider(providerSpecFor(config, identity));
  } catch (e) {
    // The library raises its own InferenceError (a missing API key, say). It
    // must surface as a KgError: `fail()` maps only KgError to exit 2, and
    // letting a foreign error type through turns "no API key configured" into
    // an unhandled stack trace.
    throw new KgError(errorMessage(e));
  }
}

/** Select, check, detect and construct: the provider `fill` sends pages to. */
export async function makeProvider(
  config: DockgConfig,
  flags: ProviderFlags = {},
): Promise<InferenceProvider> {
  return constructProvider(config, await resolveProviderIdentity(config, flags));
}
