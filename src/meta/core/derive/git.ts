/**
 * The git source of the derived channel (proposal 0040): what history can
 * state about a document's birth, its last body change, who wrote it and who
 * reviewed it.
 *
 * Documents are grouped by the repository that contains them, as
 * `gitignore.ts` groups candidates, and each root is asked once. A root's
 * history is read in one of two forms that produce the same `FileHistory`:
 * per-file `git log --follow` for a small run, because `--follow` is what
 * carries `created` across a rename and it forbids more than one pathspec;
 * one whole-repository `git log --raw -M` walk otherwise, with renames
 * followed backwards here. The judge on top of either form is the same.
 *
 * A body change is a change outside the metadata block, so a frontmatter
 * sweep does not move `last-updated`. Blobs are compared by their bodies
 * with line endings normalised, because `core.autocrlf` rewrites a blob on
 * the way in and out of the index and that is not an edit.
 *
 * Availability is a verdict, not an exception (decision 6): git missing, no
 * repository, or a shallow checkout report `available: false` with the fix.
 */
import { constants as bufferConstants } from "node:buffer";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { dirname, extname, relative, sep } from "node:path";
import { findGitRoot } from "../../../shared/git-root.js";
import { locateFrontmatter } from "../../extractors/frontmatter.js";
import {
  extractorByName,
  extractorForExtension,
} from "../../extractors/index.js";
import type { MetadataExtractor } from "../../types.js";
import { toJsonText } from "../json-text.js";
import type { DeriveInput, DerivedValue, SourceStatus } from "./types.js";

/** Facts git can state about one document. Every field is null when git answered but has no fact. */
export interface GitFacts {
  created: DerivedValue | null;
  "last-updated": DerivedValue | null;
  authors: DerivedValue | null;
  /** From `Reviewed-by` trailers only. */
  "reviewed-by": DerivedValue | null;
  /** From `Reviewed-by` trailers only. */
  "last-reviewed": DerivedValue | null;
  /** Full sha of the newest body-changing commit, for the forge source; null when uncommitted or none. */
  lastBodyCommit: string | null;
  /** Repository root the document lives in, absolute, native separators. */
  root: string;
}

export interface GitSourceOptions {
  cwd: string;
  now: () => Date;
  /** Runs with more inputs per root than this take the bulk walk. Test seam; default 32. */
  bulkThreshold?: number;
  /**
   * Most bytes one git process may write to stdout before the root is
   * reported too large to read. Test seam; default `MAX_GIT_OUTPUT_BYTES`.
   */
  maxOutputBytes?: number;
}

export interface GitSourceResult {
  status: SourceStatus;
  /** Keyed by `DeriveInput.label`. A document outside any repository is absent. */
  records: Map<string, GitFacts>;
}

const DEFAULT_BULK_THRESHOLD = 32;
const NULL_SHA = "0".repeat(40);

/**
 * The whole of one git process's stdout is held in memory and decoded in one
 * pass; streaming the log is out of scope for now. A history past this cap
 * is refused rather than decoded: 512 MiB, or V8's string limit where that
 * is lower, so the cap itself is what stops the run and not an
 * `ERR_STRING_TOO_LONG` from inside `Buffer#toString`.
 */
const MAX_GIT_OUTPUT_BYTES = Math.min(
  512 * 1024 * 1024,
  bufferConstants.MAX_STRING_LENGTH,
);

/** A root whose history cannot be held in memory; caught by `deriveFromGit`. */
class HistoryTooLarge extends Error {}

/** One commit that touched a document, as either walk form reports it. */
interface FileHistory {
  sha: string;
  /** `%aI`: ISO 8601 in the author's own offset. */
  authorDate: string;
  authorName: string;
  authorEmail: string;
  /** `Co-authored-by` trailer values, `Name <email>` form. */
  coAuthors: string[];
  /** `Reviewed-by` trailer values, as written. */
  reviewedBy: string[];
  oldBlob: string | null;
  newBlob: string | null;
  pathAtCommit: string;
}

