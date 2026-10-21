/**
 * `graph lookup`, `graph retrieve` and `graph traverse --context` through the
 * built CLI (proposal 0090, PR 2): what prints, on which stream, and the exit
 * code. A refusal is an answer and exits 0; a usage error exits 2.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnText } from "../../helpers/spawn.js";
import { removeTempRepo } from "../../helpers/temp-repo.js";
import { INDEX, QUESTION, ROTATE, retrieveArtifact } from "../helpers/retrieve-artifact.js";

const root = join(import.meta.dirname, "..", "..", "..");
const cli = join(root, "dist", "cli.js");

let dir: string;
beforeAll(async () => {
  dir = await retrieveArtifact();
}, 60_000);
afterAll(() => {
  removeTempRepo(dir);
});

function graph(args: string[]): { stdout: string; stderr: string; status: number } {
  const r = spawnText(spawnSync(process.execPath, [cli, "graph", ...args], { encoding: "utf8", cwd: dir }));
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status ?? -1 };
}

describe("graph lookup", () => {
  it("prints the three sections and exits 0", () => {
    const r = graph(["lookup", QUESTION]);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    const lines = r.stdout.split("\n");
    expect(lines[0]).toBe("Matches");
    expect(lines).toContain("Traversal, depth 1");
    expect(lines).toContain("Impact, depth 3");
    expect(r.stdout).toMatch(/\n3 matches, \d+ reached outward, \d+ depends? on them, in en\. Pass -f json for the text, edges and trace\.\n$/);
  });

  it("prints the lookup result with -f json", () => {
    const r = graph(["lookup", QUESTION, "-f", "json"]);
    expect(r.status).toBe(0);
    const result = JSON.parse(r.stdout) as { language: string; matches: { passages: { rank: number }[] } };
    expect(result.language).toBe("en");
    expect(result.matches.passages.map((p) => p.rank)).toEqual([1, 2, 3]);
  });

  it("refuses a missing artifact and one built from another graph, exit 2", () => {
    const missing = graph(["lookup", QUESTION, "-i", "nowhere"]);
    expect(missing.status).toBe(2);
    expect(missing.stderr).toBe("manni: nowhere/chunks.json does not exist; run manni graph publish.\n");

    copyFileSync(join(dir, INDEX, "graph.ttl"), join(dir, "other.ttl"));
    appendFileSync(join(dir, "other.ttl"), '\n<urn:x> <urn:y> "z" .\n', "utf8");
    const stale = graph(["lookup", QUESTION, "-g", "other.ttl", "-i", INDEX]);
    expect(stale.status).toBe(2);
    expect(stale.stderr).toBe(`manni: ${INDEX}/chunks.json was built from another graph; run manni graph publish.\n`);
  });
});

describe("graph retrieve", () => {
  it("prints its bundle's rows and exits 0", () => {
    const r = graph(["retrieve", QUESTION, "--lang", "en"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/ match\n/);
    expect(r.stdout).toMatch(/passages, in en\. Pass -f json for the text and trace\.\n$/);
  });

  it("refuses with an answer and exits 0", () => {
    const r = graph(["retrieve", "zzzqx vvvkw", "--lang", "en", "--mode", "lexical"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("Refused, no-route: No passage in the docs matches this question.\n");
  });

  it("takes every option at once", () => {
    const r = graph([
      "retrieve", QUESTION, "-c", "manni.config.yaml", "-g", `${INDEX}/graph.ttl`, "-i", INDEX, "--lang", "en",
      "--mode", "hybrid", "--seeds", "2", "-d", "2", "--max-chars", "20000", "--withhold", "drifted,failing",
      "--where", "audience=admin", "--where", "tags=keys", "-f", "json",
    ]);
    expect(r.status).toBe(0);
    const bundle = JSON.parse(r.stdout) as { context: { page: string; role: string }[] };
    expect(bundle.context.filter((b) => b.role === "match")).toHaveLength(2);
    expect(new Set(bundle.context.map((b) => b.page))).toEqual(new Set(["docs/en/rotate.md"]));
  });

  it("refuses its usage errors, exit 2", () => {
    const cases: [string[], string][] = [
      [["retrieve", QUESTION], "manni: This corpus has more than one localization (de, en) — pass --lang to choose one.\n"],
      [["retrieve", QUESTION, "--lang", "fr"], 'manni: No index for language "fr" — this corpus has de, en.\n'],
      [["retrieve", QUESTION, "--lang", "en", "--withhold", "stale"], "manni: --withhold takes drifted or failing, and got stale.\n"],
      [["retrieve", QUESTION, "--lang", "en", "--where", "audience"], "manni: --where takes field=value, and got audience.\n"],
      [["retrieve", QUESTION, "--lang", "en", "--where", "=admin"], "manni: --where takes field=value, and got =admin.\n"],
    ];
    for (const [args, stderr] of cases) {
      const r = graph(args);
      expect(r.status, args.join(" ")).toBe(2);
      expect(r.stderr.split("\n")[0]).toBe(stderr.trimEnd());
    }
    const variant = graph(["retrieve", QUESTION, "--lang", "en", "--variant", "nope"]);
    expect(variant.status).toBe(2);
    expect(variant.stderr).toContain("manni: Unknown product variant: nope");
  });
});

describe("graph traverse --context", () => {
  it("prints a bundle, and refuses its budget flags without it", () => {
    const r = graph(["traverse", ROTATE, "--context", "--max-chars", "20000", "--withhold", "drifted"]);
    expect(r.status).toBe(0);
    expect(r.stdout.split("\n")[0]).toMatch(/^rotate\.md +match$/);

    const maxChars = graph(["traverse", ROTATE, "--max-chars", "10"]);
    expect(maxChars.status).toBe(2);
    expect(maxChars.stderr).toBe("manni: --max-chars needs --context.\n");
    const withhold = graph(["traverse", ROTATE, "--withhold", "drifted"]);
    expect(withhold.status).toBe(2);
    expect(withhold.stderr).toBe("manni: --withhold needs --context.\n");
  });

  it("prints today's walk without --context", () => {
    const r = graph(["traverse", ROTATE]);
    expect(r.status).toBe(0);
    expect(r.stdout.split("\n")[0]).toBe("urn:manni:graph:doc/docs/en/rotate.md — Rotate the encryption key");
    expect(r.stdout).toMatch(/\n\d+ nodes, \d+ hops, 0 excluded\n$/);
  });
});
