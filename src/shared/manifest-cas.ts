/**
 * Compare-and-swap for a manifest a command rewrites in memory.
 *
 * Every tool that writes external metadata does the same thing. It reads a
 * manifest once, splices the entries it owns into the text it read, and writes
 * the whole file back seconds later, after the minting or hashing or model
 * round trips that made the values. Two commands over one working copy overlap
 * inside that gap easily, and each writes bytes derived from a read that
 * predates the other, so the second write replaces the first's entries with
 * bytes that never had them. Nothing reports it: the loser's entries simply
 * are not there, and a manifest short of an entry reads as a file nobody
 * recorded anything about.
 *
 * So the write is a compare-and-swap. The run keeps, beside the text it is
 * building, the edits it made as plain descriptors and the value each entry's
 * key held when it first touched it. The write re-reads, writes when the bytes
 * are the ones it spliced from, and otherwise replays the descriptors onto the
 * newer bytes and looks again. A replay keeps the other run's entries, because
 * each edit replaces one range of the text it is given and leaves every other
 * byte alone. A key both runs wrote cannot be replayed, because the value this
 * run computed was derived from the other one's absence, so that is a refusal
 * rather than a silent merge.
 *
 * The conflict base is one entry's one key, not the whole entry. `meta fill`
 * writing `summary` and `meta derive` writing `updated` into one page's entry
 * are not in conflict, and a base keyed on the entry alone would refuse them
 * both.
 *
 * What this module cannot own is the splice itself. Reading and rewriting one
 * key of a manifest is the metadata tool's, and the shared layer does not
 * import a tool's module (`write-file.ts` states the rule), so the caller
 * hands in an `apply` and a `read` and this file owns only hold, re-read,
 * replay and refuse.
 *
 * This narrows the window rather than closing it: nothing stops a third write
 * landing between the re-read and the rename. The window goes from the length
 * of a whole command to the microseconds around one `rename`, which is what a
 * lock file would have to justify itself against.
 */
import { posix } from "node:path";

/** One entry's one key: what an edit rewrites, and what a conflict is about. */
export interface ManifestKey {
  /** The entry, as the manifest spells it. */
  entry: string;
  /** The key of that entry the edit rewrites. */
  key: string;
  /** How entry keys are compared; `path` normalizes separators. */
  join: string;
}

/** One edit a run made, replayable onto bytes read later. */
export interface ManifestOp extends ManifestKey {
  /** The manifest as the run names it in its own messages. */
  file: string;
}

/**
 * The two halves of a manifest this loop cannot own: applying one recorded
 * edit to whatever text it is handed, and reading one entry's key back out of
 * text the run has not seen before.
 */
export interface ManifestCodec<Op extends ManifestOp> {
  /** One recorded edit, against whatever text it is handed. */
  apply: (text: string, op: Op) => string;
  /** One entry's key as the given text holds it, or `undefined` when absent. */
  read: (text: string, at: ManifestKey) => unknown;
}

/** An entry's key this run rewrote, and what it held before the run did. */
interface KeyBase extends ManifestKey {
  /** The value as it was read, encoded so absence cannot collide. */
  value: string;
}

/** One manifest held for the length of a run: its text before, and now. */
export interface HeldManifest<Op extends ManifestOp> {
  /** Absolute path, the write target. */
  path: string;
  /** The manifest as the run reports it. */
  file: string;
  /** The bytes the run's edits were computed from. */
  before: string;
  /** The bytes as the run has rewritten them. */
  text: string;
  /** Every edit this run made, in order, for a replay onto newer bytes. */
  ops: Op[];
  /** Each entry key this run rewrote, and what it held first. */
  bases: Map<string, KeyBase>;
}

/** How many times a write re-reads and replays before it refuses. */
export const COMMIT_ATTEMPTS = 5;

/** The refusal when a manifest will not hold still long enough to be written. */
export function conflictRefusal(file: string): string {
  return `${file} changed under the command while it was being written. Nothing was written to it. Re-run the command.`;
}

/** A manifest read, ready to be spliced and later settled. */
export function heldManifest<Op extends ManifestOp>(
  path: string,
  file: string,
  before: string,
): HeldManifest<Op> {
  return { path, file, before, text: before, ops: [], bases: new Map() };
}

