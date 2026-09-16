/**
 * Graph derivation: DocModel[] → deduplicated Quad[]. This file is the
 * vocabulary mapping — the deterministic rules for what documentation
 * structure becomes which triples.
 */
import type { DocModel } from "../types.js";
import type { DeriveSource } from "./config.js";
import type { GitHistory } from "./git.js";
import { hasScheme, resolveRelative } from "./analyze.js";
import type { AgentKind } from "./iri.js";
import {
  conceptSlug,
  encodeSegment,
  mintAgentIri,
  mintBuildActivityIri,
  mintConceptIri,
  mintDocIri,
  mintGraphIri,
  mintProductIri,
  mintSchemeIri,
  mintSectionIri,
  normalizeDocPath,
} from "./iri.js";
import { NS, RDF_TYPE, ROLE } from "./vocab.js";
import {
  DOCKG_NOT_APPLICABLE_TO_VARIANT,
  DOCKG_NOT_SOFTWARE_SUBJECT,
  IIRDS_HAS_SUBJECT,
  IIRDS_HAS_TOPIC_TYPE,
  IIRDS_PRODUCT_VARIANT,
  IIRDS_RELATES_TO_LIFECYCLE_PHASE,
  IIRDS_RELATES_TO_PRODUCT_VARIANT,
  PAGE_TYPE_TO_TOPIC_TYPE,
  SOFTWARE_LIFECYCLE_IRIS,
  SOFTWARE_SUBJECT_IRIS,
  TOPIC_TYPE_IRIS,
} from "./iirds.js";

/**
 * Resolve a provenance target (`kg.derived-from` / `kg.revision-of` entry) to a
 * corpus doc path: doc-relative first, then repo-relative; null when neither
 * names a discovered doc.
 */
function resolveProvDocPath(
  docPath: string,
  raw: string,
  docByPath: ReadonlyMap<string, DocModel>,
): string | null {
  const docRelative = resolveRelative(docPath, raw);
  if (docRelative !== null && docByPath.has(docRelative)) return docRelative;
  const repoRelative = normalizeDocPath(raw);
  return docByPath.has(repoRelative) ? repoRelative : null;
}

export type Term =
  | { kind: "iri"; value: string }
  | { kind: "literal"; value: string; datatype?: string };

export interface Quad {
  s: string;
  p: string;
  o: Term;
}

export interface DeriveOptions {
  baseIri: string;
  derive: DeriveSource[];
  /** dockg's own version, stamped on the build agent (provenance source). */
  toolVersion?: string;
  /** Per-file git history; set only under `provenance.git`. */
  gitHistory?: GitHistory;
  /** Emit qualified attribution/association nodes (`provenance.qualified`). */
  qualified?: boolean;
}

const iri = (value: string): Term => ({ kind: "iri", value });
const lit = (value: string): Term => ({ kind: "literal", value });
const typedLit = (value: string, datatype: string): Term => ({
  kind: "literal",
  value,
  datatype,
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

/** Type a frontmatter date value; plain literal when unrecognized. */
function dateTerm(value: string): Term {
  if (DATE_RE.test(value)) return typedLit(value, `${NS.xsd}date`);
  if (DATETIME_RE.test(value)) return typedLit(value, `${NS.xsd}dateTime`);
  return lit(value);
}

function asString(v: unknown): string | undefined {
  if (typeof v === "string" && v.length > 0) return v;
  if (typeof v === "number") return String(v);
  // TOML frontmatter yields Date instances (smol-toml TomlDate). String(date)
  // is locale/timezone-dependent and would break byte-identical output;
  // ISO 8601 is stable everywhere.
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? undefined : v.toISOString();
  }
  return undefined;
}

function asStringArray(v: unknown): string[] {
  if (typeof v === "string") return v.length > 0 ? [v] : [];
  if (Array.isArray(v)) {
    return v.flatMap((item) => {
      const s = asString(item);
      return s === undefined ? [] : [s];
    });
  }
  return [];
}

/** A plain object as a string-keyed record; anything else becomes `{}`. */
function asRecord(v: unknown): Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

/** First defined frontmatter value among aliases. */
function fmValue(fm: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (fm[key] !== undefined && fm[key] !== null) return fm[key];
  }
  return undefined;
}

