/**
 * Flare condition expressions (proposal 0125, decision 12): the stored
 * `include[…] exclude[…]` grammar, the boolean expression inside each clause,
 * and the rule that decides whether tagged content stays.
 */
import { describe, expect, it } from "vitest";
import {
  includes,
  parseConditionExpression,
  parseConditionTags,
} from "../../../src/shared/flare/conditions.js";

const keeps = (expression: string, tags: string[]): boolean =>
  includes(parseConditionExpression(expression), tags);

describe("includes: the rule", () => {
  it("keeps everything when there is no expression", () => {
    expect(includes(undefined, ["Default.PrintOnly"])).toBe(true);
    expect(keeps("", ["Default.PrintOnly"])).toBe(true);
  });

  it("keeps untagged content under any expression", () => {
    expect(keeps("include[Default.PrintOnly]", [])).toBe(true);
    expect(keeps("exclude[Default.PrintOnly]", [])).toBe(true);
  });

  it("keeps content the include clause is true for", () => {
    expect(keeps("include[Default.PrintOnly]", ["Default.PrintOnly"])).toBe(true);
  });

  // An explicit include beats an exclude.
  it("keeps content both clauses are true for", () => {
    expect(
      keeps("include[Default.PrintOnly],exclude[Default.Draft]", [
        "Default.PrintOnly",
        "Default.Draft",
      ]),
    ).toBe(true);
  });

  it("drops content the exclude clause is true for", () => {
    expect(keeps("exclude[Default.PrintOnly]", ["Default.PrintOnly"])).toBe(false);
  });

  // Include-only means everything unlisted is excluded.
  it("drops content an include-only expression does not list", () => {
    expect(keeps("include[Default.PrintOnly]", ["Default.ScreenOnly"])).toBe(false);
  });

  it("keeps content neither clause speaks to when there is an exclude clause", () => {
    expect(
      keeps("include[Default.PrintOnly] exclude[Default.Draft]", ["Default.ScreenOnly"]),
    ).toBe(true);
    expect(keeps("exclude[Default.Draft]", ["Default.ScreenOnly"])).toBe(true);
  });

  it("compares tags exactly on Set.Tag", () => {
    expect(keeps("exclude[Default.PrintOnly]", ["Other.PrintOnly"])).toBe(true);
    expect(keeps("exclude[Default.PrintOnly]", ["default.printonly"])).toBe(true);
  });
});

describe("parseConditionExpression: clauses", () => {
  it.each([
    ["a comma", "include[A.x],exclude[B.y]"],
    ["a space", "include[A.x] exclude[B.y]"],
    ["nothing", "include[A.x]exclude[B.y]"],
    ["the exclude first", "exclude[B.y], include[A.x]"],
  ])("reads two clauses separated by %s", (_label, expression) => {
    const expr = parseConditionExpression(expression);
    expect(includes(expr, ["A.x", "B.y"])).toBe(true);
    expect(includes(expr, ["B.y"])).toBe(false);
    expect(includes(expr, ["C.z"])).toBe(true);
  });

  it("ignores @media clauses", () => {
    expect(keeps("exclude[A.x] @media print[B.y]", ["B.y"])).toBe(true);
    expect(keeps("exclude[A.x] @media print[B.y]", ["A.x"])).toBe(false);
    expect(parseConditionExpression("@media print[B.y]")).toEqual({});
  });

  it("reads an empty or clause-less expression as no expression", () => {
    expect(parseConditionExpression("")).toEqual({});
    expect(parseConditionExpression("   ")).toEqual({});
  });
});

describe("parseConditionExpression: inside a clause", () => {
  const advanced = "include[A.x and not (B.y or C.z)]";

  it("reads and, not, or and parentheses", () => {
    expect(keeps(advanced, ["A.x"])).toBe(true);
    expect(keeps(advanced, ["A.x", "B.y"])).toBe(false);
    expect(keeps(advanced, ["A.x", "C.z"])).toBe(false);
    expect(keeps(advanced, ["D.w"])).toBe(false);
  });

  it("reads operators in any case", () => {
    const upper = "include[A.x AND NOT (B.y OR C.z)]";
    expect(keeps(upper, ["A.x"])).toBe(true);
    expect(keeps(upper, ["A.x", "C.z"])).toBe(false);
  });

  // `A or B and not C` reads as `A or (B and (not C))`.
  it("binds not, then and, then or", () => {
    const e = "exclude[A.x or B.y and not C.z]";
    expect(keeps(e, ["A.x", "C.z"])).toBe(false);
    expect(keeps(e, ["B.y"])).toBe(false);
    expect(keeps(e, ["B.y", "C.z"])).toBe(true);
  });

  it("reads Basic's or-list", () => {
    expect(keeps("exclude[A.x or B.y]", ["B.y"])).toBe(false);
  });

  it("reads tag names with hyphens and spaces, trimmed", () => {
    expect(keeps("exclude[ Print-Set.Print and-Web ]", ["Print-Set.Print and-Web"])).toBe(false);
    expect(keeps("exclude[My Set.Print Only or B.y]", ["My Set.Print Only"])).toBe(false);
    expect(keeps("exclude[My Set.Print Only]", ["My Set.Print"])).toBe(true);
  });
});

describe("parseConditionTags", () => {
  it("splits on commas, trims and drops empties", () => {
    expect(parseConditionTags(" Default.PrintOnly, Default.Draft ,,")).toEqual([
      "Default.PrintOnly",
      "Default.Draft",
    ]);
  });

  it("reads a missing attribute as no tags", () => {
    expect(parseConditionTags(null)).toEqual([]);
    expect(parseConditionTags(undefined)).toEqual([]);
    expect(parseConditionTags("")).toEqual([]);
  });
});
