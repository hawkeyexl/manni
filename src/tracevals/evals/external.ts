/**
 * The eval trail kept outside the artifact, in an external-metadata manifest a
 * collection declares (proposal 0037, and 0047's `x-manni-location`).
 *
 * `manni:artifact-evals:1.0.0-proposal.4` marks the whole top-level `metadata`
 * key `x-manni-location: external`, so `manni meta relocate` can move an
 * artifact's `evals`, `eval-skip` and `meta-provenance` out of the page and
 * into a manifest, together. Reading only the artifact's own front matter
 * therefore graded a relocated artifact as if it declared nothing: no evals, no
 * trail, no error, a clean gate. This module is why that is no longer true.
 *
 * Reading is meta's merge, not a second loader. `loadExternalEvals` loads every
 * manifest that owns `metadata`, and `forArtifact` merges one artifact through
 * `mergeExternalMetadata`, so the join rules, the ownership rules and the
 * per-item lines are the ones `meta validate` already applies.
 *
 * Two things follow `manni cite`'s sidecar, for cite's reasons:
 *
 *  - **Membership is decided by every declared collection**, not by the ones
 *    the run selected. `run` and `calibrate` select traces and `fill` selects
 *    artifacts under `--project`; no collection ever chooses tracevals' inputs
 *    (proposal 0049 §1). But an artifact `fill` was handed by path is still a
 *    member of the collection that contains it, and its evals are still in that
 *    collection's manifest. A run that read frontmatter instead would report
 *    the artifact as declaring nothing and then write a second copy.
 *  - **A page whose collections own `metadata` twice is refused** by the
 *    writer, because picking one would be the tiebreak 0020 refuses. Reading
 *    two is meta's duplicate finding, not ours.
 *
 * Where tracevals differs from cite: a URL manifest is *readable* here. cite
 * writes citations, so a URL is nowhere to write and is refused at load. `run`
 * and `calibrate` only read, so a hosted trail grades fine; `fill` refuses to
 * write into one at the point of writing (`writableOwner`).
 *
 * `--no-config` never reaches here: with no config there are no collections, so
 * an artifact's evals are its frontmatter's.
 */
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  classifyRef,
  externalMetadataJoin,
  extractFrontmatter,
  loadExternalMetadata,
  memberOf,
  mergeExternalMetadata,
  PATH_JOIN,
  type CollectionConfig,
  type ExternalMetadataConfig,
  type ExternalMetadataIndex,
  type ExtractedMetadata,
} from "../../meta/index.js";
import { TracevalsError } from "../types.js";
import type { ResolvedArtifact } from "../artifacts/types.js";

/**
 * The one key a manifest owns on tracevals' behalf. Not `evals`: 0047 puts the
 * mark on the whole `metadata` map, so `evals`, `eval-skip` and
 * `meta-provenance` relocate as one block and cannot be split across a page and
 * a manifest.
 */
export const METADATA_KEY = "metadata";

const toPosix = (path: string): string => path.split(sep).join("/");

/** How a run spells a manifest: relative to its base, posix, like every file label. */
function reportedPath(abs: string, base: string): string {
  const rel = relative(base, abs);
  return rel === "" ? "." : toPosix(rel);
}

/** A manifest that owns `metadata` for one collection. */
export interface ArtifactManifest {
  /** The collection that declares it. */
  collection: string;
  /** Absolute path of the manifest file, or the URL when `url` is true. */
  path: string;
  /** The manifest as the run reports it. */
  file: string;
  /** `path`, or the artifact field the manifest joins on. */
  join: string;
  /** A hosted manifest: readable by `run`, never written by `fill`. */
  url: boolean;
}

/** Where one artifact's `metadata` block lives, and what it holds. */
export interface ArtifactMetadata {
  /** The artifact's front matter, with a manifest-supplied `metadata` merged in. */
  extracted: ExtractedMetadata;
  /** The manifest that supplied `metadata`, when one did. */
  owner?: ArtifactManifest;
  /**
   * The key under which this artifact is written in `owner`: its path relative
   * to the config directory, or its value of the join field. Undefined when the
   * manifest joins on a field the artifact does not carry, so a writer refuses
   * rather than inventing a key.
   */
  entry?: string;
}

export interface ExternalEvals {
  /** The manifests that own `metadata`, by collection. */
  manifests: readonly ArtifactManifest[];
  /** Directory manifest paths and manifest keys resolve from. */
  configDir: string;
  /** The artifact's metadata, merged with whatever a manifest supplies. */
  forArtifact(artifact: Pick<ResolvedArtifact, "path" | "content">): ArtifactMetadata;
}

export interface LoadExternalEvalsOptions {
  /** Every collection the config declares, not only the ones the run selected. */
  collections: readonly CollectionConfig[];
  /** The config file's directory; `null`/absent when there is no config. */
  configDir: string;
  /** `--offline`: refuse a remote manifest rather than fetch it (0038). */
  offline?: boolean;
  /** The family encryption key, for a join field an artifact holds encrypted. */
  key?: string;
}

/** `<artifact> is in collections a and b, and both keep metadata in a manifest.` */
export function twoManifestsRefusal(label: string, a: string, b: string): string {
  return `${label} is in collections ${a} and ${b}, and both keep ${METADATA_KEY} in a manifest.`;
}

