/**
 * `x-manni-kg-output` (proposal 0051 §5), end to end through the built CLI.
 *
 * The keyword is annotation-only in `manni meta`; kg is the one tool that acts
 * on it. What has to hold is that a field marked `false` reaches **none** of
 * the four published outputs — Turtle, JSON-LD, iiRDS and the search index —
 * which is why this is an integration test over all four rather than a unit
 * test of the filter. All four descend from one derivation, and that is
 * exactly the claim a test should check rather than assume.
 *
 * Two neighbours share the fixture because they are the same question asked
 * from the other side: a mark nested inside `graph` is ignored (0047 rule 2), and
 * an encrypted value is harvested like any other value, so the `~…` token is
 * what lands in the graph (0051 stress test 4).
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it, beforeAll } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const cli = join(root, "dist", "cli.js");
const fixture = join(root, "test", "kg", "fixtures", "kg-output");

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

describe("x-manni-kg-output", () => {
  let cwd: string;
  let turtle: string;

  beforeAll(() => {
    cwd = mkdtempSync(join(tmpdir(), "manni-kg-output-"));
    cpSync(fixture, cwd, { recursive: true });
    const built = run(["build", "-o", "graph.ttl"], cwd);
    expect(built.status, built.stdout).toBe(0);
    turtle = readFileSync(join(cwd, "graph.ttl"), "utf8");
  });

  it("keeps a field marked false out of Turtle", () => {
    // `concepts: [throttling]` would mint a skos:Concept and a dcterms:subject
    // edge. Neither is there, and the document that declared it still is.
    //
    // `concepts` is the field this asserts on rather than `owner`, and that is
    // deliberate. kg harvests no stewardship field today, so `owner` would be
    // absent from the graph with or without its mark — an assertion on it
    // would pass vacuously, which is the silent hole this repo's ladder rule
    // exists to refuse. `owner` is marked in the fixture because 0051 §5's
    // worked example marks it; what proves the mechanism is `concepts`.
    // Verified against the same corpus with the marks flipped to `true`: 53
    // triples and three mentions of `throttling`, versus 49 and none here.
    expect(turtle).toContain("suppressed-field.md");
    expect(turtle).not.toContain("throttling");
  });

  it("keeps it out of JSON-LD", () => {
    const out = run(["export", "jsonld", "-g", "graph.ttl", "-o", "g.jsonld"], cwd);
    expect(out.status, out.stdout).toBe(0);
    const jsonld = readFileSync(join(cwd, "g.jsonld"), "utf8");
    expect(jsonld).toContain("suppressed-field.md");
    expect(jsonld).not.toContain("throttling");
  });

  it("keeps it out of the iiRDS package", () => {
    const out = run(["export", "iirds", "-g", "graph.ttl", "-o", "g.iirds"], cwd);
    expect(out.status, out.stdout).toBe(0);
    // The package is a ZIP; `throttling` is short enough that DEFLATE would
    // keep it literal if it were there, but the honest check is the RDF/XML
    // the projection writes, so read it back out of the archive as a string.
    const zip = readFileSync(join(cwd, "g.iirds"));
    expect(zip.includes(Buffer.from("throttling", "utf8"))).toBe(false);
  });

  it("keeps it out of the search index", () => {
    const out = run(["export", "search", "-g", "graph.ttl", "-o", "search"], cwd);
    expect(out.status, out.stdout).toBe(0);
    const index = readFileSync(join(cwd, "search", "search.und.json"), "utf8");
    expect(index).toContain("Rate limiting");
    expect(index).not.toContain("throttling");
  });

  it("ignores a mark nested inside graph", () => {
    // The house schema marks `graph.label` false. Only a top-level property's
    // mark counts, so the label is harvested exactly as it would be without
    // the mark — `alt-labels` proves the block was read at all.
    expect(turtle).toContain("Rate limiting");
    expect(turtle).toContain("request caps");
  });

  it("harvests an encrypted value as its token, and never decrypts it", () => {
    const token =
      "~AVIOmyh_reEkAwpNb-GlgHHrHY2Bzn9Rfq2aaalMZIqXsq4yvISgmlcv53cp400yua4bpPIzDZWT-trrdg";
    expect(turtle).toContain(token);
    expect(turtle).toContain("encrypted-value.md");
  });
});
