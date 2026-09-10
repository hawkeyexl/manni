/** Programmatic API for docmeta. */
export { runValidate } from "./commands/validate.js";
export type { ValidateOptions, ValidateRun } from "./commands/validate.js";
export { runGet } from "./commands/get.js";
export type { GetOptions, GetFileResult } from "./commands/get.js";
export { runQuery } from "./commands/query.js";
export type { QueryChange, QueryOptions, QueryRun } from "./commands/query.js";
export {
  getSchemasInfo,
  runVendorSchema,
  vendorFileName,
  DEFAULT_VENDOR_DIR,
} from "./commands/schemas.js";
export type { VendorOptions, VendorResult } from "./commands/schemas.js";
export { runFill } from "./commands/fill.js";
export { runDerive } from "./commands/derive.js";
export type {
  DeriveOptions,
  DeriveRun,
  DeriveFileResult,
  DeriveSummary,
} from "./commands/derive.js";
export type {
  FillOptions,
  FillRun,
  FillFileResult,
  FillSummary,
  FilledField,
  SkipReason,
} from "./commands/fill.js";
export { Validator } from "./core/validator.js";
export {
  resolveSchemaSet,
  collectSchemaPins,
  schemaEntryRef,
  rebaseConfigSchemaRefs,
  DEFAULT_SCHEMAS,
} from "./core/resolve-schema.js";
export { loadConfig, parseConfig, resolveRunConfig } from "./core/config.js";
export type {
  CheckConfig,
  SidecarConfig,
  DeriveConfig,
  DeriveCommandConfig,
  ConfigNotice,
  DocmetaConfig,
  DocumentRefTrust,
  FillConfig,
  LoadedConfig,
  RunConfig,
  RunConfigOptions,
  SchemaCacheConfig,
  SchemaEntry,
  SchemaRefEntry,
  SchemaTrustConfig,
} from "./core/config.js";
export {
  listBuiltins,
  loadSchema,
  fetchSchemaBytes,
  classifyRef,
  schemaLoadOptions,
} from "./core/schema-registry.js";
export type {
  FetchedSchema,
  LoadSchemaOptions,
  SchemaPin,
} from "./core/schema-registry.js";
export { integrityOf, isIntegrity, INTEGRITY_SHAPE } from "./core/integrity.js";
export {
  loadSidecars,
  mergeSidecars,
  orphanEntries,
  orphanJoins,
  orphanError,
  sidecarJoin,
  sidecarPointer,
  PATH_JOIN,
  SIDECAR_DUPLICATE_SCHEMA,
  SIDECAR_OWNED_SCHEMA,
  SIDECAR_KEYWORD,
} from "./core/sidecars.js";
export {
  fetchSidecar,
  sidecarUrlProblem,
  SIDECAR_FETCH_TIMEOUT_MS,
  SIDECAR_FETCH_MAX_BYTES,
} from "./core/sidecar-fetch.js";
export type { SidecarFetchOptions } from "./core/sidecar-fetch.js";
export {
  compareDerived,
  staleFindings,
  isBuiltinField,
  isDeriveSource,
  DERIVABLE_FIELDS,
  DERIVE_SOURCES,
  DERIVED_STALE_SCHEMA,
  DERIVED_KEYWORD,
} from "./core/derive/types.js";
export type {
  BuiltinDerivableField,
  DerivableField,
  DeriveCommand,
  DeriveSource,
  DerivedValue,
  DerivedRecord,
  DerivedField,
  DerivedStatus,
  DeriveInput,
  DeriveContext,
  ReviewClient,
  RemoteIdentity,
  Approval,
  MergedChange,
  SourceStatus,
} from "./core/derive/types.js";
export {
  deriveMetadata,
  consultedSources,
  sourcesFor,
  assertSourcesAvailable,
  FIELD_SOURCES,
} from "./core/derive/index.js";
export type { DeriveResult } from "./core/derive/index.js";
export {
  deriveFromCommands,
  PATH_PLACEHOLDER,
  isPerFile,
  argvFor,
  valueOf,
} from "./core/derive/command.js";
export type { CommandSourceOptions, CommandSourceResult } from "./core/derive/command.js";
export {
  GitHubClient,
  GitLabClient,
  createReviewClient,
  deriveFromReviews,
  parseOriginUrl,
  identityFromOrigin,
} from "./core/derive/reviews.js";
export type {
  ReviewSourceInput,
  ReviewFacts,
  ReviewSourceResult,
} from "./core/derive/reviews.js";
export { run, BinMissing } from "./core/derive/spawn.js";
export type { Run, SpawnOptions } from "./core/derive/spawn.js";
export {
  ReviewCache,
  cachedClient,
  REVIEW_CACHE_DIR,
  REVIEW_CACHE_VERSION,
} from "./core/derive/cache.js";
export type {
  SidecarIndex,
  SidecarEntry,
  SidecarValue,
  MergedMetadata,
  SidecarCollision,
  SidecarJoin,
  SourceLocation,
  LoadSidecarsOptions,
} from "./core/sidecars.js";
export {
  SchemaCache,
  SCHEMA_CACHE_DIR,
  SCHEMA_CACHE_VERSION,
  DEFAULT_TTL_HOURS,
  schemaCacheDir,
} from "./core/schema-cache.js";
export type { ReadOptions, SchemaCacheEntry } from "./core/schema-cache.js";
export {
  COMMON_FORMATS,
  QUERY_FORMATS,
  REPORT_FORMATS,
  isCommonFormat,
  isQueryFormat,
  isReportFormat,
  render,
  renderJunit,
  renderSarif,
} from "./reporters/index.js";
export type {
  CommonFormat,
  JunitOptions,
  QueryFormat,
  ReportFormat,
  ReportOptions,
  SarifOptions,
} from "./reporters/index.js";
// `ValidateRun.frame` is typed with this, so a caller passing the frame back
// into `render` needs to be able to name it.
export type { FingerprintContext } from "./core/baseline.js";
export {
  FILL_FORMATS,
  isFillFormat,
  renderFill,
  renderFillGithub,
} from "./reporters/fill.js";
export type { FillReportFormat, FillReportOptions } from "./reporters/fill.js";
export { DERIVE_FORMATS, isDeriveFormat, renderDerive } from "./reporters/derive.js";
export type { DeriveReportFormat, DeriveReportOptions } from "./reporters/derive.js";
// `stringifyValue` alongside `renderGet`: a caller building its own loop over
// `runGet` results needs the same `(unset)`-and-JSON formatting the CLI uses,
// and deriving it a second time is how two spellings of one rule start.
export { renderGet, stringifyValue } from "./reporters/get.js";
export type { GetReportOptions } from "./reporters/get.js";
export { renderQuery, renderQueryCsv } from "./reporters/query.js";
export type { QueryReportOptions } from "./reporters/query.js";
export {
  extractFrontmatter,
  locateFrontmatter,
  frontmatterInnerText,
} from "./extractors/frontmatter.js";
export type { FrontmatterLocation } from "./extractors/frontmatter.js";
export { applyFrontmatter } from "./extractors/frontmatter-write.js";
export { writeFileAtomic } from "./core/write-file.js";
export {
  extractorForExtension,
  supportedExtensions,
} from "./extractors/index.js";
export * from "./types.js";
