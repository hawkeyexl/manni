/**
 * The strategy domain's barrel (proposal 0102). The umbrella mounts
 * `buildProgram`, and docevals reads persona records through
 * `loadStrategySet` and `resolveStrategyRun` (proposal 0111), so ids, the
 * file-stem default and sidecar merging have one implementation.
 */
export { buildProgram } from "./cli.js";
export { loadStrategySet } from "./core/load-set.js";
export { resolveStrategyRun } from "./core/config.js";
export { RECORD_TYPES, STRATEGY_RULES } from "./types.js";
export type { StrategyFinding, StrategyRecord, StrategyReference } from "./types.js";
export { StrategyError } from "./errors.js";
