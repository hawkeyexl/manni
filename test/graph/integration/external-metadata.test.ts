/**
 * graph reads a page the way `manni meta validate` does: its frontmatter plus
 * every key an external-metadata manifest of its collections owns (proposals
 * 0047, 0058 and 0068). The fixture keeps each page's bookkeeping in a
 * `{page}.meta.yaml` beside it.
 *
 * Each case runs over a copy outside this checkout, so a build or a fill never
 * writes into the fixture and git history never reaches the graph.
 */
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { MockProvider } from "@hawkeyexl/inference";
import { runBuild } from "../../../src/graph/commands/build.js";
import { runFill } from "../../../src/graph/commands/fill.js";
import { analyzeDoc } from "../../../src/graph/core/analyze.js";
import {
  openMetaView,
  withExternalMetadata,
} from "../../../src/graph/core/external.js";
import { suppressGraphOutput } from "../../../src/graph/core/graph-output.js";
import { GraphError } from "../../../src/graph/types.js";
import { runGet } from "../../../src/meta/commands/get.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, "..", "fixtures", "external-metadata");
const QUERY = "docs/query.md";
const OPERATORS = "docs/operators.md";

function copy(): string {
  const dir = mkdtempSync(join(tmpdir(), "manni-graph-external-"));
  cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

async function turtle(dir: string, opts: Parameters<typeof runBuild>[0] = {}): Promise<string> {
  const result = await runBuild({ cwd: dir, out: "out.ttl", ...opts });
  return readFileSync(result.outPath, "utf8");
}

function yamlFile(dir: string, name: string): Record<string, unknown> {
  return (parse(readFileSync(join(dir, name), "utf8")) ?? {}) as Record<string, unknown>;
}

/** The entry a manifest holds for one page. */
function entry(dir: string, manifest: string, page: string): Record<string, unknown> {
  return (yamlFile(dir, manifest)[page] ?? {}) as Record<string, unknown>;
}

const PROPOSAL = {
  label: "Query Syntax",
  "alt-labels": ["query language"],
  "related-concepts": ["Search Operators"],
  concepts: ["search"],
  confidence: {
    label: 0.95,
    "alt-labels": 0.9,
    "related-concepts": 0.85,
    concepts: 0.9,
  },
};

describe("graph build reads external metadata", () => {
  it("derives triples from the fields a page's manifest supplies", async () => {
    const ttl = await turtle(copy());
    expect(ttl).toContain('"The operators a query accepts."');
    expect(ttl).toContain("Ada Lovelace");
    expect(ttl).toContain('"2026-01-15"');
    // A graph block kept in the manifest is harvested like one on the page.
    expect(ttl).toContain('"Search Operators"');
  });

  it("filters a manifest's field by the same x-manni-graph-output mark", async () => {
    const dir = copy();
    const view = await openMetaView({}, dir, [QUERY]);
    const doc = analyzeDoc(readFileSync(join(dir, QUERY), "utf8"), QUERY, new Set([QUERY]));
    const [merged] = await withExternalMetadata([doc], view);
    expect(merged?.frontmatter).toHaveProperty("owner");
    const [out] = await suppressGraphOutput(merged === undefined ? [] : [merged], view);
    const keys = Object.keys(out?.frontmatter ?? {});
    expect(keys).toEqual(expect.arrayContaining(["title", "description", "authors"]));
    expect(keys).not.toContain("owner");
  });

  it("reads no manifest under --no-config, as meta reads none", async () => {
    const dir = copy();
    const ttl = await turtle(dir, { noConfig: true, paths: ["docs"] });
    expect(ttl).toContain('"Query syntax"');
    expect(ttl).not.toContain("The operators a query accepts.");
    // meta's own read of the same page, under the same flag, agrees.
    const [got] = await runGet({ cwd: dir, noConfig: true, inputs: [QUERY], fields: ["description"] });
    expect(got?.values["description"]).toBeUndefined();
  });

  it("supplies nothing to a page read from stdin, which belongs to no collection", async () => {
    const dir = copy();
    const ttl = await turtle(dir, {
      paths: ["-"],
      as: "markdown",
      stdinContent: readFileSync(join(dir, QUERY), "utf8"),
    });
    expect(ttl).toContain("stdin");
    expect(ttl).not.toContain("The operators a query accepts.");
  });

  it("refuses a manifest meta refuses, in meta's words", async () => {
    const dir = copy();
    writeFileSync(
      join(dir, "manni.config.yaml"),
      'collections:\n  - name: pages\n    paths: ["docs/**/*.md"]\n    externalMetadata:\n      - file: missing.yaml\n        keys: [description]\n',
    );
    const err: unknown = await runBuild({ cwd: dir, out: "out.ttl" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GraphError);
    expect((err as Error).message).toContain("missing.yaml");
  });
});

describe("graph fill writes where meta fill would", () => {
  it("counts a field only the manifest holds as filled", async () => {
    const dir = copy();
    const provider = new MockProvider([{ json: PROPOSAL }]);
    const report = await runFill({ cwd: dir, paths: [OPERATORS], providerInstance: provider });
    expect(report.results[0]).toMatchObject({ status: "complete" });
    expect(provider.requests).toHaveLength(0);
  });

  it("writes a manifest-owned graph block and meta-provenance to the manifest, not the page", async () => {
    const dir = copy();
    const before = readFileSync(join(dir, QUERY), "utf8");
    const provider = new MockProvider([{ json: PROPOSAL }], "mock-model");
    const report = await runFill({ cwd: dir, paths: [QUERY], providerInstance: provider, noCache: true });
    expect(report.results[0]).toMatchObject({ status: "filled" });
    expect(readFileSync(join(dir, QUERY), "utf8")).toBe(before);
    const held = entry(dir, "docs/query.meta.yaml", QUERY);
    expect(held["graph"]).toMatchObject({ label: "Query Syntax", concepts: ["search"] });
    expect(held["meta-provenance"]).toEqual([
      expect.objectContaining({ "generated-by": "mock-model", fields: expect.arrayContaining(["/graph/label"]) }),
    ]);
    // The manifest's other values are carried through.
    expect(held["description"]).toBe("The operators a query accepts.");
  });

  it("writes a page-located graph block to the page and meta-provenance to the manifest", async () => {
    const dir = copy();
    const provider = new MockProvider([{ json: PROPOSAL }], "mock-model");
    const report = await runFill({
      cwd: dir,
      config: "graph-on-page.config.yaml",
      paths: [QUERY],
      providerInstance: provider,
      noCache: true,
    });
    expect(report.results[0]).toMatchObject({ status: "filled" });
    const page = readFileSync(join(dir, QUERY), "utf8");
    expect(page).toContain("label: Query Syntax");
    expect(page).not.toContain("meta-provenance");
    const held = entry(dir, "docs/query.meta.yaml", QUERY);
    expect(held["graph"]).toBeUndefined();
    expect(held["meta-provenance"]).toEqual([
      expect.objectContaining({ "generated-by": "mock-model" }),
    ]);
  });

  it("writes nothing under --dry-run", async () => {
    const dir = copy();
    const page = readFileSync(join(dir, QUERY), "utf8");
    const manifest = readFileSync(join(dir, "docs/query.meta.yaml"), "utf8");
    const provider = new MockProvider([{ json: PROPOSAL }], "mock-model");
    const report = await runFill({ cwd: dir, paths: [QUERY], providerInstance: provider, dryRun: true, noCache: true });
    expect(report.results[0]).toMatchObject({ status: "proposed" });
    expect(readFileSync(join(dir, QUERY), "utf8")).toBe(page);
    expect(readFileSync(join(dir, "docs/query.meta.yaml"), "utf8")).toBe(manifest);
  });
});
