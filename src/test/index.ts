/**
 * The test domain's programmatic API, exported from the package as the `test`
 * namespace: `import { test } from "@hawkeyexl/manni"`. The command core, with
 * an injectable spawn, the result types and the reporters.
 */
export { TestError } from "./errors.js";
export { runProcedures } from "./commands/procedures.js";
export type { RunProceduresOptions, ProceduresResult } from "./commands/procedures.js";
export { realSpawn } from "./core/doc-detective.js";
export type { DocDetectiveSpawn } from "./core/doc-detective.js";
export type { DocDetectiveResults, ResultCounts, TestFinding } from "./core/results.js";
export { renderGithub } from "./reporters/github.js";
export { renderJson } from "./reporters/json.js";
export { renderPretty } from "./reporters/pretty.js";
export { runTasks } from "./commands/tasks.js";
export type { RunTasksOptions, TasksReport, TaskRun, TaskEval } from "./commands/tasks.js";
export { realClaudeCodeSpawn } from "./core/claude-code.js";
export type { ClaudeCodeSpawn } from "./core/claude-code.js";
export { renderTasks } from "./reporters/tasks.js";
