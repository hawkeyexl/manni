/**
 * `manni cite add`: mint one citation and write it to a page.
 *
 * The page lines are the claim: `add docs/limits.md:9 lib/limits.ts:2` pins
 * line 9 of the page to line 2 of the source. Lines reach the command as an
 * editor numbers them and are stored body-relative, so editing the
 * frontmatter never moves them. `--marker` writes a `cite <id>` comment above
 * those lines instead, and pins the text it anchors; `--quote` says the lines
 * are a fenced block that reproduces the source. No lines at all is a bare
 * pin: this page rests on these lines, say so when they change.
 *
 * Every refusal is a `CiteError` (exit 2) with the page and the source
 * spelled as the caller spelled them, and nothing is written. Among them are
 * the pins the command can already see are wrong: a duplicate of an entry the
 * page has, and a claim whose lines hold no text at all.
 */
import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { locateFrontmatter, writeFileAtomic } from "../../meta/index.js";
import { STDIN_LABEL, STDIN_TOKEN } from "../../meta/internal.js";
import { ensureEncryptionKey } from "../../shared/prompt.js";
import { isEncryptedValue } from "../../shared/encryption.js";
import {
  blockMatches,
  otherClaimSpans,
  pinOfLines,
  spellElsewhere,
  toBodyLines,
  toFileLines,
} from "../core/claims.js";
import { resolveCiteRun } from "../core/config.js";
import { GIT_UNAVAILABLE_COMMIT, gitClient } from "../core/git.js";
import { sliceLines, splitLines } from "../core/hash.js";
import { mintCitation } from "../core/mint.js";
import { bodyLineOf, readPage } from "../core/page.js";
import {
  formatSrc,
  lineSpec,
  parseLines,
  parseSrc,
  spellLines,
  spellSource,
  tooWide,
} from "../core/range.js";
import { misplacedMarkers } from "../core/reanchor.js";
import { shiftedEntries, withClaimLines, type Shifted } from "../core/shift.js";
import { readSource, sourceIndexFor } from "../core/sources.js";
import { shortSrc, spellAt } from "../core/spell.js";
import { ManifestSet } from "../core/manifest.js";
import { sidecarsFor, type PageSidecar } from "../core/sidecar.js";
import {
  ANY_FENCE,
  MAX_IDS_PER_MARKER,
  anchoredLines,
  fenceSpanAt,
  formatStatement,
  isMarkerLine,
  markerIndent,
  offsetOfLine,
  respellStatement,
  unitHolding,
} from "../core/statements.js";
import {
  appendFrontmatterCitation,
  entryObject,
  insertStatementBefore,
  spliceEntryField,
  unifiedDiff,
} from "../core/write.js";
import { CiteError } from "../errors.js";
import type {
  AddOptions,
  AddResult,
  Citation,
  CitationClaim,
  PageCitation,
  PageCitations,
  PageLines,
  SourceIndex,
} from "../types.js";

/** The schema's id grammar, checked before anything is written. */
const ID = /^[a-z0-9][a-z0-9-]*$/;

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

/** The cited lines, joined as the hashing rule joins them. */
async function citedText(
  root: string,
  index: SourceIndex,
  src: string,
  key: string | undefined,
): Promise<string> {
  const range = parseSrc(src);
  const source = await readSource(root, index, range, key);
  // Minting already read this range, so a miss here is a race with the disk.
  if (source.kind === "missing") {
    throw new CiteError(`Source not readable: ${range.path} could not be read.`);
  }
  return sliceLines(splitLines(source.text), range, range.path);
}

/** How a refusal names an entry: its id, or the pointer a report would use. */
function entryName(entry: PageCitation): string {
  return entry.citation.id ?? `/citations/${String(entry.origin.index)}`;
}

/**
 * The entry that already pins these very page lines to this very source, in
 * the frontmatter or in the manifest that owns the page's citations. A bare
 * pin matches another bare pin over the same source.
 *
 * The source is compared as each end spells it, so an encrypted one compares
 * as its ciphertext and no path is decrypted to say so. A marker add is not
 * asked: it stores no claim lines, and its own id and anchor checks cover it.
 */
