/**
 * Shapes 1.1.1 is a PATCH of 1.1.0 (proposal 0089, decision D5). PATCH means
 * no change in validation behavior (src/graph/CLAUDE.md), so both files must
 * judge the same (severity, focus node, path) set over every corpus here. The
 * words a finding carries may change, and nothing else.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildGraph } from "../../../src/graph/commands/build.js";
import { parseGraph } from "../../../src/graph/core/load.js";
import { bundledShapesPath } from "../../../src/graph/core/pkg.js";
import { validateGraph } from "../../../src/graph/core/shacl.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const shapesDir = dirname(bundledShapesPath(import.meta.url));
const PATCH = join(shapesDir, "shapes-1.1.1.ttl");
const PRIOR = join(shapesDir, "shapes-1.1.0.ttl");

/** What a file decides about a graph, without the words it says it in. */
async function judged(turtle: string, shapes: string): Promise<string[]> {
  const findings = await validateGraph(parseGraph(turtle, "the built graph"), [shapes]);
  return [
    ...new Set(findings.map((f) => JSON.stringify([f.severity, f.focusNode, f.path ?? null]))),
  ].sort();
}

describe("shapes 1.1.1 is a PATCH of 1.1.0", () => {
  it.each(["corpus", "check-violations", "check-guidance", "curated-fields"])(
    "judges %s exactly as 1.1.0 does",
    async (corpus) => {
      const { turtle } = await buildGraph({ cwd: join(fixtures, corpus) });
      const prior = await judged(turtle, PRIOR);
      expect(await judged(turtle, PATCH)).toEqual(prior);
    },
  );

  it("is not vacuous: the violating corpora fail under both", async () => {
    for (const corpus of ["check-violations", "check-guidance", "curated-fields"]) {
      const { turtle } = await buildGraph({ cwd: join(fixtures, corpus) });
      expect(await judged(turtle, PATCH), corpus).not.toEqual([]);
    }
  });

  it("changes no constraint, only the words around them", () => {
    // Every line that is not a comment, a prefix, the header, or an
    // sh:name, sh:description or sh:message is carried over as it was.
    const constraints = (path: string): string[] =>
      readFileSync(path, "utf8")
        .split("\n")
        .filter((l) => l.trim() !== "" && !l.startsWith("#") && !l.startsWith("@prefix"))
        .filter((l) => !/^ {2}sh:(name|description|message) /.test(l))
        .map((l) => l.replace(/ \.$/, " ;"));
    const prior = constraints(PRIOR).filter((l) => !l.includes("settle on one spelling"));
    const patch = constraints(PATCH);
    const header = patch.findIndex((l) => l.includes("a owl:Ontology"));
    expect(header).toBeGreaterThan(-1);
    // The ontology node: its subject line and the lines under it.
    const body = patch.filter((_, i) => i < header - 1 || i > header + 5);
    expect(body).toEqual(prior);
  });
});
