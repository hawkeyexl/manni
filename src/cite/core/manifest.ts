/**
 * Writing a page's `citations` into the manifest that owns them.
 *
 * The splice itself is meta's (`spliceManifestValue` on the family-internal
 * barrel): one owned value of one entry is replaced, every other byte of the
 * file survives by construction, and the result is read back before it is
 * returned. This module is the part cite owns — holding each manifest's text
 * for the length of a run so it is written once, and finding the line a
 * written entry now sits on, which is what `add` reports and what a finding
 * about an entry points at.
 *
 * Only `commit` touches the disk. A caller reads the manifests it needs and
 * writes them when the whole run has succeeded, the way `key rotate` writes
 * pages only once every one of them could be re-encrypted.
 *
 * That gap is why `commit` re-reads. A run holds a manifest from its first
 * `hold` to its last write, which is seconds of minting, hashing and git, and
 * two runs over one working copy overlap easily. Each writes the whole file
 * from bytes it read at the start, so the second used to replace the first's
 * entries with bytes that never had them. Nothing reported it: a lost
 * claim-lines entry leaves the page untouched, so `cite check` stays clean and
 * the corpus is simply short.
 *
 * So the write is a compare-and-swap. `commit` re-reads the manifest, writes
 * when the bytes are the ones it spliced from, and otherwise replays this
 * run's edits onto the newer bytes and looks again. A replay keeps the other
 * run's entries because the splice replaces one range of the text it is given
 * and leaves every other byte alone. An entry both runs wrote cannot be
 * replayed, because the value this run computed was derived from the other
 * one's absence, so that is a refusal rather than a silent merge.
 *
 * This narrows the window rather than closing it: nothing stops a third write
 * landing between the re-read and the rename. The window goes from the length
 * of a whole command to the microseconds around one `rename`, which is what a
 * lock file would have to justify itself against.
 */
import { readFile } from "node:fs/promises";
import { posix } from "node:path";
import { LineCounter, isMap, isNode, isScalar, isSeq, parseDocument } from "yaml";
import { DocmetaError, writeFileAtomic } from "../../meta/index.js";
import {
  readManifestValue,
  removeManifestKey,
  spliceManifestValue,
} from "../../meta/internal.js";
import { CiteError } from "../errors.js";
import { unifiedDiff } from "./write.js";
import { CITATIONS_KEY, type CitationManifest } from "./sidecar.js";

/** One edit this run made, replayable onto bytes read later. */
type ManifestOp =
  | { kind: "splice"; entry: string; join: string; file: string; value: unknown[] }
  | { kind: "remove"; entry: string; join: string; file: string };

/** An entry this run rewrote, and what it held before the run touched it. */
interface EntryBase {
  entry: string;
  join: string;
  /** The entry's `citations` as they were read, encoded for comparison. */
  value: string;
}

/** One manifest held for the length of a run: its text before, and now. */
export interface HeldManifest {
  /** Absolute path, the write target. */
  path: string;
  /** The manifest as the run reports it. */
  file: string;
  /** The bytes as they were read. */
  before: string;
  /** The bytes as the run has rewritten them. */
  text: string;
  /** Every edit this run made, in order, for a replay onto newer bytes. */
  ops: ManifestOp[];
  /** Each entry this run rewrote, keyed as the manifest keys it. */
  bases: Map<string, EntryBase>;
}

/** How many times `commit` re-reads and replays before it refuses. */
const COMMIT_ATTEMPTS = 5;

/** The refusal when a manifest will not hold still long enough to be written. */
export function conflictRefusal(file: string): string {
  return `${file} changed under the command while it was being written. Nothing was written to it. Re-run the command.`;
}

/**
 * A `citations` value as read, or the absence of one, as one comparable
 * string. `JSON.stringify` never answers a bare word, so `absent` cannot
 * collide with a value an entry actually holds.
 */
function encodeValue(value: unknown): string {
  return value === undefined ? "absent" : JSON.stringify(value);
}

/** One manifest this run rewrote, as `changed()` and `commit()` report it. */
export interface ManifestChange {
  path: string;
  file: string;
  before: string;
  text: string;
  /**
   * `before` against `text`. A commit that rebased moves `before` to the bytes
   * it compared against, so the diff then shows what this run added on top of
   * a concurrent write rather than against the read `hold()` made.
   */
  diff: string;
}

