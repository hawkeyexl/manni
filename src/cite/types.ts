/**
 * The citation tool's types. Proposal 0044 is the record, and stress test 25
 * the shape: an entry has two ends, `claim` and `source`, each a line range
 * and a hash, and a check classifies both with one set of rules.
 *
 * Vocabulary: a page's `citations` live in its frontmatter, or in a manifest
 * a collection declares (handed in through `CheckPageOptions.citations`). A
 * body marker, `cite <id>` in the format's comment syntax, is the other way
 * to anchor an entry's claim.
 */
import type { ValidationResult } from "../meta/index.js";
import type { CollectionConfig } from "../shared/collections.js";
import type { ConfigFile } from "../shared/config-file.js";
import type { KeySource } from "../shared/encryption-key.js";
import type { Confirm } from "../shared/prompt.js";
import type { Severity } from "../shared/severity.js";

/** A parsed `<src>` or `source`: a path or `~` ciphertext, and an optional line range. */
export interface SourceRange {
  /** Repo-root-relative posix path, or the `~` ciphertext when `encrypted`. */
  path: string;
  /** `true` when `path` is an encrypted source (`~` and 82+ base64url characters) rather than a path. */
  encrypted: boolean;
  /** 1-based, inclusive. Both absent for a whole-file citation. */
  start?: number;
  end?: number;
}

/** Lines as an entry writes them: an integer for one line, `"L1-L2"` for several. */
export type LineSpec = number | string;

/** The page text a citation supports. */
export interface CitationClaim {
  /** Body lines: counted from the first line after the frontmatter. Absent when a marker anchors the entry. */
  lines?: LineSpec;
  /** `sha256-<64 hex>` over the claimed lines, always plain. */
  integrity: string;
}

/** The lines a claim rests on. */
export interface CitationSource {
  /** Root-relative posix path, or `~` and the path encrypted with the family key. */
  file: string;
  /** File lines. Absent pins the whole file. */
  lines?: LineSpec;
  /** `sha256-<64 hex>`, or `hmac-sha256-<64 hex>` exactly when `file` is encrypted. */
  integrity: string;
  /** The git commit hash the pin was taken at: 7 to 64 lowercase hex. */
  "commit-sha"?: string;
}

/** One entry of `citations`, as the schema (`manni:citations:1.0.0-proposal.3`) spells it. */
export interface Citation {
  id?: string;
  claim?: CitationClaim;
  source: CitationSource;
  quote?: boolean;
}

/** Where an entry is kept: the page's frontmatter, or a manifest a collection declares. */
export type OriginKind = "frontmatter" | "manifest";

/** Where an entry sits. */
export interface CitationOrigin {
  kind: OriginKind;
  /** The file the entry sits in: the page for frontmatter, the manifest otherwise. */
  file: string;
  /** Line of the entry in that file. */
  line?: number;
  /** Index in the page's `citations` list. */
  index: number;
}

/**
 * One entry handed to `checkCitations` from outside the page, already merged
 * from a manifest. `entry` is the raw value and is validated as a frontmatter
 * entry is; its index is its position in the list.
 */
export interface CitationInput {
  entry: unknown;
  origin: { kind: OriginKind; file: string; line?: number };
}

/** How a citation's claim is anchored: by its lines, by a body marker, or not at all. */
export type CitationAnchor = "claim" | "marker" | null;

export type SourceStatus =
  | "current"
  | "moved"
  | "moved-ambiguous"
  | "changed"
  | "missing"
  | "never-true"
  | "skipped";

export type ClaimStatus = "current" | "moved" | "moved-ambiguous" | "changed" | "skipped";

/**
 * Why a source could not be read: not a tracked file under the root, an
 * encrypted source with no key to decrypt it, one that does not decrypt under
 * the key there is, or a tracked file that could not be read.
 */
export type MissingReason = "untracked" | "no-key" | "undecryptable" | "unreadable";

/**
 * Every rule a finding can carry, stated once. The union and the default
 * severity table are derived from this array so the three cannot disagree.
 */
