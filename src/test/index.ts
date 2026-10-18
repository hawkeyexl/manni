/**
 * The test domain's programmatic API, exported from the package as the `test`
 * namespace: `import { test } from "@hawkeyexl/manni"`. The command core, with
 * an injectable spawn, the result types and the reporters.
 */
export { TestError } from "./errors.js";
export { runTest } from "./commands/run.js";
export type { RunTestOptions, TestRunResult } from "./commands/run.js";
export { realSpawn } from "./core/doc-detective.js";
export type { DocDetectiveSpawn } from "./core/doc-detective.js";
export type { DocDetectiveResults, ResultCounts, TestFinding } from "./core/results.js";
export { renderGithub } from "./reporters/github.js";
export { renderJson } from "./reporters/json.js";
export { renderPretty } from "./reporters/pretty.js";
