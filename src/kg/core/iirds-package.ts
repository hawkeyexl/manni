/**
 * Graph → iiRDS package projection (ADR 01017). Reads the built graph and emits
 * the metadata quads + content-file manifest for an unrestricted iiRDS package:
 * one `iirds:Package`, each `dockg:Document` re-typed as an `iirds:Topic` linked
 * via `iirds:is-part-of-package`, each source file exposed as an `iirds:Rendition`
 * (`iirds:source` + `iirds:format`), and the Phase-2 iiRDS classification carried
 * across. This is a *projection* — it builds a fresh quad set (never the whole
 * store), so the package graph contains only iiRDS terms, not dockg-internal
 * types. Deterministic: baseIri-derived IRIs (no random UUIDs), no blank nodes.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DataFactory, type Store } from "n3";
import { DockgError } from "../types.js";
import type { Quad, Term } from "./derive.js";
import { byCodeUnit } from "./sort.js";
import { NS, RDF_TYPE } from "./vocab.js";
import {
  IIRDS_CREATOR,
  IIRDS_HAS_PARTY_ROLE,
  IIRDS_HAS_RENDITION,
  IIRDS_HAS_SUBJECT,
  IIRDS_HAS_TOPIC_TYPE,
  IIRDS_IIRDS_VERSION,
  IIRDS_IS_PART_OF_PACKAGE,
  IIRDS_LANGUAGE,
  IIRDS_PACKAGE,
  IIRDS_PARTY,
  IIRDS_PRODUCT_VARIANT,
  IIRDS_RELATES_TO_LIFECYCLE_PHASE,
  IIRDS_RELATES_TO_PARTY,
  IIRDS_RELATES_TO_PRODUCT_VARIANT,
  IIRDS_RELATES_TO_VCARD,
  IIRDS_RENDITION,
  IIRDS_SOURCE,
  IIRDS_FORMAT,
  IIRDS_TITLE,
  IIRDS_TOPIC,
  VCARD_NS,
  VCARD_ORGANIZATION,
  VCARD_ORGANIZATION_NAME,
} from "./iirds.js";

const { namedNode } = DataFactory;
const DOCKG_DOCUMENT = `${NS.dockg}Document`;
const XSD_STRING = `${NS.xsd}string`;

/** iiRDS classification edges carried from each Document verbatim. */
const CARRIED = [
  IIRDS_HAS_TOPIC_TYPE,
  IIRDS_HAS_SUBJECT,
  IIRDS_RELATES_TO_PRODUCT_VARIANT,
  IIRDS_RELATES_TO_LIFECYCLE_PHASE,
];

export interface IirdsPackageOptions {
  baseIri: string;
  version: string;
  title?: string;
  creator?: string;
}

export interface ContentFile {
  /** In-archive path (matches the Rendition's iirds:source). */
  zipPath: string;
  /** Absolute path of the source file on disk. */
  absPath: string;
}

export interface PackageProjection {
  quads: Quad[];
  prefixes: Record<string, string>;
  contentFiles: ContentFile[];
  warnings: string[];
}

const iri = (value: string): Term => ({ kind: "iri", value });
const lit = (value: string, datatype?: string): Term =>
  datatype ? { kind: "literal", value, datatype } : { kind: "literal", value };

function firstObject(store: Store, s: string, p: string): string | undefined {
  const q = store.getQuads(namedNode(s), namedNode(p), null, null)[0];
  return q?.object.value;
}

export function projectPackage(
  store: Store,
  opts: IirdsPackageOptions,
  cwd: string,
): PackageProjection {
  const quads: Quad[] = [];
  const contentFiles: ContentFile[] = [];
  const warnings: string[] = [];
  const add = (s: string, p: string, o: Term): void => {
    quads.push({ s, p, o });
  };

  const pkg = `${opts.baseIri}package`;
  add(pkg, RDF_TYPE, iri(IIRDS_PACKAGE));
  add(pkg, IIRDS_IIRDS_VERSION, lit(opts.version));
  add(pkg, IIRDS_TITLE, lit(opts.title ?? "dockg export"));

  if (opts.creator) {
    const party = `${opts.baseIri}party/creator`;
    const org = `${opts.baseIri}vcard/creator`;
    add(pkg, IIRDS_RELATES_TO_PARTY, iri(party));
    add(party, RDF_TYPE, iri(IIRDS_PARTY));
    add(party, IIRDS_HAS_PARTY_ROLE, iri(IIRDS_CREATOR));
    add(party, IIRDS_RELATES_TO_VCARD, iri(org));
    add(org, RDF_TYPE, iri(VCARD_ORGANIZATION));
    add(org, VCARD_ORGANIZATION_NAME, lit(opts.creator));
  }

  const docs = store
    .getQuads(null, namedNode(RDF_TYPE), namedNode(DOCKG_DOCUMENT), null)
    .map((q) => q.subject.value)
    .sort(byCodeUnit);

  const variants = new Set<string>();
  for (const doc of docs) {
    add(doc, RDF_TYPE, iri(IIRDS_TOPIC));
    add(doc, IIRDS_IS_PART_OF_PACKAGE, iri(pkg));

    const title = firstObject(store, doc, `${NS.dcterms}title`);
    if (title) add(doc, IIRDS_TITLE, lit(title));
    const language = firstObject(store, doc, `${NS.dcterms}language`);
    if (language) add(doc, IIRDS_LANGUAGE, lit(language));

    const path = firstObject(store, doc, `${NS.dockg}path`);
    if (path) {
      const absPath = resolve(cwd, path);
      if (!existsSync(absPath)) {
        throw new DockgError(
          `Content file for ${path} not found at ${absPath} — re-run \`manni kg build\`, or the source moved.`,
        );
      }
      const zipPath = `content/${path}`;
      const rendition = `${doc}/rendition`;
      add(doc, IIRDS_HAS_RENDITION, iri(rendition));
      add(rendition, RDF_TYPE, iri(IIRDS_RENDITION));
      add(rendition, IIRDS_SOURCE, lit(zipPath));
      add(rendition, IIRDS_FORMAT, lit("text/markdown"));
      contentFiles.push({ zipPath, absPath });
    } else {
      warnings.push(
        `Document ${doc} has no dockg:path — no rendition emitted.`,
      );
    }

    for (const pred of CARRIED) {
      for (const q of store.getQuads(
        namedNode(doc),
        namedNode(pred),
        null,
        null,
      )) {
        const o = q.object;
        if (o.termType === "Literal") {
          const dt = o.datatype.value;
          add(doc, pred, lit(o.value, dt !== XSD_STRING ? dt : undefined));
        } else {
          add(doc, pred, iri(o.value));
          if (pred === IIRDS_RELATES_TO_PRODUCT_VARIANT) variants.add(o.value);
        }
      }
    }
  }

  // Include the referenced ProductVariant nodes (type + label).
  for (const v of [...variants].sort(byCodeUnit)) {
    add(v, RDF_TYPE, iri(IIRDS_PRODUCT_VARIANT));
    const label = firstObject(store, v, `${NS.dcterms}title`);
    if (label) add(v, `${NS.dcterms}title`, lit(label));
  }

  const prefixes: Record<string, string> = {
    dcterms: NS.dcterms,
    iirds: NS.iirds,
    iirdsSft: NS.iirdsSft,
    rdf: NS.rdf,
    vcard: VCARD_NS,
  };

  return { quads, prefixes, contentFiles, warnings };
}
