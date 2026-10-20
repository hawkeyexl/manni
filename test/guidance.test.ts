/**
 * Findings say what the schema asks for (proposal 0089, meta).
 *
 * Each Ajv finding carries `guidance`: the schema ref, the property path, the
 * first sentence of that property's description and the schema's reference
 * page. The wrapper errors `if`, `anyOf` and a `oneOf` nothing passed are
 * dropped, because each only ever reports beside the error that caused it.
 * The messages a page's author cannot act on are rewritten.
 */
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { runValidate } from "../src/meta/commands/validate.js";
import { firstSentence, guidanceFor } from "../src/meta/core/guidance.js";
import { builtinGuide } from "../src/meta/core/schema-registry.js";
import { isErrorSeverity, type FieldError } from "../src/meta/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const GUIDE = "https://hawkeyexl.github.io/manni/meta/reference/schemas/";

/** Validate inputs (or stdin) and return the failing findings of the first result. */
async function errorsOf(opts: {
  inputs?: string[];
  stdin?: string;
  schemas?: string[];
}): Promise<FieldError[]> {
  const { results } = await runValidate({
    inputs: opts.inputs ?? ["-"],
    ...(opts.stdin !== undefined ? { as: "markdown", stdinContent: opts.stdin } : {}),
    ...(opts.schemas ? { cliSchemas: opts.schemas } : {}),
    cwd: root,
    noConfig: true,
  });
  return (results[0]?.errors ?? []).filter(isErrorSeverity);
}

const lines = (errors: FieldError[]): string[] =>
  errors.map((e) => `${e.instancePath} ${e.message}`);

const P =
  "^[0-9]{4}(-[0-9]{2}(-[0-9]{2}(T[0-9]{2}:[0-9]{2}(:[0-9]{2}(\\.[0-9]+)?)?(Z|[+-][0-9]{2}:[0-9]{2}))?)?)?$";

describe("messages a page's author can act on", () => {
  it("lists the values an enum allows, and drops the else wrapper", async () => {
    const errors = await errorsOf({
      inputs: ["test/fixtures/platform/vitepress-bad-outline.md"],
      schemas: ["vitepress:page:1.6"],
    });
    expect(lines(errors)).toEqual([
      '/outline must be one of: 1, 2, 3, 4, 5, 6, "deep", false',
    ]);
  });

  it("reports a bad dcmi date once", async () => {
    const errors = await errorsOf({
      inputs: ["test/fixtures/vocabulary/dcmi-bad-date.md"],
      schemas: ["dcmi:elements:1.1"],
    });
    expect(lines(errors)).toEqual([`/date must match pattern "${P}"`]);
  });

  it("reports a dcmi date of the wrong type once", async () => {
    const errors = await errorsOf({ stdin: "---\ndate: 5\n---\n", schemas: ["dcmi:elements:1.1"] });
    expect(lines(errors)).toEqual(["/date must be string"]);
  });

  it("reports a bad eval entry without its three wrappers", async () => {
    const errors = await errorsOf({
      inputs: ["test/fixtures/guidance/evals-bad-entry.md"],
      schemas: ["manni:evals:1.0.0"],
    });
    expect(lines(errors)).toEqual([
      "/evals/0 must have required property 'assertion'",
      '/evals/0/id must match pattern "^[a-z0-9][a-z0-9-]*$"',
    ]);
  });

  it("names the one value a const allows", async () => {
    const errors = await errorsOf({
      inputs: ["test/fixtures/guidance/evals-wrong-grader.md"],
      schemas: ["manni:evals:1.0.0"],
    });
    expect(lines(errors)).toEqual(['/evals/0/grader must be "command"']);
  });

  it("says an empty string must not be empty", async () => {
    const errors = await errorsOf({
      inputs: ["test/fixtures/guidance/empty-type.md"],
      schemas: ["google:okf:0.1"],
    });
    expect(lines(errors)).toEqual(["/type must not be empty"]);
  });

  it("says an empty list must not be empty", async () => {
    const errors = await errorsOf({ stdin: "---\nevals: []\n---\n", schemas: ["manni:evals:1.0.0"] });
    expect(lines(errors)).toEqual(["/evals must not be empty"]);
  });

  it("joins a union of types with or", async () => {
    const errors = await errorsOf({ stdin: "---\nevals: 5\n---\n", schemas: ["manni:evals:1.0.0"] });
    expect(lines(errors)).toEqual(["/evals must be string or array"]);
  });

  it("says a reserved key must not be present", async () => {
    const errors = await errorsOf({ stdin: "---\neval-sute: x\n---\n", schemas: ["manni:evals:1.0.0"] });
    expect(lines(errors)).toEqual(["/eval-sute must not be present"]);
  });

  it("keeps the keyword and subject, so baselines keep their identity", async () => {
    const [e] = await errorsOf({ stdin: "---\nevals: 5\n---\n", schemas: ["manni:evals:1.0.0"] });
    expect(e?.keyword).toBe("type");
    expect(String(e?.subject)).toBe("string,array");
  });

  it("tells the author what to write when $schema names an id nothing defines", async () => {
    const errors = await errorsOf({ inputs: ["test/fixtures/guidance/unknown-schema-ref.md"] });
    expect(errors.map((e) => e.message)).toEqual([
      '$schema names "house:page:1.0.0", which this repository does not define. Use an id from manni meta schemas, or remove $schema.',
    ]);
    expect(errors[0]?.keyword).toBe("schema");
  });
});

