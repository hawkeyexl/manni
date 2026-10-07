/**
 * What `prepare` and `check` share (proposal 0079): the two model roles,
 * extraction through the rules cache, and the local-model gates. Free of CLI
 * and IO plumbing, like every command core.
 */
import { resolve } from "node:path";
import type { InferenceProvider, ProviderName } from "@hawkeyexl/inference";
import { errorMessage } from "../../shared/errors.js";
import type { TracevalsConfig } from "../core/config.js";
import {
  assertProviderSelection,
  constructProvider,
  resolveSelectionIdentity,
  selectProvider,
} from "../judge/provider.js";
import { RulesCache, rulesCacheKey } from "../rules/cache.js";
import type { HostSetting } from "../rules/host.js";
import { extractRules, promptFor, type Rule } from "../rules/extract.js";
import { GB, type LocalModels } from "../rules/local.js";
import { mockRequestsResponse, mockRulesResponse } from "../rules/mock.js";
import type { RuleSource } from "../rules/sources.js";
import { TracevalsError } from "../types.js";

export interface Identity {
  provider: ProviderName;
  model: string;
}

/**
 * Set on this process before any provider is built, so a judge it spawns
 * (`claude-cli`) runs its own hooks under gate 2 and never judges itself.
 */
export const JUDGE_ENV = "MANNI_TRACEVALS_JUDGE";

export function markJudgeProcess(): void {
  process.env[JUDGE_ENV] = "1";
}

/** Providers that never leave the machine, which `--offline` admits. */
const LOCAL_PROVIDERS: ReadonlySet<string> = new Set(["llama-cpp", "mock"]);

export function isNetworkProvider(provider: string): boolean {
  return !LOCAL_PROVIDERS.has(provider);
}

/** `--offline` met a role whose provider would leave the machine. */
export function offlineRefusal(role: string, identity: Identity): TracevalsError {
  return new TracevalsError(
    `--offline runs no network provider, and ${role} uses ${identity.provider}`,
  );
}

/** The first line of an error, as every message quoting one shows it. */
export function firstLine(err: unknown): string {
  return errorMessage(err).split("\n")[0] ?? "";
}

/** Defaults filled for a run by hand, where the section may be absent. */
export function conformanceOf(config: TracevalsConfig): NonNullable<TracevalsConfig["conformance"]> {
  return (
    config.conformance ?? {
      hook: { provider: null, model: null, runs: 1 },
      include: [],
      exclude: [],
      plans: [],
    }
  );
}

/** The rules cache, beside the judge's, resolved as `run` resolves it. */
export function rulesCacheFor(
  config: TracevalsConfig,
  configDir: string,
  noCache: boolean,
): RulesCache {
  return new RulesCache(resolve(configDir, config.judge.cacheDir, "rules"), !noCache);
}

export interface Extraction {
  identity: Identity;
  cache: RulesCache;
  /** Whether a source still needs the model: not declared, not cached. */
  needs(source: RuleSource): boolean;
  /** A source's rules, declared or extracted. */
  rulesOf(source: RuleSource): Promise<{ rules: Rule[]; origin: "declared" | "extracted" }>;
}

/**
 * The out-of-loop model as extraction uses it: `tracevals.provider`/`model`,
 * then the family's `providers:`, then `auto`. No flag reaches it, so
 * `prepare`, the hook and `check` share one cache. jev is refused, because
 * extraction generates.
 *
 * The provider is built on the first uncached source, so a fully cached run
 * needs no API key. Under `mock` each source gets a scripted reading of its
 * own text.
 */
