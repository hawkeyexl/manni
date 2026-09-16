/**
 * The kg domain's grammar and shared plumbing (proposal 0051 §2).
 *
 * Every case here is about what a user types and reads rather than what the
 * graph contains: the exit code of a usage error, the sentence an unknown
 * `-f` gets, where a list's separator is, and which spelling of a flag the
 * domain answers to. They run the built `dist/cli.js`, because an exit code
 * is only real at the process boundary.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const cli = join(root, "dist", "cli.js");
const corpus = join(root, "test", "kg", "fixtures", "corpus");
const bundledShapes = join(root, "shapes", "kg", "dockg-1.0.0.ttl");

const CONFIG_DOC = "https://example.com/kg/doc/docs/configuration.md";

function run(
  args: string[],
  cwd: string = corpus,
): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [cli, "kg", ...args], {
    encoding: "utf8",
    cwd,
  });
  return {
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    status: r.status ?? -1,
  };
}

let dir: string;
let graph: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "kg-grammar-"));
  graph = join(dir, "graph.ttl");
  const built = run(["build", "--out", graph]);
  expect(built.status, built.stderr).toBe(0);
}, 120000);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("kg usage errors exit 2", () => {
  it("a bare `manni kg` prints usage on stderr and exits 2", () => {
    const { stdout, stderr, status } = run([]);
    expect(status).toBe(2);
    expect(stdout).toBe("");
    expect(stderr).toMatch(/^Usage: manni kg /m);
    // The verbs are the point of the screen.
    expect(stderr).toMatch(/^\s+build\b/m);
    expect(stderr).toMatch(/^\s+check\b/m);
  });

  it("an unknown option exits 2", () => {
    const { status, stderr } = run(["check", "--nope"]);
    expect(status).toBe(2);
    expect(stderr).toContain("unknown option");
    expect(stderr).toContain("--help for usage");
  });

  it("an unknown verb exits 2", () => {
    const { status, stderr } = run(["nope"]);
    expect(status).toBe(2);
    expect(stderr).toContain("unknown command");
  });

  const missing: Array<[string, string[]]> = [
    ["search without its query", ["search"]],
    ["traverse without its node", ["traverse"]],
    ["export without its target", ["export"]],
  ];
  for (const [name, args] of missing) {
    it(`refuses ${name} with exit 2`, () => {
      const { status, stderr } = run(args);
      expect(status).toBe(2);
      expect(stderr).toContain("missing required argument");
    });
  }
});

describe("kg -f is the output format, and it is checked", () => {
  // Every verb that takes one. The check happens before the run, so none of
  // these needs a graph — and that is why a status-only assertion would be
  // worthless here: run from the corpus they would exit 2 anyway.
  const verbs: Array<[string, string[]]> = [
    ["check", ["check"]],
    ["validate", ["validate"]],
    ["query", ["query"]],
    ["stats", ["stats"]],
    ["search", ["search", "q"]],
    ["traverse", ["traverse", "x"]],
    ["fill", ["fill"]],
    ["embed", ["embed"]],
  ];
  for (const [name, args] of verbs) {
    it(`refuses an unknown --format on ${name}`, () => {
      const { status, stderr } = run([...args, "-f", "xml"]);
      expect(stderr).toContain('Unknown --format "xml". Use pretty | json.');
      expect(status).toBe(2);
    });
  }

  it("still takes json", () => {
    const { status, stdout } = run([
      "query",
      "--p",
      "dcterms:title",
      "-g",
      graph,
      "-f",
      "json",
    ]);
    expect(status).toBe(0);
    const result = JSON.parse(stdout) as { matches: unknown[] };
    expect(result.matches.length).toBeGreaterThan(0);
  });
});

describe("kg export takes its target as a positional", () => {
  it("writes the JSON-LD for `export jsonld`", () => {
    const out = join(dir, "positional.jsonld");
    const { status, stdout, stderr } = run([
      "export",
      "jsonld",
      "-g",
      graph,
      "-o",
      out,
    ]);
    expect(status, stderr).toBe(0);
    expect(stdout).toContain(out);
  });

  it("refuses an unknown target, naming the three", () => {
    const { status, stderr } = run(["export", "nope", "-g", graph]);
    expect(stderr).toContain(
      'Unknown export target "nope". Use jsonld | iirds | search.',
    );
    expect(status).toBe(2);
  });

  it("no longer answers to -f: the target is not an output format", () => {
    const { status, stderr } = run(["export", "-f", "jsonld", "-g", graph]);
    expect(status).toBe(2);
    expect(stderr).toContain("unknown option '-f'");
  });
});

describe("kg lists carry one separator each", () => {
  it("--shapes keeps one path per occurrence", () => {
    // Order is the tell. A repeatable option accumulates, so the missing
    // first file is what fails; the variadic it replaced would have kept only
    // the last occurrence and validated happily against the bundled shapes.
    const { status, stderr } = run([
      "check",
      "-g",
      graph,
      "--shapes",
      join(dir, "no-such-shapes.ttl"),
      "--shapes",
      bundledShapes,
    ]);
    expect(status).toBe(2);
    expect(stderr).toContain("no-such-shapes.ttl");
  });

  it("--predicates splits on commas, given once", () => {
    const iris = (args: string[]): string[] => {
      const { stdout, status, stderr } = run([
        "traverse",
        CONFIG_DOC,
        "-g",
        graph,
        "-d",
        "2",
        "-f",
        "json",
        ...args,
      ]);
      expect(status, stderr).toBe(0);
      return (JSON.parse(stdout) as { nodes: Array<{ iri: string }> }).nodes.map(
        (n) => n.iri,
      );
    };
    const one = iris(["--predicates", "dcterms:references"]);
    const two = iris(["--predicates", "dcterms:references,dcterms:hasPart"]);
    // Unsplit, "dcterms:references,dcterms:hasPart" is one predicate that
    // matches nothing, so the second walk would be the smaller one.
    expect(two.length).toBeGreaterThan(one.length);
  });
});

describe("kg search --mode is checked", () => {
  it("refuses an unknown mode, naming the three", () => {
    const { status, stderr } = run(["search", "q", "--mode", "x"]);
    expect(stderr).toContain(
      'Unknown --mode "x". Use lexical | hybrid | vector.',
    );
    expect(status).toBe(2);
  });
});

describe("kg query's terms are long-only", () => {
  it("takes --o as the object term", () => {
    const { status, stdout, stderr } = run([
      "query",
      "--o",
      "no-such-object",
      "-g",
      graph,
    ]);
    expect(status, stderr).toBe(0);
    expect(stdout).toContain("No matches.");
  });

  it("no longer answers to -o, which is --out on every other verb", () => {
    const { status, stderr } = run(["query", "-o", "term", "-g", graph]);
    expect(status).toBe(2);
    expect(stderr).toContain("unknown option");
  });
});