export const CITE_RULES = [
  "source-moved",
  "source-moved-ambiguous",
  "source-changed",
  "source-never-true",
  "source-missing",
  "claim-moved",
  "claim-moved-ambiguous",
  "claim-changed",
  "marker-orphan",
  "marker-invalid",
  "marker-repeated",
  "anchor-invalid",
  "entry-invalid",
  "quote-drift",
] as const;
export type CiteRule = (typeof CITE_RULES)[number];

/**
 * A rule's level: the family scale (`src/shared/severity.ts`) plus `off`,
 * which drops the rule's findings altogether.
 */
export type CiteSeverity = Severity | "off";

/** The claim end of a classified citation. Line specs are `"L"` or `"L1-L2"`. */
export interface ClaimEnd {
  /** The entry's body lines. Absent when a marker anchors the claim. */
  lines?: string;
  /** Where the claim is judged, in file lines: the recorded lines, or what the marker anchors. */
  fileLines?: string;
  status: ClaimStatus;
  /** For `moved`: the new body lines. */
  newLines?: string;
  /** For `moved-ambiguous`: every candidate, in body lines. */
  candidates?: string[];
  /** For `moved`: the new file lines. Pretty-only. */
  newFileLines?: string;
  /** For `moved-ambiguous`: every candidate, in file lines. Pretty-only. */
  candidateFileLines?: string[];
  /** For `changed`: the page lines at the claim now, for `--show-diff`. Pretty-only. */
  text?: string[];
}

/** The source end of a classified citation. */
export interface SourceEnd {
  /** `file` and `lines` as the entry spells them: `path`, `path:L`, `path:L1-L2`, the ciphertext for `path`. */
  src: string;
  status: SourceStatus;
  /**
   * The path an encrypted source decrypted to. Never printed except by the
   * pretty reporter under `--reveal`; never serialized to a machine format.
   */
  resolvedPath?: string;
  /** For `missing`: why the source could not be read. Composes the message, which never names a path. */
  missingReason?: MissingReason;
  /** For `moved`: the new file lines. */
  newLines?: string;
  /** For `moved`: the new `src`, spelled as the entry spells sources. */
  newSrc?: string;
  /** For `moved-ambiguous`: every candidate `src`. */
  candidates?: string[];
  /** The commit the pin was taken at. */
  commitSha?: string;
  /** For `changed` with a commit: whether git could show that commit. */
  historyAvailable?: boolean;
  /** Subjects of commits touching the path since the commit. Pretty-only. */
  commitsSince?: string[];
  /** Unified diff of the path since the commit. Pretty-only, `--show-diff`. */
  diff?: string;
  /** The move search hit its byte budget before covering the file. */
  truncatedSearch?: boolean;
}

/** One classified citation: both ends, and how it is anchored. */
export interface CitationResult {
  citation: Citation;
  origin: CitationOrigin;
  anchor: CitationAnchor;
  /** File line of the marker that names the entry, when one does. */
  markerLine?: number;
  /**
   * File line the citation anchors to now: the claim's first line, or the
   * first line of the text a marker anchors. Where its findings sit.
   */
  anchorLine?: number;
  /** `null` for an entry with no `claim`: a bare pin, or a marker with no drift check. */
  claim: ClaimEnd | null;
  source: SourceEnd;
}

export interface CitationFinding {
  rule: CiteRule;
  /** `manni:cite/<rule>`. */
  ruleId: string;
  /** On the family scale: an `error` fails the file; a `warning` or a `notice` is reported and never does. */
  severity: Severity;
  message: string;
  /** Line the finding anchors to: in the page, or in `file` when that is set. */
  line?: number;
  /** The manifest, when the finding sits there rather than on the page. */
  file?: string;
  id?: string;
  /** The source, spelled as the entry spells it. */
  src?: string;
  newSrc?: string;
  /** Index in the page's `citations` for a finding about one entry. */
  index?: number;
}

export interface PageCitationReport {
  file: string;
  format: string;
  citations: CitationResult[];
  findings: CitationFinding[];
  /** Run-level advice, said once per run by the caller: shallow clone, root fallback. */
  notices: string[];
}

/** What `showFile` answers: the bytes, or why it could not. */
export type ShownFile = { text: string } | { missing: "commit" | "path" };

/**
 * A thin git client over `execFile("git", …)`, memoized per call shape so a
 * page with a thousand citations against one path runs one `git show`.
 */
