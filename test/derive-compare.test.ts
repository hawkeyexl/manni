import { describe, it, expect } from "vitest";
import {
  compareDerived,
  staleFindings,
  DERIVED_STALE_SCHEMA,
  DERIVED_KEYWORD,
  type DerivedField,
  type DerivedValue,
} from "../src/meta/core/derive/types.js";
import {
  DERIVED_STALE_RULE,
  RESERVED_RULES,
  ruleIdFor,
} from "../src/meta/reporters/rule-id.js";
import {
  assertPublishableBuiltinId,
  listBuiltins,
} from "../src/meta/core/schema-registry.js";

const git = (
  value: unknown,
  evidence = "first commit abc1234",
): DerivedValue => ({ value, source: "git", evidence });

describe("compareDerived", () => {
  it("is current when a string matches", () => {
    const f = compareDerived("created", "2024-01-01", git("2024-01-01"));
    expect(f).toEqual({
      field: "created",
      asserted: "2024-01-01",
      derived: "2024-01-01",
      source: "git",
      evidence: "first commit abc1234",
      status: "current",
      written: false,
    });
  });

  it("is stale when a string differs", () => {
    const f = compareDerived("created", "2023-12-31", git("2024-01-01"));
    expect(f.status).toBe("stale");
    expect(f.asserted).toBe("2023-12-31");
    expect(f.derived).toBe("2024-01-01");
  });

  it("compares lists as sets: same members in another order are current", () => {
    const f = compareDerived("authors", ["b", "a"], git(["a", "b"]));
    expect(f.status).toBe("current");
  });

  it("compares lists as sets: a different member is stale", () => {
    expect(compareDerived("authors", ["a", "c"], git(["a", "b"])).status).toBe(
      "stale",
    );
    expect(compareDerived("authors", ["a"], git(["a", "b"])).status).toBe(
      "stale",
    );
    expect(compareDerived("authors", ["a", "a"], git(["a", "b"])).status).toBe(
      "stale",
    );
  });

  it("deep-compares object members", () => {
    const asserted = [{ name: "Ada", email: "ada@example.com" }];
    const derived = [{ email: "ada@example.com", name: "Ada" }];
    expect(compareDerived("authors", asserted, git(derived)).status).toBe(
      "current",
    );
    expect(
      compareDerived("authors", asserted, git([{ name: "Ada" }])).status,
    ).toBe("stale");
  });

  it("is unset when the document says nothing and a source does", () => {
    const f = compareDerived("owner", undefined, {
      value: "@docs-team",
      source: "codeowners",
      evidence: ".github/CODEOWNERS:12",
    });
    expect(f.status).toBe("unset");
    expect(f).not.toHaveProperty("asserted");
    expect(f.derived).toBe("@docs-team");
    expect(f.source).toBe("codeowners");
  });

  it("is unknown when the source answered with no fact", () => {
    const f = compareDerived("owner", "@docs-team", null);
    expect(f.status).toBe("unknown");
    expect(f.derived).toBeNull();
    expect(f.asserted).toBe("@docs-team");
    expect(f).not.toHaveProperty("source");
  });

  it("is unknown when the source was not consulted", () => {
    const f = compareDerived("owner", undefined, undefined);
    expect(f.status).toBe("unknown");
    expect(f.derived).toBeNull();
    expect(f).not.toHaveProperty("asserted");
  });

  it("never reports written", () => {
    expect(compareDerived("created", "x", git("x")).written).toBe(false);
    expect(compareDerived("created", "x", null).written).toBe(false);
  });
});

describe("staleFindings", () => {
  const fields: DerivedField[] = [
    compareDerived("created", "2023-12-31", git("2024-01-01")),
    compareDerived("authors", ["b", "a"], git(["a", "b"])),
    compareDerived("owner", undefined, {
      value: "@docs-team",
      source: "codeowners",
      evidence: ".github/CODEOWNERS:12",
    }),
    compareDerived("last-updated", "2024-05-05", null),
  ];

  it("files one finding per stale or unset field, and none otherwise", () => {
    const found = staleFindings(fields, () => undefined);
    expect(found.map((e) => e.instancePath)).toEqual(["/created", "/owner"]);
    for (const e of found) {
      expect(e.schema).toBe(DERIVED_STALE_SCHEMA);
      expect(e.keyword).toBe(DERIVED_KEYWORD);
      expect(e).not.toHaveProperty("line");
    }
  });

  it("words the stale and unset messages differently", () => {
    const [stale, unset] = staleFindings(fields, () => undefined);
    expect(stale?.message).toBe(
      "created says 2023-12-31; git says 2024-01-01 (first commit abc1234) — run manni meta derive",
    );
    expect(unset?.message).toBe(
      "owner is not set; codeowners says @docs-team (.github/CODEOWNERS:12) — run manni meta derive",
    );
  });

  it("renders non-string values as compact JSON", () => {
    const [e] = staleFindings(
      [compareDerived("authors", ["a", "c"], git(["a", "b"]))],
      () => undefined,
    );
    expect(e?.message).toBe(
      'authors says ["a","c"]; git says ["a","b"] (first commit abc1234) — run manni meta derive',
    );
  });

  it("carries the line the document's own key sits on", () => {
    const lines = new Map([["/created", 3]]);
    const found = staleFindings(fields, (p) => lines.get(p));
    expect(found[0]?.line).toBe(3);
    expect(found[1]).not.toHaveProperty("line");
  });

  it("points at the field with an RFC 6901 pointer", () => {
    const [e] = staleFindings(
      [compareDerived("last-updated", "a", git("b"))],
      () => undefined,
    );
    expect(e?.instancePath).toBe("/last-updated");
  });
});

describe("derived: reserved ids", () => {
  it("joins schema and keyword into the stale rule id", () => {
    const [e] = staleFindings(
      [compareDerived("created", "a", git("b"))],
      () => undefined,
    );
    expect(e).toBeDefined();
    if (!e) return;
    expect(ruleIdFor(e)).toBe(DERIVED_STALE_RULE);
    expect(DERIVED_STALE_RULE).toBe("derived:stale/derived");
    expect(RESERVED_RULES[DERIVED_STALE_RULE]).toMatch(/managed field/);
  });

  it("refuses a builtin id whose first segment is derived", () => {
    expect(() => {
      assertPublishableBuiltinId("derived:stale");
    }).toThrow(/derived/);
    for (const b of listBuiltins()) {
      expect(b.id.split(":")[0]).not.toBe("derived");
    }
  });
});
