/**
 * One parse of one manifest, kept for the length of the process.
 *
 * An external-metadata manifest is read and parsed once per command, and a
 * process that runs several commands over one corpus — a test suite, an
 * editor integration, `key rotate` walking two tools — paid for that parse
 * every time. At this repository's own manifest size the parse is almost the
 * whole cost of a validate run, so the same bytes were being turned into the
 * same maps over and over.
 *
 * The entry is keyed on the file's absolute path together with its `mtimeMs`
 * and its size, so a manifest edited between two commands is read again. That
 * stat is a backstop and not the mechanism: two writes inside one clock tick
 * can leave `mtimeMs` and size unchanged, and a same-size edit would then be
 * invisible. What actually makes a write visible is `writeFileAtomic` calling
 * `invalidateManifestCache` on the path it wrote, so every command that writes
 * a manifest — `cite add`, `cite update`, `cite remove`, `meta fill`,
 * `meta derive`, `meta relocate`, `meta query` — drops the entry by going
 * through the one write path they share.
 *
 * Nothing here is a user-facing surface: there is no flag, no config key and
 * no message. A caller cannot observe the cache except by being faster.
 *
 * This module deliberately imports nothing from the rest of the tree. It sits
 * between `write-file.ts` and `external-metadata.ts`, and a dependency either
 * way round would close a cycle between them.
 */
import { stat } from "node:fs/promises";

/** A cache that can be told to forget one path. */
interface Droppable {
  drop(path: string): void;
}

/** Every live cache, so one write can reach all of them. */
const caches = new Set<Droppable>();

/**
 * Forget every parse of `path`, whatever it was read as.
 *
 * Called from `writeFileAtomic` for every write it performs. Most of those
 * paths were never manifests, and dropping an absent entry costs a map lookup.
 */
export function invalidateManifestCache(path: string): void {
  for (const cache of caches) cache.drop(path);
}

/** What a file looked like when it was read. */
interface Signature {
  mtimeMs: number;
  size: number;
}

/** `null` when the file cannot be stat'ed, which is never cached. */
async function signature(path: string): Promise<Signature | null> {
  try {
    const info = await stat(path);
    return { mtimeMs: info.mtimeMs, size: info.size };
  } catch {
    return null;
  }
}

const same = (a: Signature, b: Signature): boolean =>
  a.mtimeMs === b.mtimeMs && a.size === b.size;

/**
 * One parse per file, per `variant`.
 *
 * `variant` names everything other than the bytes that decides what the parse
 * produces — for a manifest, the collection it was declared by, the field it
 * joins on, the keys it owns, and the directory its entries resolve against.
 * One file declared twice, differently, parses twice.
 */
export class ManifestCache<T> {
  private readonly slots = new Map<string, { sig: Signature; variants: Map<string, T> }>();

  constructor() {
    caches.add(this);
  }

  drop(path: string): void {
    this.slots.delete(path);
  }

  /** The cached parse of `path` under `variant`, or `parse()`'s result. */
  async parse(path: string, variant: string, parse: () => Promise<T>): Promise<T> {
    const before = await signature(path);
    if (before === null) return parse();

    const slot = this.slots.get(path);
    if (slot !== undefined && same(slot.sig, before)) {
      const hit = slot.variants.get(variant);
      if (hit !== undefined) return hit;
    }

    const parsed = await parse();

    // The file is stat'ed again, because `parse()` read it and the read is
    // not atomic with the stat that preceded it. A file that changed while it
    // was being read is not cached under either signature.
    const after = await signature(path);
    if (after === null || !same(before, after)) return parsed;

    const live = this.slots.get(path);
    if (live !== undefined && same(live.sig, after)) live.variants.set(variant, parsed);
    else this.slots.set(path, { sig: after, variants: new Map([[variant, parsed]]) });
    return parsed;
  }
}
