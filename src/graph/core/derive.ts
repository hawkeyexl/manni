/**
 * Graph derivation: DocModel[] → deduplicated Quad[]. This file is the
 * vocabulary mapping — the deterministic rules for what documentation
 * structure becomes which triples.
 */
import type { DocModel } from "../types.js";
import type { TermLabel } from "../../shared/term-labels.js";
import { spellLines } from "../../shared/pin.js";
import { readRecord, sameRecordId, type RecordType } from "../../shared/reference-fields.js";
import { canonicalLanguage, termIndex } from "./concepts.js";
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
  mintStrategyIri,
  mintTermConceptIri,
  normalizeDocPath,
} from "./iri.js";
import { readSampleQuestions } from "./questions.js";
import { byCodeUnit } from "./sort.js";
import { NS, RDF_TYPE, ROLE } from "./vocab.js";
import {
  GRAPH_NOT_APPLICABLE_TO_VARIANT,
  GRAPH_NOT_SOFTWARE_SUBJECT,
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
 * Resolve a provenance target (a `graph.derived-from` / `graph.revision-of`
 * entry) to a corpus doc path: doc-relative first, then repo-relative; null
 * when neither names a discovered doc.
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
  | {
      kind: "literal";
      value: string;
      datatype?: string;
      /** A language tag, for a literal that carries one. Never set with `datatype`. */
      language?: string;
    };

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
  /**
   * The termbase, as the family term source reads it (proposal 0086 §1).
   * Read only under the `terms` derive source.
   */
  termbase?: readonly TermLabel[];
}

/**
 * How many concepts the termbase contributes: one per term id. A `see:`
 * entry is a redirect, not a concept.
 */
export function termConceptCount(termbase: readonly TermLabel[]): number {
  return termIndex(termbase).groups.size;
}

/** A SKOS hierarchy predicate and the one emitted back from its object. */
const INVERSE = {
  broader: "narrower",
  narrower: "broader",
  related: "related",
} as const;

/** Each strategy record type's class (proposal 0110). */
const RECORD_CLASS: Record<RecordType, string> = {
  audience: `${NS.schema}Audience`,
  persona: `${NS.schema}PeopleAudience`,
  journey: `${NS.graph}Journey`,
};

/**
 * The strategy records among `docs` (proposal 0110), each with its node's
 * IRI. A record is a page whose metadata declares `type: audience`,
 * `persona` or `journey`, read by the family's one rule.
 */
export function strategyRecords(
  docs: readonly DocModel[],
  baseIri: string,
): { path: string; type: RecordType; id: string; iri: string }[] {
  return docs.flatMap((doc) => {
    const record = readRecord(doc.frontmatter, doc.path);
    return record === undefined
      ? []
      : [{ path: doc.path, ...record, iri: mintStrategyIri(baseIri, record.type, record.id) }];
  });
}

/** The one concept scheme's title (proposal 0086). */
export const CONCEPT_SCHEME_TITLE = "manni graph concepts";

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

/**
 * The names in an `author`/`authors` value. Stewardship allows a name, a
 * person object with a `name` (the MyST and Docusaurus shape), or a list of
 * either. A person object with no name names no one.
 */
