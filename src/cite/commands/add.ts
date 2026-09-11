/**
 * `manni cite add`: mint one citation and write it to a page.
 *
 * Composition (proposal 0044 §5): `--claim` anchors the paragraph carrying
 * the sentence; `--quote` anchors the fenced block reproducing the range, or
 * with `--claim` requires the first block after the sentence to; neither is
 * a bare pin. The entry goes to the frontmatter, with a `cite <id>` reference
 * above the anchor when an id is given, or inline as a JSON statement under
 * `--inline`. Every refusal is a `CiteError` (exit 2) with the page and the
 * source spelled as the caller spelled them.
 */
import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { locateFrontmatter, writeFileAtomic } from "../../meta/index.js";
import { STDIN_LABEL, STDIN_TOKEN } from "../../meta/internal.js";
import { ensureEncryptionKey } from "../../shared/prompt.js";
import { blockMatches, findClaim, paragraphContains } from "../core/claims.js";
import { resolveCiteRun } from "../core/config.js";
import { GIT_UNAVAILABLE_COMMIT, gitClient } from "../core/git.js";
import { sliceLines, splitLines } from "../core/hash.js";
import { mintCitation } from "../core/mint.js";
import { readPage } from "../core/page.js";
import { parseSrc } from "../core/range.js";
import { buildSourceIndex, readSource } from "../core/sources.js";
import {
  assertInlineEntrySupported,
  detectEol,
  fencedBlockAfter,
  fencedBlocks,
  formatStatement,
  lineAt,
  offsetOfLine,
  paragraphAfter,
} from "../core/statements.js";
import { appendFrontmatterCitation, insertStatementBefore, unifiedDiff } from "../core/write.js";
import { CiteError } from "../errors.js";
import type { AddOptions, AddResult, Citation, InlineStatement, PageCitations, SourceIndex } from "../types.js";

/** The schema's id grammar, checked before anything is written. */
const ID = /^[a-z0-9][a-z0-9-]*$/;

/** Formats with a fenced-block locator (see `fencedBlockAfter`); `--quote` needs one. */
const FENCE_FORMATS = new Set(["markdown", "mdx", "asciidoc"]);

/**
 * An inline statement reads left to right on one line, so it leads with what
 * it pins (`src`, `integrity`, `commit`) and ends with the prose fields, as
 * the proposal's examples spell it. The frontmatter entry keeps mint's order.
 */
function inlineEntry(citation: Citation): Citation {
  const { id, src, integrity, commit, claim, quote } = citation;
  return {
    ...(id === undefined ? {} : { id }),
    src,
    integrity,
    ...(commit === undefined ? {} : { commit }),
    ...(claim === undefined ? {} : { claim }),
    ...(quote === undefined ? {} : { quote }),
  };
}

/** Where the citation anchors, as offsets into the page before any edit. */
interface Anchor {
  /** Start of the line a statement goes above: the paragraph's or the fence opener's. */
  insertAt: number;
  /** Start of the line reported as the anchor: the claim's, or the fence opener's. */
  at: number;
  /** A reference statement already marking the paragraph, found by `--id`. */
  marker?: InlineStatement;
}

const toPosix = (path: string): string => path.replace(/\\/g, "/");

function isEnoent(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

async function readPageFile(path: string, label: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isEnoent(error)) throw new CiteError(`File not found: "${label}".`);
    throw error;
  }
}

/** The reference statement as the format spells it, for the repeated-claim advice. */
function referenceHint(format: string): string {
  try {
    return formatStatement(format, { kind: "ref", id: "<id>" });
  } catch {
    return "<!-- cite <id> -->";
  }
}

/** The cited lines, joined as the hashing rule joins them. */
async function citedText(root: string, index: SourceIndex, src: string, key: string | undefined): Promise<string> {
  const range = parseSrc(src);
  const source = await readSource(root, index, range, key);
  // Minting already read this range, so a miss here is a race with the disk.
  if (source.kind === "missing") {
    throw new CiteError(`Source not readable: ${range.path} could not be read.`);
  }
  return sliceLines(splitLines(source.text), range, range.path);
}

/**
 * The paragraph the claim anchors. One hit is the anchor. Several are a
 * refusal, unless `--id` names a reference statement already sitting above
 * one of them: that is the repair the refusal itself prescribes.
 */
