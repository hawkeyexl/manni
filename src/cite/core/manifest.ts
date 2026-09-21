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
 * two runs over one working copy overlap easily. The compare-and-swap that
 * makes the second write see the first is `src/shared/manifest-cas.ts`, which
 * `meta fill` and `meta derive` hold their manifests with too; what stays here
 * is what cite means by an edit, which is one entry's `citations`.
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
import {
  heldManifest,
  rebaseable,
  settle,
  type CommitIo as CasCommitIo,
  type HeldManifest as CasHeldManifest,
  type ManifestCodec,
  type ManifestOp as CasManifestOp,
} from "../../shared/manifest-cas.js";
import { CiteError } from "../errors.js";
import { unifiedDiff } from "./write.js";
import { CITATIONS_KEY, type CitationManifest } from "./sidecar.js";

/** One edit this run made, replayable onto bytes read later. */
type ManifestOp = CasManifestOp &
  ({ kind: "splice"; value: unknown[] } | { kind: "remove" });

/** One manifest held for the length of a run: its text before, and now. */
export type HeldManifest = CasHeldManifest<ManifestOp>;

/** One recorded edit, and one `citations` value read back, over a manifest. */
const codec: ManifestCodec<ManifestOp> = { apply, read: readManifestValue };

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
export type CommitIo = CasCommitIo<ManifestChange>;

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
    const fresh = heldManifest<ManifestOp>(manifest.path, manifest.file, before);
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
      key: CITATIONS_KEY,
      join: manifest.join,
      file: manifest.file,
      value: [...citations],
    };
    rebaseable(held, op, codec);
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
    const op: ManifestOp = {
      kind: "remove",
      entry,
      key: CITATIONS_KEY,
      join: manifest.join,
      file: manifest.file,
    };
    rebaseable(held, op, codec);
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
        await settle(held, { codec, write, read, toError: (message) => new CiteError(message) });
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

/** One recorded edit, against whatever text it is handed. */
function apply(text: string, op: ManifestOp): string {
  const where = { entry: op.entry, key: op.key, join: op.join, file: op.file };
  if (op.kind === "splice") return splice(text, { ...where, value: op.value }).text;
  try {
    return removeManifestKey(text, where).text;
  } catch (error) {
    if (error instanceof DocmetaError) throw new CiteError(error.message);
    throw error;
  }
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
