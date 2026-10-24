/**
 * The strategy domain's barrel (proposal 0102). The umbrella mounts
 * `buildProgram`. Cite reads whom each page serves through `loadServing`, and
 * builds its impact roll-up with the functions beside it (proposal 0105).
 * `manni check` rolls every check's findings up through the same ones (0109).
 */
export { buildProgram } from "./cli.js";
export { RECORD_TYPES, STRATEGY_RULES } from "./types.js";
export type { StrategyFinding, StrategyRecord, StrategyReference } from "./types.js";
export { StrategyError } from "./errors.js";
export { impactLines, impactNotice, impactOf, loadServing, servesSentence } from "./core/serving.js";
export type { ImpactEntry, ImpactFinding, ServingOptions, ServingSet } from "./core/serving.js";