export interface GitClient {
  available(): Promise<boolean>;
  head(): Promise<string | null>;
  /** Tracked files, posix, relative to the root. */
  lsFiles(): Promise<string[]>;
  showFile(commit: string, path: string): Promise<ShownFile>;
  subjectsSince(commit: string, path: string): Promise<string[]>;
  diffSince(commit: string, path: string): Promise<string>;
}

/**
 * The files a source may resolve to. Built from `git ls-files` when git is
 * available, else from a walk that follows no symlinks. Every entry is
 * realpath-contained in the root.
 */
export interface SourceIndex {
  files(): readonly string[];
  /** Whether `path` is a tracked file under the root. An encrypted source is decrypted first, then asked here. */
  has(path: string): boolean;
}

export interface CheckPageOptions {
  /** Absolute directory source paths resolve from. */
  root: string;
  /** Default true. False: page-side rules only; every source status is `skipped`. Claim ends are still judged. */
  checkSources?: boolean;
  /**
   * The encryption key: decrypts encrypted sources and keys their pins.
   * Absent, an encrypted citation is `missing` (no key to decrypt it).
   */
  key?: string;
  severity?: Partial<Record<CiteRule, CiteSeverity>>;
  /**
   * The git client the source index and history are read through. Defaults
   * to one over the root, which is used whenever git is on PATH and the root
   * is inside a work tree. A caller that wants no git at all passes `noGit()`.
   */
  gitClient?: GitClient;
  sourceIndex?: SourceIndex;
  /**
   * The page's citations as merged from a manifest, each with where it sits.
   * Given, the page's own frontmatter `citations` is not read. Without it, a
   * grader calling `checkCitations` on a sidecar page would find no citations.
   */
  citations?: readonly CitationInput[];
  /**
   * The manifest that owns this page's `citations`, when one does. A page
   * that carries its own anyway is `entry-invalid`, in meta's `external:owned`
   * words.
   */
  owned?: { file: string; collection: string };
}

export interface MintOptions {
  root: string;
  /** `path`, `path:L`, `path:L1-L2`, or an encrypted `~file` with the same line forms. */
  src: string;
  id?: string;
  /** The claim pin, already taken over the page lines. */
  claim?: CitationClaim;
  quote?: boolean;
  /** A commit to record; `false` records none; absent records HEAD when git has one. */
  commitSha?: string | false;
  /**
   * Write `file` encrypted and pin the lines with the keyed pin; needs `key`.
   * A source that is already encrypted stays encrypted either way.
   */
  encrypt?: boolean;
  /** The encryption key: encrypts, decrypts an encrypted source, and keys its pin. */
  key?: string;
  gitClient?: GitClient;
  sourceIndex?: SourceIndex;
}

/** One marker found in a page body: `cite <id>` in the format's comment syntax. */
export interface InlineStatement {
  /** File line of the marker. */
  line: number;
  /** File line of the anchored text: the rest of the marker's line, else the paragraph or block that follows. */
  anchorLine?: number;
  payload: { kind: "ref"; id: string } | { kind: "bad"; reason: string; json?: boolean };
  /** The marker text between the delimiters, trimmed. */
  raw: string;
  /** Character offsets of the whole marker in the file, for rewriting. */
  start: number;
  end: number;
}

/** A validated citation with where it sits and the marker that names it, before classification. */
export interface PageCitation {
  citation: Citation;
  origin: CitationOrigin;
  /** The first marker naming the entry's id. */
  marker?: InlineStatement;
}

/** What `readPage` returns: the entries, the markers, and page-side findings. */
export interface PageCitations {
  file: string;
  format: string;
  content: string;
  /** Offset where the body starts (just past the closing fence, or 0). */
  bodyOffset: number;
  /** File line of body line 1: the first line after the frontmatter, or 1. */
  bodyLine: number;
  citations: PageCitation[];
  statements: InlineStatement[];
  findings: CitationFinding[];
}

