/**
 * The term domain's barrel (proposal 0052 § The programmatic API). The umbrella
 * mounts `buildProgram`; nothing outside the domain imports anything else.
 */
export { buildProgram } from "./cli.js";
export { TERM_RULES } from "./types.js";
export type { Term, TermReader, TermWriter } from "./types.js";
export { TermError } from "./errors.js";
