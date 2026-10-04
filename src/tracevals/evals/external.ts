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
 * Reading is meta's merge, not a second loader. `loadExternalEvals` keeps every
 * manifest that may own `metadata`, and `forArtifact` merges one artifact
 * through `mergeWithMarks`. So the join rules, the ownership rules and the
 * per-item lines are the ones `meta validate` already applies. That includes a
 * manifest with no `keys` (proposal 0068), which owns what the artifact's
 * schemas mark external. It also includes a `{page}` manifest (proposal 0058),
 * which is read for the artifact it names and no other.
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
 *  - **A page whose collections own `metadata` twice is refused**, because
 *    picking one would be the tiebreak 0020 refuses.
 *
 * Where tracevals differs from cite: a URL manifest is *readable* here. cite
 * writes citations, so a URL is nowhere to write and is refused at load. `run`
 * and `calibrate` only read, so a hosted trail grades fine; `fill` refuses to
 * write into one at the point of writing (`write-location.ts`).
 *
 * `--no-config` never reaches here: with no config there are no collections, so
 * an artifact's evals are its frontmatter's.
 */
import { relative, resolve, sep } from "node:path";
import { ownsKey } from "../../shared/collections.js";
import { hasPagePlaceholder } from "../../shared/page-manifest.js";
import { familyMarks, mergeWithMarks } from "../../meta/internal.js";
import {
  classifyRef,
  DocmetaError,
  externalMetadataJoin,
  extractFrontmatter,
  loadExternalMetadata,
  memberOf,
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

/**
 * What the vocabulary tracevals reads marks `x-manni-location: external`. A
 * manifest with no `keys` may own it, less what a sibling manifest of its
 * collection names. That decides which manifests a run reads and the
 * two-collection refusal. The merge itself reads each artifact's own marks,
 * as meta's does.
 */
const MARKED: ReadonlySet<string> = new Set([METADATA_KEY]);

const toPosix = (path: string): string => path.split(sep).join("/");

/** The manifest that supplied one artifact's `metadata` block. */
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
   * manifest joins on a field the artifact does not carry.
   */
  entry?: string;
}

export interface ExternalEvals {
  /** Directory manifest paths and manifest keys resolve from. */
  configDir: string;
  /** The artifact's metadata, merged with whatever a manifest supplies. */
  forArtifact(artifact: Pick<ResolvedArtifact, "path" | "content">): Promise<ArtifactMetadata>;
}

