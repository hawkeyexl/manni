/**
 * `reencryptCitations`: re-encrypt one page's encrypted citations under a new
 * key, for `manni key rotate` (proposal 0045). It reads sources and never
 * writes: the caller gets the rewritten page back, and writes it only once
 * every page in the run could be re-encrypted.
 *
 * A citation counts as done only when its `source.file` decrypts under the
 * new key *and* its pin holds under the new key. Either alone is a half
 * rotation, and a rerun has to finish it rather than declare it done. Meta's
 * walker cannot leave one today, because it skips the whole `citations` key
 * and cite encrypts in its own `cite-src` context; an interrupted run, a hand
 * edit, or a second writer of the same manifest can.
 *
 * The path must be tracked, and the pin must hold under the old key, over the
 * lines as they are today or, with git, as they were at the entry's
 * `commit-sha` (the classifier's history search). Then `file` becomes the
 * path's ciphertext under the new key, its lines kept, and `integrity` the
 * keyed pin under it, so a `changed` citation stays exactly as changed. A pin
 * that holds nowhere is skipped, with `update --accept` named as the repair.
 * No message names a path.
 */
import type {
  Citation,
  CitationInput,
  CitationOrigin,
  GitClient,
  ReencryptCitationsResult,
  ReencryptedCitation,
  SourceIndex,
  SourceRange,
} from "../types.js";
import { historyOf } from "./classify.js";
import { gitClient } from "./git.js";
import { hashLines, sliceLines, splitLines } from "./hash.js";
import { readPage } from "./page.js";
import { formatSrc, sourceRange, spellSource } from "./range.js";
import { buildSourceIndex, decryptSourcePath, encryptSourcePath, readSource } from "./sources.js";
import { spliceEntryField } from "./write.js";

const UNDECRYPTABLE = "does not decrypt under the current key";
const MISSING = "missing (no tracked file matches)";
const CHANGED = "changed; run `manni cite update --accept` before rotating";

type Where = Pick<ReencryptedCitation, "id" | "index" | "line">;

/** The fields a report row carries to name the entry: its id, or where it sits. */
function whereOf(citation: Citation, origin: CitationOrigin): Where {
  const where: Where = { index: origin.index };
  if (citation.id !== undefined) where.id = citation.id;
  if (origin.line !== undefined) where.line = origin.line;
  return where;
}

interface Context {
  root: string;
  index: SourceIndex;
  git: GitClient;
}

/**
 * The lines the pin was taken over, joined: today's when the pin holds there
 * under `key`, else the lines at the entry's commit when git can show them;
 * else why neither.
 */
async function pinnedLines(
  ctx: Context,
  citation: Citation,
  range: SourceRange,
  path: string,
  key: string,
): Promise<{ joined: string } | { skip: string }> {
  const source = await readSource(ctx.root, ctx.index, { ...range, path, encrypted: false });
  if (source.kind === "missing") return { skip: MISSING };
  const pin = citation.source.integrity;
  let joined: string | undefined;
  try {
    joined = sliceLines(splitLines(source.text), range);
  } catch {
    // The range runs past the end of the file as it is now.
    joined = undefined;
  }
  if (joined !== undefined && hashLines(joined, key) === pin) return { joined };

  const commit = citation.source["commit-sha"];
  if (commit !== undefined && (await ctx.git.available())) {
    const history = await historyOf(ctx.git, commit, path, range, pin, key, undefined);
    if (history.kind === "original") return { joined: history.lines.join("\n") };
  }
  return { skip: CHANGED };
}

/** What one citation needs: nothing, a new pair of values, or a reason it cannot be done. */
type Verdict =
  | { kind: "done" }
  | { kind: "skip"; message: string }
  | { kind: "write"; file: string; integrity: string; to: string };

/** Options every re-encryption takes, whichever channel the entry lives in. */
export interface ReencryptOptions {
  root: string;
  fromKey: string;
  toKey: string;
  /** History and the source index are read through it; defaults to one over the root. */
  gitClient?: GitClient;
  sourceIndex?: SourceIndex;
}

/**
 * One citation's verdict: whether it is already under the new key, what its
 * `source.file` and `source.integrity` become, or why neither. The rule is
 * the same wherever the entry is kept, so the page splicer and the manifest
 * writer both go through here.
 */
