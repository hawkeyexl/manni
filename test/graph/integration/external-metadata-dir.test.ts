/**
 * `graph fill` on an `{id}` manifest (proposal 0126), over copies of
 * `test/graph/fixtures/external-metadata-dir`, whose collection keeps each
 * page's `graph` block and `meta-provenance` in `meta/<id>.yaml`.
 *
 * A page carrying an id gets both written to its file. A page with none is
 * minted one, and the block it carried moves into the new file with the
 * fill. A Docusaurus page, whose `id` is the doc id, keeps both and says why.
 */
import { cpSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockProvider } from "@hawkeyexl/inference";
import { runFill } from "../../../src/graph/commands/fill.js";
import { resetWarnings } from "../../../src/shared/warn.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, "..", "fixtures", "external-metadata-dir");

function copy(): string {
  const dir = mkdtempSync(join(tmpdir(), "manni-graph-id-dir-"));
  cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

const read = (dir: string, rel: string): string => readFileSync(join(dir, rel), "utf8");
const entry = (dir: string, rel: string, id: string): Record<string, unknown> =>
  ((parse(read(dir, rel)) ?? {}) as Record<string, Record<string, unknown>>)[id] ?? {};

const PROPOSAL = {
  label: "Query Syntax",
  "alt-labels": ["query language"],
  "related-concepts": ["Search Operators"],
  concepts: ["search"],
  confidence: { label: 0.95, "alt-labels": 0.9, "related-concepts": 0.85, concepts: 0.9 },
};
const fill = (dir: string, path: string) =>
  runFill({ cwd: dir, paths: [path], providerInstance: new MockProvider([{ json: PROPOSAL }], "mock-model"), noCache: true });

let stderr: string[];
beforeEach(() => {
  resetWarnings();
  stderr = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
    stderr.push(String(chunk));
    return true;
  });
  return () => {
    vi.restoreAllMocks();
  };
});

describe("graph fill on an {id} manifest", () => {
  it("writes the block and its record to the file the page's id names", async () => {
    const dir = copy();
    const report = await fill(dir, "docs/known.md");
    expect(report.results[0]).toMatchObject({ status: "filled" });
    expect(read(dir, "docs/known.md")).toBe(read(FIXTURE, "docs/known.md"));
    const held = entry(dir, "meta/known.yaml", "known");
    expect(held["graph"]).toMatchObject({ label: "Query Syntax", concepts: ["search"] });
    expect(held["meta-provenance"]).toEqual([expect.objectContaining({ "generated-by": "mock-model" })]);
    expect(stderr.filter((l) => l.includes("minted"))).toEqual([]);
  });

  it("mints an id into a page with none, and moves its block with the new one", async () => {
    const dir = copy();
    const report = await fill(dir, "docs/fresh.md");
    expect(report.results[0]).toMatchObject({ status: "filled" });
    expect(read(dir, "docs/fresh.md")).toBe(
      "---\ntitle: Search operators\nid: fresh\n---\n\n# Search operators\n\nThe operators a query accepts.\n",
    );
    const held = entry(dir, "meta/fresh.yaml", "fresh");
    expect(held["graph"]).toMatchObject({ label: "Query Syntax", concepts: ["search"] });
    expect(held["meta-provenance"]).toBeDefined();
    expect(stderr.filter((l) => l.includes("minted"))).toEqual([
      'manni: minted id "fresh" in docs/fresh.md, for meta/fresh.yaml.\n',
    ]);
  });

  it("leaves the block in the page, and says why, when no id can be minted", async () => {
    const dir = copy();
    const report = await fill(dir, "docs/docusaurus.md");
    expect(report.results[0]).toMatchObject({ status: "filled" });
    expect(read(dir, "docs/docusaurus.md")).toContain("label: Query Syntax");
    expect(existsSync(join(dir, "meta", "docusaurus.yaml"))).toBe(false);
    expect(stderr.filter((l) => l.includes("so graph stays"))).toEqual([
      "manni: docs/docusaurus.md: no id could be minted (docusaurus:docs:3.10 gives id a meaning of its own; set one by hand), so graph stays in the page.\n",
    ]);
  });
});
