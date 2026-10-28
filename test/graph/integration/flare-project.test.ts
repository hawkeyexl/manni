/**
 * Proposal 0125, part 2, through the real CLI: a Flare project with one
 * target. A link target naming a variable and a `/Content/` link resolve in
 * the project, the project's `xml:lang` labels a topic that sets none, and a
 * topic's passages carry its resolved text over its source lines.
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
const fixture = join(root, "test", "graph", "fixtures", "flare-project");
const BASE = "https://example.com/flare-project/doc/";
const INSTALL = `${BASE}Content/Topics/Install.htm`;

function graph(args: string[], cwd: string) {
  return spawnSync(process.execPath, [cli, "graph", ...args], {
    encoding: "utf8",
    cwd,
    env: hermeticEnv(),
  });
}

let corpus: string;
let store: Store;

beforeAll(() => {
  // A copy outside any repository, so no git history reaches the output.
  corpus = mkdtempSync(join(tmpdir(), "manni-graph-flare-project-"));
  cpSync(fixture, corpus, { recursive: true });
  const r = graph(["build"], corpus);
  expect(r.status, r.stderr).toBe(0);
  store = new Store(new Parser({ format: "text/turtle" }).parse(readFileSync(join(corpus, "graph.ttl"), "utf8")));
});

const objects = (subject: string, predicate: string): string[] =>
  store
    .getQuads(DataFactory.namedNode(subject), DataFactory.namedNode(predicate), null, null)
    .map((q) => q.object.value)
    .sort();

describe("graph build over a Flare project", () => {
  it("references the files a variable target and a /Content/ link resolve to", () => {
    expect(objects(INSTALL, `${NS.dcterms}references`)).toEqual([
      `${BASE}Content/Resources/Snippets/Note.flsnp`,
      `${BASE}Content/Topics/Setup.htm`,
    ]);
  });

  it("reports the ones that resolve to no file as broken, exit 1", () => {
    const r = graph(["stats", "--check", "-g", "graph.ttl"], corpus);
    expect(r.status, r.stderr).toBe(1);
    expect(r.stdout).toContain("Content/Topics/Install.htm -> Gone.htm");
    expect(r.stdout).toContain("Content/Topics/Install.htm -> /Content/Missing.htm");
    expect(r.stdout).not.toContain("[%=");
  });

  it("labels a topic with the project's language, and a page's own wins", () => {
    expect(objects(INSTALL, `${NS.dcterms}language`)).toEqual(["en-US"]);
    expect(objects(`${BASE}Content/Topics/Setup.htm`, `${NS.dcterms}language`)).toEqual(["de"]);
  });

  it("passes the bundled shapes", () => {
    const r = graph(["check", "-g", "graph.ttl"], corpus);
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });
});

describe("graph export chunks over a Flare project", () => {
  it("gives a topic's passages its resolved text, spanning its source lines", () => {
    const r = graph(["export", "chunks", "-g", "graph.ttl", "-o", "chunks"], corpus);
    expect(r.status, r.stderr).toBe(0);
    const rows = readFileSync(join(corpus, "chunks", "chunks.en-US.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { id: string; lines: string; text: string });
    const row = (id: string) => rows.find((r) => r.id === id);
    for (const r of rows) {
      expect(r.text).not.toContain("MadCap:variable");
      expect(r.text).not.toContain("<");
    }
    // The variable's value and the snippet's text, in the topic's passage.
    expect(row(INSTALL)).toMatchObject({ lines: "1-13" });
    expect(row(INSTALL)?.text).toContain("Install Widget today.");
    expect(row(INSTALL)?.text).toContain("Back up Widget first.");
    // A section widens over the one nested in it, its text with it.
    expect(row(`${INSTALL}#installing`)).toMatchObject({ lines: "5-11" });
    expect(row(`${INSTALL}#installing`)?.text).toMatch(/^Installing\n\nInstall Widget today\.\n\nBack up Widget first\.\n\nLinks\n\n/);
    expect(row(`${INSTALL}#links`)).toEqual(
      expect.objectContaining({ lines: "8-11", text: "Links\n\nRead the setup and the old page.\n\nSkip this and that.\n\nFrom the root: setup, missing." }),
    );
  });
});
