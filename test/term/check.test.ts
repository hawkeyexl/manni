import { describe, expect, it } from "vitest";
import { checkTermSet } from "../../src/term/core/check.js";
import type {
  Term,
  TermBlock,
  TermConstruct,
  TermField,
  TermFinding,
  TermRecord,
  TermReference,
  TermRule,
  TermSet,
} from "../../src/term/types.js";

interface TermSpec extends TermRecord {
  id?: string;
  language?: string;
  file?: string;
  line?: number;
  construct?: TermConstruct;
  fieldLines?: Partial<Record<TermField, number>>;
}

function term(spec: TermSpec): Term {
  const { id, language, file, line, construct, fieldLines, ...record } = spec;
  return {
    id: id ?? record.label.toLowerCase().replace(/\s+/g, "-"),
    record,
    ...(language === undefined ? {} : { language }),
    location: {
      file: file ?? `docs/terms/${record.label.toLowerCase().replace(/\s+/g, "-")}.md`,
      construct: construct ?? "page",
      line: line ?? 1,
      fieldLines: fieldLines ?? {},
    },
  };
}

function ref(label: string, file = "docs/guides/page.md", line?: number): TermReference {
  return line === undefined ? { file, label } : { file, line, label };
}

function set(
  terms: Term[],
  references: TermReference[] = [],
  blocks: TermBlock[] = [],
  keywords: TermReference[] = [],
): TermSet {
  return { terms, references, blocks, keywords, notices: [] };
}

/** A page's `graph:` block, each field on its own line below the block's. */
function block(
  label: string,
  fields: Partial<Record<"broader" | "narrower" | "related-concepts", string[]>>,
  file = "docs/guides/page.md",
): TermBlock {
  const edges = Object.entries(fields).flatMap(([field, values], i) =>
    values.map((value) => ({ field: field as keyof typeof fields, value, line: 6 + i })),
  );
  return { file, line: 5, label, edges };
}

/** Every term referenced once, so `unused-term` stays quiet in tests about other rules. */
function used(terms: Term[], extra: TermReference[] = []): TermSet {
  return set(terms, [...terms.map((t) => ref(t.record.label)), ...extra]);
}

function only(findings: TermFinding[], rule: TermRule): TermFinding[] {
  return findings.filter((f) => f.rule === rule);
}