/** What `commit()` does with each manifest it settles. */
export interface CommitIo {
  /** The byte writer; `writeFileAtomic` unless a test says otherwise. */
  write?: (path: string, text: string) => Promise<void>;
  /**
   * The compare-and-swap re-read, for a test counting the retries. It is that
   * loop's read alone, not a general hook: `hold()` reads the file itself.
   */
  read?: (path: string) => Promise<string>;
  /** Called after each manifest lands, in write order. */
  after?: (change: ManifestChange) => void;
  /** Called when one manifest fails to land; must throw. */
  onError?: (change: ManifestChange, error: unknown) => Promise<never>;
}

/** Every manifest one run writes, read once and spliced in memory. */
export class ManifestSet {
  private readonly held = new Map<string, HeldManifest>();

  /** Read a manifest, or hand back the copy this run has already rewritten. */
  async hold(manifest: CitationManifest): Promise<HeldManifest> {
    const already = this.held.get(manifest.path);
    if (already !== undefined) return already;
    let before: string;
    try {
      before = await readFile(manifest.path, "utf8");
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new CiteError(`Manifest ${manifest.file} could not be read: ${reason}`);
    }
    const fresh: HeldManifest = {
      path: manifest.path,
      file: manifest.file,
      before,
      text: before,
      ops: [],
      bases: new Map(),
    };
    this.held.set(manifest.path, fresh);
    return fresh;
  }

  /**
   * Write one page's whole `citations` list into its entry, and answer where
   * the entry at `index` now sits. The manifest is not saved: `changed()`
   * lists what the run would write.
   */
  async write(
    manifest: CitationManifest,
    entry: string,
    citations: readonly unknown[],
    index: number,
  ): Promise<{ file: string; line: number }> {
    const held = await this.hold(manifest);
    const op: ManifestOp = {
      kind: "splice",
      entry,
      join: manifest.join,
      file: manifest.file,
      value: [...citations],
    };
    rebaseable(held, op);
    const spliced = splice(held.text, {
      entry,
      key: CITATIONS_KEY,
      value: op.value,
      join: manifest.join,
      file: manifest.file,
    });
    held.text = spliced.text;
    held.ops.push(op);
    return { file: manifest.file, line: itemLine(spliced.text, entry, index, manifest.join) ?? spliced.line };
  }

  /**
   * Where one item of an entry's `citations` sits in the manifest as this run
   * will write it. `add` names a line in its report, and `commit` may have
   * replayed the entry onto bytes that moved it, so the line is read back from
   * the settled text rather than kept from the splice.
   */
  lineOf(manifest: CitationManifest, entry: string, index: number): number | undefined {
    const held = this.held.get(manifest.path);
    if (held === undefined) return undefined;
    return itemLine(held.text, entry, index, manifest.join);
  }

  /**
   * Take a page's `citations` key out of the manifest, for the removal that
   * leaves it with no entries. The entry itself goes when that key was all it
   * had, so a manifest never keeps a document nothing is recorded about.
   */
  async remove(manifest: CitationManifest, entry: string): Promise<void> {
    const held = await this.hold(manifest);
    const op: ManifestOp = { kind: "remove", entry, join: manifest.join, file: manifest.file };
    rebaseable(held, op);
    held.text = apply(held.text, op);
    held.ops.push(op);
  }

  /** The manifests this run rewrote, with the diff of each. */
  changed(): ManifestChange[] {
    return [...this.held.values()]
      .filter((m) => m.text !== m.before)
      .map((m) => ({ ...m, diff: unifiedDiff(m.file, m.before, m.text) }));
  }

  /**
   * Write every manifest this run rewrote, and report what landed.
   *
   * The write is the last thing a run does, so this is the one place that
   * knows a manifest is about to be replaced by bytes derived from a read
   * that may be seconds old.
   */
  async commit(io: CommitIo = {}): Promise<ManifestChange[]> {
    const write = io.write ?? writeFileAtomic;
    const read = io.read ?? ((at: string): Promise<string> => readFile(at, "utf8"));
    const landed: ManifestChange[] = [];
    for (const held of this.held.values()) {
      if (held.text === held.before) continue;
      try {
        await settle(held, write, read);
      } catch (error) {
        if (io.onError !== undefined) await io.onError(changeOf(held), error);
        throw error;
      }
      const change = changeOf(held);
      landed.push(change);
      io.after?.(change);
    }
    return landed;
  }
}

/** The change one held manifest reports, against the bytes it will replace. */
function changeOf(held: HeldManifest): ManifestChange {
  return {
    path: held.path,
    file: held.file,
    before: held.before,
    text: held.text,
    diff: unifiedDiff(held.file, held.before, held.text),
  };
}