function anchorClaim(page: PageCitations, claim: string, id: string | undefined, label: string): Anchor {
  const { content } = page;
  const hits = findClaim(content, page.bodyOffset, claim);
  const [hit, ...more] = hits;
  if (hit === undefined) {
    throw new CiteError(`Claim not found in ${label}: "${claim}". Add the sentence first, or omit --claim.`);
  }
  if (more.length > 0) {
    const marker =
      id === undefined
        ? undefined
        : page.statements.find((s) => s.payload.kind === "ref" && s.payload.id === id);
    if (
      marker?.anchorLine !== undefined &&
      paragraphContains(content, offsetOfLine(content, marker.anchorLine), claim)
    ) {
      const at = offsetOfLine(content, marker.anchorLine);
      return { insertAt: at, at, marker };
    }
    throw new CiteError(
      `Claim occurs ${hits.length} times in ${label} (lines ${hits.map((h) => h.line).join(", ")}). ` +
        `Give it an --id and put \`${referenceHint(page.format)}\` above the intended paragraph.`,
    );
  }
  return { insertAt: hit.paragraphStart, at: offsetOfLine(content, hit.line) };
}

/**
 * The block `--quote` anchors: with a claim, the first fenced block after
 * its paragraph, which must reproduce the range; alone, the one block in the
 * body that does.
 */
function anchorQuote(page: PageCitations, cited: string, src: string, label: string, claim?: Anchor): Anchor {
  const { content, format } = page;
  if (claim) {
    const paragraph = paragraphAfter(content, claim.insertAt);
    const block = fencedBlockAfter(content, paragraph?.end ?? claim.at, format);
    if (!block) throw new CiteError(`No fenced block follows the claim in ${label}.`);
    if (!blockMatches(block.text, cited)) {
      throw new CiteError(`The fenced block after the claim in ${label} does not reproduce ${src}.`);
    }
    return claim;
  }
  const matches = fencedBlocks(content, page.bodyOffset, format).filter((b) => blockMatches(b.text, cited));
  const [block, ...more] = matches;
  if (block === undefined) throw new CiteError(`No fenced block in ${label} reproduces ${src}.`);
  if (more.length > 0) {
    throw new CiteError(
      `${matches.length} fenced blocks in ${label} reproduce ${src} (lines ${matches.map((b) => b.line).join(", ")}); ` +
        "add --claim to say which sentence introduces it.",
    );
  }
  const at = offsetOfLine(content, block.line);
  return { insertAt: at, at };
}

