/**
 * Where `graph fill` pins a quoted answer (proposal 0087): the whole body lines
 * the quote touches, found with whitespace folded, and a flag when the page
 * holds the quote more than once.
 */
import { describe, expect, it } from "vitest";
import { locateQuote } from "../../../src/graph/commands/fill-questions.js";

describe("locateQuote", () => {
  it("pins the lines a quote touches, across a rewrapped line", () => {
    const body = ["# Retry", "", "An upload retries three", "times by default."];
    expect(locateQuote(body, "retries three times by default")).toEqual({ start: 3, end: 4 });
  });

  it("pins the first copy, and flags a quote the page holds twice", () => {
    const body = ["Note: this needs admin access.", "", "Steps.", "", "Note: this needs admin access."];
    expect(locateQuote(body, "this needs admin access")).toEqual({ start: 1, end: 1, ambiguous: true });
  });

  it("counts copies that do not overlap, so a quote overlapping itself is one", () => {
    expect(locateQuote(["Say aaa."], "aa")).toEqual({ start: 1, end: 1 });
  });

  it("finds nothing for a quote the page does not hold", () => {
    expect(locateQuote(["One line."], "another line")).toBeUndefined();
  });
});
