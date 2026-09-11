/**
 * Where a `src` may resolve to, and how an obfuscated token is minted.
 *
 * Sources resolve through tracked files only (`git ls-files -z`) when git is
 * available, else through a walk that follows no symlinks. Every candidate is
 * realpath-contained in the root, so a committed symlink or a `..` cannot reach
 * outside it. A page is untrusted input to the CI job that checks it.
 *
 * Token: `"~" + sha256(salt + "\n" + path).hex.slice(0, 16)`.
 */
import fg from "fast-glob";
import { randomBytes } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { join, sep } from "node:path";
import { CiteError } from "../errors.js";
import type { GitClient, SourceIndex, SourceRange } from "../types.js";
import { hashLines } from "./hash.js";

const PIN_PREFIX = "sha256-";

export function obfuscatePath(path: string, salt: string): string {
  // The same keyed formula a pin uses, over the path instead of the lines.
  const hex = hashLines(path, salt).slice(PIN_PREFIX.length);
  return `~${hex.slice(0, 16)}`;
}

/**
 * A fresh salt for `salt set` and `salt rotate`: sixteen random bytes as 32
 * lowercase hex characters. Hex, so it survives YAML unquoted in every case
 * but the all-digit one, which the writer quotes.
 */
export function generateSalt(): string {
  return randomBytes(16).toString("hex");
}

export interface BuildIndexOptions {
  /** Default true: use `git ls-files` when the client reports availability. */
  git?: boolean;
  gitClient?: GitClient;
}

/** `true` when `real` is `realRoot` itself or lies below it. */
function isUnder(real: string, realRoot: string): boolean {
  return real === realRoot || real.startsWith(realRoot.endsWith(sep) ? realRoot : realRoot + sep);
}

/**
 * The candidate's posix relative path if it is a regular file whose real
 * location lies under the real root; `undefined` to drop it. A symlink is
 * dropped by `lstat` before it is ever followed; a path that walks out, or a
 * file reached through a symlinked directory, is dropped by the realpath check.
 */
async function admit(root: string, realRoot: string, rel: string): Promise<string | undefined> {
  const abs = join(root, rel);
  try {
    const info = await lstat(abs);
    if (!info.isFile()) return undefined;
    const real = await realpath(abs);
    return isUnder(real, realRoot) ? rel : undefined;
  } catch {
    return undefined;
  }
}

async function candidates(root: string, opts: BuildIndexOptions | undefined): Promise<string[]> {
  const client = opts?.gitClient;
  if (opts?.git !== false && client !== undefined && (await client.available())) {
    return client.lsFiles();
  }
  return fg("**/*", {
    cwd: root,
    onlyFiles: true,
    dot: true,
    followSymbolicLinks: false,
    ignore: ["**/.git/**", "**/node_modules/**"],
  });
}

export async function buildSourceIndex(
  root: string,
  salt: string,
  opts?: BuildIndexOptions,
): Promise<SourceIndex> {
  const realRoot = await realpath(root);
  const admitted = await Promise.all(
    (await candidates(root, opts)).map((rel) => admit(root, realRoot, rel)),
  );
  const files = Object.freeze(
    [...new Set(admitted.filter((rel): rel is string => rel !== undefined))].sort(),
  );
  const byPath = new Set(files);
  const byToken = new Map<string, string[]>();
  for (const path of files) {
    const token = obfuscatePath(path, salt);
    const holders = byToken.get(token);
    if (holders === undefined) byToken.set(token, [path]);
    else holders.push(path);
  }
  return {
    files: () => files,
    resolve(token) {
      const holders = byToken.get(token);
      if (holders === undefined) return undefined;
      if (holders.length > 1) {
        throw new CiteError(
          `Token ${token} matches ${holders.length} tracked files; change the salt so every path gets its own token.`,
        );
      }
      return holders[0];
    },
    has: (path) => byPath.has(path),
  };
}

export type ReadSourceResult =
  | { kind: "ok"; resolvedPath: string; text: string }
  | { kind: "missing"; reason: "untracked" | "unresolved-token" | "unreadable" };

/**
 * Read the file a range names, resolving a token through the index. Never
 * reads a path the index does not hold.
 */
export async function readSource(
  root: string,
  index: SourceIndex,
  range: SourceRange,
): Promise<ReadSourceResult> {
  let resolvedPath: string;
  if (range.obfuscated) {
    const found = index.resolve(range.path);
    if (found === undefined) return { kind: "missing", reason: "unresolved-token" };
    resolvedPath = found;
  } else {
    if (!index.has(range.path)) return { kind: "missing", reason: "untracked" };
    resolvedPath = range.path;
  }
  try {
    const text = await readFile(join(root, resolvedPath), "utf8");
    return { kind: "ok", resolvedPath, text };
  } catch {
    return { kind: "missing", reason: "unreadable" };
  }
}