/** `manni tracevals fill` cannot write into a hosted manifest. */
export function urlManifestRefusal(label: string, manifest: ArtifactManifest): string {
  return `${label}: ${METADATA_KEY} is owned by ${manifest.file}, and a URL manifest cannot be written. Vendor it to a path, or run fill with --dry-run.`;
}

function ownsMetadata(manifest: ExternalMetadataConfig): boolean {
  return manifest.keys.includes(METADATA_KEY);
}

/**
 * Load every manifest that owns `metadata`, or `null` when none does — which is
 * every setup that keeps its evals in front matter, and costs nothing.
 *
 * Only the metadata-owning manifests are loaded. A sibling manifest of the same
 * collection, supplying meta's own keys from a URL, is none of tracevals'
 * business and is never fetched here.
 */
export async function loadExternalEvals(
  opts: LoadExternalEvalsOptions,
): Promise<ExternalEvals | null> {
  const manifests: ArtifactManifest[] = [];
  const scoped: CollectionConfig[] = [];
  const base = opts.configDir;
  for (const collection of opts.collections) {
    const owning = collection.externalMetadata.filter(ownsMetadata);
    if (owning.length === 0) continue;
    for (const manifest of owning) {
      const url = classifyRef(manifest.file).kind === "url";
      const path = url
        ? manifest.file
        : isAbsolute(manifest.file)
          ? manifest.file
          : resolve(opts.configDir, manifest.file);
      manifests.push({
        collection: collection.name,
        path,
        file: url ? manifest.file : reportedPath(path, base),
        join: externalMetadataJoin(manifest),
        url,
      });
    }
    scoped.push({ ...collection, externalMetadata: owning });
  }
  if (manifests.length === 0) return null;

  const index = await loadExternalMetadata(scoped, {
    configDir: opts.configDir,
    base,
    ...(opts.offline === undefined ? {} : { offline: opts.offline }),
  });
  if (index === null) return null;
  return reader(index, manifests, scoped, opts);
}

function reader(
  index: ExternalMetadataIndex,
  manifests: readonly ArtifactManifest[],
  scoped: readonly CollectionConfig[],
  opts: LoadExternalEvalsOptions,
): ExternalEvals {
  const { configDir } = opts;
  const base = configDir;
  const declared = opts.collections;

  // Membership is answered against every declared collection, so an artifact
  // `fill` was handed by path is still a member of the collection that holds
  // its manifest. Ownership is then narrowed to the manifests that own
  // `metadata`, which is what `scoped` is.
  const membersOf = (artifactPath: string): string[] =>
    memberOf(declared, configDir, base, artifactPath);

  const forArtifact = (
    artifact: Pick<ResolvedArtifact, "path" | "content">,
  ): ArtifactMetadata => {
    const label = artifact.path;
    const extracted = extractFrontmatter(artifact.content, "markdown");
    const members = membersOf(label);
    if (members.length === 0) return { extracted };

    const mine = manifests.filter((m) => members.includes(m.collection));
    const [owner, second] = mine;
    if (owner === undefined) return { extracted };
    if (second !== undefined) {
      throw new TracevalsError(
        twoManifestsRefusal(label, owner.collection, second.collection),
      );
    }

    const merged = mergeExternalMetadata(
      label,
      extracted,
      index,
      // Only the collections whose manifest owns `metadata` supply anything, so
      // the merge is handed those. Membership above was the whole declaration.
      members.filter((name) => scoped.some((c) => c.name === name)),
      base,
      { encryptionKey: () => opts.key },
    );

    // The manifest supplied the block exactly when `locate` answers for it; an
    // artifact carrying its own `metadata:` keeps it (the collision is meta's
    // finding, not a tiebreak), and `locate` then answers `undefined`.
    const supplied = merged.locate(`/${METADATA_KEY}`) !== undefined;
    if (!supplied) return { extracted: merged.extracted };

    const out: ArtifactMetadata = { extracted: merged.extracted, owner };
    if (owner.join === PATH_JOIN) {
      out.entry = toPosix(relative(configDir, resolve(base, label)));
    } else {
      const value =
        merged.joins.find((j) => j.field === owner.join)?.value ??
        extracted.data[owner.join];
      if (typeof value === "string" && value !== "") out.entry = value;
      else if (typeof value === "number" || typeof value === "boolean") {
        out.entry = String(value);
      }
    }
    return out;
  };

  return { manifests, configDir, forArtifact };
}

/**
 * The manifest `fill` may write this artifact's block into, or `undefined` when
 * the block belongs on the page. Throws when the owner is a URL: a hosted
 * manifest is readable, and writing one is not a thing a CLI can do.
 */
export function writableOwner(
  label: string,
  metadata: ArtifactMetadata | undefined,
): { manifest: ArtifactManifest; entry: string } | undefined {
  const owner = metadata?.owner;
  if (owner === undefined) return undefined;
  if (owner.url) throw new TracevalsError(urlManifestRefusal(label, owner));
  if (metadata?.entry === undefined) {
    throw new TracevalsError(
      `${label}: ${METADATA_KEY} is owned by ${owner.file}, which joins on "${owner.join}", and this artifact carries no ${owner.join}.`,
    );
  }
  return { manifest: owner, entry: metadata.entry };
}