export async function runAdd(opts: AddOptions): Promise<AddResult> {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const run = await resolveCiteRun({
    cwd,
    configPath: opts.configPath,
    noConfig: opts.noConfig,
    inputs: [],
    root: opts.root,
    onConfigLoaded: opts.onConfigLoaded,
    onNotice: opts.onNotice,
    env: opts.env,
  });
  const { root } = run;

  const usingStdin = opts.page === STDIN_TOKEN;
  if (usingStdin && opts.as === undefined) {
    throw new CiteError("Reading from stdin (`-`) requires --as <format> to choose an extractor.");
  }
  // `-` names no file: nothing to resolve, and nothing to write back to.
  const path = usingStdin ? undefined : resolve(cwd, opts.page);
  const label = path === undefined ? STDIN_LABEL : toPosix(relative(cwd, path));
  const content = path === undefined ? (opts.stdinContent ?? "") : await readPageFile(path, label);
  const page = readPage(label, content, opts.as === undefined ? undefined : { format: opts.as });
  const { format } = page;

  // Composition first: these need no source and no search.
  const anchored = opts.claim !== undefined || opts.quote === true;
  if (opts.inline === true && !anchored) {
    throw new CiteError(
      "--inline needs --claim or --quote: an inline statement anchors the paragraph or block that follows it.",
    );
  }
  if (opts.id !== undefined && !anchored) {
    throw new CiteError("--id needs --claim or --quote: nothing would reference it.");
  }
  if (opts.id !== undefined && !ID.test(opts.id)) {
    throw new CiteError(
      `Invalid id "${opts.id}": use lowercase letters, digits and hyphens, starting with a letter or digit.`,
    );
  }
  if (opts.quote === true && !FENCE_FORMATS.has(format)) {
    throw new CiteError(`--quote needs a format with fenced blocks; ${label} is ${format}.`);
  }
  // A format that carries references only (asciidoc, rst) refuses an inline
  // entry before the source is read.
  if (opts.inline === true) assertInlineEntrySupported(format);
  if (opts.id !== undefined && page.citations.some((c) => c.citation.id === opts.id)) {
    throw new CiteError(`Id "${opts.id}" is already cited in ${label}.`);
  }

  // Git is used whenever it is there, as on check and update: the index is
  // `git ls-files` and the commit is HEAD. Where it is not, a walk and none.
  const client = opts.gitClient ?? gitClient(root);
  const sourceIndex = await buildSourceIndex(root, { gitClient: client });
  const mint = (key: string | undefined, encrypt: boolean): Promise<Citation> =>
    mintCitation({
      root,
      src: opts.src,
      claim: opts.claim,
      id: opts.id,
      quote: opts.quote === true ? true : undefined,
      commit: opts.commit === false ? false : undefined,
      encrypt,
      key,
      gitClient: client,
      sourceIndex,
    });

  // Encryption follows the key: an available one encrypts every add, with no
  // flag to remember, and `--encrypt` asks for one when there is none. With a
  // key in hand this mint is the citation written. Without one it is plain,
  // and settles every refusal that needs no key (the source, the range, the
  // anchors below) before the question is put, so a refused add never leaves
  // a key behind.
  const needsKey = opts.encrypt === true && run.key === undefined;
  let citation = await mint(run.key, run.key !== undefined);

  let anchor: Anchor | undefined;
  if (opts.claim !== undefined) anchor = anchorClaim(page, opts.claim, opts.id, label);
  if (opts.quote === true) {
    anchor = anchorQuote(page, await citedText(root, sourceIndex, opts.src, run.key), opts.src, label, anchor);
  }

  if (needsKey) {
    const { key } = await ensureEncryptionKey({
      subject: opts.src,
      cwd,
      file: run.configFile ?? null,
      env: opts.env,
      confirm: opts.confirm,
      notice: (message) => {
        opts.onNotice?.(message);
      },
      toError: (message) => new CiteError(message),
    });
    citation = await mint(key, true);
  }

  let after: string;
  let placed: AddResult["placed"];
  let statement: string | undefined;
  if (opts.inline === true) {
    after = content;
    placed = "inline";
    statement = formatStatement(format, { kind: "entry", entry: inlineEntry(citation) });
  } else {
    after = appendFrontmatterCitation(content, format, citation, label);
    placed = "frontmatter";
    if (opts.id !== undefined && anchor !== undefined && anchor.marker === undefined) {
      statement = formatStatement(format, { kind: "ref", id: opts.id });
    }
  }

  // The frontmatter append leaves the body's bytes alone, so body offsets
  // move by exactly what the block grew.
  const shift = (locateFrontmatter(after)?.closeEnd ?? 0) - page.bodyOffset;
  let anchorLine: number | undefined;
  let referenceLine: number | undefined;
  if (anchor !== undefined) {
    let at = anchor.at + shift;
    if (statement !== undefined) {
      const insertAt = anchor.insertAt + shift;
      after = insertStatementBefore(after, insertAt, statement);
      if (placed === "frontmatter") referenceLine = lineAt(after, insertAt);
      at += statement.length + detectEol(after).length;
    } else if (anchor.marker !== undefined) {
      referenceLine = lineAt(after, anchor.marker.start + shift);
    }
    anchorLine = lineAt(after, at);
  }

  const diff = unifiedDiff(label, content, after);
  const written = path !== undefined && opts.dryRun !== true;
  if (written) await writeFileAtomic(path, after);
  // A commit was wanted (no --no-commit) and git had none to give. Said once
  // the add has succeeded, so a refused add says nothing about git.
  if (opts.commit !== false && !(await client.available())) opts.onNotice?.(GIT_UNAVAILABLE_COMMIT);

  const result: AddResult = { file: label, citation, placed, content: after, diff, written };
  if (anchorLine !== undefined) result.anchorLine = anchorLine;
  if (referenceLine !== undefined) result.referenceLine = referenceLine;
  return result;
}
