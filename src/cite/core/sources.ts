/**
 * Where a `src` may resolve to, and how an encrypted source is written and
 * read.
 *
 * Sources resolve through tracked files only (`git ls-files -z`) when git is
 * available, else through a walk that follows no symlinks. Every candidate is
 * realpath-contained in the root, so a committed symlink or a `..` cannot reach
 * outside it. A page is untrusted input to the CI job that checks it.
 *
 * An encrypted source is the path encrypted with the family key in the
 * `cite-src` context (proposal 0045). Reading one decrypts it to the path and
 * then asks the index exactly as a plain path is asked, so a ciphertext is
 * never a way around the tracked-file rule.
 */
import fg from "fast-glob";
import { lstat, readFile, realpath } from "node:fs/promises";
import { join, sep } from "node:path";
import { decryptValue, encryptValue } from "../../shared/encryption.js";
import type { GitClient, MissingReason, SourceIndex, SourceRange } from "../types.js";
import { SRC_PATTERN } from "./range.js";

/** The one context cite encrypts in, bound as associated data. */
const CONTEXT = "cite-src";

/** `path` encrypted under `key`: `~` and at least 82 base64url characters. */
export function encryptSourcePath(path: string, key: string): string {
  return encryptValue(path, key, CONTEXT);
}

/**
 * The path an encrypted source holds, or `undefined` when it does not decrypt
 * under `key` in the `cite-src` context, or holds anything but a path a plain
 * `src` could spell. A ciphertext is trusted no further than the page's own
 * paths are.
 */
export function decryptSourcePath(token: string, key: string): string | undefined {
  const opened = decryptValue(token, key, CONTEXT);
  if (!opened.ok || typeof opened.value !== "string") return undefined;
  const path = opened.value;
  // A bare plain path: no line suffix, and no ciphertext inside a ciphertext.
  if (path.includes(":") || path.startsWith("~") || !SRC_PATTERN.test(path)) return undefined;
  return path;
}

export interface BuildIndexOptions {
  /** `git ls-files` when this client reports git available; a walk when it does not, or with no client. */
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
  if (client !== undefined && (await client.available())) {
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

export async function buildSourceIndex(root: string, opts?: BuildIndexOptions): Promise<SourceIndex> {
  const realRoot = await realpath(root);
  const admitted = await Promise.all(
    (await candidates(root, opts)).map((rel) => admit(root, realRoot, rel)),
  );
  const files = Object.freeze(
    [...new Set(admitted.filter((rel): rel is string => rel !== undefined))].sort(),
  );
  const byPath = new Set(files);
  return {
    files: () => files,
    has: (path) => byPath.has(path),
  };
}

export type ReadSourceResult =
  | { kind: "ok"; resolvedPath: string; text: string }
  | { kind: "missing"; reason: MissingReason };

/**
 * Read the file a range names. An encrypted source is decrypted under `key`
 * first: with no key it is `no-key`, under another key `undecryptable`. Never
 * reads a path the index does not hold.
 */
export async function readSource(
  root: string,
  index: SourceIndex,
  range: SourceRange,
  key?: string,
): Promise<ReadSourceResult> {
  let resolvedPath: string;
  if (range.encrypted) {
    if (key === undefined) return { kind: "missing", reason: "no-key" };
    const path = decryptSourcePath(range.path, key);
    if (path === undefined) return { kind: "missing", reason: "undecryptable" };
    resolvedPath = path;
  } else {
    resolvedPath = range.path;
  }
  if (!index.has(resolvedPath)) return { kind: "missing", reason: "untracked" };
  try {
    const text = await readFile(join(root, resolvedPath), "utf8");
    return { kind: "ok", resolvedPath, text };
  } catch {
    return { kind: "missing", reason: "unreadable" };
  }
}
