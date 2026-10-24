/**
 * A run's temp directory (plan §4.5): the workspace the synthetic user works
 * in, a copy of the docs for a path start, and its own npm global prefix.
 * Nothing it does touches the checkout.
 *
 * The directory is spelled the long way (`realpathSync.native`), because on
 * Windows `os.tmpdir()` can be an 8.3 short name, and Claude Code reports the
 * long one: paths compared or relativized across the two would never match.
 */
import { createHash } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import picomatch from "picomatch";
import { resolveTargetSet } from "../../meta/internal.js";
import { selectCollections } from "../../shared/collections.js";
import type { ConfigFile } from "../../shared/config-file.js";
import { TestError } from "../errors.js";
import type { TaskStart, WorkspaceChanges } from "./task-types.js";

export interface RunDirs {
  root: string;
  workspaceDir: string;
  /** The npm global prefix Claude Code is given. */
  globalDir: string;
  /** Null for a URL start. */
  docsDir: string | null;
  /** The start page's copy; null for a URL start. */
  startCopy: string | null;
}

/**
 * ponytail: dependency and VCS trees are not part of what a reader changed,
 * and a `npm install` would bury the list. Skipped on both sides of the diff
 * and in the docs copy.
 */
const SKIPPED_DIRS = new Set(["node_modules", ".git"]);

const keep = (src: string): boolean => !SKIPPED_DIRS.has(basename(src));

const toPosix = (path: string): string => path.split(sep).join("/");

export async function prepareRun(
  start: TaskStart,
  seed: string | null,
  file: ConfigFile | null,
): Promise<RunDirs> {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "manni-task-")));
  const workspaceDir = join(root, "workspace");
  const globalDir = join(root, "global");
  await mkdir(workspaceDir);
  await mkdir(globalDir);
  if (seed !== null) await cp(seed, workspaceDir, { recursive: true, filter: keep });
  if (start.kind === "url") return { root, workspaceDir, globalDir, docsDir: null, startCopy: null };

  const docsDir = join(root, "docs");
  const startCopy = join(docsDir, await copyDocs(start.abs, file, docsDir));
  return { root, workspaceDir, globalDir, docsDir, startCopy };
}

/**
 * Copy the collection holding `page` into `docsDir`, relative to the
 * collection's glob base, or the page's own directory when no collection
 * holds it. Returns the page's path inside the copy.
 */
async function copyDocs(page: string, file: ConfigFile | null, docsDir: string): Promise<string> {
  const collections = file === null ? [] : selectCollections(file.collections, [], file.source, (m) => new TestError(m));
  for (const collection of collections) {
    const dir = file?.dir ?? dirname(page);
    const { files } = await resolveTargetSet({
      inputs: collection.paths,
      exclude: collection.exclude,
      cwd: dir,
      allowEmpty: true,
    });
    const abs = files.map((f) => resolve(dir, f));
    if (!abs.some((f) => samePath(f, page))) continue;
    const base = globBase(collection.paths, dir);
    for (const f of abs) {
      const rel = copyPathFor(base, f);
      if (rel === undefined) continue;
      const dest = join(docsDir, rel);
      await mkdir(dirname(dest), { recursive: true });
      await cp(f, dest);
    }
    return relative(base, page);
  }
  await cp(dirname(page), docsDir, { recursive: true, filter: keep });
  return basename(page);
}

/**
 * Where a collection file goes inside the docs copy, relative to the copy, or
 * `undefined` for a file that resolves outside the collection's base (through
 * a symlink, or on another drive). Nothing is ever written outside the copy.
 */
export function copyPathFor(base: string, file: string): string | undefined {
  const rel = relative(base, file);
  if (rel === "" || isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) return undefined;
  return rel;
}

function samePath(a: string, b: string): boolean {
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** The deepest directory every one of a collection's paths sits under. */
function globBase(paths: string[], dir: string): string {
  const bases = paths.map((p) => {
    const scan = picomatch.scan(p.replace(/\\/g, "/"));
    const abs = resolve(dir, scan.isGlob ? scan.base : p);
    return scan.isGlob || isDirectory(abs) ? abs : dirname(abs);
  });
  const [first, ...rest] = bases.map((b) => b.split(sep));
  if (first === undefined) return dir;
  let depth = first.length;
  for (const parts of rest) {
    let i = 0;
    while (i < depth && i < parts.length && parts[i] === first[i]) i++;
    depth = i;
  }
  return first.slice(0, depth).join(sep) || sep;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Every file under `dir` as a POSIX relative path → sha256 of its bytes. */
async function hashTree(dir: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const walk = async (at: string): Promise<void> => {
    for (const entry of await readdir(at, { withFileTypes: true })) {
      const abs = join(at, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) await walk(abs);
      } else if (entry.isFile()) {
        out.set(toPosix(relative(dir, abs)), createHash("sha256").update(await readFile(abs)).digest("hex"));
      }
    }
  };
  await walk(dir);
  return out;
}

/** What the run added, changed and removed against the seed, by content. */
export async function workspaceChanges(seed: string | null, workspaceDir: string): Promise<WorkspaceChanges> {
  const before = seed === null ? new Map<string, string>() : await hashTree(seed);
  const after = await hashTree(workspaceDir);
  const added: string[] = [];
  const changed: string[] = [];
  for (const [path, hash] of after) {
    const was = before.get(path);
    if (was === undefined) added.push(path);
    else if (was !== hash) changed.push(path);
  }
  const removed = [...before.keys()].filter((path) => !after.has(path));
  return { added: added.sort(), changed: changed.sort(), removed: removed.sort() };
}
