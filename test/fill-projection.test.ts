/**
 * The shape `fill` shows the model for each candidate's `value`.
 *
 * A local provider compiles the response schema into a grammar, and that
 * compiler ignores `allOf`, `$ref` chains it cannot follow, `if`/`then`/`else`
 * and `not`. It turns an untyped node into a `null`-only rule and `format: uri`
 * into `""`, so a merged subschema sent verbatim could only be answered `null`.
 * The projection is what the model is shown; the full subschema still checks
 * the answer afterwards. Each rule below has a case of its own.
 */
import { describe, it, expect } from "vitest";
import { projectValue } from "../src/meta/commands/fill-projection.js";

const noDefs = { $defs: {}, definitions: {} };

/** The projection inside rule 7's null wrapper, or a failure naming why not. */
function inner(
  subschema: unknown,
  defs: { $defs: Record<string, unknown>; definitions: Record<string, unknown> } = noDefs,
): unknown {
  const projected = projectValue(subschema, defs);
  if (!("schema" in projected)) throw new Error("expected a satisfiable projection");
  const { oneOf } = projected.schema;
  if (!Array.isArray(oneOf) || oneOf.length !== 2) {
    throw new Error("expected the null wrapper");
  }
  expect(oneOf[1]).toEqual({ type: "null" });
  return oneOf[0];
}

const ANY = [
  { type: "string" },
  { type: "number" },
  { type: "boolean" },
  { type: "array" },
  { type: "object", additionalProperties: true },
];