function asPersonNames(v: unknown): string[] {
  const one = (item: unknown): string[] => {
    const name =
      item != null && typeof item === "object" && !Array.isArray(item)
        ? asString(asRecord(item).name)
        : asString(item);
    return name === undefined ? [] : [name];
  };
  return Array.isArray(v) ? v.flatMap(one) : one(v);
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

/** The `graph` block of frontmatter, or undefined. */
function graphBlock(
  fm: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const block = fm["graph"];
  return block && typeof block === "object" && !Array.isArray(block)
    ? (block as Record<string, unknown>)
    : undefined;
}

/**
 * The harvest rule (ADR 01024): **deeper wins; the page level is the fallback**
 * — per fact, not per page. A `graph` block that speaks to a fact owns it
 * outright; where the block is silent, the page-level twin feeds the graph.
 *
 * Only the facts the `graph` block has a twin for are resolved here. Page-level
 * `prerequisites` / `next-steps` / `related-pages` belong to `docmeta:structure`
 * and are deliberately not harvested — that is a separate vocabulary, not this
 * one's fallback.
 *
 * Returns a graph-shaped object even when the page carries no `graph` block at
 * all, so a page typed only at the top level still derives its iiRDS typing.
 */
function resolveGraph(
  block: Record<string, unknown> | undefined,
  fm: Record<string, unknown>,
): Record<string, unknown> {
  const k: Record<string, unknown> = { ...(block ?? {}) };

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
  // the page's is open (docmeta:core), `graph.type` is the closed iiRDS enum. A
  // page type with no iiRDS counterpart derives nothing rather than inventing
  // one.
  if (k["type"] === undefined || k["type"] === null) {
    const pageType = asString(fmValue(fm, ["type"]));
    // hasOwn guards the prototype chain: `type: constructor` would otherwise
    // resolve to Object and pass the truthiness check below, writing a
    // function into graph.type.
    const derived =
      pageType && Object.hasOwn(PAGE_TYPE_TO_TOPIC_TYPE, pageType)
        ? PAGE_TYPE_TO_TOPIC_TYPE[pageType]
        : undefined;
    if (derived) k["type"] = derived;
  }

  return k;
}

/**
 * The mapping entries of a `provenance` / `meta-provenance` list. Both are
 * lists of entries keyed by `generated-by` (proposal 0046), and a list is all
 * either of them may be — anything else names no machine, so it derives
 * nothing rather than being guessed at.
 *
 * Not `metaProvenanceEntries` from meta's barrel: that reader narrows an entry
 * to its model, `fields` and `evals`, and the harvest also needs `confidence`,
 * which it drops.
 */
function recordEntries(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (e): e is Record<string, unknown> =>
      !!e && typeof e === "object" && !Array.isArray(e),
  );
}

/** A JSON Pointer's reference tokens, each unescaped per RFC 6901. */
function pointerSegments(pointer: string): string[] {
  return pointer
    .split("/")
    .slice(1)
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
}

