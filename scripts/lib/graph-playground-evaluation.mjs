/** Deterministic, deliberately strict checks for the fixed browser-model bakeoff. */
const normalize = (value) => value.normalize("NFKC").toLowerCase().replace(/[`“”‘’]/g, "").replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const contains = (answer, phrase) => new RegExp(`(?<![a-z0-9_])${escape(normalize(phrase))}(?![a-z0-9_])`, "u").test(normalize(answer));
const numberWords = new Map([
  ["no", 0], ["zero", 0], ["one", 1], ["two", 2], ["three", 3], ["four", 4], ["five", 5], ["six", 6], ["seven", 7], ["eight", 8], ["nine", 9], ["ten", 10],
  ["eleven", 11], ["twelve", 12], ["thirteen", 13], ["fourteen", 14], ["fifteen", 15], ["sixteen", 16], ["seventeen", 17], ["eighteen", 18], ["nineteen", 19], ["twenty", 20], ["forty-one", 41], ["forty-four", 44], ["sixty-four", 64],
]);
const numeral = [...numberWords.keys()].sort((a, b) => b.length - a.length).join("|") + "|\\d+";
const numberValue = (value) => numberWords.get(value) ?? Number(value);
const prose = new Set("is are was were the a an tool command commands namespace alone and or to for that which with it its can could should will would does has have provides uses runs prints makes returns requires exists replaces supports manages means from in on under".split(" "));

function affirmedContains(answer, phrase) {
  const text = normalize(answer);
  const pattern = new RegExp(`(?<![a-z0-9_])${escape(normalize(phrase))}(?![a-z0-9_])`, "gu");
  for (const match of text.matchAll(pattern)) {
    const prefix = text.slice(Math.max(0, match.index - 80), match.index).split(/[.;!?]|\b(?:but|however)\b/).at(-1) ?? "";
    if (!/\b(?:no|not|never|cannot|can't|doesn't|don't|without)\b(?:\W+\w+){0,5}\W*$/u.test(prefix)) return true;
  }
  return false;
}

function commandRoutes(answer) {
  const routes = [];
  for (const match of normalize(answer).matchAll(/\bmanni\s+([a-z][a-z0-9-]*)(?:\s+([a-z][a-z0-9-]*))?(?:\s+([a-z][a-z0-9-]*))?/g)) {
    const domain = match[1];
    if (!domain || prose.has(domain)) continue;
    const verb = match[2];
    const extra = match[3];
    if (!verb || prose.has(verb)) routes.push(`manni ${domain}`);
    else routes.push(`manni ${domain} ${verb}${extra && !prose.has(extra) ? ` ${extra}` : ""}`);
  }
  return routes;
}

function countClaims(answer, labels) {
  const label = labels.map((item) => escape(normalize(item))).sort((a, b) => b.length - a.length).join("|");
  const text = normalize(answer);
  const patterns = [
    new RegExp(`\\b(${numeral})\\s+(?:(?:current|matching|returned|total|source|citation)\\s+)?(?:${label})\\b`, "gu"),
    new RegExp(`\\b(?:${label})\\s*(?:(?:count|total|is|are|was|were|returned|returns)\\s*)?(?::|=)?\\s*(${numeral})\\b`, "gu"),
  ];
  return patterns.flatMap((pattern) => [...text.matchAll(pattern)].map((match) => numberValue(match[1])));
}

/** A pass requires every declared criterion; invented commands/citations are hard failures. */
export function gradeAnswer(testCase, answer) {
  const issues = [];
  let critical = false;
  if (typeof answer !== "string" || answer.trim() === "") return { pass: false, issues: ["The model returned no answer."], critical: false };
  const expected = testCase.expected;
  for (const term of expected.requiredTerms ?? []) {
    if (!contains(answer, term)) issues.push(`Missing required fact: ${term}.`);
  }
  for (const group of expected.anyOf ?? []) {
    if (!group.some((term) => contains(answer, term))) issues.push(`Missing fact group: ${group.join(" / ")}.`);
  }
  for (const claim of expected.excludedClaims ?? []) {
    if (affirmedContains(answer, claim)) issues.push(`Contrary or unsupported claim: ${claim}.`);
  }
  const mentioned = new Set([...answer.matchAll(/\[(\d+(?:\s*[,;]\s*\d+)*)\]/g)].flatMap((match) => match[1].split(/\s*[,;]\s*/)));
  const known = new Set(testCase.input.sources.map((source) => source.id));
  for (const id of mentioned) {
    if (!known.has(id)) { issues.push(`Invented citation [${id}].`); critical = true; }
  }
  for (const id of expected.citationIds ?? []) {
    if (!mentioned.has(id)) issues.push(`Missing supporting citation [${id}].`);
  }
  if (expected.citationAnyOf?.length && !expected.citationAnyOf.some((id) => mentioned.has(id))) issues.push(`Missing a supporting citation from [${expected.citationAnyOf.join(", ")}].`);
  const allowed = expected.allowedCommands.map(normalize);
  for (const route of commandRoutes(answer)) {
    // A full route is required for a verb. A namespace alone never licenses
    // a fabricated verb; optional prose after a real verb does not rename it.
    const words = route.split(" ");
    const short = words.slice(0, 3).join(" ");
    const supported = words.length < 3 ? allowed.includes(route) : allowed.some((command) => command === route || (command.split(" ").length === 3 && command === short));
    if (!supported) { issues.push(`Unsupported command: ${route}.`); critical = true; }
  }
  const countOnly = expected.counts?.length === 1 && !(expected.requiredTerms?.length || expected.anyOf?.length || expected.abstain);
  const bare = normalize(answer).replace(/\[\d+(?:\s*[,;]\s*\d+)*\]/g, "").trim().replace(/[.!?]$/, "").trim();
  const bareNumber = /^\d+$/.test(bare) || (bare !== "no" && numberWords.has(bare));
  for (const count of expected.counts ?? []) {
    const claims = countClaims(answer, count.labels);
    if (!claims.includes(count.value) && !(countOnly && bareNumber && numberValue(bare) === count.value)) issues.push(`Missing count ${count.value} for ${count.labels[0]}.`);
    if (claims.some((value) => value !== count.value)) issues.push(`Incorrect count for ${count.labels[0]}.`);
  }
  if (expected.abstain && !/(?:not (?:specified|provided|available|mentioned|stated|given|included)|does not (?:specify|provide|contain|include|state|say|tell|give)|doesn't (?:specify|provide|contain|include|state|say|tell|give)|cannot (?:determine|tell|infer|answer)|can't (?:determine|tell|infer|answer)|insufficient|unknown|don't know|no (?:\w+\s+){0,3}(?:information|evidence|data|report|verdicts?|details?)|not in (?:the )?(?:evidence|passages?|returned))/i.test(answer)) {
    issues.push("Missing explicit abstention for information absent from the evidence.");
  }
  return { pass: issues.length === 0, issues, critical };
}

const record = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const strings = (value) => Array.isArray(value) && value.every((item) => typeof item === "string");

/** Validate the portable, frozen input manifest before any model download. */
export function validateEvaluationFixture(fixture) {
  const issues = [];
  if (!record(fixture) || fixture.schemaVersion !== 1) return ["Expected fixture schemaVersion 1."];
  const provenance = fixture.provenance;
  if (!record(provenance) || !/^sha256-[a-f0-9]{64}$/.test(provenance.graphDigest ?? "") || typeof provenance.generatedFrom !== "string" || !strings(provenance.seedQuestions) || !strings(provenance.sourceIRIs)) issues.push("Missing graph/source provenance.");
  if (!Array.isArray(fixture.cases) || fixture.cases.length !== 20) return [...issues, "Expected exactly 20 fixed evaluation cases."];
  const ids = new Set();
  for (const testCase of fixture.cases) {
    if (!record(testCase) || typeof testCase.id !== "string") { issues.push("A case has no id."); continue; }
    const label = testCase.id;
    if (ids.has(label)) issues.push(`Duplicate case id ${label}.`);
    ids.add(label);
    if (!["lookup", "retrieve", "traverse", "impact"].includes(testCase.operation) || typeof testCase.question !== "string" || !testCase.question.trim()) issues.push(`${label}: invalid operation or question.`);
    const input = testCase.input;
    const expected = testCase.expected;
    if (!record(input) || !Array.isArray(input.messages) || !Array.isArray(input.sources) || !record(expected)) { issues.push(`${label}: missing input or expected answer.`); continue; }
    if (!input.messages.every((m) => record(m) && ["system", "user"].includes(m.role) && typeof m.content === "string")) issues.push(`${label}: invalid frozen messages.`);
    else if (input.messages.reduce((sum, m) => sum + Buffer.byteLength(m.content, "utf8"), 0) > 3000) issues.push(`${label}: input exceeds 3000 UTF-8 bytes.`);
    if (!Number.isInteger(input.included) || input.included !== input.sources.length || !Number.isInteger(input.omitted) || input.omitted < 0) issues.push(`${label}: invalid input passage counts.`);
    const sourceIds = new Set();
    for (const source of input.sources) {
      if (!record(source) || typeof source.id !== "string" || !/^\d+$/.test(source.id) || ["iri", "title", "sourceUrl"].some((key) => typeof source[key] !== "string")) { issues.push(`${label}: invalid source.`); continue; }
      if (sourceIds.has(source.id)) issues.push(`${label}: duplicate source id ${source.id}.`);
      sourceIds.add(source.id);
    }
    for (const key of ["requiredTerms", "excludedClaims", "citationIds", "citationAnyOf", "allowedCommands"]) {
      if ((key === "allowedCommands" || key in expected) && !strings(expected[key])) issues.push(`${label}: invalid expected.${key}.`);
    }
    if (Array.isArray(expected.citationIds) && expected.citationIds.some((id) => !sourceIds.has(id))) issues.push(`${label}: expected citation is absent from frozen sources.`);
    if (Array.isArray(expected.citationAnyOf) && expected.citationAnyOf.some((id) => !sourceIds.has(id))) issues.push(`${label}: expected alternative citation is absent from frozen sources.`);
    if ("anyOf" in expected && (!Array.isArray(expected.anyOf) || !expected.anyOf.every((group) => strings(group) && group.length > 0))) issues.push(`${label}: invalid expected.anyOf.`);
    if ("counts" in expected && (!Array.isArray(expected.counts) || !expected.counts.every((count) => record(count) && Number.isInteger(count.value) && count.value >= 0 && strings(count.labels) && count.labels.length > 0))) issues.push(`${label}: invalid expected.counts.`);
    if ("abstain" in expected && typeof expected.abstain !== "boolean") issues.push(`${label}: invalid expected.abstain.`);
  }
  return issues;
}
