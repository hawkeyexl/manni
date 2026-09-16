/** Programmatic API for manni lint. */
import { clearTemplateCaches } from "./core/template-registry.js";
import { clearMatcherCache } from "./core/resolve-template.js";
import { clearPatternCache } from "./rules/index.js";

/**
 * Drop every process-lifetime cache: parsed built-ins, fetched template files,
 * compiled override globs, and compiled heading patterns.
 *
 * A CLI run never needs this - it lints one docset and exits, and the caches
 * are what stop a tree of one doctype from re-reading the same template per
 * page. A long-lived host is the different case: the maps grow with the number
 * of distinct refs and patterns seen, and a cached remote template is served
 * for the life of the process, so one republished upstream is never picked up.
 * Call this between runs, or when a template may have changed underneath.
 */
export function clearCaches(): void {
  clearTemplateCaches();
  clearMatcherCache();
  clearPatternCache();
}

export { runLint, STDIN_LABEL } from "./commands/lint.js";
export type {
  LintOptions,
  LintRun,
  LintSummary,
  LintFileResult,
} from "./commands/lint.js";
export { runTemplates, BUILTIN_SOURCE } from "./commands/templates.js";
export type {
  TemplateInfo,
  TemplatesInfo,
  TemplatesOptions,
} from "./commands/templates.js";
export { runTools, BUILT_IN_DEFAULTS } from "./commands/tools.js";
export type { FormatInfo, ToolInfo, ToolsOptions } from "./commands/tools.js";
export {
  LINT_JOBS,
  LINT_TOOLS,
  TOOLS_BY_JOB,
  isLintTool,
  loadConfig,
  parseConfig,
  rebaseConfig,
  resolveLintRun,
} from "./core/config.js";
export type {
  LintConfig,
  LintJob,
  LintJobConfig,
  LintRunOptions,
  LintTool,
  ResolvedLintRun,
} from "./core/config.js";
export { validateDocument, validateSections } from "./core/validator.js";
export { matchSections } from "./core/match.js";
export type { Match, MatchResult } from "./core/match.js";
export { headingMatches, isRequired, isSlot } from "./core/template.js";
export type {
  Template,
  TemplateFile,
  TemplateSection,
} from "./core/template.js";
export {
  listBuiltins,
  loadTemplate,
  loadTemplateFile,
  resolveExtends,
  classifyRef,
} from "./core/template-registry.js";
export type {
  BuiltinInfo,
  LoadTemplateOptions,
  RefKind,
  TemplateResolver,
} from "./core/template-registry.js";
// Targets resolve through the family's walker (`src/meta/internal.ts`), which
// is what makes `--ext`, `--exclude`, `.gitignore` handling and `--allow-empty`
// mean the same thing here as they do for `meta` and `cite`.
export { STDIN_TOKEN } from "../meta/internal.js";
export {
  listFormats,
  parserByName,
  parserForExtension,
  supportedExtensions,
} from "./parsers/index.js";
export {
  render,
  renderPretty,
  renderJson,
  renderGithub,
  renderTemplates,
  renderTools,
} from "./reporters/index.js";
export type {
  ReportFormat,
  ReportOptions,
  ListFormat,
} from "./reporters/index.js";
export { palette, shouldColor } from "./reporters/color.js";
export * from "./types.js";
