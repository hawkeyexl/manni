/** Programmatic API for manni tracevals. */
export * from "./types.js";
export * from "./trace/types.js";
export { detectFormat, detectContentFormat } from "./trace/detect.js";
export { parseTraceFile, parseTraceContent } from "./trace/claude.js";
export {
  availableAt,
  joinDescriptions,
  newAvailability,
  offeredNames,
} from "./trace/availability.js";
export {
  discoverTraces,
  homeDir,
  slugFor,
  type DiscoverOptions,
  type TraceListing,
} from "./trace/discover.js";
export { renderList, runList, type ListOptions, type ListRun } from "./commands/list.js";
export * from "./artifacts/types.js";
export {
  PROJECT_RULES_FILENAMES,
  resolveArtifacts,
  type ResolveOptions,
} from "./artifacts/resolve.js";
export {
  coverAvailability,
  type AvailabilityCoverage,
  type AvailabilityOptions,
} from "./artifacts/availability.js";
export {
  discoverArtifacts,
  type DiscoverOptions as DiscoverArtifactsOptions,
  type DiscoveredArtifact,
  type DiscoveryResult,
} from "./artifacts/discover.js";
export {
  PRUNED_DIRS,
  findGitRoot,
  findInTree,
  listInTree,
  safeMtime,
  safeRead,
} from "./artifacts/fs.js";
export {
  ARTIFACT_EVALS_SCHEMA_ID,
  artifactEvalsSchemaPath,
  extractEvals,
  type EvalEntry,
  type EvalType,
  type ExtractedEvals,
  type Severity,
} from "./evals/extract.js";
export {
  appendArtifactEvals,
  type EvalProvenance,
  type NewEvalEntry,
} from "./evals/write.js";
export { IMPLICIT_EVAL_NAME, planEvals, type EvalPlan } from "./core/plan.js";
export * from "./graders/types.js";
export {
  BUILTIN_GRADER_KINDS,
  graderFor,
  listGraderKinds,
  registerGrader,
} from "./graders/registry.js";
export {
  loadGraderPlugins,
  type GraderPluginApi,
  type GraderPluginRegister,
  type LoadGraderPluginsOptions,
  type LoadedGraderPlugins,
} from "./graders/plugins.js";
export { skippedWindow, windowFor, type TraceWindow } from "./graders/util.js";
export { globToRegExp, matchesGlob } from "./graders/glob.js";
export {
  WHEN_CONDITIONS,
  evaluateWhen,
  validateWhen,
  type TriggerResult,
  type WhenCondition,
} from "./graders/when.js";
export { renderTrace, type RenderOptions } from "./judge/render.js";
export {
  CUSTOM_PLACEHOLDER,
  REDACTION_PATTERNS,
  compileRedactPatterns,
  makeRedactor,
  type RedactionPattern,
  type Redactor,
} from "./judge/redact.js";
export {
  JUDGE_SYSTEM_PROMPT,
  PROMPT_VERSION,
  buildUserContent,
} from "./judge/prompt.js";
export { cacheKey, sha256 } from "./judge/cache.js";
export {
  makeTraceJudge,
  type JudgedEval,
  type TraceJudge,
  type TraceJudgeOptions,
} from "./judge/trace-judge.js";
export {
  makeJudgeProvider,
  providerSpecFor,
  type MockResponse,
} from "./judge/provider.js";
export {
  CONFIG_SECTION_KEY,
  DEFAULT_CONFIG_FILENAME,
  loadConfig,
  parseConfig,
  type TracevalsConfig,
  type Pricing,
  type ProviderConfig,
} from "./core/config.js";
export { runEvals, type EngineOptions } from "./core/engine.js";
export {
  render,
  renderBatch,
  renderCalibration,
  type ReportFormat,
} from "./reporters/index.js";
export { renderBatchHuman, renderBatchMarkdown } from "./reporters/batch.js";
export {
  renderCalibrationHuman,
  renderCalibrationMarkdown,
} from "./reporters/calibration.js";
export { aggregate, type BatchOutcome } from "./aggregate.js";
export {
  prepareRun,
  runOne,
  runRun,
  type RunCommandOptions,
  type RunCommandResult,
  type RunContext,
  type RunSharedOptions,
} from "./commands/run.js";
export {
  parseSince,
  resolveBatchTraces,
  runBatch,
  type BatchCommandOptions,
  type BatchCommandResult,
} from "./commands/batch.js";
export {
  runCalibrate,
  type CalibrateCommandOptions,
  type CalibrateCommandResult,
} from "./commands/calibrate.js";
export * from "./calibrate/types.js";
export {
  DEFAULT_LABELS_FILE,
  labelKey,
  loadLabels,
  parseLabels,
} from "./calibrate/labels.js";
export {
  classify,
  joinLabels,
  rescore,
  score,
  type JoinedLabel,
  type AmbiguousLabel,
  type JoinResult,
  type Rescored,
  type ScoreInput,
  type ScoreResult,
} from "./calibrate/score.js";
export {
  renderFill,
  runFill,
  type FillArtifactResult,
  type FillOptions,
  type FillReport,
  type FillRun,
  type FillStatus,
  type SharpeningNote,
} from "./commands/fill.js";
export {
  ALLOWED_GRADERS,
  gateProposals,
  type GateOptions,
  type GateResult,
  type ProposedEval,
  type Rejection,
  type RejectionReason,
  type Vocabulary,
} from "./fill/gate.js";
export {
  FILL_PROMPT_VERSION,
  MAX_BODY_CHARS,
  PROPOSAL_SCHEMA,
  buildFillUser,
  isValidProposal,
  systemPromptFor,
} from "./fill/prompt.js";
export { FillCache, fillCacheKey, type FillCacheKeyParts } from "./fill/cache.js";
export { artifactFacts, type ArtifactFacts } from "./fill/facts.js";
export { BUILTIN_TOOLS, buildVocabulary } from "./fill/vocabulary.js";
export { mockFillProposal } from "./fill/mock.js";
export { pickTrace, type PickerChoice, type PromptFn } from "./trace/picker.js";
export {
  appendHistory,
  compareToLast,
  entryFor,
  loadHistory,
  type HistoryComparison,
  type HistoryEntry,
  type HistoryEval,
} from "./history.js";
export * from "./capture/types.js";
export {
  checkContent,
  findManifest,
  hashFile,
  manifestPathFor,
  readManifest,
  relPosix,
  safeSessionId,
  sha256Hex,
  siblingManifestPath,
  writeManifest,
  type FindManifestOptions,
  type FoundManifest,
} from "./capture/manifest.js";
export {
  buildManifest,
  deviceId,
  readGit,
  redactDeep,
  type BuildManifestOptions,
} from "./capture/build.js";
export { parseHookPayload, readStdin, type HookPayload } from "./capture/hook.js";
export {
  renderCapture,
  runCapture,
  type CaptureCommandOptions,
  type CaptureCommandResult,
} from "./commands/capture.js";
