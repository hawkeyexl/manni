/**
 * The key domain's option and result types (proposal 0045). `key` manages a
 * family resource, the encryption key, rather than documents of its own: `set`
 * writes it, and `rotate` re-encrypts every value the family's tools wrote
 * under it before writing a new one.
 */
import type { GitClient } from "../cite/index.js";

export interface KeySetOptions {
  /** `[value]`: the key to write. Omitted: 64 random hex characters (256 bits). */
  value?: string;
  /**
   * `-c, --config <path>`, relative to `cwd`: the config file to write, which
   * must exist. Omitted: the nearest `manni.config.yaml` whatever it carries,
   * else a new one at the git root (else `cwd`).
   */
  configPath?: string;
  /** `--dry-run`: name the target and write nothing. */
  dryRun?: boolean;
  cwd?: string;
  /** Read for `MANNI_ENCRYPTION_KEY`. Defaults to `process.env`; tests pass their own. */
  env?: NodeJS.ProcessEnv;
  /** A stderr diagnostic (the git warning); the CLI adds the `manni: ` prefix. */
  onNotice?: (message: string) => void;
}

/** What `set` wrote, or would have. Never the key. */
export interface KeySetResult {
  /** Absolute path of the config file. */
  path: string;
  /** The file as the user would name it, for the report. */
  source: string;
  /** Whether the write creates the file. */
  created: boolean;
  /** Whether the key was generated rather than given. */
  generated: boolean;
  dryRun: boolean;
}

export interface KeyRotateOptions {
  /** `[paths...]`: files, directories or globs. Empty: every collection. Any makes the run narrowed. */
  inputs: string[];
  /** `--collection <name>`, repeatable. Empty or absent: every collection. Any makes the run narrowed. */
  collection?: string[];
  /**
   * `--to <value>`: the new key. Omitted on a whole run with a key from the
   * config: 64 random hex characters. Required for a narrowed run and for a
   * key from `MANNI_ENCRYPTION_KEY`.
   */
  to?: string;
  /** `--ext <list>`, already split: extensions for directory walks. */
  exts?: string[];
  /** `--exclude <glob>`, repeatable; added to the selected collections' `exclude:` on a collection run. */
  exclude?: string[];
  /** `--as <format>`: force an extractor for every input. */
  as?: string;
  /** `-c, --config <path>`: the config the current key is read from and the new one written to. */
  configPath?: string;
  /** `--allow-empty`: zero matched files is success. */
  allowEmpty?: boolean;
  /** `--no-gitignore` (false). Absent: `.gitignore` is respected. */
  respectGitignore?: boolean;
  /** `--root <dir>`, cwd-relative: where cited sources resolve from. Else `cite.root`, else the git root, else `cwd`. */
  root?: string;
  /** `--no-git` (false): index sources by a directory walk. */
  git?: boolean;
  /** `--dry-run`: re-encrypt in memory, write nothing. */
  dryRun?: boolean;
  cwd?: string;
  /** Read for `MANNI_ENCRYPTION_KEY`. Defaults to `process.env`; tests pass their own. */
  env?: NodeJS.ProcessEnv;
  /** Stderr diagnostics; the CLI adds the `manni: ` prefix. */
  onNotice?: (message: string) => void;
  /** The git client sources are read through. Defaults to one over the root. */
  gitClient?: GitClient;
  /** How a page is written. Defaults to an atomic write; tests inject a failure. */
  writePage?: (path: string, content: string) => Promise<void>;
}

/** A metadata value re-encrypted: its JSON pointer, and the ciphertext before and after. */
export interface RotatedMetadata {
  kind: "metadata";
  pointer: string;
  from: string;
  to: string;
}

/** A citation re-encrypted: where it sits, and its `src` (line suffix kept) before and after. */
export interface RotatedCitation {
  kind: "citation";
  id?: string;
  /** Index in `citations` for a frontmatter entry. */
  index?: number;
  line?: number;
  from: string;
  to: string;
}

export type RotatedValue = RotatedMetadata | RotatedCitation;

export interface SkippedMetadata {
  kind: "metadata";
  pointer: string;
  message: string;
}

export interface SkippedCitation {
  kind: "citation";
  id?: string;
  index?: number;
  line?: number;
  message: string;
}

/** A value that could not be re-encrypted, and why. A message never names a path or a value. */
export type SkippedValue = SkippedMetadata | SkippedCitation;

/** One page with something encrypted on it. */
export interface RotatePage {
  file: string;
  rewritten: RotatedValue[];
  skipped: SkippedValue[];
  /** Whether this run wrote the page. */
  written: boolean;
}

/**
 * How a run ended, which decides its last line:
 *
 * - `written`: a whole run wrote the pages, then the new key to the config.
 * - `finished`: a whole run finished a rotation an interruption left behind.
 * - `narrowed`: paths or `--collection`; pages written, key not.
 * - `env`: the key comes from `MANNI_ENCRYPTION_KEY`; pages written, key not.
 * - `skipped`: a value could not be re-encrypted; nothing written (exit 1).
 * - `dry-run`: nothing written.
 */
export type RotateOutcome = "written" | "finished" | "narrowed" | "env" | "skipped" | "dry-run";

export interface KeyRotateResult {
  /** Pages that had something to re-encrypt or skip, in the order they were read. */
  pages: RotatePage[];
  /** Values re-encrypted, in memory under `--dry-run` and a skip. */
  reencrypted: number;
  skipped: number;
  /** Whether the config now holds the new key because of this run. */
  keyWritten: boolean;
  outcome: RotateOutcome;
  /** The config file the key comes from, as the user would name it; absent for an environment key. */
  configSource?: string;
  /** A citation baseline exists and this run wrote pages, so its pins are stale. */
  baselineStale: boolean;
  /** `0` everything re-encrypted, `1` something skipped. Operational errors throw. */
  exitCode: 0 | 1;
}
