/**
 * `strategy check`'s rules (proposal 0102) on sets built inline: each rule
 * fires, the gates hold, and the messages say what to do.
 */
import { describe, expect, it } from "vitest";
import { checkStrategySet, indexSet } from "../../src/strategy/core/check.js";
import type { PageField, RecordType, StrategyRecord, StrategyReference, StrategySet } from "../../src/strategy/types.js";

/** A record whose parents sit on line 4, one value per line after it. */
function rec(type: RecordType, id: string, parents: string | string[] = [], extra: Partial<StrategyRecord> = {}): StrategyRecord {
  const file = `strategy/${type}s/${id}.md`;
  return {
    id,
    type,
    file,
    line: 1,
    idAt: { file, line: 3 },
    parents: [parents].flat().map((value, i) => ({ value, file, line: 4 + i })),
    data: {},
    ...extra,
  };
}

function ref(field: PageField, value: string, page = "docs/page.md", line = 2, record = false): StrategyReference {
  return { field, value, file: page, line, page, record };
}

/** A set with one record of each type, joined up, and one page naming all three. */
function joined(): StrategySet {
  return {
    records: [rec("audience", "docs-engineers"), rec("persona", "maya", "docs-engineers"), rec("journey", "m1", "maya")],
    references: [ref("audiences", "docs-engineers"), ref("personas", "maya"), ref("journeys", "m1")],
  };
}

const rules = (set: StrategySet) => checkStrategySet(set).map((f) => f.rule);
const messages = (set: StrategySet) => checkStrategySet(set).map((f) => f.message);

