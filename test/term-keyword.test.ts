/**
 * `x-manni-term` (proposal 0086 §6): the schema keyword that says a field's
 * string values must name terms, `Validator.termMarks`, and the three
 * findings `manni meta validate` reports for a marked value.
 */
import { afterEach, describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Validator } from "../src/meta/core/validator.js";
import { TERM_KEYWORD, termScheme } from "../src/meta/core/term-keyword.js";
import { TERM_KEYWORD as PUBLIC_TERM_KEYWORD } from "../src/index.js";
import { runValidate } from "../src/meta/commands/validate.js";
import { RESERVED_RULES, ruleIdFor } from "../src/meta/reporters/rule-id.js";
import { assertPublishableBuiltinId } from "../src/meta/core/schema-registry.js";
import { DocmetaError, type FieldError } from "../src/meta/types.js";
import { registerTermLabelSource, type TermLabel } from "../src/shared/term-labels.js";
import { termLabels } from "../src/term/commands/labels.js";
import { MockProvider } from "@hawkeyexl/inference";
import { runFill } from "../src/meta/commands/fill.js";
import { termMarksIn } from "../src/meta/commands/fill-hints.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "fixtures", "term-keyword");
const AUDIENCE = join(fixtures, "audience.schema.json");
const NESTED = join(fixtures, "nested.schema.json");
const BAD_ARGUMENT = join(fixtures, "bad-argument.schema.json");
const noKey: NodeJS.ProcessEnv = {};

const TERMS: TermLabel[] = [
  { label: "Audience", id: "audience", narrower: ["Developer"] },
  { label: "Developer", id: "developer" },
  { label: "Frontend developer", id: "frontend-developer", broader: ["Developer"] },
  { label: "Operator", id: "operator", broader: ["audience"] },
  { label: "Site reliability engineer", id: "sre", broader: ["operator"], altLabels: ["SRE"] },
  { label: "Role", id: "role", narrower: ["Writer"] },
  { label: "Writer", id: "writer" },
];

afterEach(() => {
  registerTermLabelSource(undefined);
});

describe("x-manni-term: the keyword", () => {
  it("is spelled x-manni-term, and the package exports it", () => {
    expect(TERM_KEYWORD).toBe("x-manni-term");
    expect(PUBLIC_TERM_KEYWORD).toBe("x-manni-term");
  });

  it("records each marked value at its full pointer, through $ref, at any depth", async () => {
    const data = { graph: { concepts: ["Writer", "devops"] }, role: "Writer", title: "t" };
    const hits = await new Validator().termMarks(data, [NESTED]);
    expect(hits.map(({ pointer, value, under }) => ({ pointer, value, under }))).toEqual([
      { pointer: "/graph/concepts/0", value: "Writer", under: undefined },
      { pointer: "/graph/concepts/1", value: "devops", under: undefined },
      { pointer: "/role", value: "Writer", under: "role" },
    ]);
    expect(hits.every((h) => h.schema === NESTED)).toBe(true);
  });

  it("records nothing for a field the data does not hold", async () => {
    expect(await new Validator().termMarks({ title: "t" }, [AUDIENCE])).toEqual([]);
  });

  it("refuses an argument that is not an object with an optional under string", async () => {
    const err = await new Validator().termMarks({}, [BAD_ARGUMENT]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DocmetaError);
    expect((err as Error).message).toBe(
      `${BAD_ARGUMENT}: "x-manni-term" must be an object with an optional "under" string.`,
    );
  });
});

describe("x-manni-term: the termbase as the keyword reads it", () => {
  const scheme = termScheme(TERMS);

  it("finds a term by label or id, ignoring case, and by alt-label", () => {
    expect(scheme.find("frontend DEVELOPER")).toEqual({ key: "frontend-developer", label: "Frontend developer", alt: false });
    expect(scheme.find("sre")).toEqual({ key: "sre", label: "Site reliability engineer", alt: false });
    expect(scheme.find("devops")).toBeUndefined();
  });

  it("prefers a label over an alt-label that spells it too", () => {
    const shadowed = termScheme([...TERMS, { label: "Ops", id: "ops", altLabels: ["Operator"] }]);
    expect(shadowed.find("Operator")?.alt).toBe(false);
    expect(shadowed.find("Operator")?.key).toBe("operator");
  });

  it("reads a branch at any depth, through broader and narrower, never its root", () => {
    expect([...(scheme.below("Audience") ?? [])].sort()).toEqual([
      "developer",
      "frontend-developer",
      "operator",
      "sre",
    ]);
    expect([...(scheme.below("role") ?? [])]).toEqual(["writer"]);
    expect(scheme.below("Audiense")).toBeUndefined();
  });

  it("lists a branch's labels, or every label", () => {
    expect(scheme.labels(scheme.below("Role"))).toEqual(["Writer"]);
    expect(scheme.labels()).toHaveLength(TERMS.length);
  });
});

