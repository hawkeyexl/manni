/**
 * The metadata directory (proposal 0126): one `<id>.yaml` manifest per page,
 * found by the page's `id`, read by every collection that declares no
 * `externalMetadata:` of its own. `externalMetadata: []` opts out.
 *
 * Where it is comes from three places, and the first set wins, as for the
 * encryption key (`encryption-key.ts`): `MANNI_EXTERNAL_METADATA_DIR`, the
 * top-level `externalMetadataDir:`, then `metadata` beside the config file.
 * A relative value resolves from the config file's directory, whichever named
 * it.
 *
 * Which one named it decides whether the directory is read. One a person
 * named is always read, and when it is missing the loader refuses the run,
 * since a forgotten checkout step must not read as a page with nothing kept.
 * The default is read only once it holds a manifest, so a repository whose
 * own `metadata/` holds something else is not taken over by an upgrade.
 *
 * Shared, so it imports nothing from a tool.
 */
import { closeSync, openSync, readSync, statSync, type Stats } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { isMap, isScalar, parseDocument } from "yaml";
import {
  implicitExternalMetadata,
  isUrlRef,
  type CollectionConfig,
} from "./collections.js";
import { ID_PLACEHOLDER, listIdManifests } from "./page-manifest.js";

/** The environment variable that wins over the config's directory. */
export const EXTERNAL_METADATA_DIR_ENV = "MANNI_EXTERNAL_METADATA_DIR";

/** The top-level key naming the directory. */
export const EXTERNAL_METADATA_DIR_KEY = "externalMetadataDir";

/** The directory when nothing names one, beside the config file. */
export const EXTERNAL_METADATA_DIR_DEFAULT = "metadata";

export interface ResolvedMetadataDir {
  /** The directory, resolved from the config directory; absolute stays absolute. */
  abs: string;
  /** As the user wrote it, or `metadata` for the default. For messages. */
  spelled: string;
  /** What named it. */
  source: "env" | "config" | "default";
  /**
   * The `{id}` pattern a collection reads it through: posix, relative to the
   * config directory when the directory is under it (`metadata/{id}.yaml`),
   * else absolute.
   */
  pattern: string;
}

/**
 * Whether a run reads the directory: `read`, `missing` (named but not there,
 * which the loader refuses), or `absent` (the default, holding no manifest).
 */
export type MetadataDirState = "read" | "missing" | "absent";

type ToError = (message: string) => Error;

/**
 * The document's top-level `externalMetadataDir:`, or `undefined` when it has
 * none. A value that names no directory is refused, and so is a URL: a
 * writer creates manifests there, and nothing writes to a URL.
 */
export function parseExternalMetadataDir(
  doc: Readonly<Record<string, unknown>>,
  source: string,
  toError: ToError,
): string | undefined {
  if (!Object.hasOwn(doc, EXTERNAL_METADATA_DIR_KEY)) return undefined;
  const value = doc[EXTERNAL_METADATA_DIR_KEY];
  if (typeof value !== "string" || value.trim() === "") {
    throw toError(
      `${source}: ${EXTERNAL_METADATA_DIR_KEY} must be a non-empty string naming a directory, relative to the config file.`,
    );
  }
  if (isUrlRef(value)) {
    throw toError(
      `${source}: ${EXTERNAL_METADATA_DIR_KEY} is a URL. It names a directory this run reads and writes; check the repository out and name its path.`,
    );
  }
  return value;
}

/**
 * The directory a run uses: the environment's, else the config file's, else
 * the default. An empty `MANNI_EXTERNAL_METADATA_DIR` counts as unset,
 * because that is what an absent CI secret expands to.
 */
export function resolveExternalMetadataDir(opts: {
  env?: NodeJS.ProcessEnv;
  configDir: string;
  configured?: string;
}): ResolvedMetadataDir {
  const fromEnv = (opts.env ?? process.env)[EXTERNAL_METADATA_DIR_ENV];
  const [spelled, source] =
    fromEnv !== undefined && fromEnv !== ""
      ? [fromEnv, "env" as const]
      : opts.configured !== undefined
        ? [opts.configured, "config" as const]
        : [EXTERNAL_METADATA_DIR_DEFAULT, "default" as const];
  const abs = resolve(opts.configDir, spelled);
  // Across Windows drives there is no relative path, and `relative` returns `abs`.
  const rel = relative(opts.configDir, abs).replace(/\\/g, "/");
  const outside = isAbsolute(rel) || rel === ".." || rel.startsWith("../");
  const prefix = outside ? `${abs.replace(/\\/g, "/")}/` : rel === "" ? "" : `${rel}/`;
  return { abs, spelled, source, pattern: `${prefix}${ID_PLACEHOLDER}.yaml` };
}

