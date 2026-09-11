/**
 * The citation tool's types. Proposal 0044 is the record; the plan that
 * preceded it fixed these shapes before any module was written, so every
 * chunk codes against the same contract.
 *
 * Vocabulary: a page carries `citations` (frontmatter) and inline `cite`
 * statements (body). Both channels hold the same entry shape. A check hashes
 * the cited lines, compares the pin, and classifies each entry.
 */
import type { ValidationResult } from "../meta/index.js";
import type { CollectionConfig } from "../shared/collections.js";
import type { ConfigFile } from "../shared/config-file.js";
import type { KeySource } from "../shared/encryption-key.js";
import type { Confirm } from "../shared/prompt.js";

/** A parsed `src`: `path`, `path:L`, `path:L1-L2`, or an encrypted `~source[:…]`. */
export interface SourceRange {
  /** Repo-root-relative posix path, or the `~` ciphertext when `encrypted`. */
  path: string;
  /** `true` when `path` is an encrypted source (`~` and 82+ base64url characters) rather than a path. */
  encrypted: boolean;
  /** 1-based, inclusive. Both absent for a whole-file citation. */
  start?: number;
  end?: number;
}

/** One entry of `citations`, or the object payload of an inline statement. */
export interface Citation {
  src: string;
  /** `sha256-<64 hex>`: over the cited lines, or the keyed pin (an HMAC under the encryption key) when `src` is encrypted. */
  integrity: string;
  commit?: string;
  id?: string;
  claim?: string;
  quote?: boolean;
}

/** Where a citation was read from, and where it anchors in the body. */
export type CitationOrigin =
  | {
      kind: "frontmatter";
      /** Index in `citations`. */
      index: number;
      /** File line of the entry (`lineFor("/citations/N")`). */
      line?: number;
      /** File line the claim or reference statement anchors to. */
      anchorLine?: number;
    }
  | {
      kind: "inline";
      /** File line of the statement. */
      line: number;
      anchorLine?: number;
    };

export type CitationStatus =
  | "current"
  | "moved"
  | "moved-ambiguous"
  | "changed"
  | "missing"
  | "never-true"
  | "skipped";

/**
 * Why a source could not be read: not a tracked file under the root, an
 * encrypted source with no key to decrypt it, one that does not decrypt under
 * the key there is, or a tracked file that could not be read.
 */
export type MissingReason = "untracked" | "no-key" | "undecryptable" | "unreadable";

/**
 * Every rule a finding can carry, stated once. The union and the default
 * severity table below are derived from this array so the three cannot
 * disagree.
 */
export const CITE_RULES = [
  "current",
  "moved",
  "moved-ambiguous",
  "changed",
  "missing",
  "never-true",
  "claim-missing",
  "claim-ambiguous",
  "statement-orphan",
  "statement-invalid",
  "entry-invalid",
  "quote-drift",
] as const;
export type CiteRule = (typeof CITE_RULES)[number];

export type CiteSeverity = "error" | "warning" | "off";

/** The result of classifying one citation against its source. */
export interface CitationResult {
  citation: Citation;
  origin: CitationOrigin;
  status: CitationStatus;
  /**
   * The path an encrypted source decrypted to. Never printed except by
   * the pretty reporter under `--reveal`; never serialized to a machine
   * format. Output spells a source exactly as the page spelled it.
   */
  resolvedPath?: string;
  /** For `missing`: why the source could not be read. Composes the message, which never names a path. */
  missingReason?: MissingReason;
  /** For `moved`: the new `src`, spelled as the page spells sources. */
  newSrc?: string;
  /** For `moved-ambiguous`: every candidate `src`. */
  candidates?: string[];
  /** The commit the pin was minted at (entry or page default). */
  commit?: string;
  /** For `changed` with a commit: whether git could show that commit. */
  historyAvailable?: boolean;
  /** Subjects of commits touching the path since `commit`. Pretty-only. */
  commitsSince?: string[];
  /** Unified diff of the path since `commit`. Pretty-only, `--show-diff`. */
  diff?: string;
  /** The move search hit its byte budget before covering the file. */
  truncatedSearch?: boolean;
}