/** PROV-O's three prov:Agent subclasses, and their IRI path segments. */
type ProvAgentClass = "Person" | "Organization" | "SoftwareAgent";

const AGENT_KIND: Record<ProvAgentClass, AgentKind> = {
  Person: "person",
  Organization: "org",
  SoftwareAgent: "software",
};

/** The `kg` sub-map of frontmatter, or undefined. */
function kgObject(
  fm: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const kg = fm["kg"];
  return kg && typeof kg === "object" && !Array.isArray(kg)
    ? (kg as Record<string, unknown>)
    : undefined;
}

/**
 * The harvest rule (ADR 01024): **deeper wins; the page level is the fallback**
 * — per fact, not per page. A `kg` block that speaks to a fact owns it
 * outright; where the block is silent, the page-level twin feeds the graph.
 *
 * Only the facts the `kg` block has a twin for are resolved here. Page-level
 * `prerequisites` / `next-steps` / `related-pages` belong to `docmeta:structure`
 * and are deliberately not harvested — that is a separate vocabulary, not this
 * one's fallback.
 *
 * Returns a kg-shaped object even when the page carries no `kg` block at all,
 * so a page typed only at the top level still derives its iiRDS typing.
 */
function resolveKg(
  kg: Record<string, unknown> | undefined,
  fm: Record<string, unknown>,
): Record<string, unknown> {
  const k: Record<string, unknown> = { ...(kg ?? {}) };

  const fallback = (key: string, pageKeys: string[]) => {
    if (k[key] !== undefined && k[key] !== null) return;
    const pageValue = fmValue(fm, pageKeys);
    if (pageValue !== undefined) k[key] = pageValue;
  };

  fallback("concepts", ["concepts"]);
  fallback("applies-to", ["applies-to"]);
  fallback("not-applicable-to", ["not-applicable-to"]);
  fallback("revision-of", ["supersedes"]);

  // `type` is the one fact whose two altitudes speak different vocabularies:
  // the page's is open (docmeta:core), `kg.type` is the closed iiRDS enum. A
  // page type with no iiRDS counterpart derives nothing rather than inventing
  // one.
  if (k["type"] === undefined || k["type"] === null) {
    const pageType = asString(fmValue(fm, ["type"]));
    // hasOwn guards the prototype chain: `type: constructor` would otherwise
    // resolve to Object and pass the truthiness check below, writing a
    // function into kg.type.
    const derived =
      pageType && Object.hasOwn(PAGE_TYPE_TO_TOPIC_TYPE, pageType)
        ? PAGE_TYPE_TO_TOPIC_TYPE[pageType]
        : undefined;
    if (derived) k["type"] = derived;
  }

  return k;
}

/**
 * kg.provenance entries — one per model. Array only: `docmeta:kg` dropped the
 * deprecated single-object shape (dockg's 0.2/0.3 form), so accepting it here
 * would let `manni kg build` derive from frontmatter `manni kg validate` rejects.
 */
function provenanceEntries(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (e): e is Record<string, unknown> =>
      !!e && typeof e === "object" && !Array.isArray(e),
  );
}