describe("checkTermSet", () => {
  it("produces no findings for an empty set", () => {
    expect(checkTermSet(set([]))).toEqual([]);
  });

  it("produces no findings for a consistent set", () => {
    const terms = [
      term({ label: "lens", definition: "A piece of glass.", narrower: ["bifocal"] }),
      term({ label: "bifocal", definition: "A lens with two powers.", broader: ["lens"] }),
    ];
    expect(checkTermSet(used(terms))).toEqual([]);
  });

  describe("undefined-term", () => {
    it("fires on a reference no label claims, at the reference", () => {
      const findings = checkTermSet(
        used([term({ label: "lens", definition: "d" })], [ref("PAL", "docs/guides/fitting.md", 6)]),
      );
      expect(only(findings, "undefined-term")).toEqual([
        {
          rule: "undefined-term",
          ruleId: "manni:term/undefined-term",
          severity: "error",
          message: 'concepts: "PAL" names no entry.',
          file: "docs/guides/fitting.md",
          line: 6,
        },
      ]);
    });

    it("leaves an alt-label to alt-label-reference", () => {
      const findings = checkTermSet(
        used(
          [term({ label: "progressive lens", definition: "d", "alt-labels": ["PAL"] })],
          [ref("pal", "docs/guides/fitting.md", 6)],
        ),
      );
      expect(only(findings, "undefined-term")).toEqual([]);
    });

    it("resolves an id, ignoring case", () => {
      const findings = checkTermSet(
        set([term({ id: "pal", label: "progressive lens", definition: "d" })], [ref("PAL")]),
      );
      expect(findings).toEqual([]);
    });

    it("names graph.concepts when the reference came from it", () => {
      const findings = checkTermSet(set([], [{ file: "a.md", label: "PAL", field: "graph.concepts" }]));
      expect(findings.map((f) => f.message)).toEqual(['graph.concepts: "PAL" names no entry.']);
    });

    it("matches a label ignoring case", () => {
      const findings = checkTermSet(set([term({ label: "Bifocal", definition: "d" })], [ref("BIFOCAL")]));
      expect(only(findings, "undefined-term")).toEqual([]);
    });

    it("omits line when the reference has none", () => {
      const findings = checkTermSet(set([], [ref("PAL")]));
      expect(findings[0]).not.toHaveProperty("line");
      expect(findings[0]).not.toHaveProperty("id");
    });
  });

  describe("duplicate-id", () => {
    it("fires on each entry sharing an id, across a manifest and a page", () => {
      const terms = [
        term({ id: "bifocal", label: "bifocal", definition: "d", file: "docs/terms/bifocal.md", line: 5 }),
        term({
          id: "bifocal",
          label: "bifocal lens",
          definition: "d",
          file: "terms.yaml",
          line: 3,
          construct: "manifest",
        }),
      ];
      const findings = only(checkTermSet(used(terms)), "duplicate-id");
      expect(findings).toEqual([
        {
          rule: "duplicate-id",
          ruleId: "manni:term/duplicate-id",
          severity: "error",
          message: 'id: "bifocal" is also used by terms.yaml:3',
          file: "docs/terms/bifocal.md",
          line: 5,
          id: "bifocal",
        },
        {
          rule: "duplicate-id",
          ruleId: "manni:term/duplicate-id",
          severity: "error",
          message: 'id: "bifocal" is also used by docs/terms/bifocal.md:5',
          file: "terms.yaml",
          line: 3,
          id: "bifocal",
        },
      ]);
    });

    it("names every other entry when more than two share an id", () => {
      const terms = [
        term({ id: "lens", label: "one", definition: "d", file: "a.md", line: 1 }),
        term({ id: "lens", label: "two", definition: "d", file: "b.md", line: 2 }),
        term({ id: "lens", label: "three", definition: "d", file: "c.md", line: 3 }),
      ];
      expect(only(checkTermSet(used(terms)), "duplicate-id").map((f) => f.message)).toEqual([
        'id: "lens" is also used by b.md:2, c.md:3',
        'id: "lens" is also used by a.md:1, c.md:3',
        'id: "lens" is also used by a.md:1, b.md:2',
      ]);
    });

    it("compares ids ignoring case, naming each entry by its own id", () => {
      const terms = [
        term({ id: "Bifocal", label: "one", definition: "d", file: "a.md", line: 1 }),
        term({ id: "bifocal", label: "two", definition: "d", file: "b.md", line: 2 }),
      ];
      expect(only(checkTermSet(used(terms)), "duplicate-id").map((f) => [f.id, f.message])).toEqual([
        ["Bifocal", 'id: "Bifocal" is also used by b.md:2'],
        ["bifocal", 'id: "bifocal" is also used by a.md:1'],
      ]);
    });
  });

  describe("label-collision", () => {
    it("fires on the later entry, naming the first, ignoring case", () => {
      const terms = [
        term({ label: "bifocal", definition: "d", file: "docs/terms/bifocal.md", line: 5, id: "a" }),
        term({ label: "Bifocal", definition: "d", file: "docs/terms/glossary.md", line: 14, id: "b" }),
      ];
      const findings = only(checkTermSet(used(terms)), "label-collision");
      expect(findings).toEqual([
        {
          rule: "label-collision",
          ruleId: "manni:term/label-collision",
          severity: "error",
          message: '"Bifocal" is claimed by docs/terms/bifocal.md:5 as "bifocal"',
          file: "docs/terms/glossary.md",
          line: 14,
          id: "b",
          field: "label",
        },
      ]);
    });

    it("does not fire on distinct labels", () => {
      const terms = [term({ label: "bifocal", definition: "d" }), term({ label: "trifocal", definition: "d" })];
      expect(only(checkTermSet(used(terms)), "label-collision")).toEqual([]);
    });
  });

  describe("alt-label-collision", () => {
    it("fires on the entry carrying the alt-label, at its field line, ignoring case", () => {
      const terms = [
        term({ label: "bifocal", definition: "d", file: "docs/terms/bifocal.md", line: 5 }),
        term({
          label: "multifocal",
          definition: "d",
          "alt-labels": ["BIFOCAL"],
          file: "docs/terms/multifocal.md",
          line: 1,
          fieldLines: { "alt-labels": 4 },
        }),
      ];
      const findings = only(checkTermSet(used(terms)), "alt-label-collision");
      expect(findings).toEqual([
        {
          rule: "alt-label-collision",
          ruleId: "manni:term/alt-label-collision",
          severity: "error",
          message: 'alt-labels: "BIFOCAL" is the label of docs/terms/bifocal.md:5',
          file: "docs/terms/multifocal.md",
          line: 4,
          id: "multifocal",
          field: "alt-labels",
        },
      ]);
    });

    it("falls back to the entry's line and ignores its own label", () => {
      const terms = [
        term({ label: "lens", definition: "d", "alt-labels": ["Lens"], line: 2 }),
        term({ label: "bifocal", definition: "d", "alt-labels": ["lens"], line: 7 }),
      ];
      const findings = only(checkTermSet(used(terms)), "alt-label-collision");
      expect(findings.map((f) => [f.id, f.line])).toEqual([["bifocal", 7]]);
    });

    it("does not fire when no alt-label is another label", () => {
      const terms = [
        term({ label: "progressive lens", definition: "d", "alt-labels": ["PAL"] }),
        term({ label: "bifocal", definition: "d" }),
      ];
      expect(only(checkTermSet(used(terms)), "alt-label-collision")).toEqual([]);
    });
  });

  describe("dangling-reference", () => {
    it("fires once per unresolved value, at that field's line", () => {
      const terms = [
        term({
          label: "lens",
          definition: "d",
          broader: ["optics"],
          "related-terms": ["prism", "Bifocal"],
          fieldLines: { broader: 3, "related-terms": 4 },
        }),
        term({ label: "bifocal", definition: "d" }),
        term({ label: "pal", see: "progressive", fieldLines: {}, line: 9 }),
      ];
      const findings = only(checkTermSet(used(terms)), "dangling-reference");
      expect(findings.map((f) => [f.file, f.line, f.message])).toEqual([
        ["docs/terms/lens.md", 3, 'broader: "optics" names no entry'],
        ["docs/terms/lens.md", 4, 'related-terms: "prism" names no entry'],
        ["docs/terms/pal.md", 9, 'see: "progressive" names no entry'],
      ]);
      expect(findings[0]?.id).toBe("lens");
    });

    it("resolves a reference by label ignoring case, or by id", () => {
      const terms = [
        term({ label: "lens", definition: "d", narrower: ["BIFOCAL", "pal-id"] }),
        term({ label: "bifocal", definition: "d" }),
        term({ id: "pal-id", label: "progressive lens", definition: "d" }),
      ];
      expect(only(checkTermSet(used(terms)), "dangling-reference")).toEqual([]);
    });
  });

  describe("broader-cycle", () => {
    it("reports a cycle of three once, on the first entry in set order", () => {
      const terms = [
        term({ label: "corrective-lens", definition: "d", broader: ["optic"], fieldLines: { broader: 2 } }),
        term({ label: "lens", definition: "d", broader: ["corrective-lens"] }),
        term({ label: "optic", definition: "d", broader: ["Lens"] }),
      ];
      const findings = only(checkTermSet(used(terms)), "broader-cycle");
      expect(findings).toEqual([
        {
          rule: "broader-cycle",
          ruleId: "manni:term/broader-cycle",
          severity: "error",
          message: "broader: corrective-lens > optic > lens > corrective-lens",
          file: "docs/terms/corrective-lens.md",
          line: 2,
          id: "corrective-lens",
          field: "broader",
        },
      ]);
    });

    it("reports a two-entry cycle in the proposal's shape", () => {
      const terms = [
        term({ label: "lens", definition: "d", broader: ["corrective-lens"], line: 4 }),
        term({ label: "corrective-lens", definition: "d", broader: ["lens"] }),
      ];
      const findings = only(checkTermSet(used(terms)), "broader-cycle");
      expect(findings.map((f) => [f.file, f.line, f.message])).toEqual([
        ["docs/terms/lens.md", 4, "broader: lens > corrective-lens > lens"],
      ]);
    });

    it("reports a self-cycle", () => {
      const terms = [term({ label: "lens", definition: "d", broader: ["LENS"] })];
      expect(only(checkTermSet(used(terms)), "broader-cycle").map((f) => f.message)).toEqual([
        "broader: lens > lens",
      ]);
    });

    it("reports two distinct cycles through one entry separately", () => {
      const terms = [
        term({ label: "a", definition: "d", broader: ["b", "c"] }),
        term({ label: "b", definition: "d", broader: ["a"] }),
        term({ label: "c", definition: "d", broader: ["a"] }),
      ];
      expect(only(checkTermSet(used(terms)), "broader-cycle").map((f) => f.message)).toEqual([
        "broader: a > b > a",
        "broader: a > c > a",
      ]);
    });

    it("does not fire on a chain that ends", () => {
      const terms = [
        term({ label: "bifocal", definition: "d", broader: ["lens"] }),
        term({ label: "lens", definition: "d", broader: ["optic"] }),
        term({ label: "optic", definition: "d" }),
      ];
      expect(only(checkTermSet(used(terms)), "broader-cycle")).toEqual([]);
    });
  });

  describe("broader-cycle through graph blocks", () => {
    it("reads narrower as the other half of broader", () => {
      const terms = [
        term({ label: "lens", definition: "d", narrower: ["optic"] }),
        term({ label: "optic", definition: "d", narrower: ["lens"] }),
      ];
      expect(only(checkTermSet(used(terms)), "broader-cycle").map((f) => [f.file, f.message])).toEqual([
        ["docs/terms/lens.md", "broader: lens > optic > lens"],
      ]);
    });

    it("reports a cycle a block edge closes on the block's field line", () => {
      const terms = [
        term({ label: "lens", definition: "d", broader: ["optic"] }),
        term({ label: "optic", definition: "d" }),
      ];
      expect(only(checkTermSet(used(terms)), "broader-cycle")).toEqual([]);
      const blocks = [block("Optic", { broader: ["LENS"] }, "docs/guides/optics.md")];
      const findings = checkTermSet(set(terms, terms.map((t) => ref(t.record.label)), blocks));
      expect(only(findings, "broader-cycle")).toEqual([
        {
          rule: "broader-cycle",
          ruleId: "manni:term/broader-cycle",
          severity: "error",
          message: "broader: lens > optic > lens",
          file: "docs/guides/optics.md",
          line: 6,
        },
      ]);
    });

    it("keeps a cycle the terms close on the term, even when a block repeats an edge", () => {
      const terms = [
        term({ label: "lens", definition: "d", broader: ["optic"], line: 3 }),
        term({ label: "optic", definition: "d", broader: ["lens"] }),
      ];
      const blocks = [block("optic", { broader: ["lens"] })];
      const findings = checkTermSet(set(terms, terms.map((t) => ref(t.record.label)), blocks));
      expect(only(findings, "broader-cycle").map((f) => [f.file, f.line])).toEqual([["docs/terms/lens.md", 3]]);
    });

    it("finds a cycle through freeform concepts, resolving an alt-label", () => {
      const terms = [term({ label: "progressive lens", definition: "d", "alt-labels": ["PAL"] })];
      const blocks = [
        block("progressive lens", { broader: ["Eyewear"] }, "docs/b.md"),
        block("optics", { narrower: ["eyewear"] }, "docs/a.md"),
        block("optics", { broader: ["PAL"] }, "docs/c.md"),
      ];
      const findings = checkTermSet(set(terms, [ref("PAL")], blocks), {
        severity: { "hierarchy-outside-termbase": "off", "alt-label-reference": "off" },
      });
      expect(findings.map((f) => [f.file, f.message])).toEqual([
        ["docs/b.md", "broader: progressive lens > Eyewear > optics > progressive lens"],
      ]);
    });

    it("ignores related-concepts", () => {
      const terms = [term({ label: "lens", definition: "d", broader: ["optic"] }), term({ label: "optic", definition: "d" })];
      const findings = checkTermSet(
        set(terms, terms.map((t) => ref(t.record.label)), [block("optic", { "related-concepts": ["lens"] })]),
        { severity: { "hierarchy-outside-termbase": "off" } },
      );
      expect(only(findings, "broader-cycle")).toEqual([]);
    });
  });

  describe("alt-label-reference", () => {
    const terms = [term({ label: "Pluggable auth layer", definition: "d", "alt-labels": ["PAL"] })];

    it("warns on a concepts: value that is an alt-label, at the reference", () => {
      const findings = checkTermSet(set(terms, [ref("PAL", "docs/guides/auth.md", 4)]));
      expect(findings).toEqual([
        {
          rule: "alt-label-reference",
          ruleId: "manni:term/alt-label-reference",
          severity: "warning",
          message: 'concepts: "PAL" is an alt-label of "Pluggable auth layer", so name the label.',
          file: "docs/guides/auth.md",
          line: 4,
        },
      ]);
    });

    it("names graph.concepts when the reference came from it", () => {
      const findings = checkTermSet(set(terms, [{ file: "a.md", label: "pal", field: "graph.concepts" }]));
      expect(findings.map((f) => f.message)).toEqual([
        'graph.concepts: "pal" is an alt-label of "Pluggable auth layer", so name the label.',
      ]);
    });

    it("prefers a label in any language over an alt-label", () => {
      const both = [...terms, term({ id: "x", label: "PAL", language: "de", definition: "d" })];
      expect(only(checkTermSet(set(both, [ref("PAL")])), "alt-label-reference")).toEqual([]);
    });

    it("names the term in the page's own language first", () => {
      const multi = [
        term({ id: "auth", label: "Pluggable auth layer", definition: "d", "alt-labels": ["PAL"], language: "en" }),
        term({ id: "auth", label: "Steckbare Auth-Schicht", definition: "d", "alt-labels": ["PAL"], language: "de" }),
      ];
      const findings = checkTermSet(set(multi, [{ file: "a.md", label: "PAL", language: "de" }]));
      expect(only(findings, "alt-label-reference").map((f) => f.message)).toEqual([
        'concepts: "PAL" is an alt-label of "Steckbare Auth-Schicht", so name the label.',
      ]);
    });

    it("can be turned off", () => {
      expect(checkTermSet(set(terms, [ref("PAL")]), { severity: { "alt-label-reference": "off" } })).toEqual([]);
    });
  });

  describe("hierarchy-outside-termbase", () => {
    const terms = [
      term({
        label: "Retry",
        definition: "d",
        file: "docs/glossary/retry.md",
        broader: ["resilience"],
        "related-terms": ["timeout"],
      }),
      term({ label: "Networking", definition: "d", broader: ["Resilience"] }),
      term({ label: "Resilience", definition: "d", narrower: ["retry", "Networking"] }),
      term({ id: "timeout", label: "Time-out", definition: "d", "alt-labels": ["TTL"], "related-terms": ["Retry"] }),
    ];
    const refs = terms.map((t) => ref(t.record.label));

    it("notes an edge the term's own field does not list, on the page that declares it", () => {
      const findings = checkTermSet(set(terms, refs, [block("retry", { broader: ["Networking"] }, "docs/guides/net.md")]));
      expect(findings).toEqual([
        {
          rule: "hierarchy-outside-termbase",
          ruleId: "manni:term/hierarchy-outside-termbase",
          severity: "notice",
          message:
            'graph: broader "Networking" on "Retry" is not on its term page (docs/glossary/retry.md), so add it there.',
          file: "docs/guides/net.md",
          line: 6,
        },
      ]);
    });

    it("is quiet for an edge the term lists, however it is spelled", () => {
      const blocks = [block("RETRY", { broader: ["Resilience"], "related-concepts": ["TTL", "timeout"] })];
      expect(checkTermSet(set(terms, refs, blocks))).toEqual([]);
    });

    it("compares narrower with narrower, and related-concepts with related-terms", () => {
      const blocks = [block("Retry", { narrower: ["Resilience"], "related-concepts": ["Networking", "backoff"] })];
      expect(only(checkTermSet(set(terms, refs, blocks)), "hierarchy-outside-termbase").map((f) => f.message)).toEqual([
        'graph: narrower "Resilience" on "Retry" is not on its term page (docs/glossary/retry.md), so add it there.',
        'graph: related-concepts "Networking" on "Retry" is not on its term page (docs/glossary/retry.md), so add it there.',
        'graph: related-concepts "backoff" on "Retry" is not on its term page (docs/glossary/retry.md), so add it there.',
      ]);
    });

    it("says term entry for a term with no page of its own", () => {
      const manifest = term({ label: "Retry", definition: "d", file: "terms.yaml", line: 4, construct: "manifest" });
      const findings = checkTermSet(set([manifest], [ref("Retry")], [block("Retry", { broader: ["Networking"] })]));
      expect(findings.map((f) => f.message)).toEqual([
        'graph: broader "Networking" on "Retry" is not on its term entry (terms.yaml), so add it there.',
      ]);
    });

    it("says nothing about a block whose label names no term", () => {
      expect(checkTermSet(set(terms, refs, [block("Backoff", { broader: ["Networking"] })]))).toEqual([]);
    });
  });

  describe("see-not-empty", () => {
    it("fires on an entry with see and definition", () => {
      const terms = [
        term({ label: "PAL", see: "progressive lens", definition: "d", fieldLines: { see: 3 } }),
        term({ label: "progressive lens", definition: "d" }),
      ];
      const findings = only(checkTermSet(used(terms)), "see-not-empty");
      expect(findings.map((f) => [f.id, f.line, f.severity, f.message])).toEqual([
        ["pal", 3, "error", 'see: "progressive lens" redirects this entry, so remove its definition'],
      ]);
    });

    it("does not fire on a redirect with no definition", () => {
      const terms = [term({ label: "PAL", see: "progressive lens" }), term({ label: "progressive lens", definition: "d" })];
      expect(only(checkTermSet(used(terms)), "see-not-empty")).toEqual([]);
    });
  });

  describe("missing-definition", () => {
    it("fires on an entry with neither definition nor see, at the entry's line", () => {
      const terms = [term({ label: "lens", line: 4 }), term({ label: "bifocal", definition: "d" })];
      const findings = only(checkTermSet(used(terms)), "missing-definition");
      expect(findings.map((f) => [f.id, f.line, f.severity, f.field, f.message])).toEqual([
        ["lens", 4, "error", "definition", "definition: missing, so write one or run manni term fill."],
      ]);
    });

    it("does not fire on a redirect, and leaves a redirect with a definition to see-not-empty", () => {
      const terms = [
        term({ label: "PAL", see: "lens" }),
        term({ label: "graduated lens", see: "lens", definition: "d" }),
        term({ label: "lens", definition: "d" }),
      ];
      const findings = checkTermSet(used(terms));
      expect(only(findings, "missing-definition")).toEqual([]);
      expect(only(findings, "see-not-empty").map((f) => f.id)).toEqual(["graduated-lens"]);
    });

    it("can be turned off", () => {
      const terms = [term({ label: "lens" })];
      expect(only(checkTermSet(used(terms), { severity: { "missing-definition": "off" } }), "missing-definition")).toEqual(
        [],
      );
    });
  });

  describe("conflicting-matches", () => {
    const wikidata = "https://www.wikidata.org/wiki/Q1";

    it("fires once per IRI listed under two kinds, naming the first kind then the other, at the first's line", () => {
      const terms = [
        term({
          label: "lens",
          definition: "d",
          "exact-matches": [wikidata],
          "broad-matches": [wikidata],
          fieldLines: { "exact-matches": 7 },
        }),
      ];
      const findings = only(checkTermSet(used(terms)), "conflicting-matches");
      expect(findings.map((f) => [f.id, f.line, f.severity, f.field, f.message])).toEqual([
        [
          "lens",
          7,
          "error",
          "exact-matches",
          `exact-matches: "${wikidata}" is also in broad-matches, and a mapping has one kind.`,
        ],
      ]);
    });

    it("orders the kinds exact, close, broad, narrow, related, and reports an IRI in three kinds once", () => {
      const iri = "https://example.org/x";
      const terms = [
        term({
          label: "lens",
          definition: "d",
          "related-matches": [iri],
          "narrow-matches": [iri],
          "close-matches": [iri],
        }),
      ];
      const findings = only(checkTermSet(used(terms)), "conflicting-matches");
      expect(findings.map((f) => f.message)).toEqual([
        `close-matches: "${iri}" is also in narrow-matches, and a mapping has one kind.`,
      ]);
    });

    it("does not fire on distinct IRIs, or on one IRI on two entries", () => {
      const terms = [
        term({ label: "lens", definition: "d", "exact-matches": [wikidata], "close-matches": ["https://e.org/y"] }),
        term({ label: "bifocal", definition: "d", "exact-matches": [wikidata] }),
      ];
      expect(only(checkTermSet(used(terms)), "conflicting-matches")).toEqual([]);
    });
  });

  describe("asymmetric-hierarchy", () => {
    it("fires on B when A lists B as broader and B omits A from narrower, at B's narrower line", () => {
      const terms = [
        term({ label: "bifocal", definition: "d", broader: ["Lens"] }),
        term({ label: "lens", definition: "d", line: 2, fieldLines: { narrower: 5 } }),
      ];
      const findings = only(checkTermSet(used(terms)), "asymmetric-hierarchy");
      expect(findings.map((f) => [f.id, f.line, f.severity, f.message])).toEqual([
        ["lens", 5, "warning", 'narrower: omits "bifocal", which lists this entry as broader'],
      ]);
    });

    it("fires on A when B lists A as narrower and A omits B from broader", () => {
      const terms = [
        term({ label: "bifocal", definition: "d", fieldLines: { broader: 6 } }),
        term({ label: "lens", definition: "d", narrower: ["BIFOCAL"] }),
      ];
      const findings = only(checkTermSet(used(terms)), "asymmetric-hierarchy");
      expect(findings.map((f) => [f.id, f.line, f.message])).toEqual([
        ["bifocal", 6, 'broader: omits "lens", which lists this entry as narrower'],
      ]);
    });

    it("does not fire when both halves are present, matched by label or id and ignoring case", () => {
      const terms = [
        term({ label: "bifocal", definition: "d", broader: ["LENS"] }),
        term({ id: "lens-id", label: "lens", definition: "d", narrower: ["Bifocal"] }),
        term({ label: "trifocal", definition: "d", broader: ["lens-id"] }),
      ];
      const withTrifocal = terms.map((t) =>
        t.id === "lens-id" ? { ...t, record: { ...t.record, narrower: ["Bifocal", "trifocal"] } } : t,
      );
      expect(only(checkTermSet(used(withTrifocal)), "asymmetric-hierarchy")).toEqual([]);
    });

    it("does not fire when the reference dangles", () => {
      const terms = [term({ label: "bifocal", definition: "d", broader: ["optics"] })];
      expect(only(checkTermSet(used(terms)), "asymmetric-hierarchy")).toEqual([]);
    });
  });

  describe("abstract-too-long", () => {
    const sixty = "x".repeat(60);
    const sixtyOne = "x".repeat(61);

    it("fires past the default of 60, at the abstract's line", () => {
      const terms = [term({ label: "lens", definition: "d", abstract: sixtyOne, fieldLines: { abstract: 3 } })];
      const findings = only(checkTermSet(used(terms)), "abstract-too-long");
      expect(findings.map((f) => [f.id, f.line, f.severity, f.message])).toEqual([
        ["lens", 3, "notice", "abstract: 61 characters is over the limit of 60, so shorten it"],
      ]);
    });

    it("does not fire at the limit", () => {
      const terms = [term({ label: "lens", definition: "d", abstract: sixty })];
      expect(only(checkTermSet(used(terms)), "abstract-too-long")).toEqual([]);
    });

    it("honours abstractMaxLength", () => {
      const terms = [term({ label: "lens", definition: "d", abstract: sixty })];
      expect(only(checkTermSet(used(terms), { abstractMaxLength: 59 }), "abstract-too-long")).toHaveLength(1);
      expect(
        only(checkTermSet(used([term({ label: "lens", definition: "d", abstract: sixtyOne })]), { abstractMaxLength: 80 }), "abstract-too-long"),
      ).toEqual([]);
    });
  });

  describe("unused-term", () => {
    it("fires when no reference names the label", () => {
      const findings = checkTermSet(set([term({ label: "trifocal", definition: "d", file: "docs/terms/trifocal.md" })]));
      expect(findings).toEqual([
        {
          rule: "unused-term",
          ruleId: "manni:term/unused-term",
          severity: "notice",
          message: "no page's concepts: names this term",
          file: "docs/terms/trifocal.md",
          line: 1,
          id: "trifocal",
        },
      ]);
    });

    it("counts a reference by label ignoring case, by id, or by alt-label", () => {
      const terms = [
        term({ label: "Trifocal", definition: "d" }),
        term({ label: "progressive lens", definition: "d", "alt-labels": ["PAL"] }),
        term({ id: "cl", label: "corrective lens", definition: "d" }),
        term({ label: "monocle", definition: "d" }),
      ];
      const findings = only(checkTermSet(set(terms, [ref("trifocal"), ref("PAL"), ref("CL")])), "unused-term");
      expect(findings.map((f) => f.id)).toEqual(["monocle"]);
    });
  });

  describe("severity", () => {
    const terms = [term({ label: "trifocal", definition: "d" })];

    it("drops a rule set to off", () => {
      expect(checkTermSet(set(terms), { severity: { "unused-term": "off" } })).toEqual([]);
    });

    it("applies an override", () => {
      const findings = checkTermSet(set(terms), { severity: { "unused-term": "error" } });
      expect(findings.map((f) => f.severity)).toEqual(["error"]);
    });
  });

  describe("a multilingual set: one term per language, joined on id", () => {
    const en = (spec: TermSpec): Term => term({ language: "en", ...spec });
    const de = (spec: TermSpec): Term => term({ language: "de", file: `de/${spec.id ?? spec.label}.md`, ...spec });

    it("groups duplicate-id by id and language, a term with no language counting as en", () => {
      const terms = [
        term({ id: "pal", label: "progressive lens", definition: "d", file: "en/pal.md" }),
        de({ id: "pal", label: "Gleitsichtglas", definition: "d" }),
        de({ id: "PAL", label: "Gleitsichtbrille", definition: "d", file: "de/other.md" }),
        en({ id: "pal", label: "varifocal", definition: "d", file: "en/varifocal.md" }),
      ];
      const findings = only(checkTermSet(used(terms)), "duplicate-id");
      expect(findings.map((f) => [f.file, f.message])).toEqual([
        ["de/other.md", 'id: "PAL" is also used by de/pal.md:1'],
        ["de/pal.md", 'id: "pal" is also used by de/other.md:1'],
        ["en/pal.md", 'id: "pal" is also used by en/varifocal.md:1'],
        ["en/varifocal.md", 'id: "pal" is also used by en/pal.md:1'],
      ]);
    });

    it("compares languages ignoring case", () => {
      const terms = [
        de({ id: "pal", label: "Gleitsichtglas", definition: "d" }),
        term({ id: "pal", label: "Gleitsichtbrille", definition: "d", language: "DE", file: "x.md" }),
      ];
      expect(only(checkTermSet(used(terms)), "duplicate-id")).toHaveLength(2);
    });

    it("lets an identical label stand in two languages, and collides on a case clash across them", () => {
      const terms = [
        en({ id: "api", label: "API", definition: "d" }),
        de({ id: "api", label: "API", definition: "d" }),
        en({ id: "kubernetes", label: "Kubernetes", definition: "d", file: "en/kubernetes.md", line: 2 }),
        de({ id: "kubernetes", label: "kubernetes", definition: "d" }),
      ];
      const findings = only(checkTermSet(used(terms)), "label-collision");
      expect(findings.map((f) => [f.file, f.message])).toEqual([
        ["de/kubernetes.md", '"kubernetes" is claimed by en/kubernetes.md:2 as "Kubernetes"'],
      ]);
    });

    it("still collides labels within one language ignoring case", () => {
      const terms = [
        de({ id: "a", label: "Linse", definition: "d" }),
        de({ id: "b", label: "linse", definition: "d" }),
        de({ id: "c", label: "Linse", definition: "d" }),
      ];
      expect(only(checkTermSet(used(terms)), "label-collision").map((f) => f.id)).toEqual(["b", "c"]);
    });

    it("applies the same rule to alt-labels", () => {
      const terms = [
        en({ id: "api", label: "API", definition: "d" }),
        de({ id: "schnittstelle", label: "Schnittstelle", definition: "d", "alt-labels": ["API"] }),
        de({ id: "k8s", label: "K8s", definition: "d", "alt-labels": ["kubernetes"] }),
        en({ id: "kubernetes", label: "Kubernetes", definition: "d", file: "en/kubernetes.md" }),
      ];
      const findings = only(checkTermSet(used(terms)), "alt-label-collision");
      expect(findings.map((f) => [f.id, f.message])).toEqual([
        ["k8s", 'alt-labels: "kubernetes" is the label of en/kubernetes.md:1'],
      ]);
    });

    it("resolves a reference to its own language first, then to any language", () => {
      const terms = [
        en({ id: "lens", label: "lens", definition: "d", narrower: ["bifocal"] }),
        en({ id: "bifocal", label: "bifocal", definition: "d", broader: ["lens"] }),
        de({ id: "lens", label: "Linse", definition: "d", narrower: ["bifocal"] }),
        de({ id: "bifocal", label: "Bifokalglas", definition: "d", broader: ["Linse"] }),
        de({ id: "optik", label: "Optik", definition: "d", "related-terms": ["lens", "prism"] }),
      ];
      const findings = checkTermSet(used(terms));
      expect(only(findings, "asymmetric-hierarchy")).toEqual([]);
      expect(only(findings, "dangling-reference").map((f) => f.message)).toEqual([
        'related-terms: "prism" names no entry',
      ]);
    });

    it("keeps a hierarchy within its language, so a cycle is found per language", () => {
      const terms = [
        en({ id: "a", label: "a", definition: "d", broader: ["b"] }),
        en({ id: "b", label: "b", definition: "d" }),
        de({ id: "a", label: "x", definition: "d", broader: ["b"] }),
        de({ id: "b", label: "y", definition: "d", broader: ["a"] }),
      ];
      const findings = checkTermSet(used(terms));
      expect(only(findings, "broader-cycle").map((f) => f.message)).toEqual(["broader: x > y > x"]);
      expect(only(findings, "asymmetric-hierarchy").map((f) => [f.file, f.field])).toEqual([
        ["de/a.md", "narrower"],
        ["de/b.md", "narrower"],
        ["docs/terms/b.md", "narrower"],
      ]);
    });

    it("counts a term as used when a reference names any term sharing its id", () => {
      const terms = [
        en({ id: "pal", label: "progressive lens", definition: "d" }),
        de({ id: "pal", label: "Gleitsichtglas", definition: "d" }),
        de({ id: "linse", label: "Linse", definition: "d" }),
      ];
      const findings = only(checkTermSet(set(terms, [ref("progressive lens")])), "unused-term");
      expect(findings.map((f) => f.id)).toEqual(["linse"]);
    });
  });

  it("names the field a finding concerns, and none for a finding about a whole entry or a page", () => {
    const terms = [
      term({ id: "bifocal", label: "bifocal", definition: "d", abstract: "x".repeat(61), "related-terms": ["trifocal"] }),
      term({ id: "bifocal", label: "Bifocal", definition: "d", "alt-labels": ["lens"] }),
      term({ label: "lens", definition: "d", broader: ["corrective lens"], see: "bifocal" }),
      term({ label: "corrective lens", definition: "d", broader: ["lens"] }),
      term({ label: "monocle", definition: "d" }),
      term({ label: "monofocal", "exact-matches": ["https://e.org/t"], "close-matches": ["https://e.org/t"] }),
    ];
    const findings = checkTermSet(set(terms, [ref("PAL"), ...terms.slice(0, 4).map((t) => ref(t.record.label))]));
    const fields = new Map<string, Set<string>>();
    for (const f of findings) {
      const seen = fields.get(f.rule ?? "") ?? new Set<string>();
      seen.add(f.field ?? "(none)");
      fields.set(f.rule ?? "", seen);
    }
    expect(Object.fromEntries([...fields].map(([rule, seen]) => [rule, [...seen].sort()]))).toEqual({
      "undefined-term": ["(none)"],
      "duplicate-id": ["(none)"],
      "label-collision": ["label"],
      "alt-label-collision": ["alt-labels"],
      "dangling-reference": ["related-terms"],
      "broader-cycle": ["broader"],
      "see-not-empty": ["see"],
      "asymmetric-hierarchy": ["narrower"],
      "abstract-too-long": ["abstract"],
      "unused-term": ["(none)"],
      "missing-definition": ["definition"],
      "conflicting-matches": ["exact-matches"],
      "orphan-term": ["(none)"],
    });
  });

  it("names broader when the missing half of a hierarchy is broader", () => {
    const terms = [term({ label: "lens", definition: "d", narrower: ["bifocal"] }), term({ label: "bifocal", definition: "d" })];
    expect(only(checkTermSet(used(terms)), "asymmetric-hierarchy").map((f) => f.field)).toEqual(["broader"]);
  });

  it("sorts by file, then line, then rule id, then message", () => {
    const terms = [
      term({ label: "b", definition: "d", file: "z.md", line: 1 }),
      term({
        label: "a",
        definition: "d",
        see: "q",
        file: "a.md",
        line: 5,
        broader: ["y", "x"],
        fieldLines: { broader: 2, see: 2 },
      }),
    ];
    const findings = checkTermSet(set(terms, [ref("nope", "a.md", 3), ref("b")]));
    expect(findings.map((f) => [f.file, f.line, f.ruleId, f.message])).toEqual([
      ["a.md", 2, "manni:term/dangling-reference", 'broader: "x" names no entry'],
      ["a.md", 2, "manni:term/dangling-reference", 'broader: "y" names no entry'],
      ["a.md", 2, "manni:term/dangling-reference", 'see: "q" names no entry'],
      ["a.md", 2, "manni:term/see-not-empty", 'see: "q" redirects this entry, so remove its definition'],
      ["a.md", 3, "manni:term/undefined-term", 'concepts: "nope" names no entry.'],
      ["a.md", 5, "manni:term/unused-term", "no page's concepts: names this term"],
    ]);
  });
});