describe("checkStrategySet", () => {
  it("reports nothing for a joined-up set", () => {
    expect(checkStrategySet(joined())).toEqual([]);
  });

  describe("undefined-reference", () => {
    it("fires for a page value that names no record, with a did-you-mean", () => {
      const set = joined();
      set.references.push(ref("journeys", "m-1", "docs/other.md"));
      const [finding] = checkStrategySet(set).filter((f) => f.rule === "undefined-reference");
      expect(finding).toMatchObject({
        ruleId: "manni:strategy/undefined-reference",
        severity: "error",
        message: 'journeys: "m-1" names no journey. Did you mean "m1"? Correct the value, or add a record with type: journey and id: m-1.',
        key: 'journeys: "m-1" names no journey.',
        file: "docs/other.md",
        line: 2,
        field: "journeys",
      });
    });

    it("leaves the did-you-mean out when nothing is near", () => {
      const set = joined();
      set.references.push(ref("journeys", "zzzzzz"));
      expect(messages(set)).toContain(
        'journeys: "zzzzzz" names no journey. Correct the value, or add a record with type: journey and id: zzzzzz.',
      );
    });

    it("names the parent when the value is a record of another type", () => {
      const set = joined();
      set.references.push(ref("personas", "m1", "docs/other.md"));
      expect(messages(set)).toContain('personas: "m1" is a journey, not a persona. Did you mean its persona, "maya"?');
    });

    it("walks up to the audience for a journey named in audiences:", () => {
      const set = joined();
      set.references.push(ref("audiences", "m1", "docs/other.md"));
      expect(messages(set)).toContain('audiences: "m1" is a journey, not an audience. Did you mean its audience, "docs-engineers"?');
    });

    it("says where a parent named in a child's field belongs", () => {
      const set = joined();
      set.references.push(ref("journeys", "maya", "docs/other.md"));
      expect(messages(set)).toContain('journeys: "maya" is a persona, not a journey. Move it to personas:.');
    });

    it("fires for a record's parent field, at the field's line", () => {
      const set = joined();
      set.records.push(rec("journey", "m2", "mya"));
      set.references.push(ref("journeys", "m2"));
      const finding = checkStrategySet(set).find((f) => f.rule === "undefined-reference");
      expect(finding).toMatchObject({
        message: 'personas: "mya" names no persona. Did you mean "maya"?',
        file: "strategy/journeys/m2.md",
        line: 4,
        id: "m2",
        field: "personas",
      });
    });

    it("fires once for the one bad value of a record's two parents, at that value's line", () => {
      const set = joined();
      set.records.push(rec("persona", "sara", "docs-engineers"), rec("journey", "m2", ["sara", "mya"]));
      set.references.push(ref("personas", "sara", "docs/other.md"), ref("journeys", "m2", "docs/other.md"));
      const found = checkStrategySet(set).filter((f) => f.rule === "undefined-reference");
      expect(found).toEqual([
        expect.objectContaining({
          message: 'personas: "mya" names no persona. Did you mean "maya"?',
          file: "strategy/journeys/m2.md",
          line: 5,
          field: "personas",
        }),
      ]);
    });

    it("compares ids ignoring case", () => {
      const set = joined();
      set.references.push(ref("journeys", "M1", "docs/other.md"), ref("personas", "MAYA", "docs/other.md"));
      expect(rules(set)).not.toContain("undefined-reference");
    });

    it("checks a field only when the set holds a record of its type", () => {
      const set: StrategySet = {
        records: [rec("journey", "m1")],
        references: [ref("journeys", "m1"), ref("personas", "nobody"), ref("audiences", "anyone")],
      };
      expect(checkStrategySet(set)).toEqual([]);
    });

    it("checks a record's parent field only when the parent type has records", () => {
      const set: StrategySet = { records: [rec("journey", "m1", "nobody")], references: [ref("journeys", "m1")] };
      expect(checkStrategySet(set)).toEqual([]);
    });
  });

  it("duplicate-id fires on each record sharing an id, ignoring case, naming the others", () => {
    const set = joined();
    set.records.push(rec("journey", "M1", "maya", { file: "strategy/journeys/m1-old.md", idAt: { file: "strategy/journeys/m1-old.md", line: 3 } }));
    const found = checkStrategySet(set).filter((f) => f.rule === "duplicate-id");
    expect(found.map((f) => [f.file, f.line, f.message])).toEqual([
      ["strategy/journeys/m1-old.md", 3, 'id: "M1" is also the id of strategy/journeys/m1.md:3. Give each record its own id.'],
      ["strategy/journeys/m1.md", 3, 'id: "m1" is also the id of strategy/journeys/m1-old.md:3. Give each record its own id.'],
    ]);
    expect(found.every((f) => f.severity === "error")).toBe(true);
  });

  describe("missing-parent", () => {
    it("fires once per missing persona per page, at the first child's line", () => {
      const set = joined();
      set.records.push(rec("journey", "m2", "maya"));
      set.references.push(
        ref("audiences", "docs-engineers", "docs/other.md"),
        ref("journeys", "m1", "docs/other.md", 5),
        ref("journeys", "m2", "docs/other.md", 6),
      );
      const found = checkStrategySet(set).filter((f) => f.rule === "missing-parent");
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({
        severity: "warning",
        message: 'personas: does not name "maya", the persona of journey "m1". Add it, or drop "m1" from journeys:.',
        file: "docs/other.md",
        line: 5,
        field: "personas",
      });
    });

    it("fires for a persona whose audience the page lacks", () => {
      const set = joined();
      set.references.push(ref("personas", "maya", "docs/other.md"));
      expect(messages(set)).toContain(
        'audiences: does not name "docs-engineers", the audience of persona "maya". Add it, or drop "maya" from personas:.',
      );
    });

    it("is satisfied by any one of a journey's personas", () => {
      const set = joined();
      set.records.push(rec("persona", "sara", "docs-engineers"), rec("journey", "m5", ["maya", "sara"]));
      for (const persona of ["maya", "sara"]) {
        set.references.push(
          ref("audiences", "docs-engineers", `docs/${persona}.md`),
          ref("personas", persona, `docs/${persona}.md`),
          ref("journeys", "m5", `docs/${persona}.md`),
        );
      }
      expect(rules(set)).not.toContain("missing-parent");
    });

    it("names every persona of a journey when the page names none of them", () => {
      const set = joined();
      set.records.push(rec("persona", "sara", "docs-engineers"), rec("journey", "m5", ["maya", "sara"]));
      set.references.push(ref("audiences", "docs-engineers", "docs/other.md"), ref("journeys", "m5", "docs/other.md", 5));
      const found = checkStrategySet(set).filter((f) => f.rule === "missing-parent");
      expect(found).toEqual([
        expect.objectContaining({
          message:
            'personas: names none of "maya", "sara", the personas of journey "m5". Add one, or drop "m5" from journeys:.',
          file: "docs/other.md",
          line: 5,
          field: "personas",
        }),
      ]);
    });

    it("does not apply to a record's own fields", () => {
      const set = joined();
      set.references.push(ref("journeys", "m1", "strategy/personas/maya.md", 6, true));
      expect(rules(set)).not.toContain("missing-parent");
    });
  });

  describe("orphan-record", () => {
    it("fires for a persona with no audience, and a journey with no persona", () => {
      const set = joined();
      set.records.push(rec("persona", "devin"), rec("journey", "d1"));
      set.references.push(ref("personas", "devin", "docs/d.md"), ref("journeys", "d1", "docs/d.md"));
      const found = checkStrategySet(set).filter((f) => f.rule === "orphan-record");
      expect(found.map((f) => f.message)).toEqual([
        "personas: missing, so this journey belongs to no persona. Name one with personas:.",
        "audience: missing, so this persona belongs to no audience. Name one with audience:.",
      ]);
      expect(found.every((f) => f.severity === "warning" && f.line === 3)).toBe(true);
    });

    it("is quiet while the set holds no record of the parent type", () => {
      const set: StrategySet = { records: [rec("persona", "maya")], references: [ref("personas", "maya")] };
      expect(rules(set)).not.toContain("orphan-record");
    });
  });

  describe("unserved-journey", () => {
    it("fires for a journey no page names", () => {
      const set = joined();
      set.records.push(rec("journey", "m2", "maya"));
      const found = checkStrategySet(set).filter((f) => f.rule === "unserved-journey");
      expect(found).toEqual([
        expect.objectContaining({
          severity: "warning",
          message: "no page names this journey in journeys:. Name it on the pages that serve it.",
          file: "strategy/journeys/m2.md",
          line: 3,
          id: "m2",
        }),
      ]);
    });

    it("does not count a record naming the journey", () => {
      const set = joined();
      set.references = set.references.filter((r) => r.field !== "journeys");
      set.references.push(ref("journeys", "m1", "strategy/personas/maya.md", 6, true));
      expect(rules(set)).toContain("unserved-journey");
    });

    it("skips a draft journey and an archived one", () => {
      const set = joined();
      set.records.push(rec("journey", "m2", "maya", { lifecycle: "draft" }), rec("journey", "m3", "maya", { lifecycle: "archived" }));
      expect(checkStrategySet(set)).toEqual([]);
    });

    it("still fires for a published, a deprecated and an unset journey", () => {
      const set = joined();
      set.records.push(
        rec("journey", "m2", "maya", { lifecycle: "published" }),
        rec("journey", "m3", "maya", { lifecycle: "deprecated" }),
        rec("journey", "m4", "maya"),
      );
      const found = checkStrategySet(set).filter((f) => f.rule === "unserved-journey");
      expect(found.map((f) => f.id)).toEqual(["m2", "m3", "m4"]);
    });
  });

  describe("unused-record", () => {
    it("fires for an audience and a persona nothing names", () => {
      const set = joined();
      set.records.push(rec("audience", "ci-engineers"), rec("persona", "theo", "docs-engineers"));
      const found = checkStrategySet(set).filter((f) => f.rule === "unused-record");
      expect(found.map((f) => [f.severity, f.message])).toEqual([
        ["notice", "no page and no record names this audience."],
        ["notice", "no page and no record names this persona."],
      ]);
    });

    it("counts a child record as naming its parent", () => {
      const set = joined();
      set.references = [ref("journeys", "m1")];
      expect(rules(set)).not.toContain("unused-record");
    });
  });

  it("honours a severity override, and off drops the rule", () => {
    const set = joined();
    set.records.push(rec("journey", "m2", "maya"));
    expect(checkStrategySet(set, { severity: { "unserved-journey": "error" } })[0]?.severity).toBe("error");
    expect(checkStrategySet(set, { severity: { "unserved-journey": "off" } })).toEqual([]);
  });
});

describe("indexSet", () => {
  it("lists the pages naming a record, records left out, and each record's children", () => {
    const set = joined();
    set.references.push(ref("journeys", "M1", "docs/a.md"), ref("journeys", "m1", "strategy/x.md", 1, true));
    const index = indexSet(set);
    const [audience, persona, journey] = set.records;
    if (audience === undefined || persona === undefined || journey === undefined) throw new Error("fixture");
    expect(index.pagesNaming(journey)).toEqual(["docs/a.md", "docs/page.md"]);
    expect(index.childrenOf(audience)).toEqual([persona]);
    expect(index.parentsOf(journey)).toEqual([persona]);
  });

  it("files a record with two parents under each of them", () => {
    const set = joined();
    set.records.push(rec("persona", "sara", "docs-engineers"), rec("journey", "m5", ["maya", "sara"]));
    const index = indexSet(set);
    const [, maya, , sara, m5] = set.records;
    if (maya === undefined || sara === undefined || m5 === undefined) throw new Error("fixture");
    expect(index.parentsOf(m5)).toEqual([maya, sara]);
    expect(index.childrenOf(maya)).toContain(m5);
    expect(index.childrenOf(sara)).toEqual([m5]);
  });
});
