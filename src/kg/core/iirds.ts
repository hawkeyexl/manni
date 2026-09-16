/**
 * iiRDS Core + Software-domain term IRIs and the frontmatter-value → IRI maps
 * (ADR 01012). Every IRI here is byte-verified against the published
 * `iirds-core.rdf` / `iirds-software.rdf` in iirds-consortium/models. dockg
 * references these IRIs; it never redefines or re-types them (iiRDS is
 * CC BY-ND). This is the single source of truth shared by the schema
 * (via the schema-sync drift guard), derive, and shapes.
 */
import { NS } from "./vocab.js";

/** Predicates (Core). */
export const IIRDS_HAS_TOPIC_TYPE = `${NS.iirds}has-topic-type`;
export const IIRDS_RELATES_TO_PRODUCT_VARIANT = `${NS.iirds}relates-to-product-variant`;
export const IIRDS_RELATES_TO_LIFECYCLE_PHASE = `${NS.iirds}relates-to-product-lifecycle-phase`;
export const IIRDS_HAS_SUBJECT = `${NS.iirds}has-subject`;

/** Class minted for `kg.applies-to` nodes. */
export const IIRDS_PRODUCT_VARIANT = `${NS.iirds}ProductVariant`;

/**
 * Package-serialization terms (iiRDS package export, ADR 01017). Local names
 * byte-verified against the canonical RDF/XML example in the published spec
 * (`sections/structure/serialization.md`). Used only by the package projection —
 * never emitted into the built graph. IUs are typed `iirds:Topic` (the subclass
 * that carries `has-topic-type`/`has-subject`), one of the valid IU subclasses.
 */
export const IIRDS_PACKAGE = `${NS.iirds}Package`;
export const IIRDS_IIRDS_VERSION = `${NS.iirds}iiRDSVersion`;
export const IIRDS_TOPIC = `${NS.iirds}Topic`;
export const IIRDS_IS_PART_OF_PACKAGE = `${NS.iirds}is-part-of-package`;
export const IIRDS_HAS_RENDITION = `${NS.iirds}has-rendition`;
export const IIRDS_RENDITION = `${NS.iirds}Rendition`;
export const IIRDS_SOURCE = `${NS.iirds}source`;
export const IIRDS_FORMAT = `${NS.iirds}format`;
export const IIRDS_TITLE = `${NS.iirds}title`;
export const IIRDS_LANGUAGE = `${NS.iirds}language`;
export const IIRDS_PARTY = `${NS.iirds}Party`;
export const IIRDS_HAS_PARTY_ROLE = `${NS.iirds}has-party-role`;
export const IIRDS_CREATOR = `${NS.iirds}Creator`;
export const IIRDS_RELATES_TO_PARTY = `${NS.iirds}relates-to-party`;
export const IIRDS_RELATES_TO_VCARD = `${NS.iirds}relates-to-vcard`;

/** vcard namespace — package-local (not in the global NS/PREFIXES table). */
export const VCARD_NS = "http://www.w3.org/2006/vcard/ns#";
export const VCARD_ORGANIZATION = `${VCARD_NS}Organization`;
export const VCARD_ORGANIZATION_NAME = `${VCARD_NS}organization-name`;

/**
 * Negative-scope predicates (ADR 01014). Minted into `dockg:` — no standard
 * term exists, and OWL negative property assertions require blank nodes. Each
 * mirrors, and is SHACL-disjoint from, its positive counterpart above.
 */
export const DOCKG_NOT_APPLICABLE_TO_VARIANT = `${NS.dockg}notApplicableToVariant`;
export const DOCKG_NOT_SOFTWARE_SUBJECT = `${NS.dockg}notSoftwareSubject`;

/**
 * Page-level `type` → `kg.type` (ADR 01024). The page's `type` is an open
 * vocabulary (docmeta:core); `kg.type` is the closed iiRDS enum. When the block
 * is silent, the page's value derives one through this map — an unmapped page
 * type derives nothing rather than inventing a topic type. An explicit
 * `kg.type` always wins: deeper wins, the page level is the fallback.
 */
export const PAGE_TYPE_TO_TOPIC_TYPE: Readonly<Record<string, string>> = {
  "how-to": "task",
  tutorial: "learning",
  explanation: "concept",
  reference: "reference",
  troubleshooting: "troubleshooting",
};

/** `kg.type` value → `iirds:has-topic-type` object IRI. */
export const TOPIC_TYPE_IRIS: Readonly<Record<string, string>> = {
  task: `${NS.iirds}GenericTask`,
  concept: `${NS.iirds}GenericConcept`,
  reference: `${NS.iirds}GenericReference`,
  learning: `${NS.iirds}GenericLearning`,
  troubleshooting: `${NS.iirds}GenericTroubleshooting`,
  form: `${NS.iirds}GenericForm`,
};

/**
 * `kg.about-product-lifecycle` value → `iirds:relates-to-product-lifecycle-phase`
 * object IRI (Software domain: iirds:Use/PuttingToUse/AfterUse instances).
 */
export const SOFTWARE_LIFECYCLE_IRIS: Readonly<Record<string, string>> = {
  administration: `${NS.iirdsSft}Administration`,
  customization: `${NS.iirdsSft}Customization`,
  update: `${NS.iirdsSft}Update`,
  deployment: `${NS.iirdsSft}Deployment`,
  integration: `${NS.iirdsSft}Integration`,
  deinstallation: `${NS.iirdsSft}Deinstallation`,
};

/**
 * `kg.about-product-aspect` value → `iirds:has-subject` object IRI (Software domain:
 * iirds:TechnicalOverview/TechnicalData instances).
 */
export const SOFTWARE_SUBJECT_IRIS: Readonly<Record<string, string>> = {
  architecture: `${NS.iirdsSft}Architecture`,
  interface: `${NS.iirdsSft}Interface`,
  "system-requirement": `${NS.iirdsSft}SystemRequirement`,
};
