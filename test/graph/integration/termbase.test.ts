/**
 * One concept scheme, from the termbase to the graph (proposal 0085 §1),
 * through the built CLI: the `manni` umbrella registers the term source, so
 * `graph build` reads the glossary `manni term check` reads.
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { spawnText } from "../../helpers/spawn.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const cli = join(root, "dist", "cli.js");
const fixture = join(root, "test", "graph", "fixtures", "termbase");
const C = (id: string) => `<https://example.com/graph/concept/${id}>`;

/** A copy outside any repository, so git history stays out of the graph. */
function detached(): string {
  const dir = mkdtempSync(join(tmpdir(), "manni-graph-termbase-"));
  cpSync(fixture, dir, { recursive: true });
  return dir;
}

function run(args: string[], cwd: string): { stdout: string; status: number } {
  const r = spawnText(spawnSync(process.execPath, [cli, "graph", ...args], { encoding: "utf8", cwd }));
  return { stdout: r.stdout ?? "", status: r.status ?? -1 };
}

let dir: string;
let build: { stdout: string; status: number };
let ttl: string;

beforeAll(() => {
  dir = detached();
  build = run(["build"], dir);
  ttl = readFileSync(join(dir, "graph.ttl"), "utf8");
});

describe("graph build over a termbase", () => {
  it("says how many concepts the termbase gave", () => {
    expect(build.status).toBe(0);
    expect(build.stdout).toMatch(/\(6 docs, \d+ triples, 3 concepts \(2 from the termbase\)\)/);
  });

  it("joins a term's languages on one concept, labels tagged", () => {
    expect(ttl).toContain(`skos:prefLabel "Access token"@en, "Zugriffstoken"@de`);
    expect(ttl).not.toContain(C("access-token"));
  });

  it("resolves an alt-label and a see redirect to the term's concept", () => {
    expect(ttl).toContain(`dcterms:subject ${C("pluggable-auth-layer")}, ${C("token")}`);
    expect(ttl).toContain(`skos:altLabel "PAL", "auth plug-in"`);
    expect(ttl).not.toContain(C("pal"));
    expect(ttl).not.toContain(C("bearer-token"));
  });

  it("joins a graph block's edge to the term hierarchy, both ways round", () => {
    expect(ttl).toMatch(new RegExp(`${C("oauth")} a skos:Concept ;\\n  skos:broader ${C("token")}`));
    expect(ttl).toContain(`skos:narrower ${C("oauth")}`);
    expect(ttl).toContain(
      `skos:hasTopConcept ${C("pluggable-auth-layer")}, ${C("token")} .`,
    );
  });

  it("carries a term's notation and its mapping to another vocabulary", () => {
    expect(ttl).toContain(`skos:closeMatch <https://example.org/vocab/authentication-module>`);
    expect(ttl).toContain(`skos:notation "AUTH-7"`);
  });

  it("fails graph check on a mapping that points into the scheme", () => {
    const into = detached();
    const page = join(into, "docs", "glossary", "pluggable-auth-layer.md");
    writeFileSync(
      page,
      readFileSync(page, "utf8").replace("notation:", "exact-matches: https://example.com/graph/concept/token\nnotation:"),
    );
    expect(run(["build"], into).status).toBe(0);
    const check = run(["check"], into);
    expect(check.status).toBe(1);
    expect(check.stdout).toContain(
      "skos:exactMatch points into this scheme (https://example.com/graph/concept/token), so use broader, narrower or related instead.",
    );
  });

  it("passes graph check", () => {
    expect(run(["check"], dir)).toEqual({ stdout: "0 errors, 0 warnings, 0 notices\n", status: 0 });
  });

  it("builds as before when derive leaves terms out", () => {
    const off = detached();
    const config = join(off, "manni.config.yaml");
    writeFileSync(
      config,
      `${readFileSync(config, "utf8")}  build:\n    derive: [frontmatter, sections, links, tags]\n`,
    );
    const r = run(["build"], off);
    expect(r.stdout).toMatch(/, 4 concepts\)\n$/);
    expect(readFileSync(join(off, "graph.ttl"), "utf8")).toContain(C("bearer-token"));
  });
});
