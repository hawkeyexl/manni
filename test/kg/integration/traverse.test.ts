import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Parser, Store } from "n3";
import { describe, expect, it } from "vitest";
import { GraphIndex } from "../../../src/kg/runtime/graph.js";
import { traverse } from "../../../src/kg/runtime/traverse.js";
import { storeToQuads } from "../../../src/kg/core/load.js";
import { NS } from "../../../src/kg/core/vocab.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const cli = join(root, "dist", "cli.js");
const corpus = join(root, "test", "kg", "fixtures", "corpus");
const goldenDir = join(root, "test", "kg", "fixtures", "golden");
const traverseGolden = join(goldenDir, "traverse.json");

const CONFIG_DOC = "https://example.com/kg/doc/docs/configuration.md";
const REFERENCES = `${NS.dcterms}references`;
const HAS_PART = `${NS.dcterms}hasPart`;

function run(args: string[], cwd: string): { stdout: string; status: number } {
  try {
    const stdout = execFileSync(process.execPath, [cli, "kg", ...args], {
      encoding: "utf8",
      cwd,
    });
    return { stdout, status: 0 };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: (err.stdout ?? "") + (err.stderr ?? ""),
      status: err.status ?? -1,
    };
  }
}

function buildGraph(): string {
  const dir = mkdtempSync(join(tmpdir(), "dockg-traverse-"));
  const graph = join(dir, "graph.ttl");
  execFileSync(process.execPath, [cli, "kg", "build", "--out", graph], {
    encoding: "utf8",
    cwd: corpus,
  });
  return graph;
}

describe("manni kg traverse (integration)", () => {
  it("matches the traverse golden, trace included", () => {
    const graph = buildGraph();
    const { stdout, status } = run(
      [
        "traverse",
        CONFIG_DOC,
        "-g",
        graph,
        "-d",
        "2",
        "--predicates",
        "dcterms:references",
        "dcterms:hasPart",
        "--variant",
        "SP-X100",
        "-f",
        "json",
      ],
      corpus,
    );
    expect(status).toBe(0);
    expect(stdout).toBe(readFileSync(traverseGolden, "utf8"));
  });

  it("explains a scope exclusion in pretty output", () => {
    const graph = buildGraph();
    const { stdout } = run(
      [
        "traverse",
        "https://example.com/kg/doc/docs/windows-notes.md",
        "-g",
        graph,
        "-d",
        "2",
        "--variant",
        "SP-X300",
        "--predicates",
        "dcterms:references",
      ],
      corpus,
    );
    // configuration.md declares not-applicable-to: [SP-X300], so it is dropped
    // and the reason is reported, not silently omitted.
    expect(stdout).toContain("excluded by scope:");
    expect(stdout).toContain("dockg:notApplicableToVariant");
    expect(stdout).toContain("1 node, 1 hop, 1 excluded");
  });

  it("follows inbound edges with --reverse, and outbound without it", () => {
    const graph = buildGraph();
    const args = (extra: string[]) => [
      "traverse",
      CONFIG_DOC,
      "-g",
      graph,
      "--predicates",
      "dcterms:references",
      "-f",
      "json",
      ...extra,
    ];
    const iris = (out: string) =>
      (JSON.parse(out) as { nodes: Array<{ iri: string }> }).nodes.map(
        (n) => n.iri,
      );

    // Inbound: who references configuration.md.
    const reverse = iris(run(args(["--reverse"]), corpus).stdout);
    expect(reverse).toContain(
      "https://example.com/kg/doc/docs/windows-notes.md",
    );
    expect(reverse).not.toContain(
      "https://example.com/kg/doc/docs/getting-started.md#install",
    );

    // Outbound (the off state): what configuration.md references.
    const forward = iris(run(args([]), corpus).stdout);
    expect(forward).toContain(
      "https://example.com/kg/doc/docs/getting-started.md#install",
    );
    expect(forward).not.toContain(
      "https://example.com/kg/doc/docs/windows-notes.md",
    );
  });

  it("reports transitive inbound reach with --impact", () => {
    const graph = buildGraph();
    const { stdout, status } = run(
      [
        "traverse",
        CONFIG_DOC,
        "-g",
        graph,
        "--impact",
        "-d",
        "2",
        "-f",
        "json",
      ],
      corpus,
    );
    expect(status).toBe(0);
    const report = JSON.parse(stdout) as { nodes: Array<{ iri: string }> };
    const iris = report.nodes.map((n) => n.iri);
    // windows-notes.md and getting-started.md both link to configuration.md.
    expect(iris).toContain("https://example.com/kg/doc/docs/windows-notes.md");
    expect(iris).not.toContain(CONFIG_DOC);
  });

  it("exits 2 for an unknown node and an unknown variant", () => {
    const graph = buildGraph();
    const missing = run(
      ["traverse", "https://example.com/kg/doc/nope.md", "-g", graph],
      corpus,
    );
    expect(missing.status).toBe(2);
    expect(missing.stdout.toLowerCase()).toContain("node not found");

    const badVariant = run(
      ["traverse", CONFIG_DOC, "-g", graph, "--variant", "SP-NOPE"],
      corpus,
    );
    expect(badVariant.status).toBe(2);
    expect(badVariant.stdout.toLowerCase()).toContain(
      "unknown product variant",
    );
  });

  it("exits 2 for an unknown subject rather than ignoring the filter", () => {
    const graph = buildGraph();
    // An unresolvable subject silently disables scope filtering in the walker,
    // which would return exactly the nodes the filter was meant to exclude.
    const bad = run(
      ["traverse", CONFIG_DOC, "-g", graph, "--subject", "not-a-subject"],
      corpus,
    );
    expect(bad.status).toBe(2);
    expect(bad.stdout.toLowerCase()).toContain("unknown software subject");

    const good = run(
      ["traverse", CONFIG_DOC, "-g", graph, "--subject", "architecture"],
      corpus,
    );
    expect(good.status).toBe(0);
  });

  it("is deterministic across two runs", () => {
    const graph = buildGraph();
    const args = ["traverse", CONFIG_DOC, "-g", graph, "-d", "3", "-f", "json"];
    expect(run(args, corpus).stdout).toBe(run(args, corpus).stdout);
  });
});

