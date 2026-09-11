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
 * Nothing here touches the disk: a caller reads the manifests it needs and
 * writes them when the whole run has succeeded, the way `key rotate` writes
 * pages only once every one of them could be re-encrypted.
 */
import { readFile } from "node:fs/promises";
import { posix } from "node:path";
import { LineCounter, isMap, isNode, isScalar, isSeq, parseDocument } from "yaml";
import { DocmetaError } from "../../meta/index.js";
import { spliceManifestValue } from "../../meta/internal.js";
import { CiteError } from "../errors.js";
import { unifiedDiff } from "./write.js";
import { CITATIONS_KEY, type CitationManifest } from "./sidecar.js";

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
    const fresh: HeldManifest = { path: manifest.path, file: manifest.file, before, text: before };
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
    const spliced = splice(held.text, {
      entry,
      key: CITATIONS_KEY,
      value: [...citations],
      join: manifest.join,
      file: manifest.file,
    });
    held.text = spliced.text;
    return { file: manifest.file, line: itemLine(spliced.text, entry, index, manifest.join) ?? spliced.line };
  }

  /** The manifests this run rewrote, with the diff of each. */
  changed(): { path: string; file: string; before: string; text: string; diff: string }[] {
    return [...this.held.values()]
      .filter((m) => m.text !== m.before)
      .map((m) => ({ ...m, diff: unifiedDiff(m.file, m.before, m.text) }));
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
