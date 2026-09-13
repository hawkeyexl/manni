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
import { dirname, extname, isAbsolute, posix, relative, sep } from "node:path";
import { parse as parseYaml } from "yaml";
import { findGitRoot } from "../../../shared/git-root.js";
import { locateFrontmatter } from "../../extractors/frontmatter.js";
import {
  extractorByName,
  extractorForExtension,
} from "../../extractors/index.js";
import type { ExtractedMetadata, MetadataExtractor } from "../../types.js";
import { toJsonText } from "../json-text.js";
import { splitLines } from "../../../shared/pin.js";
import {
  attributeRange,
  DEFAULT_MACHINES,
  deriveProvenance,
  machineIdentity,
  parseLinePorcelain,
  parseProvenanceTarget,
  provenanceEntries,
  ZERO_SHA,
  type BlameLine,
  type CommitEvidence,
  type ProvenanceDerivation,
  type ProvenanceEntry,
} from "./provenance.js";
import {
  PROVENANCE_FIELD,
  type DeriveInput,
  type DerivedValue,
  type ProvenanceManifestRef,
  type SourceStatus,
} from "./types.js";

/** Facts git can state about one document. Every field is null when git answered but has no fact. */
export interface GitFacts {
  created: DerivedValue | null;
  "last-updated": DerivedValue | null;
  authors: DerivedValue | null;
  /** From `Reviewed-by` trailers only. */
  "reviewed-by": DerivedValue | null;
  /** From `Reviewed-by` trailers only. */
  "last-reviewed": DerivedValue | null;
  /**
   * The machine-written body ranges (proposal 0046), from blame and the
   * commits it names: the entry list as a page would carry it, or null when
   * no line names a machine, and when provenance was not requested.
   */
  provenance: DerivedValue | null;
  /**
   * The derivation behind `provenance`, per body line, which the comparison
   * with a page's stamp reads. Present exactly when provenance was requested.
   */
  provenanceDerivation?: ProvenanceDerivation;
  /** Full sha of the newest body-changing commit, for the review sources; null when uncommitted or none. */
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
  /**
   * The fields the run asks for. Blame runs only when it names
   * `provenance`, which is the per-field gating 0040 already has.
   */
  fields?: readonly string[];
  /** `--generated-by` or `MANNI_GENERATED_BY`: the machine uncommitted lines go to (rule 1). */
  generatedBy?: string;
  /** `derive.machines`; `DEFAULT_MACHINES` when absent. */
  machines?: readonly string[];
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

/**
 * `git cat-file --batch` exited non-zero: a corrupt object, a missing pack,
 * lock contention. An empty blob map would read every body as empty and
 * every history entry as unchanged, which is the false green the channel
 * refuses, so it is a failed root like a shallow clone.
 */
class BlobsUnreadable extends Error {
  constructor(readonly detail: string) {
    super(detail);
  }
}

/**
 * `git blame` exited non-zero for a file that HEAD has. A file HEAD lacks
 * (untracked, deleted and recreated, or in a repository with no commits yet)
 * is not this: all of its lines are uncommitted, and blame has nothing to add.
 * `detail` is git's own stderr.
 */
class BlameUnreadable extends Error {
  constructor(
    readonly rel: string,
    readonly detail: string,
  ) {
    super(rel);
  }
}

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
  /** `Generated-by` trailer values, as written (proposal 0046). */
  generatedBy: string[];
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
 * the whole run, as `deriveReviewsByRoot` rules: a walk that answered for
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
  const machines = opts.machines ?? DEFAULT_MACHINES;
  const wantsProvenance = opts.fields?.includes(PROVENANCE_FIELD) ?? false;
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