describe("checkTermSet: the thesaurus rules (proposal 0086 § 4)", () => {
  const messages = (findings: TermFinding[], rule: TermRule): [string | undefined, number | undefined, string][] =>
    only(findings, rule).map((f) => [f.id, f.line, f.message]);

  describe("asymmetric-related", () => {
    it("warns on the entry that omits the other half, at its related-terms line", () => {
      const terms = [
        term({ label: "lens", definition: "d", "related-terms": ["Prism"] }),
        term({ label: "prism", definition: "d", fieldLines: { "related-terms": 7 } }),
      ];
      const findings = only(checkTermSet(used(terms)), "asymmetric-related");
      expect(findings.map((f) => [f.id, f.line, f.severity, f.field, f.message])).toEqual([
        ["prism", 7, "warning", "related-terms", 'related-terms: omits "lens", which lists this entry as related.'],
      ]);
    });

    it("is quiet when both halves are there, by label or id, ignoring case", () => {
      const terms = [
        term({ label: "lens", definition: "d", "related-terms": ["PRISM-ID"] }),
        term({ id: "prism-id", label: "prism", definition: "d", "related-terms": ["Lens"] }),
      ];
      expect(only(checkTermSet(used(terms)), "asymmetric-related")).toEqual([]);
    });
  });

  describe("related-in-hierarchy", () => {
    it("warns when a related term is also broader or narrower, at any depth", () => {
      const terms = [
        term({ label: "optics", definition: "d", narrower: ["lens"], "related-terms": ["bifocal"] }),
        term({ label: "lens", definition: "d", broader: ["optics"], narrower: ["bifocal"] }),
        term({
          label: "bifocal",
          definition: "d",
          broader: ["lens"],
          "related-terms": ["Optics"],
          fieldLines: { "related-terms": 9 },
        }),
      ];
      const findings = checkTermSet(used(terms));
      expect(messages(findings, "related-in-hierarchy")).toEqual([
        ["bifocal", 9, 'related-terms: "Optics" is also broader than this entry, so keep one of the two.'],
        ["optics", 1, 'related-terms: "bifocal" is also narrower than this entry, so keep one of the two.'],
      ]);
      expect(only(findings, "related-in-hierarchy").map((f) => f.severity)).toEqual(["warning", "warning"]);
    });

    it("reads a graph block's broader as part of the hierarchy", () => {
      const terms = [
        term({ label: "lens", definition: "d", "related-terms": ["optics"] }),
        term({ label: "optics", definition: "d", "related-terms": ["lens"] }),
      ];
      const blocks = [block("lens", { broader: ["optics"] })];
      const findings = checkTermSet(set(terms, terms.map((t) => ref(t.record.label)), blocks));
      expect(messages(findings, "related-in-hierarchy")).toEqual([
        ["lens", 1, 'related-terms: "optics" is also broader than this entry, so keep one of the two.'],
        ["optics", 1, 'related-terms: "lens" is also narrower than this entry, so keep one of the two.'],
      ]);
    });
  });

  describe("related-siblings", () => {
    const family = (extra: Partial<Record<"bifocal" | "trifocal", string[]>>): Term[] => [
      term({ label: "lens", definition: "d", narrower: ["bifocal", "trifocal"] }),
      term({ label: "bifocal", definition: "d", broader: ["lens"], ...(extra.bifocal ? { "related-terms": extra.bifocal } : {}) }),
      term({ label: "trifocal", definition: "d", broader: ["lens"], ...(extra.trifocal ? { "related-terms": extra.trifocal } : {}) }),
    ];

    it("notes a related pair under one broader term once, on the first that lists the other", () => {
      const findings = checkTermSet(used(family({ bifocal: ["trifocal"], trifocal: ["bifocal"] })));
      expect(only(findings, "related-siblings").map((f) => [f.id, f.severity, f.message])).toEqual([
        ["bifocal", "notice", 'related-terms: "trifocal" shares the broader term "lens", which already relates them.'],
      ]);
    });

    it("sits on the only entry that lists the other", () => {
      const findings = checkTermSet(used(family({ trifocal: ["Bifocal"] })));
      expect(messages(findings, "related-siblings")).toEqual([
        ["trifocal", 1, 'related-terms: "Bifocal" shares the broader term "lens", which already relates them.'],
      ]);
    });
  });

  describe("label-overlap", () => {
    it("fires on an alt-label or hidden-label that repeats the entry's own names", () => {
      const terms = [
        term({
          label: "lens",
          definition: "d",
          "alt-labels": ["Lens", "optic"],
          "hidden-labels": ["LENS", "Optic"],
          fieldLines: { "alt-labels": 4, "hidden-labels": 5 },
        }),
      ];
      const findings = only(checkTermSet(used(terms)), "label-overlap");
      expect(findings.map((f) => [f.line, f.severity, f.field, f.message])).toEqual([
        [4, "error", "alt-labels", 'alt-labels: "Lens" repeats this entry\'s label.'],
        [5, "error", "hidden-labels", 'hidden-labels: "LENS" repeats this entry\'s label.'],
        [5, "error", "hidden-labels", 'hidden-labels: "Optic" repeats this entry\'s alt-label.'],
      ]);
    });

    it("fires on a hidden-label that is another entry's label or alt-label, naming it", () => {
      const terms = [
        term({ label: "progressive lens", definition: "d", "alt-labels": ["PAL"], line: 2 }),
        term({ label: "bifocal", definition: "d", line: 3 }),
        term({ label: "varifocal", definition: "d", "hidden-labels": ["pal", "Bifocal"] }),
      ];
      expect(messages(checkTermSet(used(terms)), "label-overlap")).toEqual([
        ["varifocal", 1, 'hidden-labels: "Bifocal" is the label of docs/terms/bifocal.md:3.'],
        ["varifocal", 1, 'hidden-labels: "pal" is an alt-label of docs/terms/progressive-lens.md:2.'],
      ]);
    });

    it("lets one spelling stand in two languages", () => {
      const terms = [
        term({ label: "API", definition: "d", language: "en" }),
        term({ label: "Schnittstelle", definition: "d", language: "de", "hidden-labels": ["API"] }),
      ];
      expect(only(checkTermSet(used(terms)), "label-overlap")).toEqual([]);
    });
  });

  describe("ambiguous-alt-label", () => {
    it("warns on the later entry sharing an alt-label, naming the first", () => {
      const terms = [
        term({ label: "progressive lens", definition: "d", "alt-labels": ["PAL"] }),
        term({ label: "pluggable auth layer", definition: "d", "alt-labels": ["pal"], fieldLines: { "alt-labels": 4 } }),
      ];
      const findings = only(checkTermSet(used(terms)), "ambiguous-alt-label");
      expect(findings.map((f) => [f.id, f.line, f.severity, f.message])).toEqual([
        [
          "pluggable-auth-layer",
          4,
          "warning",
          'alt-labels: "pal" is also an alt-label of docs/terms/progressive-lens.md:1, so a reader can\'t tell which term it means.',
        ],
      ]);
    });

    it("lets one spelling stand in two languages", () => {
      const terms = [
        term({ id: "pal", label: "progressive lens", definition: "d", language: "en", "alt-labels": ["PAL"] }),
        term({ id: "pal", label: "Gleitsichtglas", definition: "d", language: "de", "alt-labels": ["PAL"], file: "de/pal.md" }),
      ];
      expect(only(checkTermSet(used(terms)), "ambiguous-alt-label")).toEqual([]);
    });
  });

  describe("deprecated-label", () => {
    it("warns when the label's designation is deprecated or superseded, at the label's line", () => {
      const terms = [
        term({
          label: "lens",
          definition: "d",
          designations: [{ term: "Lens", "administrative-status": "deprecated" }],
          fieldLines: { label: 2 },
        }),
        term({ label: "prism", definition: "d", designations: [{ term: "prism", "administrative-status": "Superseded" }] }),
        term({ label: "optic", definition: "d", designations: [{ term: "optic", "administrative-status": "preferred" }] }),
      ];
      const findings = only(checkTermSet(used(terms)), "deprecated-label");
      const text = (label: string): string =>
        `label: "${label}" is deprecated in designations, so promote another label or redirect with see:.`;
      expect(findings.map((f) => [f.id, f.line, f.severity, f.field, f.message])).toEqual([
        ["lens", 2, "warning", "label", text("lens")],
        ["prism", 1, "warning", "label", text("prism")],
      ]);
    });

    it("is quiet on a redirect", () => {
      const terms = [
        term({ label: "lens", see: "optic", designations: [{ term: "lens", "administrative-status": "deprecated" }] }),
        term({ label: "optic", definition: "d" }),
      ];
      expect(only(checkTermSet(used(terms)), "deprecated-label")).toEqual([]);
    });
  });

  describe("orphan-term", () => {
    it("notes an entry with no broader, narrower or related term, once the termbase has a hierarchy", () => {
      const terms = [
        term({ label: "lens", definition: "d", narrower: ["bifocal"] }),
        term({ label: "bifocal", definition: "d", broader: ["lens"] }),
        term({ label: "prism", definition: "d", "related-terms": ["lens"] }),
        term({ label: "monocle", definition: "d", line: 3 }),
        term({ label: "pal", see: "lens" }),
      ];
      const findings = only(checkTermSet(used(terms)), "orphan-term");
      expect(findings.map((f) => [f.id, f.line, f.severity, f.field, f.message])).toEqual([
        ["monocle", 3, "notice", undefined, "no broader, narrower or related term, so place it in the hierarchy."],
      ]);
    });

    it("never fires on a flat glossary", () => {
      const terms = [
        term({ label: "lens", definition: "d", "related-terms": ["prism"] }),
        term({ label: "monocle", definition: "d" }),
      ];
      expect(only(checkTermSet(used(terms)), "orphan-term")).toEqual([]);
    });

    it("counts a graph block's edges, and places every language of a placed concept", () => {
      const terms = [
        term({ id: "lens", label: "lens", definition: "d", language: "en" }),
        term({ id: "lens", label: "Linse", definition: "d", language: "de", file: "de/lens.md" }),
        term({ label: "monocle", definition: "d" }),
      ];
      const blocks = [block("lens", { broader: ["optics"] })];
      const findings = checkTermSet(set(terms, terms.map((t) => ref(t.record.label)), blocks));
      expect(only(findings, "orphan-term").map((f) => f.id)).toEqual(["monocle"]);
    });
  });

  describe("keyword-candidate", () => {
    const kw = (label: string, file: string, line?: number): TermReference =>
      line === undefined ? { file, label, field: "keywords" } : { file, line, label, field: "keywords" };
    const terms = [term({ id: "lens-id", label: "lens", definition: "d", "alt-labels": ["optic"] })];

    it("notes a keyword on enough pages that names no term, once, at its first page", () => {
      const keywords = [
        kw("retries", "b.md", 4),
        kw("Retries", "a.md", 3),
        kw("retries", "a.md", 3),
        kw("RETRIES", "c.md"),
        kw("backoff", "a.md", 3),
      ];
      const findings = only(checkTermSet(set(terms, [ref("lens")], [], keywords)), "keyword-candidate");
      expect(findings.map((f) => [f.file, f.line, f.severity, f.id, f.message])).toEqual([
        [
          "a.md",
          3,
          "notice",
          undefined,
          'keywords: "Retries" is on 3 pages and names no term, so add it to concepts: or run manni term fill --crawl.',
        ],
      ]);
    });

    it("never offers a keyword a term's label, id or alt-label names", () => {
      const keywords = ["LENS", "lens-id", "Optic"].flatMap((k) => [kw(k, "a.md"), kw(k, "b.md")]);
      expect(only(checkTermSet(set(terms, [ref("lens")], [], keywords)), "keyword-candidate")).toEqual([]);
    });

    it("honours minPages", () => {
      const keywords = [kw("retries", "a.md"), kw("retries", "b.md")];
      const findings = checkTermSet(set(terms, [ref("lens")], [], keywords), { minPages: 3 });
      expect(only(findings, "keyword-candidate")).toEqual([]);
    });
  });

  it("drops a new rule set to off", () => {
    const terms = [
      term({ label: "lens", definition: "d", "alt-labels": ["lens"], "related-terms": ["prism"] }),
      term({ label: "prism", definition: "d" }),
    ];
    const findings = checkTermSet(used(terms), { severity: { "label-overlap": "off", "asymmetric-related": "off" } });
    expect(findings).toEqual([]);
  });
});