describe("validate: x-manni-term findings", () => {
  const team = (errors: FieldError[]): FieldError[] => errors.filter((e) => e.keyword === "term");

  it("reports the worked example, under and without under", async () => {
    registerTermLabelSource(termLabels);
    const { results, summary } = await runValidate({ inputs: ["docs/team.md"], cwd: fixtures, env: noKey });
    const [result] = results;
    expect(result?.ok).toBe(false);
    const findings = team(result?.errors ?? []);
    const ref = "audience.schema.json";
    expect(findings).toEqual([
      {
        schema: "term:outside-branch",
        keyword: "term",
        subject: "Writer",
        instancePath: "/audiences/1",
        message: `"Writer" is a term, but not under "Audience", which ${ref} requires.`,
        line: 5,
      },
      {
        schema: "term:alt-label",
        keyword: "term",
        subject: "SRE",
        instancePath: "/audiences/2",
        message: `"SRE" is an alt-label of "Site reliability engineer", so use the label.`,
        severity: "warning",
        line: 6,
      },
      {
        schema: "term:undefined",
        keyword: "term",
        subject: "devops",
        instancePath: "/audiences/3",
        message: `"devops" names no term; ${ref} marks this field x-manni-term.`,
        line: 7,
      },
      {
        schema: "term:outside-branch",
        keyword: "term",
        subject: "Audience",
        instancePath: "/audiences/4",
        message: `"Audience" is a term, but not under "Audience", which ${ref} requires.`,
        line: 8,
      },
      {
        schema: "term:alt-label",
        keyword: "term",
        subject: "SRE",
        instancePath: "/people/2",
        message: `"SRE" is an alt-label of "Site reliability engineer", so use the label.`,
        severity: "warning",
        line: 12,
      },
      {
        schema: "term:undefined",
        keyword: "term",
        subject: "devops",
        instancePath: "/people/3",
        message: `"devops" names no term; ${ref} marks this field x-manni-term.`,
        line: 13,
      },
    ]);
    expect(findings.map((f) => ruleIdFor(f))).toEqual([
      "term:outside-branch/term",
      "term:alt-label/term",
      "term:undefined/term",
      "term:outside-branch/term",
      "term:alt-label/term",
      "term:undefined/term",
    ]);
    expect(summary.warnings).toBe(2);
  });

  it("passes labels and ids under the branch", async () => {
    registerTermLabelSource(termLabels);
    const { results } = await runValidate({ inputs: ["docs/clean.md"], cwd: fixtures, env: noKey });
    expect(results.map((r) => [r.ok, r.errors])).toEqual([[true, []]]);
  });

  it("refuses an under that names no term", async () => {
    registerTermLabelSource(termLabels);
    const err = await runValidate({
      inputs: ["docs/team.md"],
      cliSchemas: ["bad-under.schema.json"],
      cwd: fixtures,
      env: noKey,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DocmetaError);
    expect((err as Error).message).toBe('bad-under.schema.json: x-manni-term under "Audiense" names no term.');
  });

  it("warns once when no termbase is found, counting the marked fields, and checks nothing", async () => {
    const notices: string[] = [];
    const { results } = await runValidate({
      inputs: ["docs/team.md"],
      cwd: fixtures,
      env: noKey,
      onNotice: (m) => notices.push(m),
    });
    expect(results.map((r) => [r.ok, team(r.errors)])).toEqual([[true, []]]);
    expect(notices).toEqual([
      "x-manni-term marks 2 fields, and no termbase was found, so their values were not checked.",
    ]);
  });

  it("treats a source that returns no terms as no termbase", async () => {
    registerTermLabelSource(() => Promise.resolve([]));
    const notices: string[] = [];
    await runValidate({
      inputs: ["docs/team.md"],
      cwd: fixtures,
      env: noKey,
      onNotice: (m) => notices.push(m),
    });
    expect(notices).toEqual([
      "x-manni-term marks 2 fields, and no termbase was found, so their values were not checked.",
    ]);
  });

  it("names the reason once when the termbase cannot be read", async () => {
    registerTermLabelSource(() => Promise.reject(new Error("glossary/x.md: bad YAML")));
    const notices: string[] = [];
    const { results } = await runValidate({
      inputs: ["docs/team.md", "docs/clean.md"],
      cwd: fixtures,
      env: noKey,
      onNotice: (m) => notices.push(m),
    });
    expect(results.every((r) => r.ok)).toBe(true);
    expect(notices).toEqual([
      "The termbase could not be read, so x-manni-term values were not checked: glossary/x.md: bad YAML",
    ]);
  });
});

/** A provider answering each request in turn with the given fields. */
function script(...answers: Record<string, { value: unknown; confidence: number }>[]): MockProvider {
  return new MockProvider(
    answers.map((fields) => ({
      json: Object.fromEntries(
        Object.entries(fields).map(([k, v]) => [k, { ...v, reasoning: "stated in the page" }]),
      ),
    })),
  );
}

/** The `enum` lists anywhere in the schema request `index` sent. */
function enumsSent(provider: MockProvider, index: number): unknown[][] {
  const out: unknown[][] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node !== "object" || node === null) return;
    const listed: unknown = (node as Record<string, unknown>).enum;
    if (Array.isArray(listed)) out.push(listed);
    Object.values(node).forEach(walk);
  };
  walk(provider.requests[index]?.schema);
  return out;
}