    try {
      const histories =
        bucket.length <= threshold
          ? await perFileHistories(run, bucket)
          : await bulkHistories(run, bucket);
      if (histories === null) {
        reasons.push(`git could not read the history at ${root}`);
        continue;
      }
      const blobs = await fetchBlobs(run, neededBlobs(histories));

      for (const entry of bucket) {
        const history = histories.get(entry.rel) ?? [];
        const facts = judge(entry.input, root, history, blobs, opts.now, machines);
        if (wantsProvenance) {
          const derived = await provenanceFor(run, root, entry, history, blobs, {
            machines,
            ...(opts.generatedBy !== undefined ? { generatedBy: opts.generatedBy } : {}),
          });
          facts.provenance = derived.value;
          facts.provenanceDerivation = derived.derivation;
        }
        records.set(entry.input.label, facts);
      }
    } catch (err) {
      if (err instanceof BlobsUnreadable) {
        reasons.push(`git cat-file could not read the history (${root}): ${err.detail}`);
        continue;
      }
      if (err instanceof BlameUnreadable) {
        const why = err.detail === "" ? "" : `: ${err.detail}`;
        reasons.push(`git blame could not read ${err.rel} (${root})${why}`);
        continue;
      }
      if (!(err instanceof HistoryTooLarge)) throw err;
      reasons.push(`git history is too large to read in one pass (${root})`);
      continue;
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
  "%(trailers:key=Reviewed-by,valueonly,unfold,separator=%x1f)%x00" +
  "%(trailers:key=Generated-by,valueonly,unfold,separator=%x1f)";

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
  generatedBy: string[];
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
      generatedBy: splitTrailers(fields[6]),
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
        generatedBy: record.generatedBy,
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
  if (out.code !== 0) throw new BlobsUnreadable(`exit ${String(out.code)}`);
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
  machines: readonly string[],
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

  const authors = bodyChanging.length === 0 ? null : authorsOf(bodyChanging, machines);

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
    provenance: null,
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
 * (by lowercase name when a co-author trailer carries none). An identity
 * whose name or email matches `derive.machines` is a machine and is left
 * out (proposal 0046); the default, `*[bot]`, is a name ending `[bot]`.
 */
function authorsOf(bodyChanging: readonly FileHistory[], machines: readonly string[]): DerivedValue {
  const seen = new Set<string>();
  const names: string[] = [];
  const add = (name: string, email: string | null): void => {
    if (name === "") return;
    const identity = email === null || email === "" ? name : `${name} <${email}>`;
    if (machineIdentity(identity, machines) !== undefined) return;
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
// provenance (proposal 0046)

/**
 * Whether a page's metadata is a leading fenced block for provenance's
 * purposes: extracted from one, or a format whose metadata can only ever be
 * one (a Markdown or MDX page with no block yet gets a fenced one when it is
 * stamped). Everywhere else the metadata is part of the body it would pin,
 * so the page cannot carry the stamp itself (stress test 8).
 */
export function provenanceFenced(extracted: Pick<ExtractedMetadata, "fenced" | "format">): boolean {
  return extracted.fenced === true || extracted.format === "markdown" || extracted.format === "mdx";
}

/**
 * The sha an out-of-range uncommitted line is given under a ranged
 * attribution: a commit with no trailers and no blob, so it resolves to no
 * evidence. With a range, `--generated-by` names those lines only; the
 * other uncommitted lines are not its to attribute.
 */
const OUTSIDE_RANGE = "outside-the-attributed-range";

/** The suffix a ranged attribution keys a committed line's commit under; the sha stays its prefix. */
const ATTRIBUTED = ":attributed";

interface ProvenanceRun {
  machines: readonly string[];
  generatedBy?: string;
}

/**
 * One page's provenance: blame once, then each blamed commit's trailers and
 * the page (or manifest) blob at it, then the evidence rules.
 */
async function provenanceFor(
  run: GitRun,
  root: string,
  entry: RootEntry,
  history: readonly FileHistory[],
  blobs: ReadonlyMap<string, string>,
  opts: ProvenanceRun,
): Promise<{ value: DerivedValue | null; derivation: ProvenanceDerivation }> {
  const { input, rel } = entry;
  const fenced = provenanceFenced(input.extracted);
  const blame = await blameOf(run, rel, input.content);
  const commits = await commitEvidence(run, root, entry, blame, history, blobs, input.provenanceManifest);
  const base = { content: input.content, commits, machines: opts.machines, fenced };

  let derivation: ProvenanceDerivation;
  const attribution = input.attribution;
  if (attribution !== undefined) {
    // Refused in 0046's words when a range runs past the end, reaches into
    // the frontmatter, or evidence names another machine for any of its lines.
    const ranges = attribution.targets.flatMap((target) => {
      attributeRange({ ...base, blame, target, generatedBy: attribution.generatedBy });
      const range = parseProvenanceTarget(target).lines;
      return range === undefined ? [] : [range];
    });
    const inRange = (line: BlameLine): boolean =>
      ranges.some((range) => line.finalLine >= range.start && line.finalLine <= range.end);
    // The attribution is evidence of its own, and nothing contradicts it (the
    // refusal above made sure). A committed line in the range is read as its
    // commit naming the machine, under a key that keeps the commit's sha for
    // the evidence text and leaves the commit's other lines as they were; an
    // uncommitted one is rule 1's. An uncommitted line outside the range has
    // no evidence: the range is what --generated-by names.
    const attributed = new Map(commits);
    const trailers = { generatedBy: [attribution.generatedBy], coAuthoredBy: [] };
    attributed.set(OUTSIDE_RANGE, { sha: OUTSIDE_RANGE, trailers: { generatedBy: [], coAuthoredBy: [] } });
    const rekeyed = blame.map((line): BlameLine => {
      if (inRange(line)) {
        if (line.uncommitted) return line;
        const sha = `${line.sha}${ATTRIBUTED}`;
        attributed.set(sha, { sha, trailers });
        return { ...line, sha };
      }
      return line.uncommitted ? { ...line, sha: OUTSIDE_RANGE, uncommitted: false } : line;
    });
    derivation = deriveProvenance({
      ...base,
      commits: attributed,
      generatedBy: attribution.generatedBy,
      blame: rekeyed,
    });
  } else {
    derivation = deriveProvenance({
      ...base,
      blame,
      ...(opts.generatedBy !== undefined ? { generatedBy: opts.generatedBy } : {}),
    });
  }

  const entries: ProvenanceEntry[] = derivation.derived.map((d) => d.entry);
  return {
    value: entries.length === 0 ? null : git(entries, provenanceEvidence(derivation)),
    derivation,
  };
}

/**
 * `blame 9b0e2c1`, `blame 9b0e2c1, 2 commits`, or `uncommitted`: the commits
 * behind the machine-attributed lines, the first in line order named, and
 * `uncommitted` when rule 1 answered for any of them.
 */
function provenanceEvidence(derivation: ProvenanceDerivation): string {
  const shas: string[] = [];
  let uncommitted = false;
  for (const range of derivation.derived) {
    for (let n = range.span.start; n <= range.span.end; n++) {
      const evidence = derivation.evidenceByLine.get(n);
      if (evidence?.machine === undefined) continue;
      if (evidence.rule === 1) uncommitted = true;
      else if (!shas.includes(evidence.sha)) shas.push(evidence.sha);
    }
  }
  const first = shas[0];
  if (first === undefined) return "uncommitted";
  const parts = [`blame ${short(first)}`];
  if (shas.length > 1) parts.push(`${String(shas.length)} commits`);
  if (uncommitted) parts.push("uncommitted");
  return parts.join(", ");
}

/**
 * `git blame --line-porcelain` over the working file. A path HEAD does not
 * have has nothing to blame, so every line is uncommitted: that covers an
 * untracked file, a repository with no commits, and a file deleted in history
 * and recreated, which has history but no blob in HEAD. Blame failing on a
 * path HEAD has is the root's failure, and git's stderr says why.
 *
 * `--no-ignore-revs-file` because a `blame.ignoreRevsFile` in someone's
 * global config would otherwise move lines onto other commits (or, naming a
 * file the repository lacks, fail blame outright), and attribution must not
 * depend on the machine it runs on. An empty `-c blame.ignoreRevsFile=` does
 * not clear the setting; the flag does.
 */
async function blameOf(run: GitRun, rel: string, content: string): Promise<BlameLine[]> {
  const out = await run([
    "-c",
    "core.quotePath=false",
    "blame",
    "--no-ignore-revs-file",
    "--line-porcelain",
    "--",
    rel,
  ]);
  if (out.tooLarge) throw new HistoryTooLarge();
  if (out.code !== 0) {
    // Asked only once blame has failed, so a page that blames cleanly pays nothing.
    const inHead = await run(["cat-file", "-e", `HEAD:${rel}`]);
    if (inHead.code !== 0) {
      return splitLines(content).map((line, i) => ({
        sha: ZERO_SHA,
        origLine: i + 1,
        finalLine: i + 1,
        author: "Not Committed Yet",
        authorMail: "not.committed.yet",
        filename: rel,
        boundary: false,
        uncommitted: true,
        content: line,
      }));
    }
    throw new BlameUnreadable(rel, out.stderr.trim());
  }
  return parseLinePorcelain(text(out));
}

/**
 * What each blamed commit offers: its trailers, from the history already
 * read or one `git log --no-walk` for a commit it lacks, and the page's text
 * at that commit, from the blobs already read or one `git cat-file --batch`
 * by `<sha>:<path>`. When a manifest holds the record, the stamp is read from
 * the manifest's blob at the same commit, under the page's entry as it was
 * keyed then: for a `path` join, the page's path at that commit, so a stamp
 * written before a rename is still found under the old key.
 */
async function commitEvidence(
  run: GitRun,
  root: string,
  entry: RootEntry,
  blame: readonly BlameLine[],
  history: readonly FileHistory[],
  blobs: ReadonlyMap<string, string>,
  manifest: ProvenanceManifestRef | undefined,
): Promise<Map<string, CommitEvidence>> {
  const pathAt = new Map<string, string>();
  for (const line of blame) {
    if (!line.uncommitted && !pathAt.has(line.sha)) pathAt.set(line.sha, unquotePath(line.filename));
  }
  const shas = [...pathAt.keys()];
  const commits = new Map<string, CommitEvidence>();
  if (shas.length === 0) return commits;

  const trailers = new Map<string, CommitEvidence["trailers"]>();
  const pageBlob = new Map<string, string>();
  for (const h of history) {
    trailers.set(h.sha, { generatedBy: h.generatedBy, coAuthoredBy: h.coAuthors });
    const blob = h.newBlob === null ? undefined : blobs.get(h.newBlob);
    if (blob !== undefined) pageBlob.set(h.sha, blob);
  }
  const unlogged = shas.filter((sha) => !trailers.has(sha));
  if (unlogged.length > 0) {
    const out = await run(["log", "--no-walk=unsorted", RECORD_FORMAT, ...unlogged]);
    if (out.tooLarge) throw new HistoryTooLarge();
    if (out.code !== 0) throw new BlobsUnreadable(`git log exit ${String(out.code)}`);
    for (const record of parseLog(text(out))) {
      trailers.set(record.sha, { generatedBy: record.generatedBy, coAuthoredBy: record.coAuthors });
    }
  }

  const manifestRel = manifest === undefined ? undefined : insideRoot(root, manifest.absPath);
  const specs: string[] = [];
  for (const sha of shas) {
    if (!pageBlob.has(sha)) specs.push(`${sha}:${pathAt.get(sha) ?? ""}`);
    if (manifestRel !== undefined) specs.push(`${sha}:${manifestRel}`);
  }
  const fetched = await fetchSpecs(run, specs);

  for (const sha of shas) {
    const blob = pageBlob.get(sha) ?? fetched.get(`${sha}:${pathAt.get(sha) ?? ""}`);
    commits.set(sha, {
      sha,
      trailers: trailers.get(sha) ?? { generatedBy: [], coAuthoredBy: [] },
      ...(blob !== undefined ? { blob } : {}),
      ...(manifest !== undefined
        ? {
            stamp:
              manifestRel === undefined
                ? []
                : manifestStamp(
                    fetched.get(`${sha}:${manifestRel}`),
                    manifest.join === "path"
                      ? entryAt(manifest.entry, entry.rel, pathAt.get(sha) ?? entry.rel)
                      : manifest.entry,
                    manifest.join,
                  ),
          }
        : {}),
    });
  }
  return commits;
}

/** A path under the root as git names it, or undefined outside the root. */
function insideRoot(root: string, abs: string): string | undefined {
  const rel = relative(root, abs);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return undefined;
  return rel.split(sep).join("/");
}

/**
 * A `path` join's key for the page as it was named at one commit. `entry` is
 * the current path relative to the config directory and `rel` the current
 * path relative to the root, so the path at the commit (root-relative, as
 * blame names it) is re-expressed from the current file's directory and
 * joined onto the entry's. That holds for an entry that climbs out of the
 * config directory with `..`, and needs no config directory of its own.
 */
function entryAt(entry: string, rel: string, relAtCommit: string): string {
  if (relAtCommit === rel) return entry;
  const fromHere = posix.relative(posix.dirname(rel), relAtCommit);
  return posix.join(posix.dirname(entry), fromHere);
}

/**
 * The `provenance` entries a manifest's text holds for one page, under `key`
 * (joined on `join`). A manifest that does not parse, or has no entry for the
 * page, holds none.
 */
function manifestStamp(
  text: string | undefined,
  key: string,
  join: ProvenanceManifestRef["join"],
): ProvenanceEntry[] {
  if (text === undefined) return [];
  let data: unknown;
  try {
    data = parseYaml(text);
  } catch {
    return [];
  }
  if (!isRecord(data)) return [];
  for (const [candidate, value] of Object.entries(data)) {
    const same =
      join === "path" ? posix.normalize(candidate) === posix.normalize(key) : candidate === key;
    if (same && isRecord(value)) return provenanceEntries(value[PROVENANCE_FIELD]);
  }
  return [];
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/**
 * `git cat-file --batch` by `<rev>:<path>`, keyed by the spec. The output
 * header names the object, not the spec, so it is read in input order; a
 * spec that names nothing answers `<spec> missing` and yields nothing.
 */
async function fetchSpecs(run: GitRun, specs: readonly string[]): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  if (specs.length === 0) return found;
  const out = await run(["cat-file", "--batch"], `${specs.join("\n")}\n`);
  if (out.tooLarge) throw new HistoryTooLarge();
  if (out.code !== 0) throw new BlobsUnreadable(`exit ${String(out.code)}`);
  const buf = out.raw;
  let cursor = 0;
  for (const spec of specs) {
    const nl = buf.indexOf(0x0a, cursor);
    if (nl === -1) break;
    const header = buf.toString("utf8", cursor, nl);
    cursor = nl + 1;
    if (header.endsWith(" missing") || header.endsWith(" ambiguous")) continue;
    const parts = header.split(" ");
    const size = Number(parts[2]);
    if (!Number.isFinite(size)) break;
    if (parts[1] === "blob") found.set(spec, buf.toString("utf8", cursor, cursor + size));
    cursor += size + 1;
  }
  return found;
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
  /** The start of stderr, decoded, for a failure message; `MAX_STDERR_BYTES` at most. */
  stderr: string;
}

/** How much of a git process's stderr is kept: enough for its `fatal:` line. */
const MAX_STDERR_BYTES = 16 * 1024;

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
      stderr: "",
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
    // Drain stderr so a chatty git cannot fill the pipe and stall, keeping
    // its start for the message a failure reports.
    const errChunks: Buffer[] = [];
    let errTotal = 0;
    child.stderr.on("data", (chunk: Buffer) => {
      if (errTotal >= MAX_STDERR_BYTES) return;
      const kept = chunk.subarray(0, MAX_STDERR_BYTES - errTotal);
      errTotal += kept.length;
      errChunks.push(kept);
    });
    // No binary on PATH lands here rather than throwing from spawn().
    child.on("error", (err: NodeJS.ErrnoException) => {
      finish(failed(err.code === "ENOENT"));
    });
    // A dead child makes the pipe write fail; 'error'/'close' report that.
    child.stdin.on("error", () => {});
    child.on("close", (code) => {
      try {
        const raw = tooLarge ? Buffer.alloc(0) : Buffer.concat(chunks);
        const stderr = Buffer.concat(errChunks).toString("utf8");
        finish({ code, raw, missing: false, tooLarge, stderr });
      } catch (err) {
        fail(err);
      }
    });

    if (stdin === undefined) child.stdin.end();
    else child.stdin.end(stdin);
  });
}