function duplicateOf(
  page: PageCitations,
  src: string,
  pageLines: PageLines | undefined,
): PageCitation | undefined {
  // opts.src is the caller's plain-path spelling; an existing entry encrypted
  // under a key compares as its ciphertext and will never match here.
  const wanted = formatSrc(parseSrc(src));
  return page.citations.find((entry) => {
    const { citation } = entry;
    if (spellSource(citation.source) !== wanted) return false;
    if (pageLines === undefined) return citation.claim === undefined;
    const spec = citation.claim?.lines;
    if (spec === undefined) return false;
    const recorded = parseLines(spec);
    if (recorded === undefined) return false;
    const file = toFileLines(recorded, page.bodyLine);
    return file.start === pageLines.start && file.end === pageLines.end;
  });
}

/** Whether a page line can hold no claim at all: it is blank, or it is a fence. */
function holdsNoText(text: string): boolean {
  return text.trim() === "" || ANY_FENCE.test(text);
}

/**
 * The refusal for a claim whose lines hold no text, `at` being the page and
 * the lines as the caller spelled them. Undefined when at least one line
 * carries text. `--quote` never asks, because a quote is fences and content
 * by design.
 */
function emptyClaimRefusal(
  lines: readonly string[],
  pageLines: PageLines,
  at: string,
): string | undefined {
  const span = lines.slice(pageLines.start - 1, pageLines.end);
  if (span.some((text) => !holdsNoText(text))) return undefined;
  if (pageLines.start !== pageLines.end) return `${at} holds no claim text.`;
  const only = span[0] ?? "";
  return only.trim() === "" ? `${at} is blank.` : `${at} is a fence line, not claim text.`;
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

  // The manifests that own `citations`, if any collection declares one. The
  // page is labelled from the working directory here, so membership is
  // measured from there too.
  const sidecars = await sidecarsFor(run, { base: cwd });
  const firstManifest = sidecars?.manifests[0];
  if (usingStdin && firstManifest !== undefined) {
    const keyedBy = firstManifest.join === "path" ? "path" : firstManifest.join;
    throw new CiteError(
      `A page read from stdin has no path, and its citations live in ${firstManifest.file}, which is keyed by ${keyedBy}.`,
    );
  }
  const sidecar: PageSidecar | undefined = usingStdin
    ? undefined
    : sidecars?.forPage(label, content, opts.as);
  const owner = sidecar?.owner;

  const page = readPage(label, content, {
    ...(opts.as === undefined ? {} : { format: opts.as }),
    // The entries already there are the manifest's, so `--id` uniqueness and
    // the marker checks are measured against them and not against a page
    // that carries none.
    ...(sidecar?.citations === undefined ? {} : { citations: sidecar.citations }),
    ...(owner === undefined ? {} : { owned: { file: owner.file, collection: owner.collection } }),
  });
  const { format } = page;

  const pageLines = opts.pageLines;
  const marker = opts.marker === true;
  const quote = opts.quote === true;
  const at = pageLines === undefined ? "" : `${label}:${spellLines(pageLines)}`;

  // Composition first: these need no source and no search.
  if (marker && pageLines === undefined) {
    throw new CiteError(`--marker needs the page lines to anchor: ${label}:L.`);
  }
  if (marker && opts.id === undefined) {
    throw new CiteError("--marker needs --id: the marker names the entry.");
  }
  const wide = pageLines === undefined ? undefined : tooWide(pageLines);
  if (wide !== undefined) throw new CiteError(`Invalid range "${at}": it ${wide}.`);
  if (quote && pageLines === undefined) {
    throw new CiteError(`--quote needs the block's lines: ${label}:L1-L2.`);
  }
  if (opts.id !== undefined && !ID.test(opts.id)) {
    throw new CiteError(
      `Invalid id "${opts.id}": use lowercase letters, digits and hyphens, starting with a letter or digit.`,
    );
  }
  if (opts.id !== undefined && page.citations.some((c) => c.citation.id === opts.id)) {
    throw new CiteError(`${label} already has an entry ${opts.id}.`);
  }
  if (marker && opts.id !== undefined) {
    // Joining an id a marker already names would write it twice into one
    // list, which is `marker-invalid`. The entry check above catches the
    // ordinary case; this one is left by a marker whose entry went away.
    const already = page.statements.find(
      (s) => s.payload.kind === "ref" && s.payload.ids.includes(opts.id ?? ""),
    );
    if (already !== undefined) {
      throw new CiteError(
        `${label} already has a marker ${opts.id} at line ${String(already.line)}.`,
      );
    }
  }
  // The same claim on the same source twice is one citation reported twice,
  // and the second is what a re-run of a script writes.
  const duplicate = marker ? undefined : duplicateOf(page, opts.src, pageLines);
  if (duplicate !== undefined) {
    const src = shortSrc(spellSource(duplicate.citation.source));
    const what =
      pageLines === undefined
        ? `a bare pin for ${src}`
        : `an entry for ${spellAt(pageLines)} and ${src}`;
    throw new CiteError(`${label} already has ${what} (${entryName(duplicate)}).`);
  }

  const lines = splitLines(content);
  if (pageLines !== undefined) {
    if (pageLines.end > lines.length) {
      throw new CiteError(`${at} is past the end of the page (${String(lines.length)} lines).`);
    }
    if (pageLines.start < page.bodyLine) {
      throw new CiteError(`${at} is in the frontmatter. A claim is body text.`);
    }
    if (quote) {
      const span = fenceSpanAt(content, pageLines.start, format);
      if (span === undefined || span.end !== pageLines.end) {
        throw new CiteError(`${at} is not a fenced block, so it cannot be a quote.`);
      }
    } else if (!marker) {
      // A pin over a fence or a blank line holds for as long as the page has
      // one, so a check would call it `current` whatever the prose does.
      const empty = emptyClaimRefusal(lines, pageLines, at);
      if (empty !== undefined) throw new CiteError(empty);
    }
    // `add` does not move a marker it did not write, so it refuses to write
    // where a misplaced one would make its entry wrong (proposal 0054).
    const split = misplacedMarkers(page, lines);
    const held = split.find(
      (found) => found.line >= pageLines.start && found.line <= pageLines.end,
    );
    if (held !== undefined) {
      throw new CiteError(
        `${at} holds the marker at line ${String(held.line)}, which splits its paragraph. Run manni cite update first.`,
      );
    }
    const inside = marker
      ? split.find(
          (found) => pageLines.start >= found.unit.start && pageLines.start <= found.unit.end,
        )
      : undefined;
    if (inside !== undefined) {
      throw new CiteError(
        `${at} is in the paragraph at ${spellAt(inside.unit)}, which the marker at line ${String(inside.line)} splits. Run manni cite update first.`,
      );
    }
  }

  // Git is used whenever it is there, as on check and update: the index is
  // `git ls-files` and the commit is HEAD. Where it is not, a walk and none.
  const client = opts.gitClient ?? gitClient(root);
  const sourceIndex = await sourceIndexFor(root, client);

  // The marker goes in before the claim is pinned, because what it anchors is
  // what the claim pins. Everything below counts lines in `body`, the page
  // with the marker, and the frontmatter append shifts them once at the end.
  let body = content;
  let markerAt: number | undefined;
  /** Whether the id joined a marker already there, rather than getting a line. */
  let markerJoined = false;
  let claimSpan: PageLines | undefined;
  let claim: CitationClaim | undefined;
  // Where else the claim's text sits, for the notice at the end of the run.
  let elsewhere: PageLines[] = [];
  // Entries whose claim lines sit below a marker move down with the text.
  let shifted: Shifted = { frontmatter: [], manifest: new Map() };
  if (marker && pageLines !== undefined) {
    // The marker goes above the paragraph or block holding the lines, below
    // any markers already stacked there, at its indentation, and the lines
    // must stay inside it.
    // A marker line is never part of a pin, so a marker written there would
    // change what the line below it pins. The refusal is keyed to the line
    // rather than to what the marker names.
    if (isMarkerLine(lines[pageLines.start - 1] ?? "", format)) {
      throw new CiteError(
        `${label}:${String(pageLines.start)} is a marker line. A marker there would change its pin.`,
      );
    }
    const holding = unitHolding(content, pageLines.start, format, {
      offset: page.bodyOffset,
      line: page.bodyLine,
    });
    if (holding === undefined) {
      throw new CiteError(`${at} has no paragraph or block for a marker to anchor.`);
    }
    if (pageLines.end > holding.end) {
      throw new CiteError(
        `${at} runs past the ${holding.kind} at ${spellAt(holding)}. A marker anchors one paragraph.`,
      );
    }
    // A marker pins everything it anchors, so the range limit applies to that.
    const unitWide = tooWide({ start: holding.start, end: holding.end });
    if (unitWide !== undefined) {
      throw new CiteError(
        `${at} is in a ${holding.kind} at ${spellAt(holding)} that ${unitWide}. A marker anchors the whole ${holding.kind}.`,
      );
    }
    // The marker nearest the anchored text: the one on the text own line when
    // there is one, else the last marker line above it. A reader associates
    // the nearest comment with the prose, and appending there needs no other
    // line to move (proposal 0056).
    const above = page.statements.filter((s) => s.anchorLine === holding.start);
    const nearest = above[above.length - 1];
    // A marker already holding the cap takes no more, so the twenty-sixth
    // citation gets a marker line of its own. Refusing would leave no way to
    // cite the paragraph short of editing the line by hand. A marker the
    // scanner could not read is left alone for the same reason.
    const held =
      nearest !== undefined &&
      nearest.payload.kind === "ref" &&
      nearest.payload.ids.length < MAX_IDS_PER_MARKER
        ? nearest.payload.ids
        : undefined;
    /** Where the marker ends in `body`, so what follows it can be anchored. */
    let after: number;
    if (nearest !== undefined && held !== undefined) {
      body = respellStatement(content, nearest, [...held, opts.id ?? ""]);
      // Joining changes one line in place, so nothing below it moves and no
      // claim on the page is re-spelled.
      after = nearest.end + (body.length - content.length);
      markerAt = nearest.line;
      markerJoined = true;
    } else {
      shifted = shiftedEntries({
        citations: page.citations,
        at: [holding.start],
        delta: 1,
        bodyLine: page.bodyLine,
        label,
      });
      const statement =
        markerIndent(content, holding.start, format, page.bodyLine) +
        formatStatement(format, { kind: "ref", ids: [opts.id ?? ""] });
      const insertAt = offsetOfLine(content, holding.start);
      body = insertStatementBefore(content, insertAt, statement);
      after = insertAt + statement.length;
      markerAt = holding.start;
    }
    const unit = anchoredLines(body, after, format, quote);
    const pin = unit === undefined ? undefined : pinOfLines(splitLines(body), unit);
    if (unit === undefined || pin === undefined) {
      throw new CiteError(`${at} has no paragraph or block for a marker to anchor.`);
    }
    for (const { index, lines: moved } of shifted.frontmatter) {
      body = spliceEntryField(body, format, index, ["claim", "lines"], moved);
    }
    claimSpan = unit;
    claim = { integrity: pin };
  } else if (pageLines !== undefined) {
    const pin = pinOfLines(lines, pageLines);
    if (pin === undefined) {
      throw new CiteError(`${at} is past the end of the page (${String(lines.length)} lines).`);
    }
    claimSpan = pageLines;
    claim = { lines: lineSpec(toBodyLines(pageLines, page.bodyLine)), integrity: pin };
    elsewhere = otherClaimSpans(lines, pageLines, pin, page.bodyLine);
  }

  const mint = (key: string | undefined, encrypt: boolean): Promise<Citation> =>
    mintCitation({
      root,
      src: opts.src,
      ...(opts.id === undefined ? {} : { id: opts.id }),
      ...(claim === undefined ? {} : { claim }),
      ...(quote ? { quote: true } : {}),
      ...(opts.commitSha === false ? { commitSha: false as const } : {}),
      encrypt,
      ...(key === undefined ? {} : { key }),
      gitClient: client,
      sourceIndex,
    });

  // Encryption follows the key: an available one encrypts every add, with no
  // flag to remember, and `--encrypt` asks for one when there is none. With a
  // key in hand this mint is the citation written. Without one it is plain,
  // and settles every refusal that needs no key before the question is put,
  // so a refused add never leaves a key behind.
  const needsKey = opts.encrypt === true && run.key === undefined;
  let citation = await mint(run.key, run.key !== undefined);

  if (quote && claimSpan !== undefined) {
    // The lines inside the fences are what the source has to match.
    const cited = await citedText(root, sourceIndex, opts.src, run.key);
    const inside = splitLines(body).slice(claimSpan.start, claimSpan.end - 1).join("\n");
    if (!blockMatches(inside, cited)) {
      throw new CiteError(`The block at ${at} does not reproduce ${opts.src}.`);
    }
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

  // The first pinned source line, so the report shows what the range caught
  // and a mis-typed one is visible at write time. A whole file has no first
  // line worth naming, and an encrypted source is never spelled in the open.
  const srcRange = parseSrc(opts.src);
  let sourceLine: string | undefined;
  if (srcRange.start !== undefined && !isEncryptedValue(citation.source.file)) {
    const read = await readSource(root, sourceIndex, srcRange, undefined);
    if (read.kind === "ok") sourceLine = splitLines(read.text)[srcRange.start - 1];
  }

  // Where the entry goes follows the config, not a flag: a collection whose
  // manifest owns `citations` keeps them there, and the page is left alone
  // but for a marker.
  const manifests = new ManifestSet();
  let placed: AddResult["manifest"];
  /** Which item of the entry's `citations` this run added, for the line report. */
  let index = 0;
  if (owner !== undefined) {
    if (sidecar?.entry === undefined) {
      throw new CiteError(
        `${label} carries no ${owner.join}: value, so its citations cannot be keyed in ${owner.file}.`,
      );
    }
    const existing = (sidecar.citations ?? []).map((input, index) => {
      const moved = shifted.manifest.get(index);
      return moved === undefined ? input.entry : withClaimLines(input.entry, moved);
    });
    const list = [...existing, entryObject(citation)];
    index = list.length - 1;
    const at = await manifests.write(owner, sidecar.entry, list, index);
    const [changed] = manifests.changed();
    placed = {
      file: at.file,
      line: at.line,
      content: changed?.text ?? "",
      diff: changed?.diff ?? "",
      written: false,
    };
  }

  const after = owner === undefined ? appendFrontmatterCitation(body, format, citation, label) : body;
  // The frontmatter append leaves the body's bytes alone, so every body line
  // moves by exactly what the block grew. The marker sits in the body, so the
  // page it was inserted into already has this page's body line. An entry
  // written to a manifest grows no block, so nothing moves.
  const shift = bodyLineOf(after, locateFrontmatter(after)?.closeEnd ?? 0) - page.bodyLine;

  const result: AddResult = {
    file: label,
    citation,
    placed: owner === undefined ? "frontmatter" : "manifest",
    content: after,
    diff: unifiedDiff(label, content, after),
    written: false,
    ...(sourceLine === undefined ? {} : { sourceLine }),
    ...(placed === undefined ? {} : { manifest: placed }),
  };
  if (markerAt !== undefined) result.markerLine = markerAt + shift;
  if (markerJoined) result.markerJoined = true;
  if (claimSpan !== undefined) {
    result.claimLines = { start: claimSpan.start + shift, end: claimSpan.end + shift };
  }

  // A manifest entry leaves the page byte for byte as it was, unless a
  // marker went into the body; there is then nothing to write.
  result.written = path !== undefined && opts.dryRun !== true && after !== content;
  if (result.written && path !== undefined) await writeFileAtomic(path, after);
  // The entry goes in under compare-and-swap, so what lands may be a replay
  // onto a manifest another command wrote while this one was running. The
  // report names the bytes and the line that actually landed, not the ones
  // this run spliced from.
  if (result.manifest !== undefined && opts.dryRun !== true) {
    const [settled] = await manifests.commit();
    if (owner !== undefined && sidecar?.entry !== undefined) {
      result.manifest.line = manifests.lineOf(owner, sidecar.entry, index) ?? result.manifest.line;
    }
    if (settled !== undefined) {
      result.manifest.content = settled.text;
      result.manifest.diff = settled.diff;
    }
    result.manifest.written = true;
  }
  // The claim's text repeats, so a later move of it could not be told apart
  // from its copies. Said once the entry is written: it is not a refusal, and
  // the lines it names are the page's own after the write.
  if (elsewhere.length > 0) {
    const named = elsewhere.map((span) => ({ start: span.start + shift, end: span.end + shift }));
    const who = citation.id === undefined ? "" : `${citation.id}: `;
    opts.onNotice?.(
      `${who}the claim's text also appears at ${spellElsewhere(named)}, so a move would be ambiguous. Use --marker, or pin more lines.`,
    );
  }
  // A commit was wanted (no --no-commit-sha) and git had none to give. Said
  // once the add has succeeded, so a refused add says nothing about git.
  if (opts.commitSha !== false && !(await client.available())) {
    opts.onNotice?.(GIT_UNAVAILABLE_COMMIT);
  }
  return result;
}
