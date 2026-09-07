/**
 * The citation tool's programmatic API, exported from the package as the
 * `cite` namespace: `import { cite } from "@hawkeyexl/manni"`.
 */
export * from "./types.js";
export { CiteError } from "./errors.js";
export { DEFAULT_SEVERITY, RULE_ID_PREFIX, isCiteRule, resolveSeverity, ruleId } from "./core/severity.js";
export { SRC_PATTERN, formatSrc, isObfuscatedToken, parseSrc } from "./core/range.js";
export { hashLines, hashRange, normalizeText, sliceLines, splitLines } from "./core/hash.js";
export { buildSourceIndex, obfuscatePath, readSource } from "./core/sources.js";
export type { BuildIndexOptions, ReadSourceResult } from "./core/sources.js";
export { detectEol, fencedBlockAfter, fencedBlockAt, fencedBlocks, formatStatement, lineAt, offsetOfLine, paragraphAfter, parseStatements, statementForms } from "./core/statements.js";
export type { StatementForm } from "./core/statements.js";
export { blockMatches, findClaim, normalizeWhitespace, paragraphContains } from "./core/claims.js";
export type { ClaimHit } from "./core/claims.js";
export { gitClient, noGit } from "./core/git.js";
export { MAX_RANGE_LINES, MOVE_BUDGET_BYTES, MOVE_WINDOW_LINES, classifyCitation, findWindows } from "./core/classify.js";
export type { ClassifyOptions, FindWindowsOptions } from "./core/classify.js";
export { MAX_STATEMENTS_PER_PAGE, pageCommit, readPage, validateEntry } from "./core/page.js";
export type { ReadPageOptions } from "./core/page.js";
export { checkCitations } from "./core/check-page.js";
export { findingsFor, messageFor, toValidationResult } from "./core/adapt.js";
export { appendFrontmatterCitation, insertStatementBefore, replaceStatement, spliceEntryField, unifiedDiff } from "./core/write.js";
export { mintCitation } from "./core/mint.js";
export { CITE_SECTION, DEFAULT_CITE_BASELINE_PATH, SALT_ENV, loadCiteConfig, parseCiteConfig, resolveCiteRun } from "./core/config.js";
export type { CiteRunOptions } from "./core/config.js";
export { runCheck } from "./commands/check.js";
export { runAdd } from "./commands/add.js";
export { runUpdate } from "./commands/update.js";
export { renderCheckPretty, renderUpdatePretty } from "./reporters/pretty.js";
export type { PrettyOptions } from "./reporters/pretty.js";
export { renderCheckJson, renderUpdateJson } from "./reporters/json.js";
export { renderCheckGithub } from "./reporters/github.js";
