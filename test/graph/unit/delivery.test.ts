/**
 * The delivery rule (proposal 0090, decision 12): a field reaches agent-facing
 * output unless its schema marks it `x-manni-graph-output: false` or
 * `x-manni-location: external`. Unlike the graph build's filter, the marks
 * are read at every depth.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Validator } from "../../../src/meta/core/validator.js";
import { DEFAULT_SCHEMAS } from "../../../src/meta/core/resolve-schema.js";
import { deliveredFields } from "../../../src/graph/core/graph-output.js";

const here = dirname(fileURLToPath(import.meta.url));
const NESTED = join(here, "..", "..", "fixtures", "delivery", "nested.schema.json");
const OVERRIDE = join(here, "..", "..", "fixtures", "delivery", "override.schema.json");

describe("deliveredFields", () => {
  it("drops top-level and nested fields marked graph-output false or external", async () => {
    const data = {
      title: "t",
      owner: "o",
      authors: ["a"],
      items: [{ question: "q", answers: [{ lines: 3 }], note: "n" }, { question: "r" }],
    };
    expect(await deliveredFields(data, [NESTED], new Validator())).toEqual({
      title: "t",
      items: [{ question: "q", note: "n" }, { question: "r" }],
    });
    // The input is never mutated.
    expect(data.items[0]).toHaveProperty("answers");
  });

  it("lets a later schema's mark win", async () => {
    const data = { title: "t", owner: "o" };
    expect(await deliveredFields(data, [NESTED, OVERRIDE], new Validator())).toEqual(data);
  });

  it("returns the data itself when nothing is marked", async () => {
    const data = { title: "t" };
    expect(await deliveredFields(data, [NESTED], new Validator())).toBe(data);
  });

  it("keeps the question and drops the answer pins under the default set", async () => {
    const data = {
      title: "t",
      "sample-questions": [
        "How?",
        { question: "Why?", answers: [{ lines: "3-4", integrity: `sha256-${"a".repeat(64)}` }], reviewed: true },
      ],
    };
    expect(await deliveredFields(data, [...DEFAULT_SCHEMAS], new Validator())).toEqual({
      title: "t",
      "sample-questions": ["How?", { question: "Why?", reviewed: true }],
    });
  });

  // The built-in vocabularies, as marked today (proposal 0090 § 7), under the
  // default set. One value per field the vocabularies define.
  it("delivers exactly the fields the built-in vocabularies leave unmarked", async () => {
    const page: Record<string, unknown> = {
      title: "t",
      description: "d",
      id: "page-id",
      type: "how-to",
      keywords: ["k"],
      language: "en",
      locale: "en-US",
      "last-updated": "2026-10-01",
      "last-verified": "2026-10-02",
      "verified-by": [{ tool: "doc-detective", check: "c", passed: "2026-10-02" }],
      authors: ["a"],
      owner: "o",
      stakeholders: ["s"],
      "reviewed-by": ["r"],
      created: "2025-01-01",
      "last-reviewed": "2026-01-01",
      audiences: ["developers"],
      intent: "do",
      personas: ["p"],
      lifecycle: "current",
      "replaced-by": "x",
      supersedes: ["y"],
      "applies-to": ["linux"],
      concepts: ["c"],
      prerequisites: ["a"],
      "next-steps": ["b"],
      "related-pages": ["c"],
      risks: ["read-only"],
      "sample-questions": ["How?"],
      provenance: [{ "generated-by": "m", lines: 1, integrity: `sha256-${"b".repeat(64)}` }],
      "meta-provenance": [{ "generated-by": "m", fields: ["/title"] }],
      evals: [{ name: "e", type: "assertion", assert: "true" }],
      citations: [{ source: { file: "a.ts", integrity: `sha256-${"c".repeat(64)}` } }],
      graph: { label: "l" },
    };
    const delivered = await deliveredFields(page, [...DEFAULT_SCHEMAS], new Validator());
    const keys = Object.keys(delivered).sort();
    // Kept out: every field a vocabulary marks false or external.
    for (const kept of [
      "authors",
      "owner",
      "stakeholders",
      "reviewed-by",
      "created",
      "last-reviewed",
      "provenance",
      "meta-provenance",
      "evals",
      "citations",
    ]) {
      expect(keys, kept).not.toContain(kept);
    }
    for (const reached of [
      "title",
      "description",
      "last-updated",
      "last-verified",
      "audiences",
      "lifecycle",
      "applies-to",
      "concepts",
      "risks",
      "sample-questions",
      "graph",
    ]) {
      expect(keys, reached).toContain(reached);
    }
  });
});
