import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { runTraverse } from "../../../src/graph/commands/traverse.js";
import { GraphError } from "../../../src/graph/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const graph = join(here, "..", "fixtures", "traverse-scope", "graph.ttl");
const A = "https://ex.com/graph/doc/a.md";
const B = "https://ex.com/graph/doc/b.md";
const DOCUMENT = "https://hawkeyexl.github.io/manni/graph/ns#Document";

const run = (extra: Partial<Parameters<typeof runTraverse>[0]> = {}) =>
  runTraverse({ graph, noConfig: true, node: A, ...extra });

describe("runTraverse --predicates", () => {
  it("follows rdf:type when the predicate list names it", () => {
    const report = run({ predicates: ["rdf:type"] });
    expect(report.nodes.map((n) => n.iri)).toContain(DOCUMENT);
  });

  it("refuses a predicate no edge in the graph uses", () => {
    const go = () => run({ predicates: ["dcterms:refrences"] });
    expect(go).toThrow(GraphError);
    expect(go).toThrow(
      "Unknown predicate: dcterms:refrences. No edge in the graph uses it.",
    );
  });

  it("accepts a predicate the graph uses", () => {
    const report = run({ predicates: ["dcterms:references"] });
    expect(report.nodes.map((n) => n.iri)).toEqual([A, B]);
  });
});

describe("runTraverse --lang", () => {
  it("matches a tag whatever its case, since BCP-47 tags are case-insensitive", () => {
    const report = run({ predicates: ["dcterms:references"], lang: "en-us" });
    expect(report.nodes.map((n) => n.iri)).toEqual([A, B]);
    expect(report.trace.exclusions).toEqual([]);
  });
});
