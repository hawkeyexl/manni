/**
 * An atomic text write for the shared layer: a temp file in the target's own
 * directory, then `rename`, so the file holds its old contents or its new
 * ones, never half of each.
 *
 * The metadata tool has a fuller one (`src/meta/core/write-file.ts`: byte
 * payloads, and an in-place fallback when Windows keeps a target locked). The
 * shared layer does not import a tool's module, so this is the small subset
 * the family config writer needs. When a later change moves meta's writer
 * here, this file is what it replaces.
 */
import { chmod, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

/** Windows returns these while an editor or scanner holds the target open. */
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

/** Write `text` (UTF-8) to `path`, replacing it atomically. */
export async function writeTextAtomic(path: string, text: string): Promise<void> {
  const tmp = join(
    dirname(path),
    `.${basename(path)}.manni-${process.pid}-${Math.random().toString(36).slice(2, 8)}.tmp`,
  );
  try {
    await writeFile(tmp, text, "utf8");
    // Keep the target's permissions; a missing target keeps the default mode.
    try {
      const { mode } = await stat(path);
      await chmod(tmp, mode);
    } catch {
      // Creating the file, or its mode is unreadable: keep the default.
    }
    for (let attempt = 1; ; attempt++) {
      try {
        await rename(tmp, path);
        return;
      } catch (err) {
        const code = errorCode(err);
        if (code === undefined || !LOCKED.has(code) || attempt >= RENAME_ATTEMPTS) {
          throw err;
        }
        await wait(attempt * 50);
      }
    }
  } finally {
    await rm(tmp, { force: true });
  }
}
