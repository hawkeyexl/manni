/**
 * The two measures set health is built on (proposal 0087 § 7b): when two
 * questions are the same question, and how much of a question its answer
 * already says. 7c gates drafts with the same copied-wording measure.
 */
import { describe, expect, it } from "vitest";
import { copiedPairs, questionKey } from "../../../src/graph/core/questions.js";

describe("questionKey", () => {
  it("ignores case, punctuation and repeated spaces", () => {
    expect(questionKey("How do I retry a  failed upload?")).toBe(
      questionKey("how do I retry a failed upload"),
    );
    expect(questionKey("Wie rotiere ich den Schlüssel?")).toBe("wie rotiere ich den schlüssel");
  });

  it("keeps different words apart", () => {
    expect(questionKey("How do I retry?")).not.toBe(questionKey("How do I resume?"));
  });
});

describe("copiedPairs", () => {
  it("counts the question's adjacent word pairs that its answer also holds", () => {
    expect(
      copiedPairs(
        "Do uploads retry three times by default?",
        "Uploads retry three times by default, waiting longer each time.",
      ),
    ).toEqual({ copied: 5, of: 6 });
  });

  it("is lowercased", () => {
    expect(copiedPairs("Retry Limits apply", "retry limits")).toEqual({ copied: 1, of: 2 });
  });

  it("measures nothing under two words", () => {
    expect(copiedPairs("Retries?", "Retries happen.")).toBeUndefined();
  });
});
