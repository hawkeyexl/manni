/**
 * Shapes 1.3.0 (proposal 0110, D3): the strategy records' nodes and edges
 * pass, and the shapes stay a MINOR of 1.2.0, judging every graph without a
 * record exactly as 1.2.0 does.
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildGraph } from "../../../src/graph/commands/build.js";
import { parseGraph } from "../../../src/graph/core/load.js";
import { bundledShapesPath } from "../../../src/graph/core/pkg.js";
import { validateGraph } from "../../../src/graph/core/shacl.js";

const root = join(import.meta.dirname, "..", "..", "..");
const fixtures = join(root, "test", "graph", "fixtures");
const SHAPES = bundledShapesPath(import.meta.url);
const PRIOR = join(root, "shapes", "graph", "shapes-1.2.0.ttl");

const judged = async (turtle: string, shapes: string): Promise<string[]> =>
  [
    ...new Set(
      (await validateGraph(parseGraph(turtle, "the built graph"), [shapes])).map((f) =>
        JSON.stringify([f.severity, f.focusNode, f.path ?? null]),
      ),
    ),
  ].sort();

describe("bundled shapes and the strategy records", () => {
  it("passes a graph with every kind of record and edge in it", async () => {
    const { turtle, strategyRecords } = await buildGraph({ cwd: join(fixtures, "strategy") });
    expect(strategyRecords).toBeGreaterThan(0);
    expect(await judged(turtle, SHAPES)).toEqual([]);
  });

  it("fails the same graph under 1.2.0, whose shapes are closed to it", async () => {
    const { turtle } = await buildGraph({ cwd: join(fixtures, "strategy") });
    expect((await judged(turtle, PRIOR)).length).toBeGreaterThan(0);
  });

  it("admits the additional topic that 1.3.0 rejected", async () => {
    const { turtle } = await buildGraph({ cwd: join(fixtures, "strategy") });
    const prior = join(root, "shapes", "graph", "shapes-1.3.0.ttl");
    expect(await judged(turtle, SHAPES)).toEqual([]);
    expect((await judged(turtle, prior)).length).toBeGreaterThan(0);
  });

  it.each(['"not an IRI"', '<urn:untyped>'])("rejects an invalid additional topic: %s", async (target) => {
    const { turtle } = await buildGraph({ cwd: join(fixtures, "strategy") });
    const invalid = `${turtle}\n<https://example.com/graph/doc/strategy/journeys/labelled.md> <http://xmlns.com/foaf/0.1/topic> ${target} .`;
    expect((await judged(invalid, SHAPES)).length).toBeGreaterThan(0);
  });

  it.each(["corpus", "check-violations", "check-guidance", "curated-fields", "statements"])(
    "judges %s exactly as 1.2.0 does",
    async (corpus) => {
      const { turtle } = await buildGraph({ cwd: join(fixtures, corpus) });
      expect(await judged(turtle, SHAPES)).toEqual(await judged(turtle, PRIOR));
    },
  );
});
