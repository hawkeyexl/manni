/**
 * `manni graph shapes` and `manni graph shapes show`, through the built bin
 * (proposal 0089): the plan's ladder, from the bare listing to every option at
 * once, then each usage error with its exact stderr and exit 2.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { bundledShapesPath } from "../../../src/graph/core/pkg.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const cli = join(root, "dist", "cli.js");
const fixture = join(root, "test", "graph", "fixtures", "check-guidance");
const BUNDLED = bundledShapesPath(import.meta.url);
const NODE_SHAPES = [
  "ActivityShape",
  "AssociationShape",
  "AttributionShape",
  "ConceptShape",
  "DocumentShape",
  "FilledFieldEntryShape",
  "OrganizationShape",
  "PersonShape",
  "ProductVariantShape",
  "SchemeShape",
  "SectionShape",
  "SoftwareAgentShape",
];

function run(args: string[]): { stdout: string; stderr: string; status: number | null } {
  const r = spawnSync(process.execPath, [cli, "graph", ...args], {
    encoding: "utf8",
    cwd: fixture,
  });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status };
}

interface Listed {
  name: string;
  id: string;
  source: string;
  target: string | null;
  closed: boolean;
  description: string | null;
  guide: string | null;
}

describe("manni graph shapes", () => {
  it("lists the bundled node shapes under the file's id", () => {
    const { stdout, status } = run(["shapes"]);
    expect(status).toBe(0);
    const lines = stdout.split("\n");
    expect(lines.slice(0, 2)).toEqual([
      "manni:graph-shapes:1.1.1  (bundled)",
      "  Guide: https://hawkeyexl.github.io/manni/graph/fix/",
    ]);
    expect(lines.slice(2).filter((l) => l !== "").map((l) => l.trim().split(/\s+/)[0])).toEqual(
      NODE_SHAPES,
    );
    expect(stdout).toContain(
      "  DocumentShape          graph:Document                     A page of the docset, as its frontmatter, links, headings and history describe it.",
    );
  });

  it("prints the shapes as JSON", () => {
    const { stdout, status } = run(["shapes", "-f", "json"]);
    expect(status).toBe(0);
    const { shapes } = JSON.parse(stdout) as { shapes: Listed[] };
    expect(shapes.map((s) => s.name)).toEqual(NODE_SHAPES);
    expect(shapes.find((s) => s.name === "DocumentShape")).toEqual({
      name: "DocumentShape",
      id: "manni:graph-shapes:1.1.1",
      source: "bundled",
      target: "https://hawkeyexl.github.io/manni/graph/ns#Document",
      closed: true,
      description: "A page of the docset, as its frontmatter, links, headings and history describe it.",
      guide: "https://hawkeyexl.github.io/manni/graph/fix/",
    });
  });

  it("lists the set graph.check.shapes names", () => {
    const { stdout, status } = run(["shapes", "-c", "house.config.yaml"]);
    expect(status).toBe(0);
    expect(stdout).toBe(
      [
        "house:shapes:1.0.0  (house-shapes.ttl)",
        "  Guide: https://example.com/house/guide/",
        "  DescribedShape  graph:Document  A page the house style describes.",
        "",
      ].join("\n"),
    );
  });
});

describe("manni graph shapes show", () => {
  it("prints each property, its predicate and the key that feeds it", () => {
    const { stdout, status } = run(["shapes", "show", "DocumentShape"]);
    expect(status).toBe(0);
    const lines = stdout.split("\n");
    expect(lines.slice(0, 4)).toEqual([
      "DocumentShape  manni:graph-shapes:1.1.1  graph:Document, closed",
      "  A page of the docset, as its frontmatter, links, headings and history describe it.",
      "  Guide: https://hawkeyexl.github.io/manni/graph/fix/",
      "",
    ]);
    const at = lines.findIndex((l) => l.trim().startsWith("Document-language "));
    expect(lines[at]?.trim().split(/\s{2,}/)).toEqual([
      "Document-language",
      "dcterms:language",
      "lang · optional",
    ]);
    expect(lines[at + 1]).toBe(
      "     The language the page is written in. Search, filters and per-language indexes group pages by it.",
    );
    // A warning-level property says so; an error-level one says nothing.
    expect(stdout).toMatch(/Document-subject +dcterms:subject +concepts · optional, repeats, warning/);
  });

  it("writes a frontmatter skeleton with -f markdown", () => {
    const { stdout, status } = run(["shapes", "show", "DocumentShape", "-f", "markdown"]);
    expect(status).toBe(0);
    const lines = stdout.trimEnd().split("\n");
    expect(lines[0]).toBe("---");
    expect(lines.at(-1)).toBe("---");
    expect(lines.slice(1, 3)).toEqual([
      "# DocumentShape, manni:graph-shapes:1.1.1",
      "# Guide: https://hawkeyexl.github.io/manni/graph/fix/",
    ]);
    expect(stdout).toContain(
      "# The language the page is written in. Search, filters and per-language indexes group pages by it.\n# lang:\n",
    );
    expect(stdout).toContain("# graph:\n");
    expect(stdout).toContain("  # The product variants the page applies to.\n  # applies-to: []\n");
  });

  it("takes every option at once", () => {
    const { stdout, status } = run([
      "shapes",
      "show",
      "DocumentShape",
      "-c",
      "manni.config.yaml",
      "--shapes",
      BUNDLED,
      "--shapes",
      "house-shapes.ttl",
      "-f",
      "json",
    ]);
    expect(status).toBe(0);
    const { shapes } = JSON.parse(stdout) as {
      shapes: Array<Listed & { properties: Array<{ rule: string | null; key: string | null; severity: string }> }>;
    };
    expect(shapes.map((s) => [s.name, s.id])).toEqual([["DocumentShape", "manni:graph-shapes:1.1.1"]]);
    expect(shapes[0]?.properties.find((p) => p.rule === "Document-language")).toEqual({
      rule: "Document-language",
      path: "http://purl.org/dc/terms/language",
      key: "lang",
      min: 0,
      max: 1,
      severity: "error",
      description:
        "The language the page is written in. Search, filters and per-language indexes group pages by it.",
    });
  });

  it("names the file a house shape comes from", () => {
    const { stdout, status } = run([
      "shapes",
      "show",
      "DescribedShape",
      "--shapes",
      "house-shapes.ttl",
      "-f",
      "markdown",
    ]);
    expect(status).toBe(0);
    expect(stdout).toBe(
      [
        "---",
        "# DescribedShape, house:shapes:1.0.0",
        "# Guide: https://example.com/house/guide/",
        "# Every page carries a one-sentence description.",
        "description:",
        "---",
        "",
      ].join("\n"),
    );
  });
});

describe("manni graph shapes usage errors", () => {
  it.each([
    [["shapes", "show"], "error: missing required argument 'shape'"],
    [
      ["shapes", "show", "Document"],
      `manni: Unknown shape "Document". Available: ${NODE_SHAPES.join(", ")}.`,
    ],
    [
      ["shapes", "show", "ActivityShape", "-f", "markdown"],
      "manni: ActivityShape has no frontmatter keys. manni writes every value it checks.",
    ],
    [
      ["shapes", "show", "Document", "--shapes", "no-node-shapes.ttl"],
      'manni: Unknown shape "Document". The shapes in effect define no node shapes.',
    ],
    [["shapes", "-f", "markdown"], 'manni: Unknown --format "markdown". Use pretty | json.'],
    [
      ["shapes", "show", "DocumentShape", "-f", "xml"],
      'manni: Unknown --format "xml". Use pretty | json | markdown.',
    ],
    [
      ["shapes", "--shapes", "nope.ttl"],
      `manni: Shapes file not found: ${join(fixture, "nope.ttl")}. Fix the path in --shapes or graph.check.shapes. Leave both unset to use the bundled shapes.`,
    ],
  ])("%j exits 2", (args, line) => {
    const { stderr, status, stdout } = run(args);
    expect(status).toBe(2);
    expect(stdout).toBe("");
    expect(stderr.split("\n")[0]).toBe(line);
  });
});
