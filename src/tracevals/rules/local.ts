/**
 * What tracevals asks of a local model without loading it (proposal 0079,
 * gates 5, 8 and 9, and `prepare`). The inference library owns every answer;
 * this is the one seam, so a test can say "downloading" without a runtime.
 */
import {
  ensureModel,
  fits,
  modelState,
  nodeLlamaCppStatus,
  type EnsureModelResult,
  type FitsResult,
  type LlamaModelState,
} from "@hawkeyexl/inference";
import type { ProviderConnections } from "../../shared/providers.js";

export interface LocalModels {
  /** Whether the llama.cpp binding is importable now, installing nothing. */
  runtimePresent(): Promise<boolean>;
  /** `ready`, `downloading` or `missing`, read without loading or fetching. */
  state(model: string): Promise<LlamaModelState>;
  /** The memory probe `auto` tiering uses. */
  fits(model: string): Promise<FitsResult>;
  /** Fetch the runtime and the weights, without loading either. */
  ensure(model: string): Promise<EnsureModelResult>;
}

/** The library's lifecycle calls, pointed at the family's models directory. */
export function libraryLocalModels(connections: ProviderConnections): LocalModels {
  const modelsDir = connections["llama-cpp"]?.modelsDir;
  const options = modelsDir === undefined ? {} : { modelsDirectory: modelsDir };
  return {
    runtimePresent: async () => (await nodeLlamaCppStatus()).state === "present",
    state: (model) => modelState(model, options),
    fits: (model) => fits(model, options),
    ensure: (model) => ensureModel(model, options),
  };
}

/** Bytes in a gigabyte as the messages count them. */
export const GB = 1024 ** 3;
