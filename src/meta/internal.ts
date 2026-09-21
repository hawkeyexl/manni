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
export { extractorByName, extractorForExtension, listFormats } from "./extractors/index.js";
// `manni cite` keeps its citations in an external-metadata manifest and is the
// first writer of one. Text in, text out; meta's own commands never call it,
// so `meta fill` and `meta query` stay read-only on manifests.
// `removeManifestKey` is the other half: `manni cite remove` takes a page's
// last citation out, and an entry left with `citations:` and nothing under it
// would be a key nobody wrote.
export {
  readManifestValue,
  removeManifestKey,
  spliceManifestValue,
} from "./core/external-metadata-write.js";
export type {
  SpliceManifestOptions,
  SplicedManifest,
} from "./core/external-metadata-write.js";
// Proposal 0047's write rule, which `manni docevals` follows for the keys it
// writes: a key a local manifest owns is written there, and a key its schema
// prefers in external metadata that no manifest owns is offered a home (P1)
// or warned about (W1, W2). `keyHome` answers where one key of one page
// lives, and a sibling builds the `RelocationContext` both it and the offer
// read from the config that sibling has already loaded.
export { keyHome } from "./core/relocation.js";
export type {
  KeyHome,
  ProposedHome,
  RelocateResult,
  RelocationContext,
} from "./core/relocation.js";
export { externalWriteWarnings, offerExternalHomes } from "./core/location-writes.js";
export type { ExternalWrite } from "./core/location-writes.js";
// `manni key rotate` re-encrypts the values a manifest supplies as well as
// the ones a page carries. `reencryptMetadata` reads a page; this is the same
// rule over metadata that is already parsed, and it skips `citations` too.
export { reencryptData } from "./core/reencrypt.js";
export type { ReencryptDataResult } from "./core/reencrypt.js";
// `manni key set` refuses to create a family file beside one of these, which
// the new file would hide from the metadata tool's discovery.
export { LEGACY_CONFIG_NAMES } from "./core/config.js";
// `meta-provenance` (proposal 0046) is written by `manni meta fill` for the
// fields it writes and by `manni docevals fill` for the evals it writes, and
// read by docevals's self-preference check beside `provenance`.
export { mergeMetaProvenance, metaProvenanceEntries } from "./core/meta-provenance.js";
export type {
  MergedMetaProvenance,
  MergedMetaProvenanceEntry,
  MetaProvenanceKey,
  MetaProvenanceProposal,
  MetaProvenanceRecord,
} from "./core/meta-provenance.js";
export { provenanceEntries } from "./core/derive/provenance.js";
export type { ProvenanceEntry } from "./core/derive/provenance.js";
// `manni cite` refuses a page whose opening fence never closes. The locator
// reads that page as having no block, which would read as no citations.
export { hasFrontmatterFence } from "./extractors/frontmatter.js";
