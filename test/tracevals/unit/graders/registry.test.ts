import { describe, expect, it } from "vitest";
import {
  graderFor,
  listGraderKinds,
  registerGrader,
} from "../../../../src/tracevals/graders/registry.js";

describe("grader registry", () => {
  it("ships the seven deterministic kinds", () => {
    const kinds = listGraderKinds();
    for (const kind of [
      "tool-usage",
      "skill-invoked",
      "file-access",
      "turn-count",
      "cost",
      "regex",
      "json-output",
    ]) {
      expect(kinds).toContain(kind);
    }
  });

  it("returns undefined for unknown kinds", () => {
    expect(graderFor("sorcery")).toBeUndefined();
  });

  it("accepts custom graders", () => {
    registerGrader({
      kind: "custom-test-grader",
      grade: () => ({ findings: [] }),
    });
    expect(graderFor("custom-test-grader")).toBeDefined();
  });
});
