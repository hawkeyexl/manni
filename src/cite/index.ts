/**
 * The citation tool's programmatic API, exported from the package as the
 * `cite` namespace: `import { cite } from "@hawkeyexl/manni"`.
 */
export * from "./types.js";
export { CiteError } from "./errors.js";
export { DEFAULT_SEVERITY, RULE_ID_PREFIX, isCiteRule, resolveSeverity, ruleId } from "./core/severity.js";
export {
  FILE_PATTERN,
  SRC_PATTERN,
  formatSrc,
  lineSpec,
  parseLines,
  parseSrc,
  rangeLines,
  sourceRange,
  spellLines,
  spellSource,
} from "./core/range.js";
export { hashLines, hashRange, isKeyedPin, normalizeText, sliceLines, splitLines } from "./core/hash.js";
export { shortCommit, shortPin, shortSrc } from "./core/spell.js";
export { buildSourceIndex, readSource } from "./core/sources.js";
export type { BuildIndexOptions, ReadSourceResult } from "./core/sources.js";
export {
  anchoredLines,
  detectEol,
  fenceSpanAt,
  fencedBlockAfter,
  fencedBlockAt,
  fencedBlocks,
  formatStatement,
  insideFence,
  lineAt,
  offsetOfLine,
  paragraphAfter,
  parseStatements,
  statementForms,
} from "./core/statements.js";
export type { StatementForm } from "./core/statements.js";
export {
  blockMatches,
  claimEnd,
  claimLine,
  markerUnit,
  normalizeWhitespace,
  pinOfLines,
  toBodyLines,
  toFileLines,
  unitAt,
} from "./core/claims.js";
export type { ClaimUnit } from "./core/claims.js";
export { GIT_UNAVAILABLE_COMMIT, GIT_UNAVAILABLE_HISTORY, gitClient, noGit } from "./core/git.js";
export { MAX_RANGE_LINES, MOVE_BUDGET_BYTES, MOVE_WINDOW_LINES, classifyCitation, findWindows, historyOf } from "./core/classify.js";
export type { ClassifyOptions, FindWindowsOptions, History } from "./core/classify.js";
export {
  MARKER_JSON,
  MAX_MARKERS_PER_PAGE,
  bodyLineOf,
  ownedMessage,
  pickExtractor,
  readPage,
  validateEntry,
} from "./core/page.js";
export {
  CITATIONS_KEY,
  duplicateJoinRefusal,
  loadCitationSidecars,
  orphanRefusal,
  sidecarsFor,
  twoManifestsRefusal,
  urlManifestRefusal,
} from "./core/sidecar.js";
export type {
  CitationManifest,
  CitationSidecars,
  LoadSidecarOptions,
  PageSidecar,
} from "./core/sidecar.js";
export { ManifestSet, itemLine, splice } from "./core/manifest.js";
export type { HeldManifest } from "./core/manifest.js";
export type { ReadPageOptions } from "./core/page.js";
export { checkCitations } from "./core/check-page.js";
export { claimMessageFor, errorSite, findingsFor, messageFor, toValidationResult } from "./core/adapt.js";
export { appendFrontmatterCitation, entryObject, insertStatementBefore, spliceEntryField, unifiedDiff } from "./core/write.js";
export type { EntryPath } from "./core/write.js";
export { mintCitation } from "./core/mint.js";
export { CITE_SECTION, DEFAULT_CITE_BASELINE_PATH, loadCiteConfig, parseCiteConfig, readCiteConfigFile, resolveCiteRun } from "./core/config.js";
export type { CiteRunOptions } from "./core/config.js";

export { runCheck } from "./commands/check.js";
export { runAdd } from "./commands/add.js";
export { runUpdate } from "./commands/update.js";
export { reencryptCitationEntries, reencryptCitations } from "./core/reencrypt.js";
export type { ReencryptEntriesResult, ReencryptOptions } from "./core/reencrypt.js";
export { renderCheckPretty, renderUpdatePretty, rewriteLine } from "./reporters/pretty.js";
export type { PrettyOptions } from "./reporters/pretty.js";
export { renderCheckJson, renderUpdateJson } from "./reporters/json.js";
export { renderCheckGithub } from "./reporters/github.js";
