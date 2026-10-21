/**
 * Shapes 1.2.0 and vocabulary 1.3.0 (proposal 0099, decision 10d): the terms
 * inline statements and verification add, the shapes that judge them, and the
 * rule that a published version never changes.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildGraph } from "../../../src/graph/commands/build.js";
import { parseGraph } from "../../../src/graph/core/load.js";
import { bundledShapesPath } from "../../../src/graph/core/pkg.js";
import { validateGraph } from "../../../src/graph/core/shacl.js";
import { NS } from "../../../src/graph/core/vocab.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const fixture = join(root, "test", "graph", "fixtures", "statements");
const SHAPES = [bundledShapesPath(import.meta.url)];

/**
 * Every published vocabulary and shapes file, by its sha256. A published
 * file is immutable (src/graph/CLAUDE.md): a change is a new version file
 * beside it, and a new file joins this table once.
 */
const PUBLISHED: Record<string, string> = {
  "ns-1.0.0.ttl": "a94a752e715ce18667a82fad1b8a565cdaf93cf2d09d72fa145c823ca2861c44",
  "ns-1.1.0.ttl": "9aba9267bbb06c4dafba26b945d11f3885d64212b28b44c117fea2214f4ddfab",
  "ns-1.2.0.ttl": "be5ba44c4ed46c2ea05b1724625a7e0945365c80c14d4d992a4ad25b7d60bfad",
  "ns-1.3.0.ttl": "3d3726fc74bfb3ac903d4815b9c11c2b426ea1aa5cd423f750dbc6823ec493dc",
  "shapes-1.0.0.ttl": "680649bcc1085c8c7c6b83d532af39e1b0339aaa40c2cd2cd08ff6d4c78286e4",
  "shapes-1.1.0.ttl": "fb7b51f8b77f6b943b8596cfa13c8362e773ff754818850bae8340bcffdaf165",
  "shapes-1.1.1.ttl": "be13d05903490899c74b0581019a89daf1061a36b5b98b26246a690546f4079f",
  "shapes-1.2.0.ttl": "628006b1f85a94faaa80437422aa49dc946736e2e98017f8b7bd3cdcafbf96bc",
};

describe("published vocabulary and shapes files", () => {
  // Named by file alone: the directory is the name's own prefix, `ns` or `shapes`.
  it.each(Object.entries(PUBLISHED))("%s never changes", (name, hash) => {
    const bytes = readFileSync(join(root, name.slice(0, name.indexOf("-")), "graph", name));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(hash);
  });

  it("lists every version file on disk", () => {
    const onDisk = ["ns", "shapes"].flatMap((dir) => readdirSync(join(root, dir, "graph")));
    expect(onDisk.sort()).toEqual(Object.keys(PUBLISHED).sort());
  });

  it("bundles shapes 1.2.0 for graph check", () => {
    expect(SHAPES[0]).toBe(join(root, "shapes", "graph", "shapes-1.2.0.ttl"));
  });

  it("serves vocabulary 1.3.0 at the namespace IRI", () => {
    expect(readFileSync(join(root, "docs", "public", "graph", "ns.ttl"), "utf8")).toBe(
      readFileSync(join(root, "ns", "graph", "ns-1.3.0.ttl"), "utf8"),
    );
  });
});

describe("shapes 1.2.0 is a MINOR of 1.1.1", () => {
  // MINOR: a graph that used to fail may now pass, and none that passed fails.
  // A corpus with no statements is judged exactly as before.
  const prior = join(root, "shapes", "graph", "shapes-1.1.1.ttl");
  const judged = async (turtle: string, shapes: string): Promise<string[]> =>
    [
      ...new Set(
        (await validateGraph(parseGraph(turtle, "the built graph"), [shapes])).map((f) =>
          JSON.stringify([f.severity, f.focusNode, f.path ?? null]),
        ),
      ),
    ].sort();

  it.each(["corpus", "check-violations", "check-guidance", "curated-fields"])(
    "judges %s exactly as 1.1.1 does",
    async (corpus) => {
      const { turtle } = await buildGraph({ cwd: join(root, "test", "graph", "fixtures", corpus) });
      expect(await judged(turtle, SHAPES[0] ?? "")).toEqual(await judged(turtle, prior));
    },
  );
});

describe("shapes 1.2.0 over inline statements", () => {
  it("passes the statements fixture's graph", async () => {
    const { turtle } = await buildGraph({ cwd: fixture });
    expect(turtle).toContain("graph:Block");
    expect(turtle).toContain("graph:Verification");
    expect(await validateGraph(parseGraph(turtle, "the built graph"), SHAPES)).toEqual([]);
  });

  it.each([
    ["lines.ttl", "lines"],
    ["pin.ttl", "pin"],
    ["pin-status.ttl", "pinStatus"],
    ["no-tool.ttl", "tool"],
    ["passed.ttl", "passed"],
    ["last-verified.ttl", "lastVerified"],
  ])("rejects bad/%s on graph:%s", async (file, local) => {
    const turtle = readFileSync(join(fixture, "bad", file), "utf8");
    const findings = await validateGraph(parseGraph(turtle, file), SHAPES);
    expect(findings.map((f) => [f.severity, f.path])).toEqual([
      ["error", `${NS.graph}${local}`],
    ]);
  });
});
