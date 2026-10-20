/**
 * The guidance lines every domain prints under a finding (proposal 0089, C2).
 * lint's template context was the first user, and these lines are the ones
 * its reporters already printed.
 */
import { describe, expect, it } from "vitest";
import { guidanceLines } from "../../src/shared/guidance.js";

describe("guidanceLines", () => {
  it("is empty when nothing stands behind the finding", () => {
    expect(guidanceLines(null)).toEqual([]);
    expect(guidanceLines(undefined)).toEqual([]);
  });

  it("treats an empty rule, description or guide as none", () => {
    expect(guidanceLines({ id: "Doc Detective", rule: "", description: "", guide: "" })).toEqual(["Doc Detective"]);
    expect(guidanceLines({ id: "manni:cite", rule: "source-changed", description: "", guide: null })).toEqual([
      "manni:cite source-changed",
    ]);
  });

  it("prints no blank head line when the id, rule and description are all empty", () => {
    expect(guidanceLines({ id: "", rule: null, description: null, guide: null })).toEqual([]);
    expect(guidanceLines({ id: "", rule: null, description: null, guide: "https://example.com/g" })).toEqual([
      "Guide: https://example.com/g",
    ]);
  });

  it("prints the id alone when there is no rule, description or guide", () => {
    expect(guidanceLines({ id: "house.yaml#how-to", rule: null, description: null, guide: null })).toEqual([
      "house.yaml#how-to",
    ]);
  });

  it("joins the rule to the id with a space", () => {
    expect(guidanceLines({ id: "manni:cite", rule: "source-changed", description: null, guide: null })).toEqual([
      "manni:cite source-changed",
    ]);
  });

  it("prints the description after a colon, then the guide on its own line", () => {
    expect(
      guidanceLines({
        id: "tgdp:how-to:1.6",
        rule: "see-also",
        description: "Link to related topics.",
        guide: "https://example.com/guide_how-to.md",
      }),
    ).toEqual(["tgdp:how-to:1.6 see-also: Link to related topics.", "Guide: https://example.com/guide_how-to.md"]);
  });
});
