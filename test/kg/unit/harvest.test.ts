/**
 * Near-miss detection for the harvest rule's page-level inputs (ADR 01028).
 *
 * The ladder is both halves: the misspellings that must warn, and the ordinary
 * page keys that must stay silent. A near-miss check that fires on `title` or
 * `draft` would be worse than none — it would train readers to ignore it.
 */
import { describe, expect, it } from "vitest";
import { harvestWarnings, HARVESTED_KEYS } from "../../../src/kg/core/harvest.js";
import { PAGE_TYPE_TO_TOPIC_TYPE } from "../../../src/kg/core/iirds.js";
import type { DocModel } from "../../../src/kg/types.js";

function doc(
  frontmatter: Record<string, unknown>,
  path = "docs/a.md",
): DocModel {
  return {
    path,
    frontmatter,
    frontmatterPresent: true,
    sections: [],
    links: [],
    images: [],
    codeLanguages: [],
    // Any digest: harvestWarnings never reads it, and a fixed value keeps this
    // stub from depending on content it does not have.
    contentHash: "0".repeat(64),
  };
}

describe("harvestWarnings", () => {
  describe("warns on a near miss", () => {
    // Every one of these is a page whose author believed they had declared a
    // fact, and which derives nothing at all.
    const cases: Array<[string, Record<string, unknown>, string]> = [
      ["snake_case", { applies_to: ["SP-X100"] }, "applies-to"],
      ["camelCase", { appliesTo: ["SP-X100"] }, "applies-to"],
      ["singular", { concept: ["alpha"] }, "concepts"],
      ["singular verb", { supersede: "./old.md" }, "supersedes"],
      [
        "snake_case negative",
        { not_applicable_to: ["SP-X"] },
        "not-applicable-to",
      ],
      [
        "camelCase negative",
        { notApplicableTo: ["SP-X"] },
        "not-applicable-to",
      ],
      ["transposed", { conceptss: ["a"] }, "concepts"],
      ["uppercase", { Supersedes: "./old.md" }, "supersedes"],
      // The pair ADR 01028 calls out by name: one edit apart, different
      // meanings. On its own `types` reads as a typo for `type`, and warning is
      // the intended behavior — not an accident of the threshold.
      ["plural of a short key", { types: ["a"] }, "type"],
      // The localization keys (ADR 01037). `lang` predates the harvest rule
      // and was never covered by ADR 01028's near-miss surface, so a typo in
      // the one fact a localized corpus depends on was silent.
      ["dropped letter", { languge: "de" }, "language"],
      ["uppercase language", { Lang: "de" }, "lang"],
      [
        "snake_case translation",
        { translation_of: "../a.md" },
        "translation-of",
      ],
      ["camelCase translation", { translationOf: "../a.md" }, "translation-of"],
      ["doubled letter", { "translation-off": "../a.md" }, "translation-of"],
    ];

    for (const [name, fm, expected] of cases) {
      it(name, () => {
        const warnings = harvestWarnings([doc(fm)]);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain(`looks like "${expected}"`);
        expect(warnings[0]).toContain("docs/a.md");
        expect(warnings[0]).toContain("nothing was derived");
      });
    }
  });

  describe("stays silent", () => {
    it("on the correct spellings", () => {
      const fm: Record<string, unknown> = {};
      for (const k of HARVESTED_KEYS) fm[k] = k === "type" ? "how-to" : ["x"];
      expect(harvestWarnings([doc(fm)])).toEqual([]);
    });

    it("on ordinary page keys that resemble nothing", () => {
      expect(
        harvestWarnings([
          doc({
            title: "T",
            description: "D",
            draft: false,
            sidebar: { order: 2 },
            tags: ["a"],
            authors: ["Jane"],
            date: "2026-01-01",
            lastmod: "2026-02-01",
            keywords: ["k"],
            "generated-by": "x",
          }),
        ]),
      ).toEqual([]);
    });

    it("on `types`, which is one edit from `type` and means something else", () => {
      // ADR 01028 names this pair as a known consequence of the distance-1
      // threshold on short keys, and the ADR was the only place it was
      // recorded. `types` on a page that also declares `type` is silent —
      // the author has made their choice — so this pins the shape the ADR
      // actually claims, rather than leaving the next reader to guess whether
      // the warning below is intended or a bug.
      expect(harvestWarnings([doc({ type: "concept", types: ["a"] })])).toEqual(
        [],
      );
    });

    it("when the page declares both the near miss and the real key", () => {
      // The author has already made the choice; the stray key is their business.
      expect(
        harvestWarnings([
          doc({ "applies-to": ["SP-X100"], applies_to: ["old"] }),
        ]),
      ).toEqual([]);
    });

    it("on a page type that simply has no iiRDS counterpart", () => {
      // `blog-post` maps to nothing and that is correct — dockg references
      // iiRDS terms and never mints them. Warning here would be noise on every
      // blog post in the corpus.
      expect(harvestWarnings([doc({ type: "blog-post" })])).toEqual([]);
      expect(harvestWarnings([doc({ type: "release-note" })])).toEqual([]);
    });
  });

  describe("page type values", () => {
    it("warns when the value is one edit from a mapped type", () => {
      const warnings = harvestWarnings([doc({ type: "how to" })]);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('page type "how to"');
      expect(warnings[0]).toContain('looks like "how-to"');
      expect(warnings[0]).toContain("no kg.type was derived");
    });

    it("accepts every mapped type without complaint", () => {
      for (const t of Object.keys(PAGE_TYPE_TO_TOPIC_TYPE)) {
        expect(harvestWarnings([doc({ type: t })]), t).toEqual([]);
      }
    });
  });

  it("reports one warning per offending key, sorted", () => {
    const warnings = harvestWarnings([
      doc({ supersede: "./x.md" }, "docs/b.md"),
      doc({ applies_to: ["SP-X100"], concept: ["a"] }, "docs/a.md"),
    ]);
    expect(warnings).toHaveLength(3);
    // Deterministic order, like every other dockg output.
    expect(warnings).toEqual([...warnings].sort());
    expect(warnings[0]).toContain("docs/a.md");
    expect(warnings[2]).toContain("docs/b.md");
  });

  it("says nothing about a corpus with no frontmatter at all", () => {
    expect(harvestWarnings([doc({})])).toEqual([]);
  });
});
