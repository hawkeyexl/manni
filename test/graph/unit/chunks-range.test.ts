import { describe, expect, it } from "vitest";
import { range } from "../../../src/graph/commands/chunks.js";

describe("range", () => {
  it("reads a line and a span", () => {
    expect(range("7")).toEqual({ start: 7, end: 7 });
    expect(range("4-13")).toEqual({ start: 4, end: 13 });
  });

  it("rejects an inverted span and anything that is not lines", () => {
    expect(range("13-4")).toBeUndefined();
    expect(range("a-b")).toBeUndefined();
  });
});
