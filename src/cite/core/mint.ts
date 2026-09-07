/**
 * Mint a citation: read the range through the source index, hash it under the
 * rule (keyed when obfuscating), record HEAD (40 hex) unless told not to.
 * Refuses (CiteError) a source the index does not hold, or a range past EOF.
 */
import { CiteError } from "../errors.js";
import type { Citation, MintOptions } from "../types.js";
import { hashLines, sliceLines, splitLines } from "./hash.js";
import { formatSrc, parseSrc } from "./range.js";
import { buildSourceIndex, obfuscatePath, readSource } from "./sources.js";

/** The schema's `commit` pattern: seven to forty lowercase hex digits. */
const COMMIT_PATTERN = /^[0-9a-f]{7,40}$/;

async function commitFor(opts: MintOptions): Promise<string | undefined> {
  if (opts.commit === false) return undefined;
  if (typeof opts.commit === "string") {
    if (!COMMIT_PATTERN.test(opts.commit)) {
      throw new CiteError(`Invalid commit "${opts.commit}": expected 7 to 40 lowercase hex digits.`);
    }
    return opts.commit;
  }
  const client = opts.gitClient;
  if (client === undefined || !(await client.available())) return undefined;
  return (await client.head()) ?? undefined;
}

export async function mintCitation(opts: MintOptions): Promise<Citation> {
  const range = parseSrc(opts.src);
  const salt = opts.salt ?? "";
  const index =
    opts.sourceIndex ?? (await buildSourceIndex(opts.root, salt, { gitClient: opts.gitClient }));

  const source = await readSource(opts.root, index, range);
  if (source.kind === "missing") {
    switch (source.reason) {
      case "untracked":
        throw new CiteError(`Source not found: ${range.path} is not a tracked file under the root.`);
      case "unresolved-token":
        throw new CiteError(`No tracked file matches ${range.path} (wrong --root or salt?).`);
      case "unreadable":
        throw new CiteError(`Source not readable: ${range.path} could not be read.`);
    }
  }

  // A src that is already a token stays keyed whatever `obfuscate` says: the
  // check side keys every pin whose src is a token, so a plain pin under a
  // token would never hold.
  const obfuscated = opts.obfuscate === true || range.obfuscated;
  // The out-of-range error names the src as the caller spelled it, never a
  // resolved path: a token stays a token even on stderr.
  const joined = sliceLines(splitLines(source.text), range, range.path);
  const integrity = hashLines(joined, obfuscated ? salt : undefined);
  const path = obfuscated && !range.obfuscated ? obfuscatePath(source.resolvedPath, salt) : range.path;
  const src = formatSrc({ ...range, path, obfuscated });
  const commit = await commitFor(opts);

  const citation: Citation = { src, integrity };
  // Field order is the order a reader scans an entry in: what it is, what it
  // says, then where and how it is pinned.
  const ordered: Citation = {
    ...(opts.id === undefined ? {} : { id: opts.id }),
    ...(opts.claim === undefined ? {} : { claim: opts.claim }),
    ...citation,
    ...(commit === undefined ? {} : { commit }),
    ...(opts.quote === undefined ? {} : { quote: opts.quote }),
  };
  return ordered;
}