describe("wrapper errors", () => {
  const schema = {
    type: "object",
    properties: {
      a: { anyOf: [{ type: "string" }, { type: "number" }] },
      b: { oneOf: [{ type: "string" }, { type: "number" }] },
      c: { oneOf: [{ type: "number" }, { type: "integer" }] },
    },
  };

  it("drops anyOf and a oneOf no branch passed, and keeps a oneOf two branches passed", async () => {
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(resolve(tmpdir(), "manni-guidance-"));
    const file = resolve(dir, "s.json");
    writeFileSync(file, JSON.stringify(schema));
    const errors = await errorsOf({ stdin: "---\na: true\nb: true\nc: 2\n---\n", schemas: [file] });
    expect(errors.map((e) => `${e.instancePath} ${e.keyword}`)).toEqual([
      "/a type",
      "/a type",
      "/b type",
      "/b type",
      "/c oneOf",
    ]);
  });
});

describe("guidance on findings", () => {
  it("names the schema and the property, and links the built-in's page", async () => {
    const [e] = await errorsOf({
      inputs: ["test/fixtures/vocabulary/dcmi-bad-date.md"],
      schemas: ["dcmi:elements:1.1"],
    });
    expect(e?.guidance).toEqual({
      id: "dcmi:elements:1.1",
      rule: "date",
      description:
        "A point or period of time associated with an event in the lifecycle of the resource.",
      guide: `${GUIDE}dcmi-elements/`,
    });
  });

  it("drops array indexes from the rule and appends a missing property", async () => {
    const errors = await errorsOf({
      inputs: ["test/fixtures/guidance/evals-bad-entry.md"],
      schemas: ["manni:evals:1.0.0"],
    });
    expect(errors.map((e) => e.guidance?.rule)).toEqual(["evals/assertion", "evals/id"]);
    expect(errors[0]?.guidance?.description).toBe("The testable assertion, in plain language.");
  });

  it("walks a nested object to the property that failed", async () => {
    const errors = await errorsOf({
      stdin: '---\ntitle: T\nsidebar:\n  order: "1"\n  badge:\n    variant: shiny\n---\n',
      schemas: ["astro:starlight:0.41"],
    });
    expect(lines(errors)).toEqual([
      "/sidebar/order must be number",
      "/sidebar/badge must have required property 'text'",
      '/sidebar/badge/variant must be one of: "note", "tip", "caution", "danger", "success", "default"',
    ]);
    expect(errors.map((e) => e.guidance?.rule)).toEqual([
      "sidebar/order",
      "sidebar/badge/text",
      "sidebar/badge/variant",
    ]);
  });

  it("names no rule for a key no property declares", async () => {
    const [e] = await errorsOf({ stdin: "---\neval-sute: x\n---\n", schemas: ["manni:evals:1.0.0"] });
    expect(e?.guidance).toEqual({
      id: "manni:evals:1.0.0",
      rule: null,
      description: null,
      guide: `${GUIDE}manni-evals/`,
    });
  });

  it("leaves the synthetic findings without guidance", async () => {
    const errors = await errorsOf({ inputs: ["test/fixtures/guidance/unknown-schema-ref.md"] });
    expect(errors[0]?.guidance).toBeUndefined();
  });

  it("gives a schema outside the built-ins no guide", () => {
    const schema = { properties: { x: { type: "string", description: "What x is. More." } } };
    expect(
      guidanceFor(schema, "./house.json", { instancePath: "/x", keyword: "type", params: {} }),
    ).toEqual({ id: "./house.json", rule: "x", description: "What x is.", guide: null });
  });

  it("follows a local $ref, allOf and then/else to the declared property", () => {
    const schema = {
      $defs: { inner: { properties: { deep: { description: "Deep." } } } },
      allOf: [{ if: true, then: { properties: { outer: { $ref: "#/$defs/inner" } } } }],
    };
    expect(
      guidanceFor(schema, "s", { instancePath: "/outer/deep", keyword: "type", params: {} }).rule,
    ).toBe("outer/deep");
  });
});

describe("firstSentence", () => {
  it("stops at the first sentence end followed by a capital or a code span", () => {
    expect(firstSentence("One. Two.")).toBe("One.");
    expect(firstSentence("One e.g. two. `Three`.")).toBe("One e.g. two.");
    expect(firstSentence("Only one")).toBe("Only one");
  });
});

describe("builtinGuide", () => {
  it("answers for an id and its published URL alike", () => {
    expect(builtinGuide("dcmi:elements:1.1")).toBe(`${GUIDE}dcmi-elements/`);
    expect(builtinGuide("https://hawkeyexl.github.io/manni/schemas/dcmi/1.1.json")).toBe(
      `${GUIDE}dcmi-elements/`,
    );
    expect(builtinGuide("./schemas/page.json")).toBeNull();
  });
});
