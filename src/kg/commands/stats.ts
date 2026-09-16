/**
 * `manni kg stats` — graph health summary: node/edge counts, orphan docs
 * (no incoming or outgoing references), broken internal links, the
 * most-connected docs, and metadata coverage. `--check` exits 1 when broken
 * links exist or a coverage threshold is unmet.
 */
import { resolve } from "node:path";
import { DataFactory, type Store } from "n3";
import { loadConfig } from "../core/config.js";
import { compactIri, loadGraph } from "../core/load.js";
import { NS, RDF_TYPE } from "../core/vocab.js";
import { COVERAGE_FIELDS, SECTION_COVERAGE_FIELDS } from "../core/coverage.js";
import { byCodeUnit } from "../core/sort.js";

const { namedNode } = DataFactory;

export interface StatsOptions {
  config?: string;
  graph?: string;
  cwd?: string;
  /** Exit 1 when broken links exist or a coverage threshold is unmet. */
  check?: boolean;
  /** How many most-connected docs to list. */
  top?: number;
  /**
   * Uniform minimum coverage percentage, overriding config across every field.
   * The per-field map form is config-only.
   */
  coverageThreshold?: number;
}

/** One row of the metadata coverage report. */
export interface CoverageRow {
  field: string;
  predicate: string;
  /** Documents carrying the predicate. */
  docs: number;
  /** Percentage of documents covered, rounded to one decimal. */
  pct: number;
}

export interface StatsReport {
  triples: number;
  docs: number;
  sections: number;
  concepts: number;
  references: number;
  /** dockg:path of docs with no in/out dcterms:references. */
  orphans: string[];
  brokenLinks: Array<{ doc: string; target: string }>;
  /** kg.sections keys that matched no heading (dockg:brokenSectionRef). */
  brokenSectionRefs: Array<{ doc: string; slug: string }>;
  mostConnected: Array<{ doc: string; degree: number }>;
  /** Per-field metadata coverage over documents, in report order. */
  coverage: CoverageRow[];
  /**
   * Per-field coverage over `dockg:Section` nodes (ADR 01029). Reported, not
   * gated: sections are explicit-only, so these start near zero on every corpus
   * and a default gate would fail every one of them.
   */
  sectionCoverage: CoverageRow[];
  /**
   * Per-language reporting (ADR 01037). The whole-corpus `coverage` table
   * blends every locale into one number that describes no audience; this says
   * which audience is under-served and what is still untranslated.
   *
   * Reported, not gated — `coverageFindings` stays whole-corpus, per
   * ADR 01009's rule that reporting on does not imply gating on.
   */
  localization: LocalizationReport;
  /** Fields whose document coverage is below their configured threshold. */
  coverageFindings: Array<{ field: string; pct: number; threshold: number }>;
  exitCode: 0 | 1;
}

export interface LanguageReport {
  /** BCP-47 tag exactly as the graph carries it. */
  language: string;
  /** Documents carrying this tag. */
  docs: number;
  /** The same fields as `coverage`, scored over this language's documents. */
  coverage: CoverageRow[];
  /**
   * `dockg:path` of source documents with no translation into this language,
   * sorted. A *source* is a document carrying no `schema:translationOfWork` —
   * so a translation is never its own backlog item — and a source already in
   * this language is excluded. Nothing here is inferred: a page counts as
   * translated only where the graph carries the edge.
   */
  untranslated: string[];
}

export interface LocalizationReport {
  /** Documents carrying no `dcterms:language` at all. */
  unlabelled: number;
  /** One block per language present, sorted by tag. */
  languages: LanguageReport[];
}

function subjectsOfType(store: Store, typeIri: string): string[] {
  return store
    .getQuads(null, namedNode(RDF_TYPE), namedNode(typeIri), null)
    .map((q) => q.subject.value)
    .sort();
}

/** Strip a fragment so section references count toward their doc. */
function base(iri: string): string {
  const hash = iri.indexOf("#");
  return hash === -1 ? iri : iri.slice(0, hash);
}

/** Round a percentage to one decimal place for display. */
function round1(pct: number): number {
  return Math.round(pct * 10) / 10;
}

