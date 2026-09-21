/**
 * Atomic file writes.
 *
 * `fill` is the first command that modifies the user's sources, and it does so
 * in bulk over a glob, often while a dev server or editor is watching. A
 * truncated write from a crash or a full disk would be unrecoverable for them,
 * so every write lands via a temp file plus `rename` — the file either has its
 * old contents or its new ones, never half of each.
 *
 * The temp file must live in the *same directory* as the target: `rename` is
 * only atomic within a filesystem, and the OS temp dir is frequently a
 * different one.
 */
import { writeFile, rename, rm, stat, chmod } from "node:fs/promises";
import { dirname, join, basename, resolve } from "node:path";
import { programName } from "../../shared/program-name.js";
import { invalidateManifestCache } from "./manifest-cache.js";

/** Windows returns these when an editor or scanner holds the target open. */
const LOCKED = new Set(["EPERM", "EBUSY", "EACCES"]);
const RENAME_ATTEMPTS = 3;

function errorCode(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && "code" in err
    ? String(err.code)
    : undefined;
}

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Write `contents` to `path`, replacing it atomically. Falls back to a direct
 * write (with a warning on stderr) if the rename keeps failing because the
 * target is locked — on Windows that is a real and recoverable situation, and
 * refusing to write at all would be worse than a non-atomic write.
 */
export async function writeFileAtomic(
  /**
   * Absolute, or relative to the process's current directory. The manifest
   * cache is keyed on absolute paths, and the invalidation in the `finally`
   * below resolves `path` against that same implicit directory — so a caller
   * that resolved its own path against some other base would invalidate a key
   * no cache holds, and the stale parse would survive the write. That miss is
   * silent, which is why the requirement is stated here rather than left to be
   * discovered.
   */
  path: string,
  /**
   * A `Uint8Array` writes byte-for-byte. `schemas vendor` needs that: the
   * integrity pin it records is taken over exactly what the server sent, and a
   * decode/re-encode round trip through a UTF-8 string would change the bytes
   * of a payload that is not valid UTF-8 — so the pin would be wrong the first
   * time anything checked it.
   */
  contents: string | Uint8Array,
): Promise<void> {
  const tmp = join(
    dirname(path),
    `.${basename(path)}.manni-${process.pid}-${Math.random().toString(36).slice(2, 8)}.tmp`,
  );

  try {
    // No encoding argument. Node ignores one when `contents` is a
    // `Uint8Array`, so passing `"utf8"` was harmless — but it reads as though a
    // decode happens, which is exactly what the byte-for-byte guarantee above
    // says must not. The two-argument overload defaults a string to UTF-8 and
    // writes bytes as they are, which is the behaviour both callers want.
    await writeFile(tmp, contents);

    // Carry the target's permissions over; a missing target just means we are
    // creating it, in which case the default mode is correct.
    try {
      const { mode } = await stat(path);
      await chmod(tmp, mode);
    } catch {
      // No existing file (or no permission to read its mode) — keep the default.
    }

    let lastError: unknown;
    for (let attempt = 1; attempt <= RENAME_ATTEMPTS; attempt++) {
      try {
        await rename(tmp, path);
        return;
      } catch (err) {
        lastError = err;
        const code = errorCode(err);
        if (code == null || !LOCKED.has(code)) throw err;
        if (attempt < RENAME_ATTEMPTS) await wait(attempt * 50);
      }
    }

    process.stderr.write(
      `${programName()}: ${path} is locked by another process; writing in place (not atomically).\n`,
    );
    try {
      await writeFile(path, contents);
    } catch {
      throw lastError;
    }
  } finally {
    await rm(tmp, { force: true });
    // Every manifest write in the family lands here — `cite add`, `cite
    // update`, `cite remove`, `meta fill`, `meta derive`, `meta relocate`,
    // `meta query` — so this is the one place a parse another command cached
    // has to be dropped. Two writes inside one clock tick can leave `mtimeMs`
    // and size unchanged, so the cache cannot be left to notice on its own.
    // It runs whether or not the write succeeded: forgetting a parse that is
    // still current costs one re-read.
    invalidateManifestCache(resolve(path));
  }
}