describe("projectValue", () => {
  describe("rule 1: $ref", () => {
    it("replaces a $ref with its target from $defs", () => {
      const defs = {
        $defs: { Slug: { type: "string", pattern: "^[a-z]+$" } },
        definitions: {},
      };
      expect(inner({ $ref: "#/$defs/Slug" }, defs)).toEqual({
        type: "string",
        pattern: "^[a-z]+$",
      });
    });

    it("follows a draft-07 definitions ref too", () => {
      const defs = { $defs: {}, definitions: { Tag: { type: "string", minLength: 1 } } };
      expect(inner({ type: "array", items: { $ref: "#/definitions/Tag" } }, defs)).toEqual({
        type: "array",
        items: { type: "string", minLength: 1 },
      });
    });

    it("stops a cycle at the second visit, as an untyped node", () => {
      const defs = {
        $defs: {
          Node: {
            type: "object",
            properties: { child: { $ref: "#/$defs/Node" } },
          },
        },
        definitions: {},
      };
      expect(inner({ $ref: "#/$defs/Node" }, defs)).toEqual({
        type: "object",
        properties: { child: { oneOf: ANY } },
      });
    });

    it("leaves a ref it cannot follow untyped, for the full check to resolve", () => {
      // Only #/$defs/… and #/definitions/… are followed. Any other ref, such
      // as a remote id, projects as any non-null value; the full subschema,
      // compiled with every schema in the set, still judges the answer.
      expect(inner({ $ref: "https://example.com/schemas/foo.json" })).toEqual({ oneOf: ANY });
      expect(inner({ $ref: "#/$defs/Missing" })).toEqual({ oneOf: ANY });
    });

    it("merges a $ref with the keywords beside it", () => {
      const defs = { $defs: { S: { type: "string" } }, definitions: {} };
      expect(inner({ $ref: "#/$defs/S", minLength: 2 }, defs)).toEqual({
        type: "string",
        minLength: 2,
      });
    });
  });

  describe("rule 2: allOf", () => {
    it("intersects the branches' types, and a branch without one constrains nothing", () => {
      expect(
        inner({ allOf: [{ type: ["string", "number"] }, { type: "string" }, { minLength: 1 }] }),
      ).toEqual({ type: "string", minLength: 1 });
    });

    it("reads integer as the common member of number and integer", () => {
      expect(inner({ allOf: [{ type: "number" }, { type: ["integer", "string"] }] })).toEqual({
        type: "integer",
      });
    });

    it("intersects enum and const", () => {
      expect(
        inner({ allOf: [{ enum: ["a", "b", "c"] }, { enum: ["b", "c", "d"] }] }),
      ).toEqual({ enum: ["b", "c"] });
      expect(inner({ allOf: [{ enum: ["a", "b"] }, { const: "b" }] })).toEqual({ const: "b" });
    });

    it("merges properties key by key, unions required, and merges items", () => {
      expect(
        inner({
          allOf: [
            {
              type: "array",
              items: {
                type: "object",
                required: ["name"],
                properties: { name: { type: "string" } },
              },
            },
            {
              items: {
                required: ["version"],
                properties: { name: { minLength: 1 }, version: { type: "string" } },
              },
            },
          ],
        }),
      ).toEqual({
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", minLength: 1 },
            version: { type: "string" },
          },
          required: ["name", "version"],
        },
      });
    });

    it("keeps the merged subschema's own description over its branches'", () => {
      expect(
        inner({
          description: "What the page is called.",
          allOf: [
            { type: "string", description: "A title." },
            { type: "string", minLength: 1, description: "Non-empty." },
          ],
        }),
      ).toEqual({ type: "string", minLength: 1, description: "What the page is called." });
    });
  });

  describe("rule 3: anyOf and oneOf", () => {
    it("keeps each branch, projected", () => {
      expect(
        inner({ anyOf: [{ type: "string", format: "uri" }, { type: "integer" }] }),
      ).toEqual({ oneOf: [{ type: "string" }, { type: "integer" }] });
      expect(inner({ oneOf: [{ type: "string" }, { type: "boolean" }] })).toEqual({
        oneOf: [{ type: "string" }, { type: "boolean" }],
      });
    });

    it("carries the keywords beside an anyOf into each branch", () => {
      expect(
        inner({ type: "string", anyOf: [{ minLength: 2 }, { const: "x" }] }),
      ).toEqual({
        oneOf: [{ type: "string", minLength: 2 }, { type: "string", const: "x" }],
      });
    });

    it("drops a branch the keywords beside it rule out", () => {
      expect(inner({ type: "string", anyOf: [{ type: "string" }, { type: "number" }] })).toEqual({
        type: "string",
      });
    });
  });

  describe("rule 4: kept and dropped keywords", () => {
    it("keeps pattern, lengths, bounds and item counts", () => {
      const kept = {
        type: "string",
        pattern: "^x",
        minLength: 1,
        maxLength: 9,
      };
      expect(inner(kept)).toEqual(kept);
      expect(inner({ type: "number", minimum: 0, maximum: 1 })).toEqual({
        type: "number",
        minimum: 0,
        maximum: 1,
      });
      expect(inner({ type: "array", minItems: 1, maxItems: 3 })).toEqual({
        type: "array",
        minItems: 1,
        maxItems: 3,
      });
    });

    it("keeps a date format and drops every other", () => {
      for (const format of ["date", "date-time", "time"]) {
        expect(inner({ type: "string", format })).toEqual({ type: "string", format });
      }
      for (const format of ["uri", "email", "uri-reference"]) {
        expect(inner({ type: "string", format })).toEqual({ type: "string" });
      }
    });

    it("keeps additionalProperties false and drops a schema-valued one", () => {
      expect(
        inner({ type: "object", properties: { a: { type: "string" } }, additionalProperties: false }),
      ).toEqual({
        type: "object",
        properties: { a: { type: "string" } },
        additionalProperties: false,
      });
      expect(inner({ type: "object", additionalProperties: { type: "string" } })).toEqual({
        type: "object",
        additionalProperties: true,
      });
    });

    it("drops if/then/else, not, and keywords outside the kept list", () => {
      expect(
        inner({
          type: "string",
          if: { minLength: 3 },
          then: { pattern: "^a" },
          else: { const: "x" },
          not: { const: "bad" },
          default: "d",
          "x-manni-location": "page",
          uniqueItems: true,
        }),
      ).toEqual({ type: "string" });
    });

    it("keeps the strictest bound when branches disagree", () => {
      expect(
        inner({
          allOf: [
            { type: "string", minLength: 1, maxLength: 80 },
            { minLength: 3, maxLength: 40 },
          ],
        }),
      ).toEqual({ type: "string", minLength: 3, maxLength: 40 });
      expect(
        inner({ allOf: [{ type: "integer", minimum: 0, maximum: 10 }, { minimum: 2, maximum: 5 }] }),
      ).toEqual({ type: "integer", minimum: 2, maximum: 5 });
      expect(
        inner({ allOf: [{ type: "array", minItems: 1, maxItems: 9 }, { minItems: 2, maxItems: 4 }] }),
      ).toEqual({ type: "array", minItems: 2, maxItems: 4 });
    });

    it("keeps one pattern, and leaves two different ones to the full check", () => {
      expect(inner({ allOf: [{ type: "string", pattern: "^a" }, { type: "string" }] })).toEqual({
        type: "string",
        pattern: "^a",
      });
      expect(
        inner({ allOf: [{ type: "string", pattern: "^a" }, { pattern: "^a" }] }),
      ).toEqual({ type: "string", pattern: "^a" });
      expect(
        inner({
          allOf: [{ type: "string", pattern: "^a" }, { pattern: "b$" }, { pattern: "^a" }],
        }),
      ).toEqual({ type: "string" });
    });
  });

  describe("rule 5: an untyped node", () => {
    it("is sent as any non-null JSON value", () => {
      expect(inner({})).toEqual({ oneOf: ANY });
      expect(inner(true)).toEqual({ oneOf: ANY });
    });

    it("keeps each keyword on the branch of the type it constrains", () => {
      expect(
        inner({
          description: "One id, or a list of them.",
          pattern: "^\\S+$",
          items: { pattern: "^\\S+$" },
          minItems: 1,
          required: ["name"],
        }),
      ).toEqual({
        description: "One id, or a list of them.",
        oneOf: [
          { type: "string", pattern: "^\\S+$" },
          { type: "number" },
          { type: "boolean" },
          {
            type: "array",
            items: { oneOf: [{ type: "string", pattern: "^\\S+$" }, ...ANY.slice(1)] },
            minItems: 1,
          },
          { type: "object", required: ["name"], additionalProperties: true },
        ],
      });
    });

    it("splits a type list into one branch per type", () => {
      expect(inner({ type: ["string", "boolean"], pattern: "^2" })).toEqual({
        oneOf: [{ type: "string", pattern: "^2" }, { type: "boolean" }],
      });
    });

    it("leaves an enum node as it is, with no type added", () => {
      expect(inner({ enum: ["a", 1] })).toEqual({ enum: ["a", 1] });
    });
  });

  describe("rule 6: no value can pass", () => {
    it("reports branches whose types have no common member", () => {
      expect(projectValue({ allOf: [{ type: "string" }, { type: "number" }] }, noDefs)).toEqual({
        unsatisfiable: true,
      });
    });

    it("reports an anyOf or oneOf whose every branch the keywords beside it rule out", () => {
      for (const kind of ["anyOf", "oneOf"] as const) {
        expect(
          projectValue(
            { [kind]: [{ type: "string" }, { type: "number" }], allOf: [{ type: "boolean" }] },
            noDefs,
          ),
        ).toEqual({ unsatisfiable: true });
      }
    });

    it("reports an enum none of whose values has the declared type", () => {
      expect(projectValue({ allOf: [{ type: "string" }, { enum: [1, 2] }] }, noDefs)).toEqual({
        unsatisfiable: true,
      });
    });

    it("reports a false branch, and its object form", () => {
      expect(projectValue({ allOf: [false, { type: "string" }] }, noDefs)).toEqual({
        unsatisfiable: true,
      });
      expect(projectValue({ allOf: [{ not: {} }, { type: "string" }] }, noDefs)).toEqual({
        unsatisfiable: true,
      });
    });

    it("reports a required property nothing can satisfy", () => {
      expect(
        projectValue(
          {
            type: "object",
            required: ["a"],
            properties: { a: { allOf: [{ type: "string" }, { type: "boolean" }] } },
          },
          noDefs,
        ),
      ).toEqual({ unsatisfiable: true });
    });
  });

  describe("alternatives", () => {
    it("are written oneOf, which node-llama-cpp reads, and never anyOf", () => {
      const sent = JSON.stringify(
        projectValue({ anyOf: [{ type: "string" }, { type: "object" }] }, noDefs),
      );
      expect(sent).not.toContain("anyOf");
      expect(sent).toContain("oneOf");
    });
  });

  describe("rule 7: the null wrapper", () => {
    it("lets the model decline under a grammar that requires every key", () => {
      expect(projectValue({ type: "string" }, noDefs)).toEqual({
        schema: { oneOf: [{ type: "string" }, { type: "null" }] },
      });
    });
  });
});
