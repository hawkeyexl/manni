import { describe, expect, it } from "vitest";
import { checkTermSet } from "../../src/term/core/check.js";
import type {
  Term,
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
  file?: string;
  line?: number;
  construct?: TermConstruct;
  fieldLines?: Partial<Record<TermField, number>>;
}

function term(spec: TermSpec): Term {
  const { id, file, line, construct, fieldLines, ...record } = spec;
  return {
    id: id ?? record.label.toLowerCase().replace(/\s+/g, "-"),
    record,
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

function set(terms: Term[], references: TermReference[] = []): TermSet {
  return { terms, references, notices: [] };
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

    it("names the entry whose alt-label matched", () => {
      const findings = checkTermSet(
        used(
          [term({ label: "progressive lens", definition: "d", "alt-labels": ["PAL"] })],
          [ref("pal", "docs/guides/fitting.md", 6)],
        ),
      );
      expect(only(findings, "undefined-term").map((f) => f.message)).toEqual([
        'concepts: "pal" names no entry. "progressive lens" lists it as an alt-label.',
      ]);
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
          message: 'id "bifocal" is also used by terms.yaml:3',
          file: "docs/terms/bifocal.md",
          line: 5,
          id: "bifocal",
        },
        {
          rule: "duplicate-id",
          ruleId: "manni:term/duplicate-id",
          severity: "error",
          message: 'id "bifocal" is also used by docs/terms/bifocal.md:5',
          file: "terms.yaml",
          line: 3,
          id: "bifocal",
        },
      ]);
    });

    it("compares ids exactly", () => {
      const terms = [
        term({ id: "Bifocal", label: "one", definition: "d" }),
        term({ id: "bifocal", label: "two", definition: "d" }),
      ];
      expect(only(checkTermSet(used(terms)), "duplicate-id")).toEqual([]);
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

    it("counts a reference ignoring case, and not one to an alt-label", () => {
      const terms = [
        term({ label: "Trifocal", definition: "d" }),
        term({ label: "progressive lens", definition: "d", "alt-labels": ["PAL"] }),
      ];
      const findings = only(checkTermSet(set(terms, [ref("trifocal"), ref("PAL")])), "unused-term");
      expect(findings.map((f) => f.id)).toEqual(["progressive-lens"]);
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
