export interface ExpectedAnswer {
  requiredTerms?: string[];
  anyOf?: string[][];
  excludedClaims?: string[];
  citationIds?: string[];
  citationAnyOf?: string[];
  abstain?: boolean;
  counts?: { value: number; labels: string[] }[];
  allowedCommands: string[];
}
export interface EvaluationCase {
  id: string;
  operation: string;
  referenceAnswer?: string;
  question: string;
  input: {
    messages: { role: "system" | "user"; content: string }[];
    sources: { id: string; iri: string; title: string; sourceUrl: string }[];
    included: number;
    omitted: number;
  };
  expected: ExpectedAnswer;
}
export function gradeAnswer(testCase: EvaluationCase, answer: string): { pass: boolean; issues: string[]; critical: boolean };
export function validateEvaluationFixture(fixture: unknown): string[];