export interface CheckOptions {
  /** Positional inputs; empty means the configured collections' `paths:` (0041). */
  inputs: string[];
  /**
   * `--collection <name>`, repeatable: the collections this run covers. Empty
   * or absent means every declared one; see `selectCollections`.
   */
  collection?: string[];
  exts?: string[];
  /** `--exclude`, appended to the selected collections' `exclude:` when the run reads from them. */
  exclude?: string[];
  as?: string;
  configPath?: string;
  noConfig?: boolean;
  cwd?: string;
  stdinContent?: string;
  allowEmpty?: boolean;
  respectGitignore?: boolean;
  onNotice?: (message: string) => void;
  onConfigLoaded?: (info: { path: string; dir: string }) => void;
  baseline?: string | boolean;
  writeBaseline?: string | boolean;
  /** `--no-check-sources` (false): page-side rules only. Absent leaves `checkSources:` in charge. */
  checkSources?: boolean;
  /**
   * `--show-diff`: the report will want diffs and commit subjects. The check
   * is the same either way; the run only says, once, when git is not there
   * to give them.
   */
  showDiff?: boolean;
  root?: string;
  /**
   * The git client every page is checked through. Defaults to one over the
   * root, used whenever git is on PATH and the root is inside a work tree; a
   * test hands in a fake.
   */
  gitClient?: GitClient;
  /** Defaults to `process.env`; read for `MANNI_ENCRYPTION_KEY`. A test hands in its own. */
  env?: NodeJS.ProcessEnv;
}

export interface CheckRun {
  results: ValidationResult[];
  summary: import("../meta/index.js").RunSummary;
  frame: import("../meta/index.js").FingerprintContext;
  pages: PageCitationReport[];
  warnings: number;
  notices: number;
}

/** Page lines as an editor numbers them, 1-based and inclusive. */
export interface PageLines {
  start: number;
  end: number;
}

export interface AddOptions {
  page: string;
  /** The claim's lines as an editor numbers them (`page:L`, `page:L1-L2`). Absent: a bare pin. */
  pageLines?: PageLines;
  src: string;
  id?: string;
  /** Write a marker above the page lines instead of claim lines, and pin the text it anchors. Needs `pageLines` and `id`. */
  marker?: boolean;
  /** The page lines are a fenced block that reproduces the source. Needs `pageLines`. */
  quote?: boolean;
  /**
   * `--encrypt`: write `file` encrypted, with a keyed pin, even when no key is
   * available yet, in which case `confirm` is asked whether to generate one.
   * An available key encrypts every add without it, so `false` and absent
   * are the same.
   */
  encrypt?: boolean;
  /** `false` records no `commit-sha`. */
  commitSha?: boolean;
  dryRun?: boolean;
  as?: string;
  configPath?: string;
  noConfig?: boolean;
  cwd?: string;
  stdinContent?: string;
  root?: string;
  /**
   * The git client HEAD and the source index are read through. Defaults to
   * one over the root; a test hands in a fake.
   */
  gitClient?: GitClient;
  /** Defaults to `process.env`; read for `MANNI_ENCRYPTION_KEY`. A test hands in its own. */
  env?: NodeJS.ProcessEnv;
  onNotice?: (message: string) => void;
  onConfigLoaded?: (info: { path: string; dir: string }) => void;
  /**
   * Asked when `encrypt` needs a key and there is none; the CLI passes
   * `terminalConfirm()`. Absent, the add refuses instead of asking.
   */
  confirm?: Confirm;
}

/** The manifest half of a write: what it says now, and whether it was saved. */
export interface ManifestWrite {
  /** The manifest as the run reports it. */
  file: string;
  /** 1-based line the written entry now sits on. */
  line: number;
  /** The whole manifest, rewritten. */
  content: string;
  diff: string;
  written: boolean;
}

export interface AddResult {
  file: string;
  citation: Citation;
  /**
   * Where the entry was written: the page's frontmatter, or the manifest the
   * page's collection declares. The config decides, not a flag.
   */
  placed: "frontmatter" | "manifest";
  /** The manifest the entry went to, under `placed: "manifest"`. */
  manifest?: ManifestWrite;
  /** File lines of the claim after the write: the claim lines, or the text the marker anchors. */
  claimLines?: PageLines;
  /** File line of the marker written above the claim, under `marker`. */
  markerLine?: number;
  /** The rewritten page. */
  content: string;
  diff: string;
  written: boolean;
}

export interface UpdateOptions extends Omit<CheckOptions, "baseline" | "writeBaseline"> {
  accept?: boolean;
  only?: string[];
  dryRun?: boolean;
}