export interface LoadExternalEvalsOptions {
  /** Every collection the config declares, not only the ones the run selected. */
  collections: readonly CollectionConfig[];
  /** The config file's directory. */
  configDir: string;
  /**
   * The config file itself. A manifest with no `keys` owns what an artifact's
   * schemas mark external, and those schemas are meta's section of this file.
   * Without it, meta's default set decides.
   */
  configPath?: string;
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
export function urlManifestRefusal(label: string, file: string): string {
  return `${label}: ${METADATA_KEY} is owned by ${file}, and a URL manifest cannot be written. Vendor it to a path, or run fill with --dry-run.`;
}

/** Whether one manifest declaration of `collection` may own `metadata`. */
function ownsMetadata(
  collection: Pick<CollectionConfig, "externalMetadata">,
  manifest: ExternalMetadataConfig,
): boolean {
  return ownsKey(collection, manifest, METADATA_KEY, MARKED);
}

/**
 * Every manifest that may own `metadata`, or `null` when none does. That is
 * every setup that keeps its evals in front matter, and it costs nothing.
 *
 * Only the metadata-owning manifests are read. A sibling manifest of the same
 * collection, supplying meta's own keys from a URL, is none of tracevals'
 * business and is never fetched here.
 *
 * Nothing is read until an artifact asks. A `{page}` manifest (proposal 0058)
 * names one file per artifact, and meta reads one only for the pages it is
 * handed, so the artifacts have to be known first. `run` learns them from a
 * trace, and `fill` from its scan.
 */
export function loadExternalEvals(
  opts: LoadExternalEvalsOptions,
): Promise<ExternalEvals | null> {
  const scoped: CollectionConfig[] = [];
  for (const collection of opts.collections) {
    const owning = collection.externalMetadata.filter((m) => ownsMetadata(collection, m));
    if (owning.length === 0) continue;
    scoped.push({ ...collection, externalMetadata: owning });
  }
  return Promise.resolve(scoped.length === 0 ? null : reader(scoped, opts));
}

function reader(
  scoped: readonly CollectionConfig[],
  opts: LoadExternalEvalsOptions,
): ExternalEvals {
  const { configDir } = opts;
  const base = configDir;
  const declared = opts.collections;
  const marks = familyMarks({ configPath: opts.configPath, configDir, cwd: base });

  // A concrete manifest is the same file for every artifact, so it is read
  // once per invocation, and a URL one is fetched once. A `{page}` manifest is
  // read per artifact, and the concrete ones beside it come back out of meta's
  // per-process parse cache.
  const perPage = scoped.some((c) =>
    c.externalMetadata.some((m) => hasPagePlaceholder(m.file)),
  );
  // A manifest that cannot be read is the run's problem, not one artifact's,
  // so it surfaces as this tool's operational error (exit 2) wherever it is
  // first read.
  const load = async (pages?: readonly string[]): Promise<ExternalMetadataIndex | null> => {
    try {
      return await loadExternalMetadata(scoped, {
        configDir,
        base,
        ...(opts.offline === undefined ? {} : { offline: opts.offline }),
        ...(pages === undefined ? {} : { pages }),
      });
    } catch (err) {
      if (err instanceof DocmetaError) throw new TracevalsError(err.message);
      throw err;
    }
  };
  let shared: Promise<ExternalMetadataIndex | null> | undefined;
  const own = new Map<string, Promise<ExternalMetadataIndex | null>>();
  const indexFor = (abs: string): Promise<ExternalMetadataIndex | null> => {
    if (!perPage) return (shared ??= load());
    let index = own.get(abs);
    if (index === undefined) {
      index = load([abs]);
      own.set(abs, index);
    }
    return index;
  };

  const forArtifact = async (
    artifact: Pick<ResolvedArtifact, "path" | "content">,
  ): Promise<ArtifactMetadata> => {
    const label = artifact.path;
    const extracted = extractFrontmatter(artifact.content, "markdown");
    // Membership is answered against every declared collection, so an
    // artifact `fill` was handed by path is still a member of the collection
    // that holds its manifest. Ownership is then narrowed to the collections
    // whose manifests may own `metadata`, which is what `scoped` is.
    const members = memberOf(declared, configDir, base, label);
    const [first, second] = scoped.filter((c) => members.includes(c.name));
    if (first === undefined) return { extracted };
    if (second !== undefined) {
      throw new TracevalsError(twoManifestsRefusal(label, first.name, second.name));
    }

    const merged = await mergeWithMarks(
      label,
      extracted,
      await indexFor(resolve(base, label)),
      [first.name],
      base,
      { encryptionKey: () => opts.key, marks: await marks() },
    );

    // The manifest supplied the block exactly when `locate` answers for it; an
    // artifact carrying its own `metadata:` keeps it (the collision is meta's
    // finding, not a tiebreak), and `locate` then answers `undefined`.
    const at = merged.locate(`/${METADATA_KEY}`);
    const [declaration] = first.externalMetadata;
    if (at === undefined || declaration === undefined) {
      return { extracted: merged.extracted };
    }

    const url = classifyRef(at.file).kind === "url";
    const owner: ArtifactManifest = {
      collection: first.name,
      path: url ? at.file : resolve(base, at.file),
      file: at.file,
      join: externalMetadataJoin(declaration),
      url,
    };
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

  return { configDir, forArtifact };
}
