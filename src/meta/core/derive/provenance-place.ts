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
import {
  ownsKey,
  type CollectionConfig,
  type ExternalMetadataConfig,
} from "../../../shared/collections.js";
import { hasPagePlaceholder, pageManifestPath } from "../../../shared/page-manifest.js";
import { DocmetaError } from "../../types.js";
import { memberOf } from "../collections.js";
import { externalMetadataJoin, outsideRefusal, PATH_JOIN, reportedPath } from "../external-metadata.js";
import { classifyRef } from "../schema-registry.js";
import { PROVENANCE_FIELD, type ProvenanceManifestRef } from "./types.js";

/** A manifest that owns `provenance` for one collection. */
export interface ProvenanceManifest {
  collection: string;
  /**
   * The manifest file, absolute. For a `{page}` manifest (proposal 0058) as
   * `provenanceManifests` lists it, the pattern resolved as a path; a place
   * carries the page's own file.
   */
  absPath: string;
  /** The manifest as the run reports it: relative to the run's base, posix. The pattern as written, for a `{page}` manifest before placing. */
  file: string;
  /** `path`, or the page field the manifest joins on. */
  join: string;
  /** `file:` holds `{page}`, so each page keeps its record in a manifest of its own. */
  perPage: boolean;
  /** `file:` as the config writes it, which a `{page}` manifest resolves per page. */
  written: string;
  /**
   * The manifest names no `keys` (proposal 0068), so it holds a page's record
   * only when the page's schemas mark `provenance` external. The declaration,
   * for `ownsKey`.
   */
  implied?: { collection: CollectionConfig; manifest: ExternalMetadataConfig; url: boolean };
}

/** One page's record in a manifest. */
export interface ProvenancePlace extends ProvenanceManifestRef {
  manifest: ProvenanceManifest;
}

const toPosix = (p: string): string => p.split(sep).join("/");

/**
 * Every declared manifest that owns `provenance`, or may: a manifest with no
 * `keys` (proposal 0068) owns it for the pages whose schemas mark it. A URL
 * manifest may not own it: `derive` writes the record, and a URL is not
 * somewhere to write. One that names it is refused here, and a keyless one
 * when a page's marks give it the record.
 */
export function provenanceManifests(
  collections: readonly CollectionConfig[],
  configDir: string,
  base: string,
): ProvenanceManifest[] {
  const out: ProvenanceManifest[] = [];
  for (const collection of collections) {
    for (const manifest of collection.externalMetadata) {
      const implied = manifest.keys === undefined;
      if (!implied && manifest.keys?.includes(PROVENANCE_FIELD) !== true) continue;
      const url = classifyRef(manifest.file).kind === "url";
      if (url && !implied) throw new DocmetaError(urlRefusal(collection.name));
      if (url) {
        out.push({
          collection: collection.name,
          absPath: manifest.file,
          file: manifest.file,
          join: externalMetadataJoin(manifest),
          perPage: false,
          written: manifest.file,
          implied: { collection, manifest, url },
        });
        continue;
      }
      const absPath = isAbsolute(manifest.file) ? manifest.file : resolve(configDir, manifest.file);
      const perPage = hasPagePlaceholder(manifest.file);
      out.push({
        collection: collection.name,
        absPath,
        file: perPage ? manifest.file : reportedPath(absPath, base),
        join: externalMetadataJoin(manifest),
        perPage,
        written: manifest.file,
        ...(implied ? { implied: { collection, manifest, url } } : {}),
      });
    }
  }
  return out;
}

function urlRefusal(collection: string): string {
  return `collection ${collection}: ${PROVENANCE_FIELD} cannot come from a URL manifest, because manni meta derive writes it.`;
}

/**
 * The manifest entry holding one page's record, or undefined when the record
 * is the page's own. A page in two collections whose manifests both own
 * `provenance` is refused: a writer has to know which file to write to.
 * `data` is the page's own metadata, for a manifest joined on a field; a page
 * that does not carry that field has no entry to write to, and is refused.
 * `marked` is what the page's schemas mark external, which decides whether a
 * manifest with no `keys` holds the record (proposal 0068).
 */
export function provenancePlace(
  label: string,
  data: Readonly<Record<string, unknown>>,
  manifests: readonly ProvenanceManifest[],
  collections: readonly CollectionConfig[],
  configDir: string,
  base: string,
  marked?: ReadonlySet<string>,
): ProvenancePlace | undefined {
  if (manifests.length === 0) return undefined;
  const members = new Set(memberOf(collections, configDir, base, label));
  const owning = manifests.filter(
    (m) =>
      members.has(m.collection) &&
      (m.implied === undefined || ownsKey(m.implied.collection, m.implied.manifest, PROVENANCE_FIELD, marked)),
  );
  const [declared, second] = owning;
  if (declared === undefined) return undefined;
  if (second !== undefined) {
    throw new DocmetaError(
      `${label} is in collections ${declared.collection} and ${second.collection}, and both keep ${PROVENANCE_FIELD} in a manifest.`,
    );
  }
  if (declared.implied?.url === true) throw new DocmetaError(urlRefusal(declared.collection));
  const manifest = declared.perPage ? ownManifest(declared, label, collections, configDir, base) : declared;
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
 * A `{page}` manifest (proposal 0058) as one page keeps its record: the
 * page's own file. A page above the config directory cannot have one, which
 * the loader refuses first whenever the run names the page.
 */
function ownManifest(
  manifest: ProvenanceManifest,
  label: string,
  collections: readonly CollectionConfig[],
  configDir: string,
  base: string,
): ProvenanceManifest {
  const resolved = pageManifestPath(manifest.written, configDir, resolve(base, label));
  if ("outside" in resolved) {
    const declared = collections
      .find((c) => c.name === manifest.collection)
      ?.externalMetadata.find((m) => m.file === manifest.written);
    throw new DocmetaError(
      outsideRefusal(declared ?? { file: manifest.written }, manifest.collection, resolved.pageRel),
    );
  }
  return { ...manifest, absPath: resolved.abs, file: reportedPath(resolved.abs, base) };
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
  marked?: ReadonlySet<string>,
): ProvenanceManifestRef | undefined {
  try {
    const place = provenancePlace(label, data, manifests, collections, configDir, base, marked);
    return place === undefined ? undefined : { absPath: place.absPath, entry: place.entry, join: place.join };
  } catch (err) {
    if (err instanceof DocmetaError) return undefined;
    throw err;
  }
}
