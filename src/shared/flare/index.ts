/** MadCap Flare projects (proposal 0125): conditions, variables, targets and the project a page belongs to. */
export {
  type ConditionExpression,
  type TagExpression,
  includes,
  parseConditionExpression,
  parseConditionTags,
} from "./conditions.js";
export {
  type FlareProject,
  type FlareRun,
  FlareError,
  findProjectRoot,
  flareRun,
} from "./project.js";
export { type FlareTarget, readTarget } from "./target.js";
export {
  type FlareVariable,
  type VariableSets,
  lookupVariable,
  readVariableSets,
  resolveText,
  resolveVariable,
} from "./variables.js";
