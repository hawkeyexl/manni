/**
 * Choosing the provider and model, and building the shared inference
 * library's `ProviderSpec` for it.
 *
 * The providers themselves live in `@hawkeyexl/inference` (ADR 01006). The
 * names a provider may have, the two refusals, `--local`, the detection call,
 * the level-bound precedence and the mapping of the family's `providers:`
 * connection settings are `src/shared/providers.ts`, the same code
 * `manni meta fill` and `manni docevals` run. What stays here is what only
 * manni tracevals can decide: which levels it reads (a flag, an eval's own
 * `provider:`/`model:`, `tracevals.provider`/`model`, then the family's
 * `providers:`), and the judge-shaped options a verdict call wants.
 *
 * No model id is named in this file. A model the tool pinned would go stale
 * the week the provider shipped a better one, and would override the default
 * the library keeps current.
 */
import {
  makeProvider as makeInferenceProvider,
  mockVerdict,
  type InferenceProvider,
  type MockDecisions,
  type MockResponse,
  type ProviderName as ConcreteProvider,
  type ProviderSelector,
  type ProviderSpec,
} from "@hawkeyexl/inference";
import { TracevalsError } from "../types.js";
import type { HostSetting } from "../rules/host.js";
import type { TracevalsConfig } from "../core/config.js";
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

export type { MockResponse, ProviderChoice, ProviderFlags, ProviderSelection };

/** The decide-only provider (proposal 0079). */
export const JEV = "jev";

/** Why jev cannot serve out of the loop, and where it goes instead. */
export const JEV_OUT_OF_LOOP =
  "jev answers decisions only, so it cannot extract rules or write verdicts. Use it as tracevals.conformance.hook.provider.";

/** The key a tracevals user writes, named by the refusal a bare model gets. */
const CONFIG_KEY = "tracevals.provider";

const toTracevalsError = (message: string): Error => new TracevalsError(message);

/** What a caller wants of the provider beyond which one it is. */
export interface JudgeProviderOptions {
  /**
   * Responses for the `mock` seam. The default is verdict-shaped, which suits
   * judging; callers with a different response schema (criteria proposals,
   * say) must supply their own. `mock` is accepted when named but never
   * offered, so nothing that lists providers mentions it.
   */
  mockResponses?: MockResponse[];
  /** Scripted decisions for the `mock` seam, which the turn judge asks. */
  mockDecisions?: MockDecisions;
  /**
   * How a `llama-cpp` provider reaches the model host. Unset, it connects to
   * a running host and never starts one, which is every run by hand.
   */
  host?: HostSetting;
}

/**
 * The provider and model in force: a flag, then the eval's own choice, then
 * `tracevals.provider`/`model`, then the family's `providers.provider`/`model`,
 * then `auto`. A model is carried only to the provider its own level names, so
 * an eval that names a different provider takes that provider's default
 * instead of a model it cannot run (`selectProvider` in the shared module).
 *
 * `--local` runs llama-cpp over all of them. A `--provider` it contradicts is
 * refused here, so no path selects past it. `ev.origin` names the eval in the
 * notice for a provider `--local` replaced; the caller knows its artifact.
 */
export function selectProvider(
  config: TracevalsConfig,
  flags: ProviderFlags = {},
  ev: ProviderChoice = {},
): ProviderSelection {
  assertLocalFlag(flags, toTracevalsError);
  return selectFromLevels(flags, [
    {
      ...(ev.provider !== undefined ? { provider: ev.provider } : {}),
      ...(ev.model !== undefined ? { model: ev.model } : {}),
      ...(ev.origin !== undefined ? { origin: ev.origin } : {}),
    },
    ...configLevels(config),
  ]);
}

/**
 * The judge inside a hook (proposal 0079, "Two model roles"):
 * `conformance.hook.provider`/`model`, then `tracevals.provider`/`model`, then
 * the family's `providers:`, then `auto`. No flag reaches it, because a hook
 * has no command line. A hook level naming only a model lends it to whichever
 * provider wins, as every level does.
 */
export function selectHookProvider(config: TracevalsConfig): ProviderSelection {
  const hook = config.conformance?.hook;
  return selectFromLevels({}, [
    {
      ...(hook?.provider != null ? { provider: hook.provider } : {}),
      ...(hook?.model != null ? { model: hook.model } : {}),
      origin: "tracevals.conformance.hook.provider",
    },
    ...configLevels(config),
  ]);
}

