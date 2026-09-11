/**
 * `reencryptCitations`: re-encrypt one page's encrypted citations under a new
 * key, for `manni key rotate` (proposal 0045). It reads sources and never
 * writes: the caller gets the rewritten page back, and writes it only once
 * every page in the run could be re-encrypted.
 *
 * For each citation, in either channel, whose `src` is encrypted: one that
 * already decrypts under the new key is done, so an interrupted rotation can
 * run again; one that decrypts under neither key is skipped. The path must be
 * tracked, and the keyed pin must hold under the old key, over the lines as
 * they are today or, with git, as they were at the entry's commit (the
 * classifier's history search). Then `src` becomes the path's ciphertext under
 * the new key, line suffix kept, and `integrity` the keyed pin under it, so a
 * `changed` citation stays exactly as changed. A pin that holds nowhere is
 * skipped, with `update --accept` named as the repair. No message names a
 * path.
 */
import type {
  Citation,
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
import { formatSrc, parseSrc } from "./range.js";
import { buildSourceIndex, decryptSourcePath, encryptSourcePath, readSource } from "./sources.js";
import { rewriteInlineFields, spliceEntryField } from "./write.js";

const UNDECRYPTABLE = "does not decrypt under the current key";
const MISSING = "missing (no tracked file matches)";
const CHANGED = "changed; run `manni cite update --accept` before rotating";

type Where = Pick<ReencryptedCitation, "id" | "index" | "line">;

/** The fields a report row carries to name the entry: its id, or where it sits. */
function whereOf(citation: Citation, origin: CitationOrigin): Where {
  const where: Where = {};
  if (citation.id !== undefined) where.id = citation.id;
  if (origin.kind === "frontmatter") {
    where.index = origin.index;
    if (origin.line !== undefined) where.line = origin.line;
  } else {
    where.line = origin.line;
  }
  return where;
}

/** Whether the page spelled this source encrypted. */
function citesEncrypted(src: string): boolean {
  try {
    return parseSrc(src).encrypted;
  } catch {
    return false;
  }
}

interface Context {
  root: string;
  index: SourceIndex;
  git: GitClient;
  fromKey: string;
  pageCommit?: string;
}

/**
 * The lines the pin was minted over, joined: today's when the keyed pin holds
 * there under the old key, else the lines at the entry's commit when git can
 * show them; else why neither.
 */
async function pinnedLines(
  ctx: Context,
  citation: Citation,
  range: SourceRange,
  path: string,
): Promise<{ joined: string } | { skip: string }> {
  const source = await readSource(ctx.root, ctx.index, { ...range, path, encrypted: false });
  if (source.kind === "missing") return { skip: MISSING };
  let joined: string | undefined;
  try {
    joined = sliceLines(splitLines(source.text), range);
  } catch {
    // The range runs past the end of the file as it is now.
    joined = undefined;
  }
  if (joined !== undefined && hashLines(joined, ctx.fromKey) === citation.integrity) return { joined };

  const commit = citation.commit ?? ctx.pageCommit;
  if (commit !== undefined && (await ctx.git.available())) {
    const history = await historyOf(ctx.git, commit, path, range, citation.integrity, ctx.fromKey, undefined);
    if (history.kind === "original") return { joined: history.lines.join("\n") };
  }
  return { skip: CHANGED };
}

export async function reencryptCitations(
  page: { file: string; content: string; format?: string },
  opts: {
    root: string;
    fromKey: string;
    toKey: string;
    /** History and the source index are read through it; defaults to one over the root. */
    gitClient?: GitClient;
    sourceIndex?: SourceIndex;
  },
): Promise<ReencryptCitationsResult> {
  const read = readPage(page.file, page.content, page.format === undefined ? undefined : { format: page.format });
  const result: ReencryptCitationsResult = { content: page.content, rewritten: [], skipped: [] };
  const encrypted = read.citations.filter(({ citation }) => citesEncrypted(citation.src));
  // A page with nothing encrypted costs no index and no git.
  if (encrypted.length === 0) return result;

  const git = opts.gitClient ?? gitClient(opts.root);
  const index = opts.sourceIndex ?? (await buildSourceIndex(opts.root, { gitClient: git }));
  const ctx: Context = { root: opts.root, index, git, fromKey: opts.fromKey };
  if (read.commit !== undefined) ctx.pageCommit = read.commit;

  let after = page.content;
  for (const { citation, origin } of encrypted) {
    const range = parseSrc(citation.src);
    const where = whereOf(citation, origin);
    // Already under the new key: done, which is what makes a rerun safe.
    if (decryptSourcePath(range.path, opts.toKey) !== undefined) continue;
    const path = decryptSourcePath(range.path, opts.fromKey);
    if (path === undefined) {
      result.skipped.push({ ...where, message: UNDECRYPTABLE });
      continue;
    }
    const lines = await pinnedLines(ctx, citation, range, path);
    if ("skip" in lines) {
      result.skipped.push({ ...where, message: lines.skip });
      continue;
    }
    const to = formatSrc({ ...range, path: encryptSourcePath(path, opts.toKey) });
    const integrity = hashLines(lines.joined, opts.toKey);
    if (origin.kind === "frontmatter") {
      after = spliceEntryField(after, read.format, origin.index, "src", to);
      after = spliceEntryField(after, read.format, origin.index, "integrity", integrity);
    } else {
      after = rewriteInlineFields(after, read.format, page.file, origin.line, { src: to, integrity });
    }
    result.rewritten.push({ ...where, from: citation.src, to });
  }
  result.content = after;
  return result;
}
