import fixture from "../fixtures/retrieve-prototype/model-evaluation.json" with { type: "json" };
import { describe, expect, it } from "vitest";
import { gradeAnswer, validateEvaluationFixture, type EvaluationCase } from "../../scripts/lib/graph-playground-evaluation.mjs";

function sample(expected: EvaluationCase["expected"]): EvaluationCase {
  return {
    id: "example", operation: "lookup", question: "Which command rotates the key?",
    input: { messages: [{ role: "system", content: "Use the evidence." }, { role: "user", content: "manni key rotate replaces the key." }], sources: [{ id: "1", iri: "urn:source:1", title: "Key", sourceUrl: "/key/" }], included: 1, omitted: 0 },
    expected,
  };
}

function validationFixture() {
  return {
    schemaVersion: 1,
    provenance: { graphDigest: `sha256-${"a".repeat(64)}`, generatedFrom: "repository graph", seedQuestions: ["key"], sourceIRIs: ["urn:source:1"] },
    cases: Array.from({ length: 20 }, (_, index) => ({ ...sample({ requiredTerms: ["rotate"], allowedCommands: ["manni key rotate"] }), id: `case-${index}` })),
  };
}

describe("fixed browser-model evaluation grading", () => {
  it("accepts an exact command with the supporting citation despite prose and formatting variation", () => {
    const testCase = sample({ requiredTerms: ["manni key rotate"], citationIds: ["1"], allowedCommands: ["manni key", "manni key rotate"] });
    expect(gradeAnswer(testCase, "Run `manni key rotate` to replace it. [1]")).toEqual({ pass: true, issues: [], critical: false });
    expect(gradeAnswer(testCase, "Use MANNI   KEY ROTATE [1].").pass).toBe(true);
  });

  it("rejects a valid but unsupported command and marks hallucination as critical", () => {
    const testCase = sample({ allowedCommands: ["manni key", "manni key rotate"] });
    const grade = gradeAnswer(testCase, "Use `manni key encrypt` [1].");
    expect(grade.pass).toBe(false);
    expect(grade.critical).toBe(true);
    expect(grade.issues.join(" ")).toMatch(/unsupported command/i);
    expect(gradeAnswer(testCase, "The manni key tool provides this operation.").critical).toBe(false);
  });

  it("does not accept a different command merely because it starts with a permitted namespace", () => {
    const grade = gradeAnswer(sample({ allowedCommands: ["manni key"] }), "manni key delete [1]");
    expect(grade).toMatchObject({ pass: false, critical: true });
  });

  it("rejects invented numbered citations and distinguishes missing supporting citations", () => {
    const testCase = sample({ citationIds: ["1"], allowedCommands: [] });
    expect(gradeAnswer(testCase, "This is true [9].")).toMatchObject({ pass: false, critical: true });
    const missing = gradeAnswer(testCase, "This is true.");
    expect(missing).toMatchObject({ pass: false, critical: false });
    expect(missing.issues.join(" ")).toMatch(/citation/i);
  });

  it("requires all fact groups, rejects contrary claims, and preserves exact command boundaries", () => {
    const testCase = sample({ requiredTerms: ["manni key rotate"], anyOf: [["re-encrypt", "re-encrypts"]], excludedClaims: ["manni key set re-encrypts"], allowedCommands: ["manni key rotate", "manni key set"] });
    expect(gradeAnswer(testCase, "manni key rotate re-encrypts the values").pass).toBe(true);
    expect(gradeAnswer(testCase, "manni key rotates re-encrypts the values").pass).toBe(false);
    expect(gradeAnswer(testCase, "manni key rotate exists, but `manni key set` re-encrypts the values.").pass).toBe(false);
  });

  it("checks labeled counts, supports written numbers, and catches incorrect extra counts", () => {
    const testCase = sample({ counts: [{ value: 3, labels: ["matches", "match passages"] }, { value: 14, labels: ["context passages"] }], allowedCommands: [] });
    expect(gradeAnswer(testCase, "Three matches and 14 context passages were returned.").pass).toBe(true);
    expect(gradeAnswer(testCase, "5 matches, 14 context passages.").pass).toBe(false);
    expect(gradeAnswer(testCase, "3 matches. Actually 5 matches; 14 context passages.").pass).toBe(false);
    expect(gradeAnswer(testCase, "The numbers 3 and 14 appear in the source.").pass).toBe(false);
  });

  it("accepts a bare number only for a single-count question with no additional facts", () => {
    const testCase = sample({ counts: [{ value: 3, labels: ["matches"] }], allowedCommands: [] });
    expect(gradeAnswer(testCase, "3").pass).toBe(true);
    expect(gradeAnswer(testCase, "Three. [1]").pass).toBe(true);
    expect(gradeAnswer(testCase, "5").pass).toBe(false);
    expect(gradeAnswer(testCase, "The number 3 is mentioned elsewhere.").pass).toBe(false);
    expect(gradeAnswer(sample({ counts: [{ value: 3, labels: ["matches"] }], requiredTerms: ["verified"], allowedCommands: [] }), "3").pass).toBe(false);
  });

  it("requires an explicit abstention for facts absent from the delivered input", () => {
    const testCase = sample({ abstain: true, excludedClaims: ["30 milliseconds"], allowedCommands: [] });
    expect(gradeAnswer(testCase, "The returned evidence does not specify a runtime.").pass).toBe(true);
    expect(gradeAnswer(testCase, "It takes 30 milliseconds.").pass).toBe(false);
    expect(gradeAnswer(testCase, "Not specified, but it takes 30 milliseconds.").pass).toBe(false);
    expect(gradeAnswer(testCase, "").pass).toBe(false);
  });

  it("does not turn a negated unsupported claim into an affirmative hallucination", () => {
    const testCase = sample({ abstain: true, excludedClaims: ["all tests passed"], allowedCommands: [] });
    expect(gradeAnswer(testCase, "The eval report is not provided, so it does not prove all tests passed.").pass).toBe(true);
    expect(gradeAnswer(testCase, "The report is not provided, but all tests passed.").pass).toBe(false);
    expect(gradeAnswer(sample({ counts: [{ value: 0, labels: ["dependent passages"] }], allowedCommands: [] }), "No dependent passages were returned.").pass).toBe(true);
  });

  it("accepts either genuinely supporting source while rejecting an unsupported replacement", () => {
    const testCase = sample({ citationAnyOf: ["1", "2"], allowedCommands: [] });
    testCase.input.sources.push({ id: "2", iri: "urn:source:2", title: "Other proof", sourceUrl: "/other/" });
    testCase.input.included = 2;
    expect(gradeAnswer(testCase, "The environment variable wins. [2]").pass).toBe(true);
    expect(gradeAnswer(testCase, "The environment variable wins. [3]")).toMatchObject({ pass: false, critical: true });
  });

  it("keeps the actual twenty-case frozen fixture valid and accepts each curated reference answer", () => {
    expect(validateEvaluationFixture(fixture)).toEqual([]);
    for (const testCase of fixture.cases) {
      const messages = testCase.input.messages.map<EvaluationCase["input"]["messages"][number]>((message) => {
        const role = message.role;
        if (role !== "system" && role !== "user") throw new Error("Invalid frozen role.");
        return { ...message, role };
      });
      expect(gradeAnswer({ ...testCase, input: { ...testCase.input, messages } }, testCase.referenceAnswer), testCase.id).toEqual({ pass: true, issues: [], critical: false });
    }
  });

  it.each([
    { messages: [] },
    { messages: [{ role: "system", content: "Use the evidence." }] },
    { messages: [{ role: "user", content: " \n\t " }] },
    { messages: [{ role: "system", content: "" }, { role: "user", content: "Which command?" }] },
    { messages: [{ role: "assistant", content: "manni key rotate" }] },
  ])("rejects missing, blank, or unsupported frozen message input: %j", ({ messages }) => {
    const manifest = validationFixture();
    const candidate = { ...manifest, cases: manifest.cases.map((testCase) => ({ ...testCase, input: { ...testCase.input, messages } })) };
    expect(validateEvaluationFixture(candidate).join(" ")).toMatch(/invalid frozen messages/i);
  });

  it("requires at least one delivered evidence source and rejects blank source metadata", () => {
    const manifest = validationFixture();
    const withoutEvidence = { ...manifest, cases: manifest.cases.map((testCase) => ({ ...testCase, input: { ...testCase.input, sources: [], included: 0 } })) };
    expect(validateEvaluationFixture(withoutEvidence).join(" ")).toMatch(/passage counts|evidence source/i);
    for (const key of ["iri", "title", "sourceUrl"]) {
      const blankSource = { ...manifest, cases: manifest.cases.map((testCase) => ({ ...testCase, input: { ...testCase.input, sources: testCase.input.sources.map((source) => ({ ...source, [key]: " \t " })) } })) };
      expect(validateEvaluationFixture(blankSource).join(" "), key).toMatch(/invalid source/i);
    }
  });

  it.each([
    { allowedCommands: [] },
    { requiredTerms: [], anyOf: [], counts: [], abstain: false, allowedCommands: [] },
    { citationIds: ["1"], citationAnyOf: ["1"], excludedClaims: ["invented"], allowedCommands: ["manni key rotate"] },
    { requiredTerms: [" \t "], allowedCommands: [] },
    { anyOf: [[" "]], allowedCommands: [] },
    { counts: [{ value: 3, labels: [" "] }], allowedCommands: [] },
    { requiredTerm: ["rotate"], allowedCommands: [] },
  ])("rejects cases without a substantive fact, count, or abstention criterion: %j", (expected) => {
    const manifest = validationFixture();
    const candidate = { ...manifest, cases: manifest.cases.map((testCase) => ({ ...testCase, expected })) };
    expect(validateEvaluationFixture(candidate).join(" ")).toMatch(/substantive answer criterion/i);
  });

  it.each([
    { requiredTerms: ["rotate"], allowedCommands: [] },
    { anyOf: [["rotate", "replace"]], allowedCommands: [] },
    { counts: [{ value: 0, labels: ["dependent passages"] }], allowedCommands: [] },
    { abstain: true, allowedCommands: [] },
  ])("accepts each supported substantive criterion without requiring a command: %j", (expected) => {
    const manifest = validationFixture();
    expect(validateEvaluationFixture({ ...manifest, cases: manifest.cases.map((testCase) => ({ ...testCase, expected })) })).toEqual([]);
  });

  it("rejects an unknown graph operation before the runner starts", () => {
    const manifest = validationFixture();
    expect(validateEvaluationFixture({ ...manifest, cases: manifest.cases.map((testCase) => ({ ...testCase, operation: "invented" })) }).join(" ")).toMatch(/invalid operation/i);
  });

  it("validates frozen input byte ceilings, citation support and unique cases", () => {
    const cases = Array.from({ length: 20 }, (_, index) => ({ ...sample({ requiredTerms: ["rotate"], allowedCommands: ["manni key rotate"] }), id: `case-${index}` }));
    const fixture = { schemaVersion: 1, provenance: { graphDigest: `sha256-${"a".repeat(64)}`, generatedFrom: "repository graph", seedQuestions: ["key"], sourceIRIs: ["urn:source:1"] }, cases };
    expect(validateEvaluationFixture(fixture)).toEqual([]);
    const first = cases[0];
    if (!first) throw new Error("A fixture case is required.");
    first.input = { ...first.input, messages: [{ role: "user", content: "🦦".repeat(1000) }] };
    first.expected.citationIds = ["99"];
    expect(validateEvaluationFixture(fixture).join(" ")).toMatch(/3000|byte/i);
    expect(validateEvaluationFixture(fixture).join(" ")).toMatch(/citation/i);
    cases[1] = first;
    expect(validateEvaluationFixture(fixture).join(" ")).toMatch(/duplicate/i);
  });
});