export function deriveGraph(docs: DocModel[], options: DeriveOptions): Quad[] {
  const { baseIri } = options;
  const sources = new Set(options.derive);
  const quads: Quad[] = [];
  const add = (s: string, p: string, o: Term) => quads.push({ s, p, o });
  let mintedConcepts = false;

  /** Concept node + membership triples; returns the concept IRI. */
  const concept = (label: string): string => {
    const c = mintConceptIri(baseIri, label);
    add(c, RDF_TYPE, iri(`${NS.skos}Concept`));
    add(c, `${NS.skos}prefLabel`, lit(label));
    add(c, `${NS.skos}inScheme`, iri(mintSchemeIri(baseIri)));
    mintedConcepts = true;
    return c;
  };

  /** ProductVariant node (type + label); returns its IRI. Positive and
   *  negative applicability converge on one node per label. */
  const variantNode = (label: string): string => {
    const variant = mintProductIri(baseIri, label);
    add(variant, RDF_TYPE, iri(IIRDS_PRODUCT_VARIANT));
    add(variant, `${NS.dcterms}title`, lit(label));
    return variant;
  };

  /**
   * Emit the iiRDS typing fields (type, applies-to, about-product-lifecycle,
   * about-product-aspect) plus the negative-scope fields (not-applicable-to,
   * not-about-product-aspect) for `subjectIri` from a kg-like object. Shared by the
   * document `kg` block and the per-section `kg.sections` block so the mapping
   * cannot drift between them (ADR 01012/01013/01014).
   */
  const emitIirdsTyping = (subjectIri: string, k: Record<string, unknown>) => {
    const topicType = asString(k["type"]);
    const topicTypeIri = topicType && TOPIC_TYPE_IRIS[topicType];
    if (topicTypeIri) add(subjectIri, IIRDS_HAS_TOPIC_TYPE, iri(topicTypeIri));

    for (const label of asStringArray(k["applies-to"])) {
      add(
        subjectIri,
        IIRDS_RELATES_TO_PRODUCT_VARIANT,
        iri(variantNode(label)),
      );
    }
    for (const label of asStringArray(k["not-applicable-to"])) {
      add(subjectIri, DOCKG_NOT_APPLICABLE_TO_VARIANT, iri(variantNode(label)));
    }

    for (const value of asStringArray(k["about-product-lifecycle"])) {
      const phase = SOFTWARE_LIFECYCLE_IRIS[value];
      if (phase) add(subjectIri, IIRDS_RELATES_TO_LIFECYCLE_PHASE, iri(phase));
    }
    for (const value of asStringArray(k["about-product-aspect"])) {
      const subject = SOFTWARE_SUBJECT_IRIS[value];
      if (subject) add(subjectIri, IIRDS_HAS_SUBJECT, iri(subject));
    }
    for (const value of asStringArray(k["not-about-product-aspect"])) {
      const subject = SOFTWARE_SUBJECT_IRIS[value];
      if (subject) add(subjectIri, DOCKG_NOT_SOFTWARE_SUBJECT, iri(subject));
    }
  };

  const docByPath = new Map(docs.map((d) => [normalizeDocPath(d.path), d]));
  const prov = sources.has("provenance");

  /**
   * Agent node; dedupe converges repeats of the same name AND kind. The IRI
   * is segmented by kind (`agent/person/…`, `agent/software/…`) so a human
   * and a model whose names slug alike stay distinct nodes.
   */
  const agentNode = (name: string, type: ProvAgentClass): string => {
    const a = mintAgentIri(baseIri, AGENT_KIND[type], name);
    add(a, RDF_TYPE, iri(`${NS.prov}${type}`));
    add(a, `${NS.foaf}name`, lit(name));
    return a;
  };

  const qualified = options.qualified === true;

  // Qualification node IRIs use "." separators (github-slugger can never emit
  // a dot, so heading slugs cannot collide) and carry the agent slug, so two
  // agents on one activity/doc never merge into a single node.

  /** doc ↔ author qualification: {docIri}#prov.attribution.{agentSlug}. */
  const qualifyAttribution = (
    docIri: string,
    agentIri: string,
    name: string,
  ): void => {
    if (!qualified) return;
    const node = `${docIri}#prov.attribution.${conceptSlug(name)}`;
    add(docIri, `${NS.prov}qualifiedAttribution`, iri(node));
    add(node, RDF_TYPE, iri(`${NS.prov}Attribution`));
    add(node, `${NS.prov}agent`, iri(agentIri));
    add(node, `${NS.prov}hadRole`, iri(ROLE.author));
  };

  /** activity ↔ agent qualification: {activityIri}.assoc.{agentSlug}. */
  const qualifyAssociation = (
    activityIri: string,
    agentIri: string,
    role: string,
  ): void => {
    if (!qualified) return;
    const agentSlug = agentIri.slice(agentIri.lastIndexOf("/") + 1);
    const node = `${activityIri}.assoc.${agentSlug}`;
    add(activityIri, `${NS.prov}qualifiedAssociation`, iri(node));
    add(node, RDF_TYPE, iri(`${NS.prov}Association`));
    add(node, `${NS.prov}agent`, iri(agentIri));
    add(node, `${NS.prov}hadRole`, iri(role));
  };

  /** Author agent + creator/attribution edges (+ qualification when on). */
  const attributeAuthor = (docIri: string, name: string): void => {
    const a = agentNode(name, "Person");
    add(docIri, `${NS.dcterms}creator`, iri(a));
    add(docIri, `${NS.prov}wasAttributedTo`, iri(a));
    qualifyAttribution(docIri, a, name);
  };

  /**
   * Shared mapping for kg.derived-from / kg.revision-of / page `translation-of`
   * entries.
   *
   * `inverse`, when given, is also emitted back from the resolved target — but
   * only for a target inside the corpus. A URL names a resource dockg has not
   * analyzed and does not speak for, so it gains an inbound edge and never an
   * outbound claim (ADR 01037).
   */
  const provTargetEdge = (
    doc: DocModel,
    docIri: string,
    raw: string,
    predicate: string,
    inverse?: string,
  ): void => {
    if (hasScheme(raw)) {
      add(docIri, predicate, iri(raw));
      return;
    }
    const target = resolveProvDocPath(
      normalizeDocPath(doc.path),
      raw,
      docByPath,
    );
    if (target) {
      const targetIri = mintDocIri(baseIri, target);
      add(docIri, predicate, iri(targetIri));
      if (inverse) add(targetIri, inverse, iri(docIri));
    } else {
      add(docIri, `${NS.dockg}brokenLink`, lit(raw));
    }
  };

  for (const doc of docs) {
    const docIri = mintDocIri(baseIri, doc.path);
    const fm = doc.frontmatter;
    const kg = kgObject(fm);
    // `kg` is the block as written (block-only facts: sections, provenance,
    // the SKOS hierarchy); `kgHarvested` folds in the page-level fallbacks.
    const kgHarvested = resolveKg(kg, fm);
    let createdEmitted = false;
    let modifiedEmitted = false;

    add(docIri, RDF_TYPE, iri(`${NS.dockg}Document`));
    if (prov) add(docIri, RDF_TYPE, iri(`${NS.prov}Entity`));
    add(docIri, `${NS.dockg}path`, lit(normalizeDocPath(doc.path)));
    // Intrinsic like path, not gated behind a derive source (ADR 01036): a hash
    // present only sometimes cannot tell "unchanged" from "not stamped", which
    // is the whole question it exists to answer.
    add(docIri, `${NS.dockg}contentHash`, lit(doc.contentHash));

    if (sources.has("frontmatter")) {
      const title = asString(fmValue(fm, ["title"])) ?? doc.firstH1;
      if (title) add(docIri, `${NS.dcterms}title`, lit(title));

      const description = asString(fmValue(fm, ["description"]));
      if (description)
        add(docIri, `${NS.dcterms}description`, lit(description));

      for (const author of asStringArray(fmValue(fm, ["author", "authors"]))) {
        if (prov) {
          attributeAuthor(docIri, author);
        } else {
          add(docIri, `${NS.dcterms}creator`, lit(author));
        }
      }

      const created = asString(fmValue(fm, ["date", "created"]));
      if (created) {
        add(docIri, `${NS.dcterms}created`, dateTerm(created));
        if (prov) add(docIri, `${NS.prov}generatedAtTime`, dateTerm(created));
        createdEmitted = true;
      }

      const modified = asString(
        fmValue(fm, ["updated", "lastmod", "modified"]),
      );
      if (modified) {
        add(docIri, `${NS.dcterms}modified`, dateTerm(modified));
        modifiedEmitted = true;
      }

      // The page's own key outranks the route it sits under (ADR 01037): a
      // single English page inside a translated tree can correct its label,
      // and a corpus that declares nothing keeps deriving nothing.
      const language =
        asString(fmValue(fm, ["lang", "language"])) ?? doc.routeLanguage;
      if (language) add(docIri, `${NS.dcterms}language`, lit(language));

      // Page-level only: docmeta's `kg` block is closed and carries no
      // translation key, so this fact lives at the altitude `lang` already
      // does (ADR 01023, ADR 01037). Both directions are materialized, so
      // "every localization of this page" is one lookup for a consumer with no
      // inbound index of its own.
      for (const raw of asStringArray(fmValue(fm, ["translation-of"]))) {
        provTargetEdge(
          doc,
          docIri,
          raw,
          `${NS.schema}translationOfWork`,
          `${NS.schema}workTranslation`,
        );
      }

      // kg sub-key: the SKOS hierarchy has no page-level twin, so it reads the
      // block as written (frontmatter key `kg`, RDF ns `dockg:`).
      if (kg) {
        const label = asString(kg["label"]);
        if (label) {
          const topic = concept(label);
          add(docIri, `${NS.foaf}primaryTopic`, iri(topic));
          for (const alt of asStringArray(kg["alt-labels"])) {
            add(topic, `${NS.skos}altLabel`, lit(alt));
          }
          // Frontmatter key → SKOS predicate. `related-concepts` is spelled for
          // what it points at (in step with the page-level `related-pages`);
          // the predicate it emits is still plain skos:related.
          for (const [key, predicate] of [
            ["broader", "broader"],
            ["narrower", "narrower"],
            ["related-concepts", "related"],
          ] as const) {
            for (const value of asStringArray(kg[key])) {
              add(topic, `${NS.skos}${predicate}`, iri(concept(value)));
            }
          }
        }
      }

      // iiRDS Core + Software typing (ADR 01012), over the harvested block so a
      // page typed only at the top level still types its document (ADR 01024).
      emitIirdsTyping(docIri, kgHarvested);
    }

    if (sources.has("tags")) {
      // Two distinct facts, both landing on dcterms:subject: dockg's own
      // tag harvest (`tags`/`keywords`), and the concepts fact — where
      // `kg.concepts` beats the page-level `concepts` outright rather than
      // adding to it (ADR 01024).
      const labels = [
        ...asStringArray(fmValue(fm, ["tags", "keywords"])),
        ...asStringArray(kgHarvested["concepts"]),
      ];
      for (const label of labels) {
        add(docIri, `${NS.dcterms}subject`, iri(concept(label)));
      }
    }

    if (sources.has("sections")) {
      // kg.sections: slug-keyed iiRDS typing attached to section nodes
      // (ADR 01013). Explicit-only — a section gets nothing from the doc.
      const sectionMeta = asRecord(kg?.["sections"]);
      const sectionSlugs = new Set(doc.sections.map((s) => s.slug));

      for (const section of doc.sections) {
        const secIri = mintSectionIri(docIri, section.slug);
        const parentIri = section.parentSlug
          ? mintSectionIri(docIri, section.parentSlug)
          : docIri;
        add(secIri, RDF_TYPE, iri(`${NS.dockg}Section`));
        add(secIri, `${NS.dcterms}title`, lit(section.title));
        add(
          secIri,
          `${NS.dockg}level`,
          typedLit(String(section.level), `${NS.xsd}integer`),
        );
        add(
          secIri,
          `${NS.dockg}order`,
          typedLit(String(section.order), `${NS.xsd}integer`),
        );
        add(parentIri, `${NS.dcterms}hasPart`, iri(secIri));

        const meta = asRecord(sectionMeta[section.slug]);
        emitIirdsTyping(secIri, meta);
        for (const label of asStringArray(meta["concepts"])) {
          add(secIri, `${NS.dcterms}subject`, iri(concept(label)));
        }
      }

      // A kg.sections key naming no heading is a broken reference (surfaced by
      // stats, gated by stats --check) — never a silent drop.
      for (const slug of Object.keys(sectionMeta)) {
        if (!sectionSlugs.has(slug)) {
          add(docIri, `${NS.dockg}brokenSectionRef`, lit(slug));
        }
      }
    }

    if (sources.has("links")) {
      for (const link of doc.links) {
        if (link.kind === "external" && link.url) {
          add(docIri, `${NS.dcterms}references`, iri(link.url));
        } else if (link.kind === "internal" && link.resolvedPath) {
          const targetIri = mintDocIri(baseIri, link.resolvedPath);
          const target = docByPath.get(link.resolvedPath);
          const anchorResolves =
            link.anchor !== undefined &&
            target !== undefined &&
            target.sections.some((s) => s.slug === link.anchor);
          add(
            docIri,
            `${NS.dcterms}references`,
            iri(
              anchorResolves
                ? mintSectionIri(targetIri, link.anchor!)
                : targetIri,
            ),
          );
        } else if (link.kind === "broken") {
          add(docIri, `${NS.dockg}brokenLink`, lit(link.raw));
        }
      }
    }

    if (sources.has("images")) {
      for (const image of doc.images) {
        const target = image.external
          ? image.target
          : `${baseIri}file/${normalizeDocPath(image.target)
              .split("/")
              .map(encodeSegment)
              .join("/")}`;
        add(docIri, `${NS.schema}image`, iri(target));
      }
    }

    if (sources.has("code")) {
      for (const language of doc.codeLanguages) {
        add(docIri, `${NS.dockg}codeLanguage`, lit(language));
      }
    }

    if (prov) {
      // kg.derived-from / kg.revision-of: doc-relative path, repo-relative
      // path, or URL — one shared resolution. `derived-from` is block-only
      // (document lineage is curated by hand); `revision-of` harvests the
      // page-level `supersedes` when the block is silent (ADR 01024).
      for (const raw of kg ? asStringArray(kg["derived-from"]) : []) {
        provTargetEdge(doc, docIri, raw, `${NS.prov}wasDerivedFrom`);
      }
      for (const raw of asStringArray(kgHarvested["revision-of"])) {
        provTargetEdge(doc, docIri, raw, `${NS.prov}wasRevisionOf`);
      }

      // Per-file git history (provenance.git): frontmatter always wins on
      // dates; authors merge; renames become revision edges to the
      // historical-path entities.
      const gitFile = options.gitHistory?.files.get(normalizeDocPath(doc.path));
      if (gitFile) {
        if (!createdEmitted && gitFile.created) {
          add(docIri, `${NS.dcterms}created`, dateTerm(gitFile.created));
          add(docIri, `${NS.prov}generatedAtTime`, dateTerm(gitFile.created));
        }
        if (!modifiedEmitted && gitFile.modified) {
          add(docIri, `${NS.dcterms}modified`, dateTerm(gitFile.modified));
        }
        for (const author of gitFile.authors) {
          attributeAuthor(docIri, author);
        }
        for (const oldPath of gitFile.renamedFrom) {
          const oldIri = mintDocIri(baseIri, oldPath);
          add(docIri, `${NS.prov}wasRevisionOf`, iri(oldIri));
          add(oldIri, RDF_TYPE, iri(`${NS.prov}Entity`));
        }
      }

      // Whole-page generation: the page-level `generated-by`
      // (docmeta:ai-context). The `kg` block no longer carries a twin — page
      // provenance is the page's fact, not the graph block's. Fragment uses a
      // "." separator, which github-slugger can never produce — heading slugs
      // cannot collide with provenance fragments.
      const generatedBy = asString(fmValue(fm, ["generated-by"]));
      if (generatedBy) {
        const activity = `${docIri}#prov.generation`;
        const model = agentNode(generatedBy, "SoftwareAgent");
        add(docIri, `${NS.prov}wasGeneratedBy`, iri(activity));
        add(activity, RDF_TYPE, iri(`${NS.prov}Activity`));
        add(activity, `${NS.prov}wasAssociatedWith`, iri(model));
        qualifyAssociation(activity, model, ROLE.generator);
      }

      // kg.provenance (written by `manni kg fill`): one activity PER MODEL so
      // multiple fills by different models keep truthful attribution. Only
      // the doc's own topic concept is prov:generated — shared subject/tag
      // concepts are never attributed, or one doc's LLM would taint every
      // doc using the same tag.
      for (const entry of provenanceEntries(kg?.["provenance"])) {
        const model = asString(entry["generated-by"]);
        if (!model) continue;
        const activity = `${docIri}#prov.kg-fill.${conceptSlug(model)}`;
        const modelAgent = agentNode(model, "SoftwareAgent");
        add(activity, RDF_TYPE, iri(`${NS.prov}Activity`));
        add(activity, `${NS.prov}wasAssociatedWith`, iri(modelAgent));
        qualifyAssociation(activity, modelAgent, ROLE.generator);
        // Each filled field is reified as an entry node carrying its name and
        // (when fill recorded one) the model's confidence — a plain,
        // blank-node-free per-field audit edge (ADR 01015).
        const filledFields = asStringArray(entry["fields"]);
        const confidence = asRecord(entry["confidence"]);
        for (const field of filledFields) {
          const fieldNode = `${activity}.field.${field}`;
          add(activity, `${NS.dockg}filledFieldEntry`, iri(fieldNode));
          add(fieldNode, `${NS.dockg}filledField`, lit(field));
          const c = confidence[field];
          if (typeof c === "number") {
            add(
              fieldNode,
              `${NS.dockg}confidence`,
              typedLit(String(Math.round(c * 100) / 100), `${NS.xsd}decimal`),
            );
          }
        }
        const label = kg ? asString(kg["label"]) : undefined;
        if (label && filledFields.includes("label")) {
          add(
            activity,
            `${NS.prov}generated`,
            iri(mintConceptIri(baseIri, label)),
          );
        }
      }
    }
  }

  if (prov) {
    const graphIri = mintGraphIri(baseIri);
    const activity = mintBuildActivityIri(baseIri);
    const tool = agentNode("dockg", "SoftwareAgent");
    add(graphIri, RDF_TYPE, iri(`${NS.prov}Entity`));
    add(graphIri, `${NS.prov}wasGeneratedBy`, iri(activity));
    add(activity, RDF_TYPE, iri(`${NS.prov}Activity`));
    add(activity, `${NS.prov}wasAssociatedWith`, iri(tool));
    qualifyAssociation(activity, tool, ROLE.tool);
    if (options.toolVersion) {
      add(tool, `${NS.dockg}version`, lit(options.toolVersion));
    }
    for (const doc of docs) {
      add(activity, `${NS.prov}used`, iri(mintDocIri(baseIri, doc.path)));
    }
    const headTime = options.gitHistory?.headTime;
    if (headTime) {
      add(
        activity,
        `${NS.prov}endedAtTime`,
        typedLit(headTime, `${NS.xsd}dateTime`),
      );
    }
  }

  if (mintedConcepts) {
    const scheme = mintSchemeIri(baseIri);
    add(scheme, RDF_TYPE, iri(`${NS.skos}ConceptScheme`));
    add(scheme, `${NS.dcterms}title`, lit("dockg concepts"));
  }

  return dedupe(quads);
}

function quadKey(q: Quad): string {
  const o =
    q.o.kind === "iri"
      ? `i:${q.o.value}`
      : `l:${q.o.value}|${q.o.datatype ?? ""}`;
  return `${q.s}|${q.p}|${o}`;
}

function dedupe(quads: Quad[]): Quad[] {
  const seen = new Set<string>();
  const out: Quad[] = [];
  for (const q of quads) {
    const key = quadKey(q);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(q);
  }
  return out;
}