/**
 * Content outside the metadata block: for a fenced document the block
 * `[openStart, closeEnd)` is dropped, so a BOM ahead of it survives; anything
 * else is the whole content. Exported for the orchestrator and tests.
 */
export function bodyOf(content: string, fenced: boolean | undefined): string {
  if (fenced !== true) return content;
  const loc = locateFrontmatter(content);
  if (!loc) return content;
  return content.slice(0, loc.openStart) + content.slice(loc.closeEnd);
}

/**
 * Never throws for availability: git missing, no repository for any input,
 * a shallow clone, or a history too large to read report
 * `status.available: false` with a `reason` that names the fix, and an
 * empty map. One root that cannot answer makes the source unavailable for
 * the whole run, as `deriveForgeByRoot` rules: a walk that answered for
 * some roots and silently dropped the rest would read as green for
 * documents it never looked at. An input outside any repository is not a
 * failing root; it is simply absent from the records.
 */
export async function deriveFromGit(
  inputs: readonly DeriveInput[],
  opts: GitSourceOptions,
): Promise<GitSourceResult> {
  const records = new Map<string, GitFacts>();
  const byRoot = groupByRoot(inputs);
  if (byRoot.size === 0) {
    return {
      status: {
        available: false,
        reason: "no git repository contains the documents",
      },
      records,
    };
  }

  const threshold = opts.bulkThreshold ?? DEFAULT_BULK_THRESHOLD;
  const maxBytes = opts.maxOutputBytes ?? MAX_GIT_OUTPUT_BYTES;
  const reasons: string[] = [];
  for (const [root, bucket] of byRoot) {
    const run: GitRun = (args, stdin) => runGit(args, root, stdin, maxBytes);
    const shallow = await run(["rev-parse", "--is-shallow-repository"]);
    if (shallow.missing) {
      return {
        status: { available: false, reason: "git is not on PATH" },
        records: new Map(),
      };
    }
    if (shallow.code !== 0) {
      reasons.push(`git could not read the repository at ${root}`);
      continue;
    }
    if (text(shallow).trim() === "true") {
      reasons.push(
        `this checkout is shallow; use actions/checkout with fetch-depth: 0 (${root})`,
      );
      continue;
    }

    let histories: Map<string, FileHistory[]> | null;
    let blobs: Map<string, string>;
    try {
      histories =
        bucket.length <= threshold
          ? await perFileHistories(run, bucket)
          : await bulkHistories(run, bucket);
      if (histories === null) {
        reasons.push(`git could not read the history at ${root}`);
        continue;
      }
      blobs = await fetchBlobs(run, neededBlobs(histories));
    } catch (err) {
      if (!(err instanceof HistoryTooLarge)) throw err;
      reasons.push(`git history is too large to read in one pass (${root})`);
      continue;
    }

    for (const entry of bucket) {
      const history = histories.get(entry.rel) ?? [];
      records.set(
        entry.input.label,
        judge(entry.input, root, history, blobs, opts.now),
      );
    }
  }

  if (reasons.length > 0) {
    return {
      status: { available: false, reason: reasons.join("; ") },
      records: new Map(),
    };
  }
  return { status: { available: true }, records };
}

// ---------------------------------------------------------------------------
// Grouping

interface RootEntry {
  input: DeriveInput;
  /** Root-relative, forward slashes: how git names the path. */
  rel: string;
}

function groupByRoot(inputs: readonly DeriveInput[]): Map<string, RootEntry[]> {
  const rootOf = new Map<string, string | null>();
  const byRoot = new Map<string, RootEntry[]>();
  for (const input of inputs) {
    const dir = dirname(input.absPath);
    let root = rootOf.get(dir);
    if (root === undefined) {
      root = findGitRoot(dir);
      rootOf.set(dir, root);
    }
    if (root === null) continue;
    const rel = relative(root, input.absPath).split(sep).join("/");
    const bucket = byRoot.get(root);
    if (bucket) bucket.push({ input, rel });
    else byRoot.set(root, [{ input, rel }]);
  }
  return byRoot;
}