describe("fill: x-manni-term offers", () => {
  const opts = (provider: MockProvider, fields: string[]) => ({
    cwd: fixtures,
    inputs: ["docs/untagged.md"],
    fields,
    dryRun: true,
    cache: false as const,
    inferenceProvider: provider,
  });

  it("offers the labels below under, and refuses a term outside the branch once more", async () => {
    registerTermLabelSource(termLabels);
    const provider = script(
      { audiences: { value: ["Writer"], confidence: 0.9 } },
      { audiences: { value: ["Site reliability engineer"], confidence: 0.9 } },
    );
    const run = await runFill(opts(provider, ["audiences"]));
    expect(enumsSent(provider, 0)).toContainEqual([
      "Developer",
      "Frontend developer",
      "Operator",
      "Site reliability engineer",
    ]);
    expect(provider.requests[1]?.user).toContain(`/audiences/0: must be a glossary term label under "Audience"`);
    expect(run.results[0]?.fields[0]).toMatchObject({ written: true, value: ["Site reliability engineer"] });
  });

  it("offers every label when the mark names no branch", async () => {
    registerTermLabelSource(termLabels);
    const provider = script({ people: { value: ["writer"], confidence: 0.9 } });
    const run = await runFill(opts(provider, ["people"]));
    expect(enumsSent(provider, 0)).toContainEqual([
      "Audience",
      "Developer",
      "Frontend developer",
      "Operator",
      "Role",
      "Site reliability engineer",
      "Writer",
    ]);
    expect(provider.requests).toHaveLength(1);
    expect(run.results[0]?.fields[0]).toMatchObject({ written: true, value: ["writer"] });
  });

  it("reads marks from a candidate's subschema, nested and through $ref", () => {
    const defs = { $defs: { terms: { type: "array", items: { "x-manni-term": {} } } }, definitions: {} };
    const graph = {
      key: "graph",
      subschema: { type: "object", properties: { concepts: { $ref: "#/$defs/terms" } } },
      required: false,
      present: false,
    };
    const role = { key: "role", subschema: { "x-manni-term": { under: "Role" } }, required: false, present: false };
    expect(termMarksIn(graph, defs)).toEqual([{ path: ["graph", "concepts"] }]);
    expect(termMarksIn(role, defs)).toEqual([{ path: ["role"], under: "Role" }]);
  });

  it("offers nothing with no termbase, and takes any string", async () => {
    registerTermLabelSource(() => Promise.resolve([]));
    const provider = script({ audiences: { value: ["devops"], confidence: 0.9 } });
    const run = await runFill(opts(provider, ["audiences"]));
    expect(enumsSent(provider, 0)).toEqual([]);
    expect(run.results[0]?.fields[0]).toMatchObject({ written: true, value: ["devops"] });
  });
});

describe("x-manni-term: reserved identities", () => {
  it("reserves the three rule ids", () => {
    expect(Object.keys(RESERVED_RULES)).toEqual(
      expect.arrayContaining(["term:undefined/term", "term:outside-branch/term", "term:alt-label/term"]),
    );
  });

  it("refuses a built-in id whose first segment is term", () => {
    expect(() => {
      assertPublishableBuiltinId("term:undefined");
    }).toThrow(/reserved for term finding identities/);
  });
});
