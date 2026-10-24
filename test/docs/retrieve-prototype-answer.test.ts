import { describe, expect, it } from "vitest";
import { hasModelReasoning, modelAnswerText } from "../../docs/src/components/retrieve-prototype-answer.js";

describe("WebLLM non-thinking answer transport", () => {
  it("removes the SDK's empty thinking prefix without altering the answer", () => {
    const raw = "<think>\n\n</think>\n\nRun `manni key rotate` [2].";
    expect(modelAnswerText(raw)).toBe("Run `manni key rotate` [2].");
    expect(hasModelReasoning(raw)).toBe(false);
    expect(modelAnswerText("3")).toBe("3");
  });

  it("keeps partial empty-prefix chunks out of the streamed display", () => {
    for (const partial of ["", "<", "<thi", "<think>", "<think>\n\n", "<think>\n\n</th", "<think>\n\n</think>"]) {
      expect(modelAnswerText(partial), partial).toBe("");
      expect(hasModelReasoning(partial), partial).toBe(false);
    }
    expect(modelAnswerText("<think>\n\n</think>\n\n3 match")).toBe("3 match");
  });

  it("flags actual reasoning rather than silently classifying it as an empty prefix", () => {
    const raw = "<think>I should inspect the evidence.</think>3";
    expect(hasModelReasoning(raw)).toBe(true);
    expect(modelAnswerText(raw)).toBe(raw);
    expect(hasModelReasoning("<think>Working")).toBe(true);
    expect(hasModelReasoning("The text mentions <think> as a literal tag.")).toBe(false);
  });
});