/** A manifest's root key is its first line, so a probe reads no more of a file than this. */
const PROBE_BYTES = 4096;

/** Each default directory probed in this process, by path, with the mtime it had then. */
const probed = new Map<string, { mtimeMs: number; state: MetadataDirState }>();

/**
 * Whether a run reads `dir`. A directory the key or the environment names is
 * read when it exists and `missing` when it does not. The default is read
 * only once it holds a manifest: a `<stem>.yaml` whose root mapping has the
 * key `<stem>`, the shape every manifest there has. Until then it is
 * `absent`, and nothing reads it.
 */
export function metadataDirState(dir: ResolvedMetadataDir): MetadataDirState {
  const stats = statOf(dir.abs);
  if (dir.source !== "default") return stats?.isDirectory() === true ? "read" : "missing";
  // Every config parse in a run asks, so the answer stands until a file is
  // added or removed, which moves the directory's mtime. ponytail: a file
  // edited in place in the same process is seen by the next run.
  const seen = probed.get(dir.abs);
  if (stats !== undefined && seen?.mtimeMs === stats.mtimeMs) return seen.state;
  // `some` stops at the first manifest, so the rest are never opened.
  const state = listIdManifests(dir.pattern, dirname(dir.abs)).some(({ abs, id }) => holdsEntry(abs, id))
    ? "read"
    : "absent";
  if (stats !== undefined) probed.set(dir.abs, { mtimeMs: stats.mtimeMs, state });
  return state;
}

function statOf(path: string): Stats | undefined {
  try {
    return statSync(path);
  } catch {
    return undefined;
  }
}

/**
 * Does the YAML file at `abs` have the root key `id`? Only its first
 * `PROBE_BYTES` are read. A cut-off head need not parse to its end, but the
 * keys before the cut are whole, and the loader reports what follows.
 * Unreadable is no.
 */
function holdsEntry(abs: string, id: string): boolean {
  const head = Buffer.alloc(PROBE_BYTES);
  let read: number;
  try {
    const fd = openSync(abs, "r");
    try {
      read = readSync(fd, head, 0, PROBE_BYTES, 0);
    } finally {
      closeSync(fd);
    }
  } catch {
    return false;
  }
  const root = parseDocument(head.toString("utf8", 0, read)).contents;
  return isMap(root) && root.items.some(({ key }) => isScalar(key) && String(key.value) === id);
}

/** The refusal for a directory someone named that is not there, without its exit code. */
export function missingDirMessage(dir: ResolvedMetadataDir): string {
  const namer = dir.source === "env" ? EXTERNAL_METADATA_DIR_ENV : EXTERNAL_METADATA_DIR_KEY;
  return `${namer}: ${dir.spelled} does not exist. Create it, or check out the repository it names.`;
}

/**
 * `collections` with the metadata directory's entry added to each one that
 * declares no `externalMetadata:`. `absent` adds nothing. `missing` adds the
 * entry carrying its refusal, which the loader gives unless the caller is
 * the writer that creates the directory. `source` names the config file in
 * the entry's origin.
 */
export function withMetadataDirectory(
  collections: CollectionConfig[],
  dir: ResolvedMetadataDir,
  state: MetadataDirState,
  source: string,
): CollectionConfig[] {
  if (state === "absent") return collections;
  return collections.map((c, i) => {
    if (c.declaresExternalMetadata) return c;
    const entry = implicitExternalMetadata(dir.pattern, source, `collections[${String(i)}]`);
    // Set on the entry itself, so the origin and the never-owned keys stay registered.
    if (state === "missing") entry.missing = missingDirMessage(dir);
    return { ...c, externalMetadata: [entry] };
  });
}

/**
 * The one call a parse site makes once it has a document's collections:
 * validate its `externalMetadataDir:`, resolve the directory against the
 * environment and the config directory, decide whether it is read, and add
 * its entry. The directory is looked at only when some collection would read
 * it. `state` overrides what the disk says, for the writer that is about to
 * create the directory and reads its config back as it will then be read.
 */
export function applyMetadataDirectory(
  collections: CollectionConfig[],
  doc: Readonly<Record<string, unknown>>,
  opts: { source: string; configDir: string; toError: ToError; env?: NodeJS.ProcessEnv; state?: MetadataDirState },
): CollectionConfig[] {
  const configured = parseExternalMetadataDir(doc, opts.source, opts.toError);
  if (collections.every((c) => c.declaresExternalMetadata)) return collections;
  const dir = resolveExternalMetadataDir({
    configDir: opts.configDir,
    ...(opts.env === undefined ? {} : { env: opts.env }),
    ...(configured === undefined ? {} : { configured }),
  });
  return withMetadataDirectory(collections, dir, opts.state ?? metadataDirState(dir), opts.source);
}
