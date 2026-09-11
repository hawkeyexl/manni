/**
 * Mint a citation: read the range through the source index, hash it under the
 * rule (the keyed pin when the source is encrypted), record HEAD (40 hex)
 * unless told not to. Refuses (CiteError) a source the index does not hold, an
 * encrypted source the key cannot open, or a range past EOF. No refusal names
 * the path an encrypted source holds.
 */
import { ENCRYPTION_KEY_ENV } from "../../shared/encryption-key.js";
import { CiteError } from "../errors.js";
import type { Citation, MintOptions, MissingReason } from "../types.js";
import { hashLines, sliceLines, splitLines } from "./hash.js";
import { formatSrc, parseSrc } from "./range.js";
import { buildSourceIndex, encryptSourcePath, readSource } from "./sources.js";

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

/**
 * The refusal for a source that could not be read, naming it as the caller
 * spelled it: an encrypted source stays a ciphertext even on stderr.
 */
function refusalFor(reason: MissingReason, path: string, encrypted: boolean): CiteError {
  switch (reason) {
    case "untracked":
      return new CiteError(
        encrypted
          ? `No tracked file matches ${path} (wrong --root?).`
          : `Source not found: ${path} is not a tracked file under the root.`,
      );
    case "no-key":
      return new CiteError(`${path} is encrypted, and no encryption key is available to decrypt it.`);
    case "undecryptable":
      return new CiteError(`${path} does not decrypt under the current key.`);
    case "unreadable":
      return new CiteError(`Source not readable: ${path} could not be read.`);
  }
}

export async function mintCitation(opts: MintOptions): Promise<Citation> {
  const range = parseSrc(opts.src);
  const { key } = opts;
  // A src that is already encrypted stays encrypted whatever `encrypt` says:
  // the check side keys every pin whose src is encrypted, so a plain pin
  // under a ciphertext would never hold.
  const encrypt = opts.encrypt === true || range.encrypted;
  if (encrypt && !range.encrypted && key === undefined) {
    throw new CiteError(
      `${opts.src} must be encrypted, and no encryption key is available. Run \`manni key set\`, or set ${ENCRYPTION_KEY_ENV}.`,
    );
  }
  const index = opts.sourceIndex ?? (await buildSourceIndex(opts.root, { gitClient: opts.gitClient }));

  const source = await readSource(opts.root, index, range, key);
  if (source.kind === "missing") throw refusalFor(source.reason, range.path, range.encrypted);

  // The out-of-range error names the src as the caller spelled it, never a
  // decrypted path.
  const joined = sliceLines(splitLines(source.text), range, range.path);
  // Set whenever `encrypt` is: refused above for a plain src, and an
  // encrypted one could not have been read without it.
  const pinKey = encrypt ? key : undefined;
  const integrity = hashLines(joined, pinKey);
  const path =
    pinKey !== undefined && !range.encrypted ? encryptSourcePath(source.resolvedPath, pinKey) : range.path;
  const src = formatSrc({ ...range, path, encrypted: encrypt });
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
