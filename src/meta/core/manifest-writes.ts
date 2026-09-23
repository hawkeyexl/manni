/**
 * The metadata tool's half of the shared manifest compare-and-swap.
 *
 * `src/shared/manifest-cas.ts` owns hold, re-read, replay and refuse, and
 * cannot own the splice: rewriting one key of a manifest is this tool's, and
 * the shared layer does not import a tool's module. So this file supplies the
 * codec, and the two commands that write manifests — `fill` and `derive` —
 * record their edits as the descriptors it applies rather than as the text
 * those descriptors produced.
 *
 * `relocate` and `query` re-read and abort on their own, so neither goes
 * through here.
 */
import { readFile } from "node:fs/promises";
import { DocmetaError } from "../types.js";
import { errorMessage } from "../../shared/errors.js";
import {
  heldManifest,
  isMissing,
  rebaseable,
  rebaseline,
  settle,
  type HeldManifest,
  type ManifestCodec,
  type ManifestOp,
} from "../../shared/manifest-cas.js";
import { writeFileAtomic } from "./write-file.js";
import {
  readManifestValue,
  removeManifestKey,
  spliceManifestValue,
} from "./external-metadata-write.js";

/**
 * One edit `fill` or `derive` makes to a manifest: a key of an entry set to a
 * value, or taken out. Plain data, so it replays onto bytes read later.
 */
export type MetaManifestOp = ManifestOp &
  ({ kind: "splice"; value: unknown } | { kind: "remove" });

/** One manifest held for the length of a `fill` or `derive` run. */
export type MetaHeldManifest = HeldManifest<MetaManifestOp>;

/** One recorded edit, and one key read back, over a manifest's text. */
export const manifestCodec: ManifestCodec<MetaManifestOp> = {
  apply(text, op) {
    const where = { entry: op.entry, key: op.key, join: op.join, file: op.file };
    return op.kind === "remove"
      ? removeManifestKey(text, where).text
      : spliceManifestValue(text, { ...where, value: op.value }).text;
  },
  read(text, at) {
    return readManifestValue(text, at);
  },
};

/** One recorded edit, against whatever text it is handed. */
export function applyManifestOp(text: string, op: MetaManifestOp): string {
  return manifestCodec.apply(text, op);
}

/**
 * Read a manifest, ready to be spliced and later settled. A `perPage`
 * manifest (proposal 0058) that does not exist yet is a page with nothing
 * kept there: it is held as empty text marked absent, and the settle creates
 * it. A missing concrete manifest is refused, as it always was.
 */
export async function holdManifestFile(
  path: string,
  file: string,
  perPage = false,
): Promise<MetaHeldManifest> {
  let before: string;
  try {
    before = await readFile(path, "utf8");
  } catch (err) {
    if (perPage && isMissing(err)) return heldManifest<MetaManifestOp>(path, file, "", true);
    throw new DocmetaError(`Manifest ${file} could not be read: ${errorMessage(err)}`);
  }
  return heldManifest<MetaManifestOp>(path, file, before);
}

/**
 * Commit one edit to the held text: note what the key held before this run
 * first touched it, keep the descriptor for a replay, and advance the text.
 */
export function recordManifestOp(held: MetaHeldManifest, op: MetaManifestOp): void {
  rebaseable(held, op, manifestCodec);
  held.ops.push(op);
}

/** What a caller may substitute for the bytes a settle reads and writes. */
export interface ManifestSettleIo {
  write?: (path: string, text: string) => Promise<void>;
  read?: (path: string) => Promise<string>;
}

/**
 * Write one held manifest, compare-and-swap, and take the written bytes as the
 * new base. Answers whether anything was written; a manifest the run left as
 * it found it is not rewritten.
 */
export async function settleManifest(
  held: MetaHeldManifest,
  io: ManifestSettleIo = {},
): Promise<boolean> {
  if (held.text === held.before) return false;
  await settle(held, {
    codec: manifestCodec,
    // A per-page manifest (proposal 0058) may be the first file in its directory.
    write: io.write ?? ((at: string, text: string) => writeFileAtomic(at, text, { createParents: true })),
    read: io.read ?? ((at: string): Promise<string> => readFile(at, "utf8")),
    toError: (message) => new DocmetaError(message),
  });
  rebaseline(held);
  return true;
}
