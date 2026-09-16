/**
 * Metadata coverage fields (ADR 01011). Coverage answers the ADR 01008
 * question — what can a graph-side consumer see — by counting `dockg:Document`
 * nodes that carry each predicate. The list is fixed and deliberate: a
 * predicate absent from every document still shows as 0%, which a dynamic
 * census could not surface. It is shared between the config parser (which
 * expands a uniform threshold across every field) and `manni kg stats` (which
 * reports and gates), and pinned by test/unit/schema-sync.ts against the
 * config schema so it cannot silently drift.
 */
import { NS } from "./vocab.js";
import {
  IIRDS_HAS_SUBJECT,
  IIRDS_HAS_TOPIC_TYPE,
  IIRDS_RELATES_TO_LIFECYCLE_PHASE,
  IIRDS_RELATES_TO_PRODUCT_VARIANT,
} from "./iirds.js";

export interface CoverageField {
  /** Config/report key. */
  field: string;
  /** Full predicate IRI counted against `dockg:Document` subjects. */
  iri: string;
}

/**
 * Report order is this array's order. Only the IRI is stored; the compact form
 * shown in the report is derived from it with `compactIri`, so there is one
 * source of truth for the namespace.
 */
export const COVERAGE_FIELDS: readonly CoverageField[] = [
  { field: "title", iri: `${NS.dcterms}title` },
  { field: "description", iri: `${NS.dcterms}description` },
  { field: "creator", iri: `${NS.dcterms}creator` },
  { field: "created", iri: `${NS.dcterms}created` },
  { field: "modified", iri: `${NS.dcterms}modified` },
  { field: "subject", iri: `${NS.dcterms}subject` },
  { field: "label", iri: `${NS.foaf}primaryTopic` },
  // Dropped by ADR 01011 as "near-universally 0% noise", which was true on the
  // monolingual corpora it was measured against and false the moment language
  // means something. Restored by ADR 01037, which made it a scope dimension:
  // an unlabelled document in a translated corpus cannot be filtered, indexed
  // per locale, or counted against the right audience.
  { field: "language", iri: `${NS.dcterms}language` },
  // The iiRDS typing added in Phases 2–4. Coverage predates all of it, so the
  // measure of "what a graph-side consumer can see" was silent about the
  // vocabulary the project spent four phases adding (ADR 01029).
  { field: "type", iri: IIRDS_HAS_TOPIC_TYPE },
  { field: "applies-to", iri: IIRDS_RELATES_TO_PRODUCT_VARIANT },
  {
    field: "about-product-lifecycle",
    iri: IIRDS_RELATES_TO_LIFECYCLE_PHASE,
  },
  { field: "about-product-aspect", iri: IIRDS_HAS_SUBJECT },
];

/**
 * Section-level coverage: the fields a `kg.sections` block can attach
 * (ADR 01013), measured over `dockg:Section` nodes.
 *
 * Sections are explicit-only — a section gets exactly what its own block
 * declares and nothing from its document — so these numbers are low by
 * construction on most corpora. That is the point: the granularity golden rule
 * says content granularity must match node granularity, and this is the number
 * that says whether it does.
 *
 * `label` is absent deliberately: ADR 01013 rejected `prefLabel` at section
 * level as meaningless, so it cannot be missing.
 */
/** Section-attachable field NAMES; the IRIs come from COVERAGE_FIELDS, so a
 * namespace revision cannot move one table and not the other. */
const SECTION_FIELD_NAMES: readonly string[] = [
  "type",
  "applies-to",
  "about-product-lifecycle",
  "about-product-aspect",
  "subject",
];

export const SECTION_COVERAGE_FIELDS: readonly CoverageField[] =
  SECTION_FIELD_NAMES.map((name) => {
    const field = COVERAGE_FIELDS.find((f) => f.field === name);
    /* c8 ignore next 3 -- unreachable while the two lists agree, which the
       drift guard in test/unit/schema-sync.test.ts keeps true. */
    if (field === undefined) {
      throw new Error(
        `SECTION_FIELD_NAMES names ${name}, which COVERAGE_FIELDS does not define`,
      );
    }
    return field;
  });

/** The measured field names, in report order. */
export const COVERAGE_FIELD_NAMES: readonly string[] = COVERAGE_FIELDS.map(
  (f) => f.field,
);

/**
 * The two negative predicates (ADR 01014) are deliberately not measured.
 *
 * Coverage answers "what can a consumer see that the author lifted". A document
 * with no `not-applicable-to` is not under-annotated — under open-world
 * semantics its absence means *unknown*, which is the normal and correct state
 * for almost every document. Counting it as a gap would put every healthy
 * corpus permanently near zero on two rows and teach readers to ignore the
 * table.
 */
export const UNMEASURED_BY_DESIGN: readonly string[] = [
  "not-applicable-to",
  "not-about-product-aspect",
];
