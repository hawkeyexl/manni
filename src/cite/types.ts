/**
 * The citation tool's types. Proposal 0042 is the record; the plan that
 * preceded it fixed these shapes before any module was written, so every
 * chunk codes against the same contract.
 *
 * Vocabulary: a page carries `citations` (frontmatter) and inline `cite`
 * statements (body). Both channels hold the same entry shape. A check hashes
 * the cited lines, compares the pin, and classifies each entry.
 */
import type { ValidationResult } from "../meta/index.js";
import type { CollectionConfig } from "../shared/collections.js";

/** A parsed `src`: `path`, `path:L`, `path:L1-L2`, or `~token[:…]`. */
export interface SourceRange {
  /** Repo-root-relative posix path, or the `~token` when `obfuscated`. */
  path: string;
  /** `true` when `path` is a `~<16 hex>` token rather than a path. */
  obfuscated: boolean;
  /** 1-based, inclusive. Both absent for a whole-file citation. */
  start?: number;
  end?: number;
}

/** One entry of `citations`, or the object payload of an inline statement. */
export interface Citation {
  src: string;
  /** `sha256-<64 hex>`; keyed with the salt when `src` is obfuscated. */
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
   * The real path an obfuscated token resolved to. Never printed except by
   * the pretty reporter under `--reveal`; never serialized to a machine
   * format. Output spells a source exactly as the page spelled it.
   */
  resolvedPath?: string;
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
  /** Resolve a `~token` to its path, or `undefined`. */
  resolve(token: string): string | undefined;
  has(path: string): boolean;
}

export interface CheckPageOptions {
  /** Absolute directory `src:` paths resolve from. */
  root: string;
  /** Default true. False: no never-true, no history, no subjects. */
  git?: boolean;
  /** Default true. False: page-side rules only; every source status is `skipped`. */
  sources?: boolean;
  /** Keys obfuscated tokens and pins. Default `""`. */
  salt?: string;
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
  obfuscate?: boolean;
  salt?: string;
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
  /** Defaults to `process.env`; read for `MANNI_CITE_SALT`. A test hands in its own. */
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
   * Write `src` as a token and a keyed pin. Absent, obfuscation follows the
   * salt: a configured or environment salt obfuscates every add, and no salt
   * writes a plain path. `true` with no salt keys under the empty string.
   */
  obfuscate?: boolean;
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
  /** Defaults to `process.env`; read for `MANNI_CITE_SALT`. A test hands in its own. */
  env?: NodeJS.ProcessEnv;
  onNotice?: (message: string) => void;
  onConfigLoaded?: (info: { path: string; dir: string }) => void;
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

/** `manni cite salt set [<value>]`: write `cite.salt` into the config file. */
export interface SaltSetOptions {
  /** The salt to write. Absent generates 32 lowercase hex characters. */
  value?: string;
  /** `-c/--config`: the file to edit, instead of the discovered one. */
  configPath?: string;
  cwd?: string;
  /** Say what would be written and write nothing. */
  dryRun?: boolean;
  /** Defaults to `process.env`; read for `MANNI_CITE_SALT`, which wins over the key. */
  env?: NodeJS.ProcessEnv;
  /** Told once when the environment carries a salt that outranks the one written. */
  onWarn?: (message: string) => void;
}

export interface SaltSetResult {
  /** The config file as the user would name it, for the report line. Never the value. */
  source: string;
  /** Absolute path of the config file. */
  path: string;
  written: boolean;
}

/**
 * `manni cite salt rotate [paths...]`: re-key every obfuscated citation under
 * a new salt, then write it where the old one lives. A config salt is
 * replaced in the config; a salt from `MANNI_CITE_SALT` is never written
 * anywhere, and `to` is then required, because the tool cannot update the
 * secret. Inputs resolve as `check`'s do; the config is where the old salt
 * is read from, so `--no-config` has no meaning here, and neither has stdin,
 * since a rotated page is written back to its file.
 */
export interface SaltRotateOptions
  extends Omit<CheckOptions, "baseline" | "writeBaseline" | "sources" | "stdinContent" | "noConfig"> {
  /** The new salt. Absent generates 32 lowercase hex characters; required when the salt comes from the environment. */
  to?: string;
  /** Report every rewrite and write nothing: no page, no salt. */
  dryRun?: boolean;
}

export interface SaltRotateRewrite {
  id?: string;
  /** Index in `citations` for a frontmatter entry. */
  index?: number;
  /** File line of the entry or statement. */
  line?: number;
  /** The `src` before and after, spelled as the page spells it. */
  from: string;
  to: string;
}

export interface SaltRotateSkip {
  id?: string;
  index?: number;
  line?: number;
  /** Spelled as the page spelled it. */
  src: string;
  reason: string;
}

export interface SaltRotatePage {
  file: string;
  rewritten: SaltRotateRewrite[];
  skipped: SaltRotateSkip[];
  written: boolean;
}

export interface SaltRotateRun {
  pages: SaltRotatePage[];
  /** Citations re-keyed in memory; written only when `skipped` is zero and the run is not a dry run. */
  rekeyed: number;
  skipped: number;
  /** `false` under `--dry-run`, when anything was skipped, and always when the salt comes from the environment. */
  saltWritten: boolean;
  /** Where the old salt came from. `"none"` is refused before a run exists. */
  saltSource: Exclude<SaltSource, "none">;
  /** The config file the salt was, or would be, written to, as the user would name it. */
  source: string;
  dryRun: boolean;
  /** `1` when anything was skipped: the rotation is work left undone. */
  exitCode: 0 | 1;
}

/**
 * Config under `cite:` in manni.config.yaml, camelCase as `meta:` is. The
 * document set is not here: proposal 0041 moved `paths` and `exclude` to the
 * family-level `collections:` list, which every tool reads.
 */
export interface CiteConfig {
  allowEmpty?: boolean;
  respectGitignore?: boolean;
  root?: string;
  baseline?: string;
  git?: boolean;
  sources?: boolean;
  /**
   * Keys obfuscated tokens and pins, and turns obfuscation on: once a salt
   * is configured, `add` writes every source as a token. `MANNI_CITE_SALT`
   * wins over it. Written by `salt set`, replaced by `salt rotate`.
   */
  salt?: string;
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
  salt: string;
  /** Where `salt` came from. The environment wins over the config. */
  saltSource: SaltSource;
}

/**
 * Where a run's salt was read from: `MANNI_CITE_SALT`, `cite.salt`, or
 * nowhere. `salt rotate` reads it to decide where the new salt goes: a salt
 * managed in the environment rotates through the environment, and the
 * config is never touched, so a secret never lands in a public file.
 */
export type SaltSource = "env" | "config" | "none";