export async function extraction(
  config: TracevalsConfig,
  cache: RulesCache,
  injected?: InferenceProvider,
  host?: HostSetting,
): Promise<Extraction> {
  let identity: Identity;
  if (injected !== undefined) {
    identity = { provider: injected.provider() as ProviderName, model: injected.modelName() };
  } else {
    const selection = selectProvider(config);
    assertProviderSelection(selection);
    identity = await resolveSelectionIdentity(config, selection);
  }
  let built: InferenceProvider | undefined = injected;
  const providerFor = (source: RuleSource): InferenceProvider => {
    // Under `mock` each source gets a scripted reading of its own text, so a
    // provider is built per source and never kept.
    if (built === undefined && identity.provider === "mock") {
      markJudgeProcess();
      const scripted =
        promptFor(source.format) === "requests"
          ? mockRequestsResponse(source.content)
          : mockRulesResponse(source.content);
      return constructProvider(config, identity, { mockResponses: [scripted] });
    }
    // Every other provider is built once, on the first uncached source.
    if (built === undefined) {
      markJudgeProcess();
      built = constructProvider(config, identity, host === undefined ? {} : { host });
    }
    return built;
  };
  const keyOf = (source: RuleSource): string =>
    rulesCacheKey({
      provider: identity.provider,
      model: identity.model,
      prompt: promptFor(source.format),
      temperature: config.judge.temperature,
      sha256: source.sha256,
    });
  return {
    identity,
    cache,
    needs: (source) =>
      source.declaredRules === undefined && cache.get(keyOf(source)) === undefined,
    rulesOf: async (source) => {
      if (source.declaredRules !== undefined) {
        return { rules: source.declaredRules, origin: "declared" };
      }
      const hit = cache.get(keyOf(source));
      if (hit !== undefined) return { rules: hit, origin: "extracted" };
      try {
        const extracted = await extractRules(
          {
            path: source.displayPath,
            format: source.format,
            content: source.content,
            sha256: source.sha256,
          },
          { provider: providerFor(source), cache, temperature: config.judge.temperature },
        );
        return { rules: extracted.rules, origin: "extracted" };
      } catch (err) {
        if (err instanceof TracevalsError) throw err;
        throw new TracevalsError(
          `could not extract rules from ${source.displayPath}: ${firstLine(err)}`,
        );
      }
    },
  };
}

export type LocalGate = "downloading" | "not-downloaded" | "memory";

export interface GateSkip<G extends string = string> {
  gate: G;
  message: string;
}

const wholeGb = (bytes: number): number => Math.round(bytes / GB);

/**
 * Gates 5, 7 and 8 for one local model, in that order, each asked only when
 * listed. Nothing here loads or fetches a model: a runtime that is absent is
 * gate 7, and the memory probe is asked only once the runtime is there.
 *
 * The probe forks a worker and initializes the GPU to read free memory, which
 * costs most of a second. `memoryUnneeded` is asked first and, when it says so,
 * the probe is not run: memory only matters to a model about to be loaded.
 */
export async function localGate(
  local: LocalModels,
  model: string,
  gates: readonly LocalGate[],
  memoryUnneeded?: () => boolean | Promise<boolean>,
): Promise<GateSkip<LocalGate> | undefined> {
  const state = await local.state(model);
  if (gates.includes("downloading") && state === "downloading") {
    return { gate: "downloading", message: `tracevals skipped this turn: ${model} is still downloading.` };
  }
  if (gates.includes("not-downloaded") && (state !== "ready" || !(await local.runtimePresent()))) {
    return {
      gate: "not-downloaded",
      message: `tracevals skipped this turn: ${model} is not downloaded yet. Run manni tracevals prepare to fetch it.`,
    };
  }
  if (gates.includes("memory") && !(await memoryUnneeded?.())) {
    const fit = await local.fits(model);
    if (!fit.fits) {
      return {
        gate: "memory",
        message: `tracevals skipped this turn: ${model} needs about ${String(wholeGb(fit.needBytes))} GB and ${String(wholeGb(fit.freeBytes))} GB is free.`,
      };
    }
  }
  return undefined;
}

/** By hand a missing local model is an error, and nothing downloads. */
export async function assertDownloaded(local: LocalModels, model: string): Promise<void> {
  if ((await local.state(model)) === "ready" && (await local.runtimePresent())) return;
  throw new TracevalsError(`${model} is not downloaded; run manni tracevals prepare`);
}