// ---------------------------------------------------------------------------
// History walks

/**
 * Record format: one `\x1e`-led header per commit, its fields `\0`-separated,
 * trailer values `\x1f`-separated. `--raw` lines follow each header. `-z` is
 * deliberately absent: it makes the record boundary ambiguous, where `\x1e`
 * cannot appear in a sha, a date, or a raw line. `--no-abbrev` because
 * `--raw` shortens blob shas by default, and `cat-file` wants the full ones.
 * `unfold` because a trailer may wrap onto an indented continuation line,
 * and the header is read up to its first newline: folded, the rest of the
 * header would be taken for raw lines and the value split in two.
 */
const RECORD_FORMAT =
  "--format=%x1e%H%x00%aI%x00%an%x00%ae%x00" +
  "%(trailers:key=Co-authored-by,valueonly,unfold,separator=%x1f)%x00" +
  "%(trailers:key=Reviewed-by,valueonly,unfold,separator=%x1f)";

const LOG_ARGS = [
  "-c",
  "core.quotePath=false",
  "log",
  "--raw",
  "-M",
  "--no-abbrev",
  RECORD_FORMAT,
];

/** The per-file form: `--follow` carries the path across renames itself. */
async function perFileHistories(
  run: GitRun,
  bucket: RootEntry[],
): Promise<Map<string, FileHistory[]> | null> {
  const histories = new Map<string, FileHistory[]>();
  for (const entry of bucket) {
    const out = await run([...LOG_ARGS, "--follow", "--", pathspec(entry.rel)]);
    if (out.tooLarge) throw new HistoryTooLarge();
    if (out.code !== 0) {
      if (await isUnbornHead(run)) return histories;
      return null;
    }
    // `--follow` already walked the rename; `attribute` still applies so the
    // rename commit's own raw line is read the same way the bulk form reads it.
    const attributed = attribute(parseLog(text(out)), [entry.rel]);
    histories.set(entry.rel, attributed.get(entry.rel) ?? []);
  }
  return histories;
}

/** The bulk form: one walk, every path attributed and followed here. */
async function bulkHistories(
  run: GitRun,
  bucket: RootEntry[],
): Promise<Map<string, FileHistory[]> | null> {
  const out = await run(LOG_ARGS);
  if (out.tooLarge) throw new HistoryTooLarge();
  if (out.code !== 0) {
    if (await isUnbornHead(run)) return new Map();
    return null;
  }
  return attribute(
    parseLog(text(out)),
    bucket.map((e) => e.rel),
  );
}

/** A path with glob characters is named literally, as `gitignore.ts` does. */
function pathspec(rel: string): string {
  return /[*?[\]]/.test(rel) ? `:(literal)${rel}` : rel;
}