async function verdictFor(
  ctx: Context,
  citation: Citation,
  opts: Pick<ReencryptOptions, "fromKey" | "toKey">,
): Promise<Verdict> {
  const range = sourceRange(citation.source);
  const underNew = decryptSourcePath(range.path, opts.toKey);
  // Done only when both halves are under the new key; a file that is and a
  // pin that is not is the half rotation this finishes.
  if (underNew !== undefined) {
    const held = await pinnedLines(ctx, citation, range, underNew, opts.toKey);
    if ("joined" in held) return { kind: "done" };
  }
  const path = underNew ?? decryptSourcePath(range.path, opts.fromKey);
  if (path === undefined) return { kind: "skip", message: UNDECRYPTABLE };
  const lines = await pinnedLines(ctx, citation, range, path, opts.fromKey);
  if ("skip" in lines) return { kind: "skip", message: lines.skip };
  const file = underNew === undefined ? encryptSourcePath(path, opts.toKey) : range.path;
  return {
    kind: "write",
    file,
    integrity: hashLines(lines.joined, opts.toKey),
    to: formatSrc({ ...range, path: file }),
  };
}

/** The git client and source index a run shares, built once per page at most. */
async function contextFor(opts: ReencryptOptions): Promise<Context> {
  const git = opts.gitClient ?? gitClient(opts.root);
  const index = opts.sourceIndex ?? (await buildSourceIndex(opts.root, { gitClient: git }));
  return { root: opts.root, index, git };
}

export async function reencryptCitations(
  page: { file: string; content: string; format?: string },
  opts: ReencryptOptions,
): Promise<ReencryptCitationsResult> {
  const read = readPage(page.file, page.content, page.format === undefined ? undefined : { format: page.format });
  const result: ReencryptCitationsResult = { content: page.content, rewritten: [], skipped: [] };
  const encrypted = read.citations.filter(({ citation }) => sourceRange(citation.source).encrypted);
  // A page with nothing encrypted costs no index and no git.
  if (encrypted.length === 0) return result;

  const ctx = await contextFor(opts);
  let after = page.content;
  for (const { citation, origin } of encrypted) {
    const range = sourceRange(citation.source);
    const where = whereOf(citation, origin);
    const verdict = await verdictFor(ctx, citation, opts);
    if (verdict.kind === "done") continue;
    if (verdict.kind === "skip") {
      result.skipped.push({ ...where, message: verdict.message });
      continue;
    }
    if (verdict.file !== range.path) {
      after = spliceEntryField(after, read.format, origin.index, ["source", "file"], verdict.file);
    }
    after = spliceEntryField(
      after,
      read.format,
      origin.index,
      ["source", "integrity"],
      verdict.integrity,
    );
    result.rewritten.push({ ...where, from: spellSource(citation.source), to: verdict.to });
  }
  result.content = after;
  return result;
}

/** What `reencryptCitationEntries` did to one page's manifest entries. */
export interface ReencryptEntriesResult {
  /** The entries as they should now be written, a copy of what came in. */
  entries: unknown[];
  /** Whether any of them changed. */
  changed: boolean;
  rewritten: ReencryptedCitation[];
  skipped: { id?: string; index?: number; line?: number; message: string }[];
}

/**
 * The same rotation, for a page whose citations live in a manifest.
 *
 * The entries come from meta's merge, so they are plain values; each one is
 * validated as `readPage` validates a frontmatter entry, and an encrypted
 * source's `file` and `integrity` are rewritten in place. The caller writes
 * the whole list back with one splice, once every page of the run could be
 * re-encrypted.
 */
export async function reencryptCitationEntries(
  page: { file: string; content: string; format?: string; citations: readonly CitationInput[] },
  opts: ReencryptOptions,
): Promise<ReencryptEntriesResult> {
  const entries: unknown[] = JSON.parse(
    JSON.stringify(page.citations.map((input) => input.entry)),
  ) as unknown[];
  const out: ReencryptEntriesResult = { entries, changed: false, rewritten: [], skipped: [] };

  const read = readPage(page.file, page.content, {
    ...(page.format === undefined ? {} : { format: page.format }),
    citations: page.citations,
  });
  const encrypted = read.citations.filter(({ citation }) => sourceRange(citation.source).encrypted);
  if (encrypted.length === 0) return out;

  const ctx = await contextFor(opts);
  for (const { citation, origin } of encrypted) {
    const where = whereOf(citation, origin);
    const verdict = await verdictFor(ctx, citation, opts);
    if (verdict.kind === "done") continue;
    if (verdict.kind === "skip") {
      out.skipped.push({ ...where, message: verdict.message });
      continue;
    }
    const entry: unknown = entries[origin.index];
    const source =
      typeof entry === "object" && entry !== null && !Array.isArray(entry)
        ? (entry as Record<string, unknown>).source
        : undefined;
    if (typeof source !== "object" || source === null || Array.isArray(source)) {
      out.skipped.push({ ...where, message: UNDECRYPTABLE });
      continue;
    }
    const fields = source as Record<string, unknown>;
    fields.file = verdict.file;
    fields.integrity = verdict.integrity;
    out.changed = true;
    out.rewritten.push({ ...where, from: spellSource(citation.source), to: verdict.to });
  }
  return out;
}
