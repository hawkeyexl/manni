/**
 * The family encryption key (proposal 0045): where a run finds it, where a
 * write puts it, and whether git would publish it.
 *
 * One key for the family, at the top of `manni.config.yaml` beside
 * `collections:`, read by every tool. `MANNI_ENCRYPTION_KEY` in the
 * environment wins over it, which is the right home for a shared repository:
 * a key committed with the pages decrypts every value on them.
 */
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { isMap, parseDocument, parse as parseYaml, stringify } from "yaml";
import {
  ENCRYPTION_KEY_FIELD,
  FAMILY_CONFIG_NAMES,
  MOOSE_CONFIG_NAMES,
  type ConfigFile,
} from "./config-file.js";
import { isValidEncryptionKey } from "./encryption.js";
import { findGitRoot } from "./git-root.js";
import { writeTextAtomic } from "./write-file.js";

export { ENCRYPTION_KEY_FIELD, findFamilyConfigFile } from "./config-file.js";

/** The environment variable that wins over the config's key. */
export const ENCRYPTION_KEY_ENV = "MANNI_ENCRYPTION_KEY";

export type KeySource = "env" | "config" | "none";

export interface ResolvedKey {
  key: string | undefined;
  source: KeySource;
}

type ToError = (message: string) => Error;

/**
 * The key a run uses: the environment's, else the config file's, else none.
 *
 * An empty `MANNI_ENCRYPTION_KEY` counts as unset, because that is what an
 * absent CI secret expands to (a fork's pull request, say), and refusing the
 * run there would fail every such build for a key it was never going to get.
 * A non-empty value of the wrong shape is refused, and never echoed.
 */
export function resolveEncryptionKey(opts: {
  env?: NodeJS.ProcessEnv;
  file: ConfigFile | null;
  toError: ToError;
}): ResolvedKey {
  const env = opts.env ?? process.env;
  const fromEnv = env[ENCRYPTION_KEY_ENV];
  if (fromEnv !== undefined && fromEnv !== "") {
    if (!isValidEncryptionKey(fromEnv)) {
      throw opts.toError(
        `${ENCRYPTION_KEY_ENV} must be at least 32 hex or base64url characters.`,
      );
    }
    return { key: fromEnv, source: "env" };
  }
  const fromFile = opts.file?.encryptionKey;
  if (fromFile !== undefined) return { key: fromFile, source: "config" };
  return { key: undefined, source: "none" };
}

interface Target {
  path: string;
  source: string;
  /** The file's current text, or `null` when the write creates it. */
  text: string | null;
}

function relativeSource(cwd: string, path: string): string {
  return relative(resolve(cwd), path).replace(/\\/g, "/");
}

function errorCode(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && "code" in err
    ? String(err.code)
    : undefined;
}

async function readIfPresent(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if (errorCode(err) === "ENOENT") return null;
    throw err;
  }
}

async function fileTarget(file: ConfigFile, toError: ToError): Promise<Target> {
  // A single-tool file's whole document is one tool's section. A top-level
  // `encryptionKey:` would turn it into a family file on the next read, and
  // every key the tool had would stop being read.
  if (file.kind === "legacy" || !file.wrapped) {
    throw toError(
      `${file.source} is a single-tool config file, which cannot hold the family ${ENCRYPTION_KEY_FIELD}. Move its keys under the tool's section in ${FAMILY_CONFIG_NAMES[0] ?? "manni.config.yaml"}, or set ${ENCRYPTION_KEY_ENV}.`,
    );
  }
  // Re-read rather than trust `file.text`: the file may have changed since
  // discovery, and an edit made in between must not be written over.
  const text = await readIfPresent(file.path);
  return { path: file.path, source: file.source, text: text ?? file.text };
}

/**
 * With no config for the running tool, the key goes to the git root (else
 * `cwd`), where discovery from anywhere in the repository finds it. A family
 * file already there, one a sibling tool owns, is edited rather than
 * replaced.
 */
