/**
 * Filesystem helpers shared by trace-driven artifact resolution and static
 * artifact discovery. Every function degrades to null/empty rather than
 * throwing: a missing or unreadable path is a coverage note, never a crash.
 */
import { access, readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

/**
 * Directory names never worth walking. `.git` alone can hold more entries than
 * the rest of a repo combined, and `node_modules` hides vendored skills that
 * are not the project's to edit.
 */
/**
 * Path split into segments with separators normalised, so convention
 * matching ("is this under `.claude/commands/`?") agrees between
 * trace-driven resolution and static discovery. Both had their own
 * byte-identical copy; a drift between them would classify one file two
 * ways in `run` and `fill`.
 */
export function segments(path: string): string[] {
  return path.split(sep).join("/").split("/");
}

export const PRUNED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".manni",
  ".tmp",
  ".next",
  ".venv",
]);

/** Nearest ancestor containing `.git` (a directory *or* a worktree file). */
export async function findGitRoot(start: string): Promise<string | null> {
  let current = resolve(start);
  for (let depth = 0; depth < 64; depth += 1) {
    try {
      await access(join(current, ".git"));
      return current;
    } catch {
      // keep walking
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return null;
}

export async function safeRead(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Last-modified time of `path` as an ISO-8601 string, or null when it cannot
 * be read. Used for the staleness heuristic (ADR 01021); like everything else
 * here it degrades rather than throwing — an artifact whose mtime is
 * unreadable is simply one the report says nothing about.
 */
export async function safeMtime(path: string): Promise<string | null> {
  try {
    const info = await stat(path);
    return info.mtime.toISOString();
  } catch {
    return null;
  }
}

/** First file under `root` matching `match`, or null. */
export async function findInTree(
  root: string,
  match: (path: string) => boolean,
): Promise<string | null> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true, recursive: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const full = join(entry.parentPath ?? root, entry.name);
    if (match(full)) return full;
  }
  return null;
}

export interface ListOptions {
  /** Directory names to skip; defaults to PRUNED_DIRS. */
  prune?: Set<string>;
  maxDepth?: number;
}

/**
 * Every file under `root` matching `match`, sorted for stable output.
 *
 * Hand-rolled rather than `readdir({recursive:true})` because pruning has to
 * happen *during* the walk — a recursive readdir would enumerate all of
 * `node_modules` before we could filter it. Symlinked directories report
 * `isDirectory() === false`, so loops are not followed.
 */
export async function listInTree(
  root: string,
  match: (path: string) => boolean,
  options: ListOptions = {},
): Promise<string[]> {
  const prune = options.prune ?? PRUNED_DIRS;
  const maxDepth = options.maxDepth ?? 24;
  const found: string[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // unreadable directory is a skip, not a failure
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (prune.has(entry.name)) continue;
        await walk(full, depth + 1);
      } else if (entry.isFile() && match(full)) {
        found.push(full);
      }
    }
  }

  await walk(resolve(root), 0);
  return found.sort();
}