/** A repository with no commits yet has no history rather than a broken one. */
async function isUnbornHead(run: GitRun): Promise<boolean> {
  const out = await run(["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]);
  return !out.missing && out.code !== 0;
}

interface RawEntry {
  status: string;
  oldBlob: string;
  newBlob: string;
  oldPath: string;
  newPath: string;
}

interface LogRecord {
  sha: string;
  authorDate: string;
  authorName: string;
  authorEmail: string;
  coAuthors: string[];
  reviewedBy: string[];
  raw: RawEntry[];
}

function parseLog(text: string): LogRecord[] {
  const records: LogRecord[] = [];
  for (const chunk of text.split("\x1e")) {
    if (chunk === "") continue;
    const nl = chunk.indexOf("\n");
    const header = nl === -1 ? chunk : chunk.slice(0, nl);
    const fields = header.split("\0");
    const sha = fields[0];
    if (sha === undefined || sha === "") continue;
    const raw: RawEntry[] = [];
    if (nl !== -1) {
      for (const line of chunk.slice(nl + 1).split("\n")) {
        const entry = parseRawLine(line);
        if (entry) raw.push(entry);
      }
    }
    records.push({
      sha,
      authorDate: fields[1] ?? "",
      authorName: fields[2] ?? "",
      authorEmail: fields[3] ?? "",
      coAuthors: splitTrailers(fields[4]),
      reviewedBy: splitTrailers(fields[5]),
      raw,
    });
  }
  return records;
}

function splitTrailers(field: string | undefined): string[] {
  if (field === undefined || field === "") return [];
  return field
    .split("\x1f")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/**
 * `:<oldmode> <newmode> <oldsha> <newsha> <status>\t<path>`, or with two
 * paths after `R`/`C`. A path git still had to quote (a control character
 * or a backslash, even with `core.quotePath=false`) is C-unquoted.
 */
function parseRawLine(line: string): RawEntry | null {
  if (!line.startsWith(":")) return null;
  const tab = line.indexOf("\t");
  if (tab === -1) return null;
  const meta = line.slice(1, tab).split(" ");
  const oldBlob = meta[2];
  const newBlob = meta[3];
  const status = meta[4];
  if (oldBlob === undefined || newBlob === undefined || status === undefined) {
    return null;
  }
  const paths = line.slice(tab + 1).split("\t").map(unquotePath);
  const first = paths[0];
  if (first === undefined) return null;
  const second = paths[1];
  const renamed = status.startsWith("R") || status.startsWith("C");
  return {
    status,
    oldBlob,
    newBlob,
    oldPath: first,
    newPath: renamed && second !== undefined ? second : first,
  };
}

function unquotePath(p: string): string {
  if (p.length < 2 || !p.startsWith('"') || !p.endsWith('"')) return p;
  const inner = p.slice(1, -1);
  const bytes: number[] = [];
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if (ch !== "\\") {
      bytes.push(...Buffer.from(ch ?? "", "utf8"));
      continue;
    }
    const next = inner[i + 1];
    if (next === undefined) break;
    const octal = /^[0-7]{3}/.exec(inner.slice(i + 1));
    if (octal) {
      bytes.push(parseInt(octal[0], 8));
      i += 3;
      continue;
    }
    const simple: Record<string, number> = {
      a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, "\\": 92,
    };
    const code = simple[next];
    if (code === undefined) bytes.push(...Buffer.from(next, "utf8"));
    else bytes.push(code);
    i += 1;
  }
  return Buffer.from(bytes).toString("utf8");
}

/**
 * Attribute raw lines to the wanted paths, newest first, following a rename
 * backwards: after the commit that renamed `old` to `new`, the file is
 * looked for under `old`. A path deleted and later re-added is tracked
 * through the deletion, since the re-add is its newest history.
 */
function attribute(
  records: LogRecord[],
  wanted: string[],
): Map<string, FileHistory[]> {
  const histories = new Map<string, FileHistory[]>();
  // The path each wanted document is currently known by, walking backwards.
  const tracked = new Map<string, string>();
  for (const rel of wanted) {
    histories.set(rel, []);
    tracked.set(rel, rel);
  }
  for (const record of records) {
    if (record.raw.length === 0) continue;
    const byNewPath = new Map<string, RawEntry>();
    for (const entry of record.raw) byNewPath.set(entry.newPath, entry);
    for (const [rel, current] of tracked) {
      const entry = byNewPath.get(current);
      if (!entry) continue;
      histories.get(rel)?.push({
        sha: record.sha,
        authorDate: record.authorDate,
        authorName: record.authorName,
        authorEmail: record.authorEmail,
        coAuthors: record.coAuthors,
        reviewedBy: record.reviewedBy,
        oldBlob: entry.oldBlob === NULL_SHA ? null : entry.oldBlob,
        newBlob: entry.newBlob === NULL_SHA ? null : entry.newBlob,
        pathAtCommit: entry.newPath,
      });
      if (entry.oldPath !== entry.newPath) tracked.set(rel, entry.oldPath);
    }
  }
  return histories;
}

// ---------------------------------------------------------------------------
// Blobs

function neededBlobs(histories: Map<string, FileHistory[]>): Set<string> {
  const shas = new Set<string>();
  for (const history of histories.values()) {
    for (const h of history) {
      if (h.oldBlob !== null) shas.add(h.oldBlob);
      if (h.newBlob !== null) shas.add(h.newBlob);
    }
  }
  return shas;
}

/**
 * One `git cat-file --batch` per root, one sha per line on stdin. Output is
 * `<sha> blob <size>\n<bytes>\n` per object, correlated by the header's sha
 * rather than by order; a `<sha> missing` line yields nothing.
 */
async function fetchBlobs(
  run: GitRun,
  shas: Set<string>,
): Promise<Map<string, string>> {
  const blobs = new Map<string, string>();
  if (shas.size === 0) return blobs;
  const out = await run(["cat-file", "--batch"], `${[...shas].join("\n")}\n`);
  if (out.tooLarge) throw new HistoryTooLarge();
  if (out.code !== 0) return blobs;
  const buf = out.raw;
  let cursor = 0;
  while (cursor < buf.length) {
    const nl = buf.indexOf(0x0a, cursor);
    if (nl === -1) break;
    const header = buf.toString("utf8", cursor, nl).split(" ");
    cursor = nl + 1;
    const sha = header[0];
    const kind = header[1];
    const size = Number(header[2]);
    if (sha === undefined || kind !== "blob" || !Number.isFinite(size)) {
      continue;
    }
    blobs.set(sha, buf.toString("utf8", cursor, cursor + size));
    cursor += size + 1; // the trailing newline after the object
  }
  return blobs;
}

// ---------------------------------------------------------------------------
// The judge

const git = (value: unknown, evidence: string): DerivedValue => ({
  value,
  source: "git",
  evidence,
});

function judge(
  input: DeriveInput,
  root: string,
  history: readonly FileHistory[],
  blobs: Map<string, string>,
  now: () => Date,
): GitFacts {
  const fenced = input.extracted.fenced;
  const extractor = extractorFor(input);
  const blobBody = (sha: string | null): string | null =>
    sha === null ? null : bodyOf(blobs.get(sha) ?? "", fenced);
  const stampsOf = (sha: string | null): Record<string, unknown> => {
    if (sha === null) return {};
    const content = blobs.get(sha);
    return content === undefined ? {} : extractStamps(extractor, content, input.absPath);
  };

  // Oldest first, so authors read in order of first appearance.
  const bodyChanging = [...history]
    .reverse()
    .filter((h) => !sameBody(blobBody(h.newBlob), blobBody(h.oldBlob)));
  const oldest = history[history.length - 1];
  const newestBody = bodyChanging[bodyChanging.length - 1];
  const head = history[0];
  const headBlob = head === undefined ? null : head.newBlob;

  const created = oldest === undefined ? null : createdOf(oldest, stampsOf(oldest.newBlob));

  const workingChanged = !sameBody(
    bodyOf(input.content, fenced),
    headBlob === null ? null : blobBody(headBlob),
  );

  let lastUpdated: DerivedValue | null;
  let lastBodyCommit: string | null;
  if (workingChanged) {
    lastBodyCommit = null;
    const working = input.extracted.data["last-updated"];
    const committed = stampsOf(headBlob)["last-updated"];
    lastUpdated =
      working !== undefined && working !== null && !sameValue(working, committed)
        ? git(working, "stamped in working tree")
        : git(localDate(now()), "uncommitted body change");
  } else if (newestBody === undefined) {
    lastBodyCommit = null;
    lastUpdated = null;
  } else {
    lastBodyCommit = newestBody.sha;
    lastUpdated = lastUpdatedOf(
      newestBody,
      stampsOf(newestBody.newBlob),
      stampsOf(newestBody.oldBlob),
    );
  }

  const authors = bodyChanging.length === 0 ? null : authorsOf(bodyChanging);

  let reviewedBy: DerivedValue | null = null;
  let lastReviewed: DerivedValue | null = null;
  if (!workingChanged && newestBody !== undefined && newestBody.reviewedBy.length > 0) {
    const evidence = `Reviewed-by trailer in ${short(newestBody.sha)}`;
    reviewedBy = git(newestBody.reviewedBy.map(nameOf), evidence);
    lastReviewed = git(datePart(newestBody.authorDate), evidence);
  }

  return {
    created,
    "last-updated": lastUpdated,
    authors,
    "reviewed-by": reviewedBy,
    "last-reviewed": lastReviewed,
    lastBodyCommit,
    root,
  };
}

function createdOf(
  oldest: FileHistory,
  stamps: Record<string, unknown>,
): DerivedValue {
  const stamp = stamps["created"];
  if (stamp !== undefined && stamp !== null) {
    return git(stamp, `stamped in ${short(oldest.sha)}`);
  }
  const date = datePart(oldest.authorDate);
  return git(date, `added in ${short(oldest.sha)} (${date})`);
}

function lastUpdatedOf(
  commit: FileHistory,
  after: Record<string, unknown>,
  before: Record<string, unknown>,
): DerivedValue {
  const stamp = after["last-updated"];
  if (stamp !== undefined && stamp !== null && !sameValue(stamp, before["last-updated"])) {
    return git(stamp, `stamped in ${short(commit.sha)}`);
  }
  const date = datePart(commit.authorDate);
  return git(date, `body changed in ${short(commit.sha)} (${date})`);
}

/**
 * Distinct people behind the body-changing commits, oldest first, each
 * commit's author ahead of its co-authors, deduplicated by lowercase email
 * (by lowercase name when a co-author trailer carries none). A name ending
 * `[bot]` is a machine and is left out.
 */
function authorsOf(bodyChanging: readonly FileHistory[]): DerivedValue {
  const seen = new Set<string>();
  const names: string[] = [];
  const add = (name: string, email: string | null): void => {
    if (name === "" || name.endsWith("[bot]")) return;
    const key = email === null || email === "" ? `name:${name.toLowerCase()}` : email.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    names.push(name);
  };
  for (const h of bodyChanging) {
    add(h.authorName, h.authorEmail);
    for (const co of h.coAuthors) add(nameOf(co), emailOf(co));
  }
  const n = bodyChanging.length;
  return git(names, `${n} body-changing ${n === 1 ? "commit" : "commits"}`);
}

// ---------------------------------------------------------------------------
// Small helpers

function extractorFor(input: DeriveInput): MetadataExtractor | undefined {
  return (
    extractorByName(input.extracted.format) ??
    extractorForExtension(extname(input.absPath))
  );
}

/** The stamps a blob carries; a blob that fails to parse carries none. */
function extractStamps(
  extractor: MetadataExtractor | undefined,
  content: string,
  filePath: string,
): Record<string, unknown> {
  if (!extractor) return {};
  try {
    return extractor.extract(content, filePath).data;
  } catch {
    return {};
  }
}

/**
 * Bodies compare with CRLF folded to LF: `core.autocrlf` rewrites line
 * endings between the working tree and the index, and that is not an edit.
 * An absent blob (a file being added, or one with no history) matches only
 * another absent blob.
 */
function sameBody(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return a.replace(/\r\n/g, "\n") === b.replace(/\r\n/g, "\n");
}

function sameValue(a: unknown, b: unknown): boolean {
  return toJsonText(a) === toJsonText(b);
}

const short = (sha: string): string => sha.slice(0, 7);

/** The `YYYY-MM-DD` of a `%aI` string: the author's own day, no conversion. */
const datePart = (iso: string): string => iso.slice(0, 10);

function localDate(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `Name <email>` → `Name`; a bare name is returned trimmed. */
function nameOf(trailer: string): string {
  const lt = trailer.lastIndexOf("<");
  return (lt === -1 ? trailer : trailer.slice(0, lt)).trim();
}

function emailOf(trailer: string): string | null {
  const m = /<([^>]*)>\s*$/.exec(trailer);
  return m?.[1]?.trim() ?? null;
}

// ---------------------------------------------------------------------------
// Process plumbing

interface GitOutput {
  /** Exit code; null when git was killed by a signal or never started. */
  code: number | null;
  /**
   * The bytes of stdout, undecoded: `cat-file` sizes are byte counts, and
   * the log is decoded only where it is read, through `text()`.
   */
  raw: Buffer;
  /** True when `git` itself could not be started (not on PATH). */
  missing: boolean;
  /** True when stdout passed the byte cap; `raw` is then empty. */
  tooLarge: boolean;
}

/** One git command in a fixed root, with the run's byte cap bound in. */
type GitRun = (args: string[], stdin?: string) => Promise<GitOutput>;

/**
 * Decode stdout as UTF-8. The cap keeps the byte count under V8's string
 * limit, so a decode that still throws is treated the same way rather than
 * escaping as a crash.
 */
function text(out: GitOutput): string {
  try {
    return out.raw.toString("utf8");
  } catch {
    throw new HistoryTooLarge();
  }
}

/**
 * One git process from `cwd`, modelled on `checkIgnore` in gitignore.ts.
 * stdout is collected whole and capped at `maxBytes`: past the cap the
 * child is killed and the result says `tooLarge` instead of carrying the
 * bytes. Anything thrown while assembling the result rejects the promise
 * rather than escaping the 'close' handler as an uncaught exception.
 */
function runGit(
  args: string[],
  cwd: string,
  stdin: string | undefined,
  maxBytes: number,
): Promise<GitOutput> {
  return new Promise((settle, reject) => {
    let done = false;
    const finish = (out: GitOutput): void => {
      if (done) return;
      done = true;
      settle(out);
    };
    const fail = (err: unknown): void => {
      if (done) return;
      done = true;
      reject(err instanceof Error ? err : new Error(String(err)));
    };
    const failed = (missing: boolean): GitOutput => ({
      code: null,
      raw: Buffer.alloc(0),
      missing,
      tooLarge: false,
    });

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn("git", args, { cwd, windowsHide: true });
    } catch {
      finish(failed(true));
      return;
    }

    let chunks: Buffer[] = [];
    let total = 0;
    let tooLarge = false;
    child.stdout.on("data", (chunk: Buffer) => {
      if (tooLarge) return;
      total += chunk.length;
      if (total > maxBytes) {
        tooLarge = true;
        chunks = [];
        child.kill();
        return;
      }
      chunks.push(chunk);
    });
    // Drain stderr so a chatty git cannot fill the pipe and stall.
    child.stderr.resume();
    // No binary on PATH lands here rather than throwing from spawn().
    child.on("error", (err: NodeJS.ErrnoException) => {
      finish(failed(err.code === "ENOENT"));
    });
    // A dead child makes the pipe write fail; 'error'/'close' report that.
    child.stdin.on("error", () => {});
    child.on("close", (code) => {
      try {
        const raw = tooLarge ? Buffer.alloc(0) : Buffer.concat(chunks);
        finish({ code, raw, missing: false, tooLarge });
      } catch (err) {
        fail(err);
      }
    });

    if (stdin === undefined) child.stdin.end();
    else child.stdin.end(stdin);
  });
}