export function deriveGraph(docs: DocModel[], options: DeriveOptions): Quad[] {
  const { baseIri } = options;
  const sources = new Set(options.derive);
  const quads: Quad[] = [];
  const add = (s: string, p: string, o: Term) => quads.push({ s, p, o });
  /**
   * Concept IRIs minted while deriving. A set rather than a flag because
   * `concept()` is a closure: a captured `let` assigned only inside one stays
   * narrowed to its initializer at the read below, which would make the
   * scheme node unreachable as far as the compiler is concerned.
   */
  const mintedConcepts = new Set<string>();
  const terms = termIndex(sources.has("terms") ? (options.termbase ?? []) : []);

  /**
   * The concept a label names (proposal 0086 §1). A label the termbase
   * defines names that term's concept, which the termbase pass below emits,
   * so the reference adds no label of its own. Any other label is a freeform
   * concept, minted from its slug with the label as its prefLabel.
   */
  const concept = (label: string, language?: string): string => {
    const id = terms.resolve(label, language);
    if (id !== undefined) return mintTermConceptIri(baseIri, id);
    const c = mintConceptIri(baseIri, label);
    add(c, RDF_TYPE, iri(`${NS.skos}Concept`));
    add(c, `${NS.skos}prefLabel`, lit(label));
    add(c, `${NS.skos}inScheme`, iri(mintSchemeIri(baseIri)));
    mintedConcepts.add(c);
    return c;
  };

  /** One hierarchy edge, emitted both ways round. */
  const hierarchy = (s: string, relation: keyof typeof INVERSE, o: string) => {
    add(s, `${NS.skos}${relation}`, iri(o));
    add(o, `${NS.skos}${INVERSE[relation]}`, iri(s));
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
   * not-about-product-aspect) for `subjectIri` from a graph-like object. Shared
   * by the document `graph` block and the per-section `graph.sections` block so
   * the mapping cannot drift between them (ADR 01012/01013/01014).
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
      add(subjectIri, GRAPH_NOT_APPLICABLE_TO_VARIANT, iri(variantNode(label)));
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
      if (subject) add(subjectIri, GRAPH_NOT_SOFTWARE_SUBJECT, iri(subject));
    }
  };

  /** Verification nodes minted per subject, so two statements on one section never share one. */
  const verifications = new Map<string, number>();

  /**
   * `last-verified` and `verified-by` (proposal 0098), on a document, a section
   * or a block alike (proposal 0099). Each `verified-by` entry is one
   * graph:Verification. It gets an IRI under the subject's fragment, never a
   * blank node: `<doc>#/verified-by/1`, `<doc>#slug/verified-by/1`,
   * `<doc>#slug.2/verified-by/1`. A slug never holds a `/`, so none collide.
   */
  const emitVerification = (subject: string, fields: Record<string, unknown>) => {
    const last = asString(fields["last-verified"]);
    if (last) add(subject, `${NS.graph}lastVerified`, dateTerm(last));
    const prefix = subject.includes("#") ? subject : `${subject}#`;
    for (const entry of recordEntries(fields["verified-by"])) {
      const n = (verifications.get(subject) ?? 0) + 1;
      verifications.set(subject, n);
      const node = `${prefix}/verified-by/${String(n)}`;
      add(subject, `${NS.graph}verifiedBy`, iri(node));
      add(node, RDF_TYPE, iri(`${NS.graph}Verification`));
      const tool = asString(entry["tool"]);
      if (tool) add(node, `${NS.graph}tool`, lit(tool));
      const check = asString(entry["check"]);
      if (check) add(node, `${NS.graph}check`, lit(check));
      const version = asString(entry["version"]);
      if (version) add(node, `${NS.graph}version`, lit(version));
      const passed = asString(entry["passed"]);
      if (passed) add(node, `${NS.graph}passed`, dateTerm(passed));
    }
  };

  /**
   * A node under `subject`: `<doc>#<suffix>` for a document, and
   * `<subject>.<suffix>` for a section or block, which already has a fragment.
   * github-slugger never emits a dot, so none collides with a heading slug.
   */
  const partIri = (subject: string, suffix: string): string =>
    subject.includes("#") ? `${subject}.${suffix}` : `${subject}#${suffix}`;

  const docByPath = new Map(docs.map((d) => [normalizeDocPath(d.path), d]));
  const prov = sources.has("provenance");

  // The strategy records in the build (proposal 0110). A reference derives an
  // edge only to one of them, so an id no record declares derives nothing.
  const records = strategyRecords(docs, baseIri);
  const recordByPath = new Map(records.map((r) => [r.path, r]));
  const recordIri = (type: RecordType, id: string): string | undefined =>
    records.find((r) => r.type === type && sameRecordId(r.id, id))?.iri;
  /** `subject predicate <record>` for each value of `fm[key]` that names a record of `type`. */
  const recordEdges = (subject: string, predicate: string, fm: Record<string, unknown>, key: string, type: RecordType) => {
    for (const value of asStringArray(fm[key])) {
      const target = recordIri(type, value);
      if (target !== undefined) add(subject, predicate, iri(target));
    }
  };

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
    const node = partIri(docIri, `prov.attribution.${conceptSlug(name)}`);
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
   * Shared mapping for graph.derived-from / graph.revision-of / page
   * `translation-of` entries.
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
      // On the document even when a statement wrote it: a broken link is the
      // page's to fix, and only a Document carries graph:brokenLink.
      add(mintDocIri(baseIri, doc.path), `${NS.graph}brokenLink`, lit(raw));
    }
  };

  /**
   * The front-matter mapping. A page's front matter derives onto its document
   * through it, and an inline `meta` statement's fields derive onto its
   * section or block through it too (proposal 0099, decisions 10a and 10c),
   * so the levels cannot drift. A section keeps its heading as its title, and
   * only a document falls back to its first H1. `language` is what the node
   * itself declares, and `labels` is the language its concepts and questions
   * are read in. Returns which dates it wrote, so git fills only the gaps.
   */
  const deriveFields = (
    subject: string,
    doc: DocModel,
    fm: Record<string, unknown>,
    level: "document" | "section" | "block",
    language: string | undefined,
    labels: string | undefined,
  ): { created: boolean; modified: boolean } => {
    const block = graphBlock(fm);
    // `block` is the `graph` block as written (block-only facts: provenance,
    // the SKOS hierarchy); `harvested` folds in the page-level fallbacks.
    const harvested = resolveGraph(block, fm);
    const blockLabel = block ? asString(block["label"]) : undefined;
    let created = false;
    let modified = false;

    if (sources.has("frontmatter")) {
      const title =
        level === "section"
          ? undefined
          : (asString(fmValue(fm, ["title"])) ??
            (level === "document" ? doc.firstH1 : undefined));
      if (title) add(subject, `${NS.dcterms}title`, lit(title));

      const description = asString(fmValue(fm, ["description"]));
      if (description) add(subject, `${NS.dcterms}description`, lit(description));

      for (const author of asPersonNames(fmValue(fm, ["author", "authors"]))) {
        if (prov) {
          attributeAuthor(subject, author);
        } else {
          add(subject, `${NS.dcterms}creator`, lit(author));
        }
      }

      // Stewardship's spelling first (`created`, `last-updated`), then the
      // aliases other generators write. One value per predicate: the first
      // key present wins and the rest are ignored.
      const createdOn = asString(fmValue(fm, ["created", "date"]));
      if (createdOn) {
        add(subject, `${NS.dcterms}created`, dateTerm(createdOn));
        if (prov) add(subject, `${NS.prov}generatedAtTime`, dateTerm(createdOn));
        created = true;
      }

      const modifiedOn = asString(
        fmValue(fm, ["last-updated", "updated", "lastmod", "modified"]),
      );
      if (modifiedOn) {
        add(subject, `${NS.dcterms}modified`, dateTerm(modifiedOn));
        modified = true;
      }

      // Written in its canonical spelling: tags are case-insensitive, and
      // `en-us` beside `en-US` would otherwise split one locale into two
      // indexes and miss a `--lang` filter typed the other way.
      if (language) add(subject, `${NS.dcterms}language`, lit(language));

      // ai-context's questions this page should be found for (proposal 0086
      // §7), in the page's language. Only the text: an item's answer pins and
      // review state are test data `check` reads from the source (0087).
      for (const { question } of readSampleQuestions(fmValue(fm, ["sample-questions"]))) {
        add(
          subject,
          `${NS.graph}sampleQuestion`,
          labels ? { kind: "literal", value: question, language: labels } : lit(question),
        );
      }

      // Page-level only: the `graph` block is closed and carries no
      // translation key, so this fact lives at the altitude `lang` already
      // does (ADR 01023, ADR 01037). Both directions are materialized, so
      // "every localization of this page" is one lookup for a consumer with no
      // inbound index of its own.
      for (const raw of asStringArray(fmValue(fm, ["translation-of"]))) {
        provTargetEdge(
          doc,
          subject,
          raw,
          `${NS.schema}translationOfWork`,
          `${NS.schema}workTranslation`,
        );
      }

      // The graph block: the SKOS hierarchy has no page-level twin, so it reads
      // the block as written (frontmatter key `graph`, RDF prefix `graph:`).
      if (block && blockLabel) {
        const topic = concept(blockLabel, labels);
        add(subject, `${NS.foaf}primaryTopic`, iri(topic));
        for (const alt of asStringArray(block["alt-labels"])) {
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
          for (const value of asStringArray(block[key])) {
            hierarchy(topic, predicate, concept(value, labels));
          }
        }
      }

      // A term page is about its term (proposal 0086 §1), unless its `graph`
      // block names a topic of its own. Its id names the term, and its label
      // does when the id is absent or names no term.
      if (!blockLabel && asString(fm["type"]) === "term") {
        const id = asString(fm["id"]);
        const label = asString(fm["label"]);
        const termId =
          (id !== undefined && terms.groups.has(id) ? id : undefined) ??
          (label === undefined ? undefined : terms.resolve(label, labels));
        if (termId !== undefined) {
          add(subject, `${NS.foaf}primaryTopic`, iri(mintTermConceptIri(baseIri, termId)));
        }
      }

      // iiRDS Core + Software typing (ADR 01012), over the harvested block so a
      // page typed only at the top level still types its document (ADR 01024).
      emitIirdsTyping(subject, harvested);
      emitVerification(subject, fm);
    }

    if (sources.has("tags")) {
      // Two distinct facts, both landing on dcterms:subject: dockg's own
      // tag harvest (`tags`/`keywords`), and the concepts fact — where
      // `graph.concepts` beats the page-level `concepts` outright rather than
      // adding to it (ADR 01024).
      const tagged = [
        ...asStringArray(fmValue(fm, ["tags", "keywords"])),
        ...asStringArray(harvested["concepts"]),
      ];
      for (const label of tagged) {
        add(subject, `${NS.dcterms}subject`, iri(concept(label, labels)));
      }
    }

    if (prov) {
      // graph.derived-from / graph.revision-of: doc-relative path,
      // repo-relative path, or URL — one shared resolution. `derived-from` is block-only
      // (document lineage is curated by hand); `revision-of` harvests the
      // page-level `supersedes` when the block is silent (ADR 01024).
      for (const raw of block ? asStringArray(block["derived-from"]) : []) {
        provTargetEdge(doc, subject, raw, `${NS.prov}wasDerivedFrom`);
      }
      for (const raw of asStringArray(harvested["revision-of"])) {
        provTargetEdge(doc, subject, raw, `${NS.prov}wasRevisionOf`);
      }

      // Whole-page generation. There is no page-level `generated-by` any more
      // (proposal 0046): the machines that wrote a page are the DISTINCT
      // `generated-by` values across its page-level `provenance` entries, each
      // of which pins a line range. The activity stays one per page, so a
      // single-model page emits exactly what it always did. Its fragment uses
      // a "." separator, which github-slugger can never produce — heading
      // slugs cannot collide with provenance fragments.
      const machines = [
        ...new Set(
          recordEntries(fmValue(fm, ["provenance"])).flatMap((e) => {
            const m = asString(e["generated-by"]);
            return m === undefined ? [] : [m];
          }),
        ),
      ].sort(byCodeUnit);
      if (machines.length > 0) {
        const activity = partIri(subject, "prov.generation");
        add(subject, `${NS.prov}wasGeneratedBy`, iri(activity));
        add(activity, RDF_TYPE, iri(`${NS.prov}Activity`));
        for (const machine of machines) {
          const model = agentNode(machine, "SoftwareAgent");
          add(activity, `${NS.prov}wasAssociatedWith`, iri(model));
          qualifyAssociation(activity, model, ROLE.generator);
        }
      }

      // Page-level `meta-provenance` (written by `manni graph fill`): one
      // activity PER MODEL so multiple fills by different models keep truthful
      // attribution. Only the doc's own topic concept is prov:generated —
      // shared subject/tag concepts are never attributed, or one doc's LLM
      // would taint every doc using the same tag.
      for (const entry of recordEntries(fmValue(fm, ["meta-provenance"]))) {
        const model = asString(entry["generated-by"]);
        if (!model) continue;
        // A pointer names a value anywhere on the page, so only the ones under
        // `/graph/` are graph's business. The filled field is the first segment
        // after it: `/graph/sections/install/type` attributes `sections`, the
        // field a reviewer would look at. First pointer wins on confidence,
        // which 0046 keys by the whole pointer rather than by the field.
        const pointers = asStringArray(entry["fields"]);
        const confidence = asRecord(entry["confidence"]);
        const filled = new Map<string, string>();
        for (const pointer of pointers) {
          if (!pointer.startsWith("/graph/")) continue;
          const field = pointerSegments(pointer)[1];
          if (field === undefined || field === "") continue;
          if (!filled.has(field)) filled.set(field, pointer);
        }
        if (filled.size === 0) continue;
        const activity = partIri(subject, `prov.graph-fill.${conceptSlug(model)}`);
        const modelAgent = agentNode(model, "SoftwareAgent");
        add(activity, RDF_TYPE, iri(`${NS.prov}Activity`));
        add(activity, `${NS.prov}wasAssociatedWith`, iri(modelAgent));
        qualifyAssociation(activity, modelAgent, ROLE.generator);
        // Each filled field is reified as an entry node carrying its name and
        // (when fill recorded one) the model's confidence — a plain,
        // blank-node-free per-field audit edge (ADR 01015).
        for (const [field, pointer] of filled) {
          const fieldNode = `${activity}.field.${field}`;
          add(activity, `${NS.graph}filledFieldEntry`, iri(fieldNode));
          add(fieldNode, `${NS.graph}filledField`, lit(field));
          const c = confidence[pointer];
          if (typeof c === "number") {
            add(
              fieldNode,
              `${NS.graph}confidence`,
              typedLit(String(Math.round(c * 100) / 100), `${NS.xsd}decimal`),
            );
          }
        }
        if (blockLabel && filled.has("label")) {
          const id = terms.resolve(blockLabel, labels);
          add(
            activity,
            `${NS.prov}generated`,
            iri(
              id === undefined
                ? mintConceptIri(baseIri, blockLabel)
                : mintTermConceptIri(baseIri, id),
            ),
          );
        }
      }
    }
    return { created, modified };
  };

  for (const doc of docs) {
    const docIri = mintDocIri(baseIri, doc.path);
    const fm = doc.frontmatter;
    // The `graph` block as written, for the section typing it carries.
    const block = graphBlock(fm);
    // The page's own key outranks the route it sits under (ADR 01037): a
    // single English page inside a translated tree can correct its label,
    // and a corpus that declares nothing keeps deriving nothing.
    const pageLanguage = canonicalLanguage(
      asString(fmValue(fm, ["lang", "language"])) ?? doc.routeLanguage,
    );

    add(docIri, RDF_TYPE, iri(`${NS.graph}Document`));
    if (prov) add(docIri, RDF_TYPE, iri(`${NS.prov}Entity`));
    add(docIri, `${NS.graph}path`, lit(normalizeDocPath(doc.path)));
    // Intrinsic like path, not gated behind a derive source (ADR 01036): a hash
    // present only sometimes cannot tell "unchanged" from "not stamped", which
    // is the whole question it exists to answer.
    add(docIri, `${NS.graph}contentHash`, lit(doc.contentHash));

    const dated = deriveFields(docIri, doc, fm, "document", pageLanguage, pageLanguage);

    // The content strategy (proposal 0110), page level only, every edge
    // pointing away from the page. A record's file is about its record,
    // unless its `graph` block names a topic of its own.
    if (sources.has("frontmatter")) {
      const record = recordByPath.get(doc.path);
      if (record !== undefined) {
        add(record.iri, RDF_TYPE, iri(RECORD_CLASS[record.type]));
        const title = asString(fm["title"]);
        if (title) add(record.iri, `${NS.dcterms}title`, lit(title));
        if (!(block && asString(block["label"]))) add(docIri, `${NS.foaf}primaryTopic`, iri(record.iri));
        if (record.type === "persona") recordEdges(record.iri, `${NS.dcterms}isPartOf`, fm, "audience", "audience");
        if (record.type === "journey") recordEdges(record.iri, `${NS.schema}audience`, fm, "personas", "persona");
      } else {
        recordEdges(docIri, `${NS.schema}audience`, fm, "audiences", "audience");
        recordEdges(docIri, `${NS.schema}audience`, fm, "personas", "persona");
        recordEdges(docIri, `${NS.dcterms}isPartOf`, fm, "journeys", "journey");
      }
    }

    if (sources.has("sections")) {
      // graph.sections: slug-keyed iiRDS typing attached to section nodes
      // (ADR 01013). Explicit-only — a section gets nothing from the doc.
      const sectionMeta = asRecord(block?.["sections"]);
      const sectionSlugs = new Set(doc.sections.map((s) => s.slug));

      for (const section of doc.sections) {
        const secIri = mintSectionIri(docIri, section.slug);
        const parentIri = section.parentSlug
          ? mintSectionIri(docIri, section.parentSlug)
          : docIri;
        add(secIri, RDF_TYPE, iri(`${NS.graph}Section`));
        add(secIri, `${NS.dcterms}title`, lit(section.title));
        add(
          secIri,
          `${NS.graph}level`,
          typedLit(String(section.level), `${NS.xsd}integer`),
        );
        add(
          secIri,
          `${NS.graph}order`,
          typedLit(String(section.order), `${NS.xsd}integer`),
        );
        add(parentIri, `${NS.dcterms}hasPart`, iri(secIri));

        const meta = asRecord(sectionMeta[section.slug]);
        emitIirdsTyping(secIri, meta);
        for (const label of asStringArray(meta["concepts"])) {
          add(secIri, `${NS.dcterms}subject`, iri(concept(label, pageLanguage)));
        }
      }

      // A graph.sections key naming no heading is a broken reference (surfaced
      // by stats, gated by stats --check) — never a silent drop.
      for (const slug of Object.keys(sectionMeta)) {
        if (!sectionSlugs.has(slug)) {
          add(docIri, `${NS.graph}brokenSectionRef`, lit(slug));
        }
      }

      // Inline `meta` statements (proposal 0099). One on a heading describes
      // that section. Any other mints a graph:Block, `<doc>#<slug>.<n>`, the
      // nth statement in its section, or `<doc>#.<n>` before any heading. A
      // heading statement whose heading graph does not find is a block. Its
      // fields derive as front matter does (decisions 10a and 10c), and nothing
      // is copied from the page (ADR 01013), not even its language.
      const headed = doc.sections.filter((s) => s.line !== null);
      const blocksIn = new Map<string, number>();
      for (const statement of doc.statements ?? []) {
        const { start, end } = statement.anchor;
        const own = canonicalLanguage(asString(fmValue(statement.data, ["lang", "language"])));
        const heading =
          statement.scope === "section"
            ? headed.find((s) => s.line !== null && s.line >= start && s.line <= end)
            : undefined;
        if (heading) {
          const secIri = mintSectionIri(docIri, heading.slug);
          deriveFields(secIri, doc, statement.data, "section", own, own ?? pageLanguage);
          continue;
        }
        const owner = headed.filter((s) => s.line !== null && s.line <= start).at(-1);
        const slug = owner?.slug ?? "";
        const n = (blocksIn.get(slug) ?? 0) + 1;
        blocksIn.set(slug, n);
        const blockIri = mintSectionIri(docIri, `${slug}.${String(n)}`);
        add(owner ? mintSectionIri(docIri, slug) : docIri, `${NS.dcterms}hasPart`, iri(blockIri));
        add(blockIri, RDF_TYPE, iri(`${NS.graph}Block`));
        add(blockIri, `${NS.graph}lines`, lit(spellLines(statement.anchor)));
        if (statement.pin !== undefined) add(blockIri, `${NS.graph}pin`, lit(statement.pin));
        add(blockIri, `${NS.graph}pinStatus`, lit(statement.status));
        deriveFields(blockIri, doc, statement.data, "block", own, own ?? pageLanguage);
      }
    }

    if (sources.has("links")) {
      for (const link of doc.links) {
        if (link.kind === "external" && link.url) {
          add(docIri, `${NS.dcterms}references`, iri(link.url));
        } else if (link.kind === "internal" && link.resolvedPath) {
          const targetIri = mintDocIri(baseIri, link.resolvedPath);
          const target = docByPath.get(link.resolvedPath);
          // Bound first, so the anchor the test found is the anchor the IRI is
          // minted from rather than a second read the type cannot connect to
          // the first.
          const anchor = link.anchor;
          const anchorResolves =
            anchor !== undefined &&
            target !== undefined &&
            target.sections.some((s) => s.slug === anchor);
          add(
            docIri,
            `${NS.dcterms}references`,
            iri(
              anchorResolves ? mintSectionIri(targetIri, anchor) : targetIri,
            ),
          );
        } else if (link.kind === "broken") {
          add(docIri, `${NS.graph}brokenLink`, lit(link.raw));
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
        add(docIri, `${NS.graph}codeLanguage`, lit(language));
      }
    }

    if (prov) {
      // Per-file git history (provenance.git): frontmatter always wins on
      // dates; authors merge; renames become revision edges to the
      // historical-path entities.
      const gitFile = options.gitHistory?.files.get(normalizeDocPath(doc.path));
      if (gitFile) {
        if (!dated.created && gitFile.created) {
          add(docIri, `${NS.dcterms}created`, dateTerm(gitFile.created));
          add(docIri, `${NS.prov}generatedAtTime`, dateTerm(gitFile.created));
        }
        if (!dated.modified && gitFile.modified) {
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
    }
  }

  if (prov) {
    const graphIri = mintGraphIri(baseIri);
    const activity = mintBuildActivityIri(baseIri);
    const tool = agentNode("manni", "SoftwareAgent");
    add(graphIri, RDF_TYPE, iri(`${NS.prov}Entity`));
    add(graphIri, `${NS.prov}wasGeneratedBy`, iri(activity));
    add(activity, RDF_TYPE, iri(`${NS.prov}Activity`));
    add(activity, `${NS.prov}wasAssociatedWith`, iri(tool));
    qualifyAssociation(activity, tool, ROLE.tool);
    if (options.toolVersion) {
      add(tool, `${NS.graph}version`, lit(options.toolVersion));
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

  // The termbase's concepts (proposal 0086 §1): one per id, each language of a
  // term joining it, and every label tagged with the term's language.
  const tagged = (value: string, language: string | undefined): Term =>
    language === undefined ? lit(value) : { kind: "literal", value, language };
  for (const [id, entries] of terms.groups) {
    const c = mintTermConceptIri(baseIri, id);
    add(c, RDF_TYPE, iri(`${NS.skos}Concept`));
    add(c, `${NS.skos}inScheme`, iri(mintSchemeIri(baseIri)));
    mintedConcepts.add(c);
    for (const entry of entries) {
      const language = canonicalLanguage(entry.language);
      add(c, `${NS.skos}prefLabel`, tagged(entry.label, language));
      for (const [values, predicate] of [
        [entry.altLabels, "altLabel"],
        [entry.hiddenLabels, "hiddenLabel"],
        [entry.definition, "definition"],
        [entry.scopeNote, "scopeNote"],
      ] as const) {
        for (const value of asStringArray(values)) {
          add(c, `${NS.skos}${predicate}`, tagged(value, language));
        }
      }
      for (const relation of ["broader", "narrower", "related"] as const) {
        for (const value of entry[relation] ?? []) {
          hierarchy(c, relation, concept(value, language));
        }
      }
      // A code and the mappings out of the scheme belong to no language.
      if (entry.notation !== undefined) add(c, `${NS.skos}notation`, lit(entry.notation));
      for (const [values, predicate] of [
        [entry.exactMatches, "exactMatch"],
        [entry.closeMatches, "closeMatch"],
        [entry.broadMatches, "broadMatch"],
        [entry.narrowMatches, "narrowMatch"],
        [entry.relatedMatches, "relatedMatch"],
      ] as const) {
        for (const value of values ?? []) add(c, `${NS.skos}${predicate}`, iri(value));
      }
    }
  }
  // A `see:` entry is no concept of its own. Its label is another way to say
  // its target, so it becomes an altLabel there.
  for (const entry of terms.redirects) {
    const language = canonicalLanguage(entry.language);
    const target =
      entry.see === undefined ? undefined : terms.resolve(entry.see, language);
    if (target === undefined) continue;
    add(
      mintTermConceptIri(baseIri, target),
      `${NS.skos}altLabel`,
      tagged(entry.label, language),
    );
  }

  if (mintedConcepts.size > 0) {
    const scheme = mintSchemeIri(baseIri);
    add(scheme, RDF_TYPE, iri(`${NS.skos}ConceptScheme`));
    add(scheme, `${NS.dcterms}title`, lit(CONCEPT_SCHEME_TITLE));
    // A concept with no broader concept is a top concept of the scheme, both
    // ways round. Read off the quads, so every source of hierarchy counts.
    const broader = `${NS.skos}broader`;
    const hasBroader = new Set(
      quads.filter((q) => q.p === broader).map((q) => q.s),
    );
    for (const c of mintedConcepts) {
      if (hasBroader.has(c)) continue;
      add(c, `${NS.skos}topConceptOf`, iri(scheme));
      add(scheme, `${NS.skos}hasTopConcept`, iri(c));
    }
  }

  return dedupe(quads);
}

function quadKey(q: Quad): string {
  const o =
    q.o.kind === "iri"
      ? `i:${q.o.value}`
      : `l:${q.o.value}|${q.o.datatype ?? ""}|${q.o.language ?? ""}`;
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