/** `tracevals.provider`/`model`, then the family's `providers:`. */
function configLevels(config: TracevalsConfig): ProviderChoice[] {
  return [
    {
      ...(config.provider !== null ? { provider: config.provider } : {}),
      ...(config.model !== null ? { model: config.model } : {}),
      origin: CONFIG_KEY,
    },
    {
      ...(config.providers.provider !== undefined
        ? { provider: config.providers.provider }
        : {}),
      ...(config.providers.model !== undefined ? { model: config.providers.model } : {}),
      origin: "providers.provider",
    },
  ];
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
 * an unknown name, or a model under `auto`. Both are `TracevalsError`s, which
 * is what maps them to exit 2.
 */
export function assertProviderSelection(selection: ProviderSelection): void {
  // Every caller of this check generates: `run`'s and `calibrate`'s verdicts,
  // `fill`'s proposals, and rule extraction. Only the turn judge may decide.
  if (selection.provider === JEV) throw new TracevalsError(JEV_OUT_OF_LOOP);
  assertKnownProvider(selection.provider, toTracevalsError);
  assertModelHasProvider(selection.provider, selection.model, CONFIG_KEY, toTracevalsError);
}

/**
 * The spec for a selection, with the family's connection settings for the
 * provider it names, and under `auto` the settings detection reads.
 */
export function providerSpecFor(
  config: TracevalsConfig,
  selection: { provider: ProviderSelector; model: string | null },
  options: JudgeProviderOptions = {},
): ProviderSpec {
  const spec = sharedProviderSpecFor(config.providers, selection);
  switch (selection.provider) {
    case "anthropic":
      // A verdict-shaped tool name steers the model better than a generic
      // one, and it is free to keep.
      return { ...spec, anthropic: { toolName: "record_verdict" } };
    case "openai":
      return { ...spec, openai: { schemaName: "verdict" } };
    case "llama-cpp":
      return {
        ...spec,
        llamaCpp: { ...spec.llamaCpp, ...(options.host ?? { host: "connect" }) },
      };
    case "mock":
      return {
        ...spec,
        mockResponses: options.mockResponses ?? [mockVerdict("pass", 0.95)],
        ...(options.mockDecisions !== undefined ? { mockDecisions: options.mockDecisions } : {}),
      };
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
  config: TracevalsConfig,
  flags: ProviderFlags = {},
  ev: ProviderChoice = {},
): Promise<{ provider: ConcreteProvider; model: string }> {
  // Every caller of this generates, so jev is refused here as well as where
  // a command checks its selection up front.
  const selection = selectProvider(config, flags, ev);
  assertProviderSelection(selection);
  return resolveSelectionIdentity(config, selection);
}

/** `resolveProviderIdentity` for a selection already made. */
export async function resolveSelectionIdentity(
  config: TracevalsConfig,
  selection: ProviderSelection,
): Promise<{ provider: ConcreteProvider; model: string }> {
  const { provider, model } = selection;
  // Generating callers refused jev in assertProviderSelection; reaching here
  // with it means the turn judge, which decides.
  assertKnownProvider(provider, toTracevalsError, { decisions: true });
  assertModelHasProvider(provider, model, CONFIG_KEY, toTracevalsError);
  announceSelection(selection);
  return resolveIdentity(
    providerSpecFor(config, { provider, model: model ?? null }),
    toTracevalsError,
  );
}

/** Construct a provider for an identity already resolved. */
export function constructProvider(
  config: TracevalsConfig,
  identity: { provider: ConcreteProvider; model: string },
  options: JudgeProviderOptions = {},
): InferenceProvider {
  if (identity.provider === JEV) {
    // Checked here, so the message names the variable a user sets rather than
    // the library's wording for it.
    const keyEnv = config.providers.jev?.apiKeyEnv ?? "TYPESAFE_API_KEY";
    const key = process.env[keyEnv];
    if (key === undefined || key === "") {
      throw new TracevalsError(`jev needs an API key in ${keyEnv}`);
    }
  }
  try {
    return makeInferenceProvider(providerSpecFor(config, identity, options));
  } catch (e) {
    // The library raises its own InferenceError (a missing API key). It must
    // surface as a TracevalsError: `cli.ts`'s fail() maps only that to exit 2,
    // and letting a foreign error type through turns "no API key configured"
    // into an unhandled stack trace.
    throw new TracevalsError(errorMessage(e));
  }
}

/** Select, check, detect and construct: the provider a verb judges with. */
export async function makeJudgeProvider(
  config: TracevalsConfig,
  flags: ProviderFlags = {},
  ev: ProviderChoice = {},
  options: JudgeProviderOptions = {},
): Promise<InferenceProvider> {
  return constructProvider(
    config,
    await resolveProviderIdentity(config, flags, ev),
    options,
  );
}