/** Note what an entry held before this run first rewrote it. */
function rebaseable(held: HeldManifest, op: ManifestOp): void {
  const at = op.join === "path" ? posix.normalize(op.entry) : op.entry;
  if (held.bases.has(at)) return;
  held.bases.set(at, {
    entry: op.entry,
    join: op.join,
    value: encodeValue(
      readManifestValue(held.before, { entry: op.entry, key: CITATIONS_KEY, join: op.join }),
    ),
  });
}

/** One recorded edit, against whatever text it is handed. */
function apply(text: string, op: ManifestOp): string {
  if (op.kind === "splice") {
    return splice(text, {
      entry: op.entry,
      key: CITATIONS_KEY,
      value: op.value,
      join: op.join,
      file: op.file,
    }).text;
  }
  try {
    return removeManifestKey(text, {
      entry: op.entry,
      key: CITATIONS_KEY,
      join: op.join,
      file: op.file,
    }).text;
  } catch (error) {
    if (error instanceof DocmetaError) throw new CiteError(error.message);
    throw error;
  }
}

/**
 * Replay this run's edits onto the manifest as it now stands, or `undefined`
 * when an entry this run rewrote has changed since it was read. The splice
 * replaces one range of the text it is given, so every entry this run did not
 * touch survives the replay untouched.
 */
function rebase(held: HeldManifest, current: string): string | undefined {
  for (const base of held.bases.values()) {
    const now = encodeValue(
      readManifestValue(current, { entry: base.entry, key: CITATIONS_KEY, join: base.join }),
    );
    if (now !== base.value) return undefined;
  }
  let text = current;
  for (const op of held.ops) text = apply(text, op);
  return text;
}

/**
 * Write one manifest, re-reading it first so the bytes being replaced are the
 * bytes this run spliced from. A run that loses the compare replays its edits
 * onto what it found and looks again; one that keeps losing refuses, having
 * written nothing.
 */
async function settle(
  held: HeldManifest,
  write: (path: string, text: string) => Promise<void>,
  read: (path: string) => Promise<string>,
): Promise<void> {
  for (let attempt = 1; attempt <= COMMIT_ATTEMPTS; attempt++) {
    let current: string;
    try {
      current = await read(held.path);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new CiteError(`Manifest ${held.file} could not be read: ${reason}`);
    }
    if (current === held.before) {
      await write(held.path, held.text);
      return;
    }
    const replayed = rebase(held, current);
    // A replay that cannot be made is a verdict about bytes just read, against
    // a base fixed when this run first touched the entry. Neither side of that
    // comparison moves on a re-read, so the attempts are left for the case
    // they exist for, which is a file moving under replays that do succeed.
    if (replayed === undefined) throw new CiteError(conflictRefusal(held.file));
    held.before = current;
    held.text = replayed;
  }
  throw new CiteError(conflictRefusal(held.file));
}

/** `spliceManifestValue`, with meta's refusal reported as this tool's. */
export function splice(
  text: string,
  options: Parameters<typeof spliceManifestValue>[1],
): { text: string; line: number } {
  try {
    return spliceManifestValue(text, options);
  } catch (error) {
    if (error instanceof DocmetaError) throw new CiteError(error.message);
    throw error;
  }
}

/**
 * The 1-based line of one item of an entry's `citations`, in a manifest that
 * may not have been written yet. The loader answers this for a manifest on
 * disk; a freshly spliced one has to be read where it stands, so `add` can
 * say where the entry it just wrote went.
 */
export function itemLine(
  text: string,
  entry: string,
  index: number,
  join: string,
): number | undefined {
  const lc = new LineCounter();
  const doc = parseDocument(text, { lineCounter: lc, uniqueKeys: false });
  if (doc.errors.length > 0) return undefined;
  const root = doc.contents;
  if (!isMap(root)) return undefined;
  const same = (key: unknown): boolean => {
    const spelled = isScalar(key) ? String(key.value) : String(key);
    return join === "path" ? posix.normalize(spelled) === posix.normalize(entry) : spelled === entry;
  };
  const pair = root.items.find((p) => same(p.key));
  const value = pair?.value;
  if (!isMap(value)) return undefined;
  const kv = value.items.find(
    (p) => (isScalar(p.key) ? String(p.key.value) : String(p.key)) === CITATIONS_KEY,
  );
  const list = kv?.value;
  if (!isSeq(list)) return undefined;
  const item: unknown = list.items[index];
  const range = isNode(item) ? item.range : undefined;
  return range ? lc.linePos(range[0]).line : undefined;
}
