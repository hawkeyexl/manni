/**
 * The strategy domain's barrel (proposal 0102). The umbrella mounts
 * `buildProgram`; nothing outside the domain imports anything else.
 */
export { buildProgram } from "./cli.js";
export { RECORD_TYPES, STRATEGY_RULES } from "./types.js";
export type { StrategyFinding, StrategyRecord, StrategyReference } from "./types.js";
export { StrategyError } from "./errors.js";