export interface CitationFinding {
  rule: CiteRule;
  /** `manni:cite/<rule>`. */
  ruleId: string;
  severity: "error" | "warning";
  message: string;
  /** File line the finding anchors to. */
  line?: number;
  id?: string;
  /** Spelled as the page spelled it. */
  src?: string;
  newSrc?: string;
  /** Index in `citations` for a frontmatter entry. */
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
 * page with a thousand statements against one path runs one `git show`.
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
 * The files a `src` may resolve to. Built from `git ls-files` when git is
 * available, else from a walk that follows no symlinks. Every entry is
 * realpath-contained in the root.
 */
export interface SourceIndex {
  files(): readonly string[];
  /** Whether `path` is a tracked file under the root. An encrypted source is decrypted first, then asked here. */
  has(path: string): boolean;
}

export interface CheckPageOptions {
  /** Absolute directory `src:` paths resolve from. */
  root: string;
  /** Default true. False: no never-true, no history, no subjects. */
  git?: boolean;
  /** Default true. False: page-side rules only; every source status is `skipped`. */
  sources?: boolean;
  /**
   * The encryption key: decrypts encrypted sources and keys their pins.
   * Absent, an encrypted citation is `missing` (no key to decrypt it).
   */
  key?: string;
  severity?: Partial<Record<CiteRule, CiteSeverity>>;
  gitClient?: GitClient;
  sourceIndex?: SourceIndex;
}

export interface MintOptions {
  root: string;
  src: string;
  claim?: string;
  id?: string;
  quote?: boolean;
  /** A commit to record; `false` records none; absent records HEAD when git has one. */
  commit?: string | false;
  /**
   * Write `src` encrypted and pin the lines with the keyed pin; needs `key`.
   * A `src` that is already encrypted stays encrypted either way.
   */
  encrypt?: boolean;
  /** The encryption key: encrypts, decrypts an encrypted `src`, and keys its pin. */
  key?: string;
  gitClient?: GitClient;
  sourceIndex?: SourceIndex;
}

/** One inline statement found in a page body. */
export interface InlineStatement {
  /** File line of the statement. */
  line: number;
  /** File line of the anchored paragraph or fenced block, when one follows. */
  anchorLine?: number;
  payload:
    | { kind: "ref"; id: string }
    | { kind: "entry"; entry: unknown }
    | { kind: "bad"; reason: string };
  /** The statement text between the delimiters, trimmed. */
  raw: string;
  /** Character offsets of the whole statement in the file, for rewriting. */
  start: number;
  end: number;
}

/** A citation with the channel it came from, before classification. */
export interface PageCitation {
  citation: Citation;
  origin: CitationOrigin;
}

/** What `readPage` returns: both channels, plus page-side findings. */
export interface PageCitations {
  file: string;
  format: string;
  content: string;
  /** Offset where the body starts (just past the closing fence, or 0). */
  bodyOffset: number;
  /** The page-level `citation-commit`, already applied to entries without their own. */
  commit?: string;
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
  git?: boolean;
  sources?: boolean;
  root?: string;
  /** Defaults to `process.env`; read for `MANNI_ENCRYPTION_KEY`. A test hands in its own. */
  env?: NodeJS.ProcessEnv;
}

export interface CheckRun {
  results: ValidationResult[];
  summary: import("../meta/index.js").RunSummary;
  frame: import("../meta/index.js").FingerprintContext;
  pages: PageCitationReport[];
  warnings: number;
}

export interface AddOptions {
  page: string;
  src: string;
  claim?: string;
  id?: string;
  quote?: boolean;
  inline?: boolean;
  /**
   * `--encrypt`: write `src` encrypted, with a keyed pin, even when no key is
   * available yet, in which case `confirm` is asked whether to generate one.
   * An available key encrypts every add without it, so `false` and absent
   * are the same.
   */
  encrypt?: boolean;
  /** `false` records no commit. */
  commit?: boolean;
  dryRun?: boolean;
  as?: string;
  configPath?: string;
  noConfig?: boolean;
  cwd?: string;
  stdinContent?: string;
  root?: string;
  /** Default true. False: no HEAD recorded, and sources indexed by a directory walk. */
  git?: boolean;
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

export interface AddResult {
  file: string;
  citation: Citation;
  placed: "frontmatter" | "inline";
  /** File line of the claim or block the citation anchors to. */
  anchorLine?: number;
  /** File line of the reference statement written above the anchor, if any. */
  referenceLine?: number;
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

export interface UpdateRewrite {
  id?: string;
  index?: number;
  line?: number;
  from: string;
  to: string;
  reason: "moved" | "accepted";
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

export interface UpdateRun {
  pages: UpdatePage[];
  rewritten: number;
  skipped: number;
  exitCode: 0 | 1;
}

/** One citation `reencryptCitations` rewrote: where it sits, and its `src` before and after. */
export interface ReencryptedCitation {
  id?: string;
  /** Index in `citations` for a frontmatter entry. */
  index?: number;
  /** File line of the entry or statement. */
  line?: number;
  /** The whole `src`, line suffix included, under the old key and under the new. */
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
  git?: boolean;
  sources?: boolean;
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
  /** Absolute root `src:` paths resolve from. */
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