async function defaultTarget(cwd: string): Promise<Target> {
  const root = findGitRoot(cwd) ?? resolve(cwd);
  for (const name of [...FAMILY_CONFIG_NAMES, ...MOOSE_CONFIG_NAMES]) {
    const path = join(root, name);
    const text = await readIfPresent(path);
    if (text !== null) return { path, source: relativeSource(cwd, path), text };
  }
  const path = join(root, FAMILY_CONFIG_NAMES[0] ?? "manni.config.yaml");
  return { path, source: relativeSource(cwd, path), text: null };
}

/** `text` with the top-level key set, comments and key order kept. */
function withKey(text: string, key: string, source: string, toError: ToError): string {
  const doc = parseDocument(text);
  const [first] = doc.errors;
  if (first !== undefined) {
    throw toError(`${source}: invalid YAML: ${first.message}`);
  }
  if (doc.contents !== null && !isMap(doc.contents)) {
    throw toError(`${source}: top level must be a mapping.`);
  }
  // Replaces an existing key in place, appends a new one, and turns an empty
  // or comment-only document into a one-key mapping.
  doc.set(ENCRYPTION_KEY_FIELD, key);
  return doc.toString();
}

function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read back what is about to be written: the key, and every other top-level
 * value exactly as it was. A config the tools cannot read, or one that lost a
 * key on the way, is worse than a refused write.
 */
function verify(
  before: string | null,
  after: string,
  key: string,
  source: string,
  toError: ToError,
): void {
  const old: unknown = before === null ? null : parseYaml(before);
  const expected = { ...(isMapping(old) ? old : {}), [ENCRYPTION_KEY_FIELD]: key };
  const reread: unknown = parseYaml(after);
  if (!isMapping(reread) || !isDeepStrictEqual(reread, expected)) {
    throw toError(
      `Could not write ${ENCRYPTION_KEY_FIELD} to ${source}; add the key by hand.`,
    );
  }
}

/**
 * Set the top-level `encryptionKey:` and write the file atomically.
 *
 * `file` is the config to write into: the running tool's discovered config,
 * or `findFamilyConfigFile`'s for `manni key`. With `null`, the key goes to
 * the family file at the git root (else `cwd`), created holding only the key
 * when there is none. A single-tool file (legacy, or an explicit `-c` file
 * read whole as one tool's section) is refused. `dryRun` does everything but
 * the write, so a caller can name the target before asking about it.
 */
export async function writeEncryptionKey(opts: {
  file: ConfigFile | null;
  key: string;
  cwd: string;
  toError: ToError;
  dryRun?: boolean;
}): Promise<{ path: string; source: string; created: boolean }> {
  const { file, key, toError } = opts;
  if (!isValidEncryptionKey(key)) {
    throw toError(
      `The ${ENCRYPTION_KEY_FIELD} must be at least 32 hex or base64url characters.`,
    );
  }
  const target =
    file === null ? await defaultTarget(opts.cwd) : await fileTarget(file, toError);
  const text =
    target.text === null
      ? stringify({ [ENCRYPTION_KEY_FIELD]: key })
      : withKey(target.text, key, target.source, toError);
  verify(target.text, text, key, target.source, toError);
  if (opts.dryRun !== true) await writeTextAtomic(target.path, text);
  return { path: target.path, source: target.source, created: target.text === null };
}

/**
 * Whether git ignores `path`, which need not exist yet: `git check-ignore -q`.
 * `undefined` when git is absent or the path is not inside a work tree. A
 * tracked file is not ignored, whatever `.gitignore` says, so it is `false`.
 */
export function isIgnoredByGit(path: string): boolean | undefined {
  const result = spawnSync("git", ["check-ignore", "-q", "--", basename(path)], {
    cwd: dirname(path),
    stdio: "ignore",
    windowsHide: true,
  });
  if (result.error !== undefined) return undefined;
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  return undefined;
}

/** The warning for a key about to land in a file git would publish. */
export const committedKeyWarning = (source: string): string =>
  `${source} is not ignored by git: once committed, anyone who can read the repository can decrypt every encrypted value. Prefer MANNI_ENCRYPTION_KEY for a shared repository.`;