describe("JSON-LD ⇄ Turtle equivalence gate", () => {
  /**
   * The browser builds a GraphIndex from graph.jsonld; the CLI builds one from
   * graph.ttl. Retrieval must not depend on which artifact was loaded.
   */
  const fromJsonLd = (): GraphIndex =>
    GraphIndex.fromJsonLd(
      readFileSync(join(goldenDir, "graph.jsonld"), "utf8"),
    );
  const fromTurtle = (): GraphIndex =>
    GraphIndex.fromQuads(
      storeToQuads(
        new Store(
          new Parser().parse(
            readFileSync(join(goldenDir, "graph.ttl"), "utf8"),
          ),
        ),
      ),
    );

  it("indexes the same node set from either artifact", () => {
    expect(fromJsonLd().ids()).toEqual(fromTurtle().ids());
  });

  it("yields identical traversals from either artifact", () => {
    const options = {
      seeds: [CONFIG_DOC],
      depth: 3,
      predicates: [REFERENCES, HAS_PART],
    };
    const a = traverse(fromJsonLd(), options);
    const b = traverse(fromTurtle(), options);
    expect(b.nodes).toEqual(a.nodes);
    expect(b.trace.hops).toEqual(a.trace.hops);
  });

  it("applies scope rules identically from either artifact", () => {
    const options = {
      seeds: [CONFIG_DOC],
      depth: 3,
      predicates: [REFERENCES, HAS_PART],
      variant: "SP-X100",
    };
    const a = traverse(fromJsonLd(), options);
    const b = traverse(fromTurtle(), options);
    expect(b.nodes).toEqual(a.nodes);
    expect(b.trace.exclusions).toEqual(a.trace.exclusions);
    expect(a.trace.exclusions.length).toBeGreaterThan(0);
  });
});

/**
 * Localization at the CLI (ADR 01037). The two halves that matter to a
 * localization owner: reaching a page's translations when it changes, and not
 * reaching the ones in the wrong language.
 */
describe("manni kg traverse --lang", () => {
  const EN = "https://example.com/kg/doc/docs/getting-started.md";

  it("reaches every translation of a changed source", () => {
    // The governance job: impact analysis across the translation edge. Without
    // the materialized inverse this returns nothing at all.
    const graph = buildGraph();
    const { stdout, status } = run(
      [
        "traverse",
        EN,
        "-g",
        graph,
        "--impact",
        "--predicates",
        "schema:translationOfWork",
      ],
      corpus,
    );
    expect(status).toBe(0);
    expect(stdout).toContain("docs/de/getting-started.md");
    expect(stdout).toContain("docs/fr/getting-started.md");
  });

  it("excludes a translation in another language, and says so", () => {
    const graph = buildGraph();
    const { stdout, status } = run(
      [
        "traverse",
        EN,
        "-g",
        graph,
        "--impact",
        "--predicates",
        "schema:translationOfWork",
        "--lang",
        "fr",
      ],
      corpus,
    );
    expect(status).toBe(0);
    expect(stdout).toContain("docs/fr/getting-started.md");
    expect(stdout).toContain("excluded by scope:");
    // The trace names the firing rule, not just the fact of exclusion.
    expect(stdout).toMatch(
      /docs\/de\/getting-started\.md — dcterms:language fr/,
    );
  });

  it("keeps nodes that declare no language at all", () => {
    // Unscoped content applies broadly, the same rule variants follow — so a
    // language filter must not silently empty a corpus that has not adopted it.
    const graph = buildGraph();
    const { stdout } = run(
      ["traverse", EN, "-g", graph, "-d", "1", "--lang", "de"],
      corpus,
    );
    expect(stdout).toContain("docs/configuration.md");
  });
});
