/**
 * Where a page's `provenance` record lives (proposal 0046 § In an external
 * manifest): in the page's frontmatter, or in the external-metadata manifest
 * of a collection the page belongs to, when that manifest owns the key.
 *
 * `derive` writes the record there, and every reader that compares it (the
 * derive command, `validate`, `get`) hands the same manifest to the git
 * source, so evidence rule 2 reads the manifest's blob at each commit rather
 * than the page's frontmatter. Membership is decided by every declared
 * collection, as cite decides it for `citations`: a page named by path is
 * still a member of the collection whose manifest holds its record.
 */
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { CollectionConfig } from "../../../shared/collections.js";
import { DocmetaError } from "../../types.js";
import { memberOf } from "../collections.js";
import { externalMetadataJoin, PATH_JOIN } from "../external-metadata.js";
import { classifyRef } from "../schema-registry.js";
import { PROVENANCE_FIELD, type ProvenanceManifestRef } from "./types.js";

/** A manifest that owns `provenance` for one collection. */
export interface ProvenanceManifest {
  collection: string;
  /** The manifest file, absolute. */
  absPath: string;
  /** The manifest as the run reports it: relative to the run's base, posix. */
  file: string;
  /** `path`, or the page field the manifest joins on. */
  join: string;
}

/** One page's record in a manifest. */
export interface ProvenancePlace extends ProvenanceManifestRef {
  manifest: ProvenanceManifest;
}

const toPosix = (p: string): string => p.split(sep).join("/");

/**
 * Every declared manifest that owns `provenance`. A URL manifest may not:
 * `derive` writes the record, and a URL is not somewhere to write.
 */
export function provenanceManifests(
  collections: readonly CollectionConfig[],
  configDir: string,
  base: string,
): ProvenanceManifest[] {
  const out: ProvenanceManifest[] = [];
  for (const collection of collections) {
    for (const manifest of collection.externalMetadata) {
      if (!manifest.keys.includes(PROVENANCE_FIELD)) continue;
      if (classifyRef(manifest.file).kind === "url") {
        throw new DocmetaError(
          `collection ${collection.name}: ${PROVENANCE_FIELD} cannot come from a URL manifest, because manni meta derive writes it.`,
        );
      }
      const absPath = isAbsolute(manifest.file) ? manifest.file : resolve(configDir, manifest.file);
      const rel = relative(base, absPath);
      out.push({
        collection: collection.name,
        absPath,
        file: rel === "" ? "." : toPosix(rel),
        join: externalMetadataJoin(manifest),
      });
    }
  }
  return out;
}

/**
 * The manifest entry holding one page's record, or undefined when the record
 * is the page's own. A page in two collections whose manifests both own
 * `provenance` is refused: a writer has to know which file to write to.
 * `data` is the page's own metadata, for a manifest joined on a field; a page
 * that does not carry that field has no entry to write to, and is refused.
 */
export function provenancePlace(
  label: string,
  data: Readonly<Record<string, unknown>>,
  manifests: readonly ProvenanceManifest[],
  collections: readonly CollectionConfig[],
  configDir: string,
  base: string,
): ProvenancePlace | undefined {
  if (manifests.length === 0) return undefined;
  const members = new Set(memberOf(collections, configDir, base, label));
  const owning = manifests.filter((m) => members.has(m.collection));
  const [manifest, second] = owning;
  if (manifest === undefined) return undefined;
  if (second !== undefined) {
    throw new DocmetaError(
      `${label} is in collections ${manifest.collection} and ${second.collection}, and both keep ${PROVENANCE_FIELD} in a manifest.`,
    );
  }
  if (manifest.join === PATH_JOIN) {
    const entry = toPosix(relative(configDir, resolve(base, label)));
    return { manifest, absPath: manifest.absPath, entry, join: manifest.join };
  }
  const value = data[manifest.join];
  if (typeof value !== "string" && typeof value !== "number") {
    throw new DocmetaError(
      `${label} carries no ${manifest.join}, which ${manifest.file} joins on, so its ${PROVENANCE_FIELD} has no entry there.`,
    );
  }
  return { manifest, absPath: manifest.absPath, entry: String(value), join: manifest.join };
}

/**
 * `provenanceManifests` for a reader (`validate`, `get`): nothing is
 * written, so a URL manifest is not refused here; its record is simply not
 * read at a commit.
 */
export function readerManifests(
  collections: readonly CollectionConfig[],
  configDir: string,
  base: string,
): ProvenanceManifest[] {
  const local = collections.map((c) => ({
    ...c,
    externalMetadata: c.externalMetadata.filter((m) => classifyRef(m.file).kind !== "url"),
  }));
  return provenanceManifests(local, configDir, base);
}

/**
 * `provenancePlace` for a reader: a page the writer would refuse (two
 * owning manifests, a join field it lacks) has no manifest to read at a
 * commit, and the merge already reports what is wrong with it.
 */
export function readerPlace(
  label: string,
  data: Readonly<Record<string, unknown>>,
  manifests: readonly ProvenanceManifest[],
  collections: readonly CollectionConfig[],
  configDir: string,
  base: string,
): ProvenanceManifestRef | undefined {
  try {
    const place = provenancePlace(label, data, manifests, collections, configDir, base);
    return place === undefined ? undefined : { absPath: place.absPath, entry: place.entry, join: place.join };
  } catch (err) {
    if (err instanceof DocmetaError) return undefined;
    throw err;
  }
}