export function runStats(opts: StatsOptions = {}): StatsReport {
  const cwd = opts.cwd ?? process.cwd();
  const config = loadConfig(opts.config, cwd);
  const store = loadGraph(resolve(cwd, opts.graph ?? config.out));
  const top = opts.top ?? 5;

  const docIris = subjectsOfType(store, `${NS.dockg}Document`);
  const docSet = new Set(docIris);
  // One indexed scan for all paths instead of a per-doc lookup.
  const pathOf = new Map<string, string>(docIris.map((d) => [d, d]));
  for (const quad of store.getQuads(
    null,
    namedNode(`${NS.dockg}path`),
    null,
    null,
  )) {
    pathOf.set(quad.subject.value, quad.object.value);
  }

  const refQuads = store.getQuads(
    null,
    namedNode(`${NS.dcterms}references`),
    null,
    null,
  );
  const degree = new Map<string, number>(docIris.map((d) => [d, 0]));
  for (const quad of refQuads) {
    const from = quad.subject.value;
    const to = base(quad.object.value);
    if (docSet.has(from)) degree.set(from, (degree.get(from) ?? 0) + 1);
    if (docSet.has(to) && to !== from)
      degree.set(to, (degree.get(to) ?? 0) + 1);
  }

  const orphans = docIris
    .filter((d) => (degree.get(d) ?? 0) === 0)
    .map((d) => pathOf.get(d)!)
    .sort();

  const brokenLinks = store
    .getQuads(null, namedNode(`${NS.dockg}brokenLink`), null, null)
    .map((q) => ({
      doc: pathOf.get(q.subject.value) ?? q.subject.value,
      target: q.object.value,
    }))
    .sort((a, b) => (a.doc + a.target < b.doc + b.target ? -1 : 1));

  const brokenSectionRefs = store
    .getQuads(null, namedNode(`${NS.dockg}brokenSectionRef`), null, null)
    .map((q) => ({
      doc: pathOf.get(q.subject.value) ?? q.subject.value,
      slug: q.object.value,
    }))
    .sort((a, b) => (a.doc + a.slug < b.doc + b.slug ? -1 : 1));

  const mostConnected = [...degree.entries()]
    .filter(([, deg]) => deg > 0)
    .map(([doc, deg]) => ({ doc: pathOf.get(doc)!, degree: deg }))
    .sort((a, b) => b.degree - a.degree || (a.doc < b.doc ? -1 : 1))
    .slice(0, top);

  // Coverage: one indexed scan per field over Document subjects. Measured
  // against the graph, so git-derived values count (ADR 01008/01011). A
  // zero-document graph is vacuously 100% — no divide-by-zero, no false gate.
  const total = docIris.length;
  /** Count subjects carrying each predicate, as a share of `subjects`. */
  const coverageOver = (
    subjects: readonly string[],
    fields: readonly { field: string; iri: string }[],
  ): CoverageRow[] =>
    fields.map(({ field, iri }) => {
      let docs = 0;
      for (const s of subjects) {
        if (store.countQuads(namedNode(s), namedNode(iri), null, null) > 0)
          docs++;
      }
      const ratio =
        subjects.length === 0 ? 100 : (docs / subjects.length) * 100;
      // Report the rounded value; gate on the raw ratio (below) so a corpus at
      // 79.96% does not clear an 80 threshold on display rounding alone.
      return { field, predicate: compactIri(iri), docs, pct: round1(ratio) };
    });

  const coverage = coverageOver(docIris, COVERAGE_FIELDS);
  const sectionCoverage = coverageOver(
    subjectsOfType(store, `${NS.dockg}Section`),
    SECTION_COVERAGE_FIELDS,
  );

  // --- Localization (ADR 01037) ---------------------------------------------
  const languageOf = new Map<string, string>();
  for (const q of store.getQuads(
    null,
    namedNode(`${NS.dcterms}language`),
    null,
    null,
  )) {
    if (docSet.has(q.subject.value))
      languageOf.set(q.subject.value, q.object.value);
  }

  const byLanguage = new Map<string, string[]>();
  for (const d of docIris) {
    const tag = languageOf.get(d);
    if (tag === undefined) continue;
    // Push into the existing array rather than rebuilding it: spreading copies
    // the whole bucket per document, which is quadratic in a corpus where one
    // language holds most of the pages.
    const bucket = byLanguage.get(tag);
    if (bucket) bucket.push(d);
    else byLanguage.set(tag, [d]);
  }

  // A source is a document that is not itself a translation. Translations are
  // excluded so a German page never appears in the German backlog.
  const sources = docIris.filter(
    (d) =>
      store.countQuads(
        namedNode(d),
        namedNode(`${NS.schema}translationOfWork`),
        null,
        null,
      ) === 0,
  );

  // Which languages each source already has a translation into, from one scan
  // over the inverse edges. Asking the store per source per language instead
  // scales with #sources × #languages, and every one of those lookups walks
  // the same quads this single pass already visited.
  const translatedInto = new Map<string, Set<string>>();
  for (const q of store.getQuads(
    null,
    namedNode(`${NS.schema}workTranslation`),
    null,
    null,
  )) {
    const target = languageOf.get(q.object.value);
    if (target === undefined) continue;
    const known = translatedInto.get(q.subject.value);
    if (known) known.add(target);
    else translatedInto.set(q.subject.value, new Set([target]));
  }

  const localization: LocalizationReport = {
    unlabelled: docIris.length - languageOf.size,
    languages: [...byLanguage.keys()].sort(byCodeUnit).map((language) => {
      const docsIn = byLanguage.get(language)!;
      const untranslated = sources
        .filter((s) => languageOf.get(s) !== language)
        .filter((s) => !translatedInto.get(s)?.has(language))
        .map((s) => pathOf.get(s)!)
        .sort(byCodeUnit);
      return {
        language,
        docs: docsIn.length,
        coverage: coverageOver(docsIn, COVERAGE_FIELDS),
        untranslated,
      };
    }),
  };

  // A uniform --coverage-threshold overrides the resolved config map. Bind it
  // to a local first so the null-narrowing survives the .map() closure.
  const uniform = opts.coverageThreshold;
  const thresholds =
    uniform != null
      ? Object.fromEntries(coverage.map((c) => [c.field, uniform]))
      : config.stats.coverageThreshold;
  const coverageFindings = coverage
    .filter(
      (c) =>
        c.field in thresholds &&
        (total === 0 ? 100 : (c.docs / total) * 100) < thresholds[c.field]!,
    )
    .map((c) => ({
      field: c.field,
      pct: c.pct,
      threshold: thresholds[c.field]!,
    }));

  const failed =
    !!opts.check &&
    (brokenLinks.length > 0 ||
      brokenSectionRefs.length > 0 ||
      coverageFindings.length > 0);

  return {
    triples: store.size,
    docs: docIris.length,
    // countQuads avoids materializing + sorting arrays used only for counting.
    sections: store.countQuads(
      null,
      namedNode(RDF_TYPE),
      namedNode(`${NS.dockg}Section`),
      null,
    ),
    concepts: store.countQuads(
      null,
      namedNode(RDF_TYPE),
      namedNode(`${NS.skos}Concept`),
      null,
    ),
    references: refQuads.length,
    orphans,
    brokenLinks,
    brokenSectionRefs,
    mostConnected,
    coverage,
    sectionCoverage,
    localization,
    coverageFindings,
    exitCode: failed ? 1 : 0,
  };
}

