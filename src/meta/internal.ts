/**
 * Family-internal. Sibling tools import this and ../meta/index.js only;
 * nothing here is public API.
 *
 * `src/index.ts` re-exports `./meta/index.js` and not this file, so a consumer
 * of the package cannot reach any of it. What lives here is the plumbing a
 * sibling tool needs to run the same pipeline shape as `meta validate` — the
 * target walk, the baseline ratchet, the reporter escapes — without reaching
 * into `core/`, `extractors/` or `reporters/` directly. An eslint rule keeps
 * those paths closed to `src/<tool>/`, so this barrel is the one door, and a
 * change to anything behind it shows up as a change to this file.
 */
export {
  assertNonEmpty,
  gitignoreOptions,
  resolveTargetSet,
  resolveTargets,
  STDIN_LABEL,
  STDIN_TOKEN,
} from "./core/load-files.js";
export type {
  NonEmptyParams,
  ResolveOptions,
  ResolvedTargets,
} from "./core/load-files.js";
export {
  DEFAULT_BASELINE_PATH,
  applyBaseline,
  buildBaseline,
  countFingerprints,
  diffBaselines,
  fingerprint,
  readBaseline,
  resolveBaselineRequest,
  settleBaseline,
  writeBaselineFile,
} from "./core/baseline.js";
export type {
  AppliedBaseline,
  Baseline,
  BaselineDefaults,
  BaselineFlags,
  BaselineRequest,
  Fingerprintable,
} from "./core/baseline.js";
export {
  escapeWorkflowCommandMessage,
  escapeWorkflowCommandProperty,
} from "./reporters/github.js";
export { fieldLabel, ruleIdFor } from "./reporters/rule-id.js";
export {
  COMMON_FORMAT_LIST,
  MACHINE_FORMATS,
  OMITTED_WHEN_CLEAN,
  REPORT_FORMAT_LIST,
  formatList,
  isMachineFormat,
} from "./reporters/index.js";
export { extractorByName, listFormats } from "./extractors/index.js";
// `manni cite` keeps its citations in an external-metadata manifest and is the
// first writer of one. Text in, text out; meta's own commands never call it,
// so `meta fill` and `meta query` stay read-only on manifests.
export { spliceManifestValue } from "./core/external-metadata-write.js";
export type {
  SpliceManifestOptions,
  SplicedManifest,
} from "./core/external-metadata-write.js";
// `manni key set` refuses to create a family file beside one of these, which
// the new file would hide from the metadata tool's discovery.
export { LEGACY_CONFIG_NAMES } from "./core/config.js";