/**
 * A value as read, or the absence of one, as one comparable string.
 * `JSON.stringify` never answers a bare word, so `absent` cannot collide with
 * a value an entry actually holds.
 */
function encodeValue(value: unknown): string {
  return value === undefined ? "absent" : JSON.stringify(value);
}

/** An entry and a key as one map key, spelled the way the manifest joins. */
function baseKey(at: ManifestKey): string {
  const entry = at.join === "path" ? posix.normalize(at.entry) : at.entry;
  return `${entry}\u0000${at.key}`;
}

/** Note what an entry's key held before this run first rewrote it. */
export function rebaseable<Op extends ManifestOp>(
  held: HeldManifest<Op>,
  op: Op,
  codec: ManifestCodec<Op>,
): void {
  const at = baseKey(op);
  if (held.bases.has(at)) return;
  held.bases.set(at, {
    entry: op.entry,
    key: op.key,
    join: op.join,
    value: encodeValue(codec.read(held.before, op)),
  });
}

/**
 * Replay this run's edits onto the manifest as it now stands, or `undefined`
 * when a key this run rewrote has changed since it was read. Each edit
 * replaces one range of the text it is given, so every entry this run did not
 * touch survives the replay untouched.
 */
export function rebase<Op extends ManifestOp>(
  held: HeldManifest<Op>,
  current: string,
  codec: ManifestCodec<Op>,
): string | undefined {
  for (const base of held.bases.values()) {
    if (encodeValue(codec.read(current, base)) !== base.value) return undefined;
  }
  let text = current;
  for (const op of held.ops) text = codec.apply(text, op);
  return text;
}

/**
 * Take the bytes just written as the new base, so a run that writes one
 * manifest more than once compares its next write against what it left on
 * disk. Without it the second write would replay against the pre-run text and
 * call this run's own first write somebody else's.
 */
export function rebaseline<Op extends ManifestOp>(held: HeldManifest<Op>): void {
  held.before = held.text;
  held.ops = [];
  held.bases.clear();
}

/** What `settle` needs from the tool around it. */
export interface SettleIo<Op extends ManifestOp> {
  /** Applying and reading one edit; the metadata tool's, handed in. */
  codec: ManifestCodec<Op>;
  /** The byte writer; an atomic write unless a test says otherwise. */
  write: (path: string, text: string) => Promise<void>;
  /**
   * The compare-and-swap re-read, for a test counting the retries. It is that
   * loop's read alone: the first read of a manifest is the caller's.
   */
  read: (path: string) => Promise<string>;
  /** The calling tool's error class, so a refusal reads as that tool's. */
  toError: (message: string) => Error;
}

/**
 * Write one manifest, re-reading it first so the bytes being replaced are the
 * bytes this run spliced from. A run that loses the compare replays its edits
 * onto what it found and looks again; one that keeps losing refuses, having
 * written nothing.
 */
export async function settle<Op extends ManifestOp>(
  held: HeldManifest<Op>,
  io: SettleIo<Op>,
): Promise<void> {
  for (let attempt = 1; attempt <= COMMIT_ATTEMPTS; attempt++) {
    let current: string;
    try {
      current = await io.read(held.path);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw io.toError(`Manifest ${held.file} could not be read: ${reason}`);
    }
    if (current === held.before) {
      await io.write(held.path, held.text);
      return;
    }
    const replayed = rebase(held, current, io.codec);
    // A replay that cannot be made is a verdict about bytes just read, against
    // a base fixed when this run first touched the key. Neither side of that
    // comparison moves on a re-read, so the attempts are left for the case
    // they exist for, which is a file moving under replays that do succeed.
    if (replayed === undefined) throw io.toError(conflictRefusal(held.file));
    held.before = current;
    held.text = replayed;
  }
  throw io.toError(conflictRefusal(held.file));
}

/** What a caller may substitute when it writes the manifests it held. */
export interface CommitIo<Change> {
  /** The byte writer; an atomic write unless a test says otherwise. */
  write?: (path: string, text: string) => Promise<void>;
  /** The compare-and-swap re-read, for a test counting the retries. */
  read?: (path: string) => Promise<string>;
  /** Called after each manifest lands, in write order. */
  after?: (change: Change) => void;
  /** Called when one manifest fails to land; must throw. */
  onError?: (change: Change, error: unknown) => Promise<never>;
}