export function renderStats(
  report: StatsReport,
  format: "pretty" | "json",
): string {
  if (format === "json") {
    const { exitCode: _exitCode, ...rest } = report;
    return JSON.stringify(rest, null, 2);
  }
  const lines = [
    `Triples:    ${report.triples}`,
    `Documents:  ${report.docs}`,
    `Sections:   ${report.sections}`,
    `Concepts:   ${report.concepts}`,
    `References: ${report.references}`,
  ];
  lines.push("", "Most connected:");
  if (report.mostConnected.length === 0) lines.push("  (none)");
  for (const { doc, degree } of report.mostConnected) {
    lines.push(`  ${doc} (${degree})`);
  }
  lines.push("", `Orphan docs (${report.orphans.length}):`);
  for (const orphan of report.orphans) lines.push(`  ${orphan}`);
  if (report.orphans.length === 0) lines.push("  (none)");
  lines.push("", `Broken internal links (${report.brokenLinks.length}):`);
  for (const { doc, target } of report.brokenLinks) {
    lines.push(`  ${doc} -> ${target}`);
  }
  if (report.brokenLinks.length === 0) lines.push("  (none)");

  lines.push("", `Broken section refs (${report.brokenSectionRefs.length}):`);
  for (const { doc, slug } of report.brokenSectionRefs) {
    lines.push(`  ${doc} -> #${slug}`);
  }
  if (report.brokenSectionRefs.length === 0) lines.push("  (none)");

  const belowThreshold = new Set(report.coverageFindings.map((f) => f.field));
  const width = Math.max(
    ...report.coverage.map((c) => c.field.length),
    ...report.sectionCoverage.map((c) => c.field.length),
  );
  lines.push("", "Coverage (documents):");
  for (const { field, docs, pct } of report.coverage) {
    const flag = belowThreshold.has(field) ? "  ! below threshold" : "";
    lines.push(
      `  ${field.padEnd(width)}  ${docs}/${report.docs}  ${pct.toFixed(1)}%${flag}`,
    );
  }

  // Sections are explicit-only (ADR 01013), so this block is reported and not
  // gated — a corpus that has not started on section metadata should not fail.
  lines.push("", "Coverage (sections, not gated):");
  if (report.sections === 0) {
    // The vacuous-100% convention exists to stop an empty graph tripping a
    // gate. This block gates nothing, so printing "0/0 100.0%" on a corpus with
    // no sections would just assert the opposite of the truth.
    lines.push("  (no sections in this graph)");
  } else {
    for (const { field, docs, pct } of report.sectionCoverage) {
      lines.push(
        `  ${field.padEnd(width)}  ${docs}/${report.sections}  ${pct.toFixed(1)}%`,
      );
    }
  }

  // Omitted entirely on a corpus that declares no language, rather than
  // printed empty: a block that says nothing on most corpora teaches readers to
  // skip the report (the failure ADR 01029 recorded for always-zero rows).
  if (report.localization.languages.length > 0) {
    const tagWidth = Math.max(
      ...report.localization.languages.map((l) => l.language.length),
    );
    lines.push("", "Localization:");
    for (const { language, docs, untranslated } of report.localization
      .languages) {
      const plural = docs === 1 ? "doc" : "docs";
      const backlog =
        untranslated.length === 0
          ? ""
          : `  ${untranslated.length} untranslated`;
      lines.push(`  ${language.padEnd(tagWidth)}  ${docs} ${plural}${backlog}`);
    }
    lines.push(`  no language: ${report.localization.unlabelled}`);
  }
  return lines.join("\n");
}
