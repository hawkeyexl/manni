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
 * spelled as the caller spelled them, and nothing is written.
 */
import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { locateFrontmatter, writeFileAtomic } from "../../meta/index.js";
import { STDIN_LABEL, STDIN_TOKEN } from "../../meta/internal.js";
import { ensureEncryptionKey } from "../../shared/prompt.js";
import { blockMatches, pinOfLines, toBodyLines } from "../core/claims.js";
import { resolveCiteRun } from "../core/config.js";
import { GIT_UNAVAILABLE_COMMIT, gitClient } from "../core/git.js";
import { sliceLines, splitLines } from "../core/hash.js";
import { mintCitation } from "../core/mint.js";
import { bodyLineOf, readPage } from "../core/page.js";
import { lineSpec, parseSrc, spellLines } from "../core/range.js";
import { buildSourceIndex, readSource } from "../core/sources.js";
import { ManifestSet } from "../core/manifest.js";
import { sidecarsFor, type PageSidecar } from "../core/sidecar.js";
import { anchoredLines, fenceSpanAt, formatStatement, offsetOfLine } from "../core/statements.js";
import {
  appendFrontmatterCitation,
  entryObject,
  insertStatementBefore,
  unifiedDiff,
} from "../core/write.js";
import { CiteError } from "../errors.js";
import type {
  AddOptions,
  AddResult,
  Citation,
  CitationClaim,
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
    const already = page.statements.find(
      (s) => s.payload.kind === "ref" && s.payload.id === opts.id,
    );
    if (already !== undefined) {
      throw new CiteError(
        `${label} already has a marker ${opts.id} at line ${String(already.line)}.`,
      );
    }
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
    }
  }

  // Git is used whenever it is there, as on check and update: the index is
  // `git ls-files` and the commit is HEAD. Where it is not, a walk and none.
  const client = opts.gitClient ?? gitClient(root);
  const sourceIndex = await buildSourceIndex(root, { gitClient: client });

  // The marker goes in before the claim is pinned, because what it anchors is
  // what the claim pins. Everything below counts lines in `body`, the page
  // with the marker, and the frontmatter append shifts them once at the end.
  let body = content;
  let markerAt: number | undefined;
  let claimSpan: PageLines | undefined;
  let claim: CitationClaim | undefined;
  if (marker && pageLines !== undefined) {
    const statement = formatStatement(format, { kind: "ref", id: opts.id ?? "" });
    const insertAt = offsetOfLine(content, pageLines.start);
    body = insertStatementBefore(content, insertAt, statement);
    markerAt = pageLines.start;
    const unit = anchoredLines(body, insertAt + statement.length, format, quote);
    const pin = unit === undefined ? undefined : pinOfLines(splitLines(body), unit);
    if (unit === undefined || pin === undefined) {
      throw new CiteError(`${at} has no paragraph or block for a marker to anchor.`);
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

  // Where the entry goes follows the config, not a flag: a collection whose
  // manifest owns `citations` keeps them there, and the page is left alone
  // but for a marker.
  const manifests = new ManifestSet();
  let placed: AddResult["manifest"];
  if (owner !== undefined) {
    if (sidecar?.entry === undefined) {
      throw new CiteError(
        `${label} carries no ${owner.join}: value, so its citations cannot be keyed in ${owner.file}.`,
      );
    }
    const existing = (sidecar.citations ?? []).map((input) => input.entry);
    const list = [...existing, entryObject(citation)];
    const at = await manifests.write(owner, sidecar.entry, list, list.length - 1);
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
    ...(placed === undefined ? {} : { manifest: placed }),
  };
  if (markerAt !== undefined) result.markerLine = markerAt + shift;
  if (claimSpan !== undefined) {
    result.claimLines = { start: claimSpan.start + shift, end: claimSpan.end + shift };
  }

  // A manifest entry leaves the page byte for byte as it was, unless a
  // marker went into the body; there is then nothing to write.
  result.written = path !== undefined && opts.dryRun !== true && after !== content;
  if (result.written && path !== undefined) await writeFileAtomic(path, after);
  if (result.manifest !== undefined && opts.dryRun !== true) {
    for (const changed of manifests.changed()) await writeFileAtomic(changed.path, changed.text);
    result.manifest.written = true;
  }
  // A commit was wanted (no --no-commit-sha) and git had none to give. Said
  // once the add has succeeded, so a refused add says nothing about git.
  if (opts.commitSha !== false && !(await client.available())) {
    opts.onNotice?.(GIT_UNAVAILABLE_COMMIT);
  }
  return result;
}
