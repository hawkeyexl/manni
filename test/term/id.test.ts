import { describe, expect, it } from "vitest";
import { slugOf } from "../../src/term/core/id.js";

describe("slugOf", () => {
  it.each([
    ["progressive lens", "progressive-lens"],
    ["API", "api"],
    ["C++ (language)", "c-language"],
    ["no-line bifocal", "no-line-bifocal"],
    ["Café au lait", "café-au-lait"],
    ["K8s", "k8s"],
    ["  spaced out ", "spaced-out"],
  ])("slugs %j as %j", (label, expected) => {
    expect(slugOf(label)).toBe(expected);
  });
});
