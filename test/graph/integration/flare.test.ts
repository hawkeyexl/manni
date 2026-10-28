/**
 * Proposal 0125: a MadCap Flare cross-reference and a snippet include are
 * links. Two topics and a snippet, built through the real CLI, with the gates
 * the formats corpus carries: a golden, a double build and a clean
 * `graph check`, plus the edges and the broken link the proposal exists for.
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { DataFactory, Parser, Store } from "n3";
import { NS } from "../../../src/graph/core/vocab.js";
import { hermeticEnv } from "../helpers/git-env.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const cli = join(root, "dist", "cli.js");
const fixture = join(root, "test", "graph", "fixtures", "flare");
const goldens = join(root, "test", "graph", "fixtures", "flare-golden");
const BASE = "https://example.com/flare/doc/";

function graph(args: string[], cwd: string) {
  return spawnSync(process.execPath, [cli, "graph", ...args], {
    encoding: "utf8",
    cwd,
    env: hermeticEnv(),
  });
}

function normalizeVersion(ttl: string): string {
  return ttl.replace(/graph:version "[^"]+"/g, 'graph:version "X"');
}

let corpus: string;
let ttl: string;
let store: Store;

beforeAll(() => {
  // A copy outside any repository, so no git history reaches the golden.
  corpus = mkdtempSync(join(tmpdir(), "manni-graph-flare-"));
  cpSync(fixture, corpus, { recursive: true });
  const r = graph(["build"], corpus);
  expect(r.status, r.stderr).toBe(0);
  ttl = readFileSync(join(corpus, "graph.ttl"), "utf8");
  store = new Store(new Parser({ format: "text/turtle" }).parse(ttl));
});

describe("graph build over a Flare project", () => {
  it("matches the golden output byte-for-byte (modulo tool version)", () => {
    expect(normalizeVersion(ttl)).toBe(
      normalizeVersion(readFileSync(join(goldens, "graph.ttl"), "utf8")),
    );
  });

  it("is byte-identical across two runs (determinism gate)", () => {
    const again = graph(["build", "-o", "again.ttl"], corpus);
    expect(again.status, again.stderr).toBe(0);
    expect(readFileSync(join(corpus, "again.ttl"), "utf8")).toBe(ttl);
  });

  it("derives dcterms:references from a MadCap:xref and a MadCap:snippetBlock", () => {
    const refs = store
      .getQuads(
        DataFactory.namedNode(`${BASE}Install.htm`),
        DataFactory.namedNode(`${NS.dcterms}references`),
        null,
        null,
      )
      .map((q) => q.object.value)
      .sort();
    expect(refs).toEqual([
      `${BASE}Configure.htm#options`,
      `${BASE}Snippets/BeforeYouStart.flsnp`,
    ]);
  });

  it("names the misspelled cross-reference as broken, exit 1", () => {
    const r = graph(["stats", "--check", "-g", "graph.ttl"], corpus);
    expect(r.status, r.stderr).toBe(1);
    expect(r.stdout).toContain("Install.htm -> Configur.htm");
  });

  it("passes the bundled shapes", () => {
    const r = graph(["check", "-g", "graph.ttl"], corpus);
    expect(r.status, r.stdout).toBe(0);
  });
});