/** One end `update` rewrote. */
export interface UpdateRewrite {
  id?: string;
  /** Index in the page's `citations`. */
  index: number;
  /** File line of the entry. */
  line?: number;
  end: "claim" | "source";
  reason: "moved" | "accepted";
  /** The status that was repaired. */
  status: "moved" | "changed" | "never-true";
  /**
   * Before and after. A moved claim: its file lines. A moved source: its
   * `src`. An accepted end: its pin.
   */
  from: string;
  to: string;
  /** An accepted claim: its first file line. */
  at?: number;
  /** An accepted claim: the text now pinned, whitespace collapsed. */
  text?: string;
  /** An accepted source: its `src`. */
  src?: string;
  /** An accepted source: the commit recorded in the entry, when it records one. */
  commitSha?: string;
}

export interface UpdatePage {
  file: string;
  rewritten: UpdateRewrite[];
  skipped: CitationFinding[];
  diff: string;
  written: boolean;
  /** The rewritten page, for the stdin input only: it has no file to be written to. */
  content?: string;
}

/** One manifest a run rewrote: what changed in it, and whether it was saved. */
export interface ManifestChange {
  /** The manifest as the run reports it. */
  file: string;
  diff: string;
  written: boolean;
}

export interface UpdateRun {
  pages: UpdatePage[];
  rewritten: number;
  skipped: number;
  /** The manifests this run rewrote, each written once however many pages it holds. */
  manifests?: ManifestChange[];
  exitCode: 0 | 1;
}

/** One citation `reencryptCitations` rewrote: where it sits, and its source before and after. */
export interface ReencryptedCitation {
  id?: string;
  /** Index in `citations`. */
  index?: number;
  /** File line of the entry. */
  line?: number;
  /** `file` and its line suffix, under the old key and under the new. */
  from: string;
  to: string;
}

/** What `reencryptCitations` did to one page. */
export interface ReencryptCitationsResult {
  /** The page with every re-encrypted citation rewritten; the input itself when none was. */
  content: string;
  rewritten: ReencryptedCitation[];
  /** Citations that could not be re-encrypted, and why. A message never names a path. */
  skipped: { id?: string; index?: number; line?: number; message: string }[];
}

/**
 * Config under `cite:` in manni.config.yaml, camelCase as `meta:` is. The
 * document set is not here: proposal 0041 moved `paths` and `exclude` to the
 * family-level `collections:` list, which every tool reads. Neither is the
 * encryption key, the top-level `encryptionKey:` every tool reads (0045).
 */
export interface CiteConfig {
  allowEmpty?: boolean;
  respectGitignore?: boolean;
  root?: string;
  baseline?: string;
  checkSources?: boolean;
  severity?: Partial<Record<CiteRule, CiteSeverity>>;
}

export interface LoadedCiteConfig {
  config: CiteConfig;
  path: string;
  dir: string;
  /** The file as the user would name it, for messages. */
  source: string;
  /** The family file's top-level `collections:`, parsed by the shared layer (0041). */
  collections: CollectionConfig[];
}

/** What every command core resolves before touching a file. */
export interface CiteRun {
  config: CiteConfig | null;
  /** The positional inputs, or the selected collections' `paths:` in declaration order. */
  inputs: string[];
  /** Directory the inputs resolve from: cwd for positional inputs, the config directory for collections. */
  base: string;
  /**
   * The collections this run covers: every declared one, or the ones
   * `--collection` named. `[]` when no config governs the run.
   */
  collections: CollectionConfig[];
  /** Whether `inputs` came from the collections rather than the command line. */
  fromCollections: boolean;
  configDir?: string;
  configPath?: string;
  /** The config file as the user would name it, for messages. */
  configSource?: string;
  /** Absolute root source paths resolve from. */
  root: string;
  /**
   * The family encryption key (proposal 0045): `MANNI_ENCRYPTION_KEY`, else
   * the config's top-level `encryptionKey:`. Absent when neither is set.
   */
  key?: string;
  /** Where `key` came from. The environment wins over the config. */
  keySource: KeySource;
  /**
   * The config file that governs the run, as discovery found it. A write
   * that needs a key (`add --encrypt` with none) puts one there.
   */
  configFile?: ConfigFile;
}
