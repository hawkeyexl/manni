/**
 * Mint a citation's source end: read the range through the source index, hash
 * it under the rule (the keyed pin when the source is encrypted), record HEAD
 * unless told not to. Refuses (CiteError) a source the index does not hold, an
 * encrypted source the key cannot open, a range wider than
 * `MAX_RANGE_LINES`, a range past EOF, or a commit that does not contain the
 * lines it would be recorded against. No refusal names the path an encrypted
 * source holds.
 *
 * The claim end is minted by the caller, over the page lines it was given,
 * and passed in whole.
 */
import { ENCRYPTION_KEY_ENV } from "../../shared/encryption-key.js";
import { CiteError } from "../errors.js";
import type {
  Citation,
  CitationSource,
  MintOptions,
  MissingReason,
  SourceRange,
} from "../types.js";
import { historyOf } from "./classify.js";
import { hashLines, sliceLines, splitLines } from "./hash.js";
import { parseSrc, rangeLines, tooWide } from "./range.js";
import { buildSourceIndex, encryptSourcePath, readSource } from "./sources.js";

/** The schema's `commit-sha` pattern: seven to sixty-four lowercase hex digits. */
const COMMIT_PATTERN = /^[0-9a-f]{7,64}$/;

async function commitFor(opts: MintOptions): Promise<string | undefined> {
  if (opts.commitSha === false) return undefined;
  if (typeof opts.commitSha === "string") {
    if (!COMMIT_PATTERN.test(opts.commitSha)) {
      throw new CiteError(
        `Invalid commit-sha "${opts.commitSha}": expected 7 to 64 lowercase hex digits.`,
      );
    }
    return opts.commitSha;
  }
  const client = opts.gitClient;
  if (client === undefined || !(await client.available())) return undefined;
  return (await client.head()) ?? undefined;
}

/**
 * Refuse a commit that does not contain the lines it would be recorded
 * against. The range is read from the working tree, so an uncommitted edit
 * would otherwise be dated to a commit that never held it. Such a pin reads as
 * `current` forever, because `classifyCitation` returns at the working-tree
 * match without consulting the commit, and then accuses the source of
 * `source-never-true` the first time it changes.
 *
 * `historyOf` is the same question `check` asks, so the answers agree. It
 * accepts the lines sitting elsewhere in the file at that commit, which is what
 * `update` leaves behind when it follows a move and keeps `commit`.
 *
 * A commit git cannot read is recorded unverified. A shallow clone must
 * degrade to "history unavailable" rather than refuse (`git.ts`).
 */
async function assertCommitHolds(
  opts: MintOptions,
  commit: string,
  path: string,
  range: SourceRange,
  pin: string,
  key: string | undefined,
): Promise<void> {
  const client = opts.gitClient;
  if (client === undefined || !(await client.available())) return;
  const history = await historyOf(client, commit, path, range, pin, key, undefined);
  if (history.kind !== "never-true") return;
  // Named as the caller spelled it: an encrypted source stays a ciphertext.
  throw new CiteError(
    `${opts.src} is not committed: ${commit.slice(0, 7)} does not contain those lines. Commit the source, or use --no-commit-sha.`,
  );
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
  const wide =
    range.start === undefined || range.end === undefined
      ? undefined
      : tooWide({ start: range.start, end: range.end });
  if (wide !== undefined) throw new CiteError(`Invalid range "${opts.src}": it ${wide}.`);
  const { key } = opts;
  // A source that is already encrypted stays encrypted whatever `encrypt`
  // says: the check side keys every pin whose file is encrypted, so a plain
  // pin under a ciphertext would never hold.
  const encrypt = opts.encrypt === true || range.encrypted;
  if (encrypt && !range.encrypted && key === undefined) {
    throw new CiteError(
      `${opts.src} must be encrypted, and no encryption key is available. Run \`manni key set\`, or set ${ENCRYPTION_KEY_ENV}.`,
    );
  }
  const index = opts.sourceIndex ?? (await buildSourceIndex(opts.root, { gitClient: opts.gitClient }));

  const read = await readSource(opts.root, index, range, key);
  if (read.kind === "missing") throw refusalFor(read.reason, range.path, range.encrypted);

  // The out-of-range error names the source as the caller spelled it, never a
  // decrypted path.
  const joined = sliceLines(splitLines(read.text), range, range.path);
  // Set whenever `encrypt` is: refused above for a plain source, and an
  // encrypted one could not have been read without it.
  const pinKey = encrypt ? key : undefined;
  const file =
    pinKey !== undefined && !range.encrypted ? encryptSourcePath(read.resolvedPath, pinKey) : range.path;
  const lines = rangeLines(range);
  const commitSha = await commitFor(opts);
  const integrity = hashLines(joined, pinKey);
  if (commitSha !== undefined) {
    await assertCommitHolds(opts, commitSha, read.resolvedPath, range, integrity, pinKey);
  }

  const source: CitationSource = { file, integrity };
  // Field order is the order a reader scans a source in: which file, which
  // lines, what they hashed to, and when that was taken.
  const ordered: CitationSource = {
    file: source.file,
    ...(lines === undefined ? {} : { lines }),
    integrity: source.integrity,
    ...(commitSha === undefined ? {} : { "commit-sha": commitSha }),
  };
  // And an entry reads: what it is called, what it says, what it rests on.
  return {
    ...(opts.id === undefined ? {} : { id: opts.id }),
    ...(opts.claim === undefined ? {} : { claim: opts.claim }),
    source: ordered,
    ...(opts.quote === undefined ? {} : { quote: opts.quote }),
  };
}
