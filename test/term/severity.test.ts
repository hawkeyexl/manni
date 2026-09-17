import { describe, expect, it } from "vitest";
import {
  DEFAULT_SEVERITY,
  foldValeSeverity,
  proseRuleId,
  resolveSeverity,
  ruleId,
} from "../../src/term/core/severity.js";
import { TERM_RULES } from "../../src/term/types.js";

describe("term severity", () => {
  it("gives every rule a default, as proposal 0052's table does", () => {
    expect(Object.keys(DEFAULT_SEVERITY)).toEqual([...TERM_RULES]);
    expect(DEFAULT_SEVERITY).toMatchObject({
      "undefined-term": "error",
      "broader-cycle": "error",
      "see-not-empty": "error",
      "asymmetric-hierarchy": "warning",
      "abstract-too-long": "notice",
      "unused-term": "notice",
    });
  });

  it("lets config override a rule, including to off", () => {
    const resolved = resolveSeverity({ "unused-term": "off", "asymmetric-hierarchy": "error" });
    expect(resolved["unused-term"]).toBe("off");
    expect(resolved["asymmetric-hierarchy"]).toBe("error");
    expect(resolved["undefined-term"]).toBe("error");
  });

  it("spells a check rule id and a prose rule id", () => {
    expect(ruleId("broader-cycle")).toBe("manni:term/broader-cycle");
    expect(proseRuleId("Direct.Length")).toBe("manni:term/prose/Direct.Length");
  });

  it("folds Vale's scale onto the family's", () => {
    expect(foldValeSeverity("error")).toBe("error");
    expect(foldValeSeverity("warning")).toBe("warning");
    expect(foldValeSeverity("suggestion")).toBe("notice");
  });
});
