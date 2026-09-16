import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { detachedCorpus } from "../helpers/corpus.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const cli = join(root, "dist", "cli.js");
// A copy outside any repository: git is detected now (proposal 0051 §6),
// and a corpus built inside this checkout would carry HEAD's committer
// date. See test/kg/helpers/corpus.ts.
const corpus = detachedCorpus();
const violations = join(root, "test", "kg", "fixtures", "check-violations");
const curated = join(root, "test", "kg", "fixtures", "curated-fields");

let corpusGraph: string;
let violationsGraph: string;
let curatedGraph: string;

function run(
  args: string[],
  cwd: string,
): { stdout: string; stderr: string; status: number } {
  try {
    const stdout = execFileSync(process.execPath, [cli, "kg", ...args], {
      encoding: "utf8",
      cwd,
    });
    return { stdout, stderr: "", status: 0 };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
      status: err.status ?? -1,
    };
  }
}

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "manni-kg-check-"));
  corpusGraph = join(dir, "corpus.ttl");
  violationsGraph = join(dir, "violations.ttl");
  execFileSync(process.execPath, [cli, "kg", "build", "--out", corpusGraph], {
    encoding: "utf8",
    cwd: corpus,
  });
  execFileSync(process.execPath, [cli, "kg", "build", "--out", violationsGraph], {
    encoding: "utf8",
    cwd: violations,
  });
  curatedGraph = join(dir, "curated.ttl");
  execFileSync(process.execPath, [cli, "kg", "build", "--out", curatedGraph], {
    encoding: "utf8",
    cwd: curated,
  });
});

describe("manni kg check", () => {
  it("passes the regression corpus (warnings allowed, no errors)", () => {
    const { stdout, status } = run(["check", "-g", corpusGraph], corpus);
    expect(status).toBe(0);
    expect(stdout).toContain("0 errors");
  });

  it("exits 1 on the violating corpus, naming the offending docs", () => {
    const { stdout, status } = run(
      ["check", "-g", violationsGraph],
      violations,
    );
    expect(status).toBe(1);
    // broader cycle between Alpha and Beta blames both docs
    expect(stdout).toContain("cycle");
    expect(stdout).toContain("docs/alpha.md");
    expect(stdout).toContain("docs/beta.md");
    // related ⨯ broaderTransitive
    expect(stdout).toContain("broaderTransitive");
    // skos:prefLabel collision surfaces as a warning, not a violation
    expect(stdout).toMatch(/warning:.*prefLabel/);
  });

  it("emits parseable JSON with both severity scales and blamed docs", () => {
    const { stdout, status } = run(
      ["check", "-g", violationsGraph, "-f", "json"],
      violations,
    );
    expect(status).toBe(1);
    const parsed = JSON.parse(stdout) as {
      findings: Array<{
        severity: string;
        shaclSeverity: string;
        docs: string[];
      }>;
      errors: number;
      warnings: number;
      notices: number;
    };
    expect(parsed.errors).toBeGreaterThan(0);
    expect(parsed.warnings).toBeGreaterThan(0);
    expect(parsed.notices).toBe(0);
    // Every finding carries the family's word and SHACL's own.
    expect(
      parsed.findings.every(
        (f) =>
          ["notice", "warning", "error"].includes(f.severity) &&
          ["info", "warning", "violation"].includes(f.shaclSeverity),
      ),
    ).toBe(true);
    expect(
      parsed.findings.some(
        (f) => f.severity === "error" && f.shaclSeverity === "violation",
      ),
    ).toBe(true);
    expect(parsed.findings.some((f) => f.docs.includes("docs/alpha.md"))).toBe(
      true,
    );
  });

  it("annotates each finding for GitHub, at the finding's level", () => {
    const { stdout, status } = run(
      ["check", "-g", violationsGraph, "-f", "github"],
      violations,
    );
    expect(status).toBe(1);
    const lines = stdout.trim().split("\n");
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).toMatch(/^::(error|warning|notice)( file=[^:]+)?::/);
    }
    expect(lines.some((l) => l.startsWith("::error file=docs/alpha.md::"))).toBe(
      true,
    );
    expect(lines.some((l) => l.startsWith("::warning "))).toBe(true);
  });

  it("refuses an unknown --format in the family's words", () => {
    const { status, stderr } = run(
      ["check", "-g", corpusGraph, "-f", "sarif"],
      corpus,
    );
    expect(status).toBe(2);
    expect(stderr).toContain(
      'Unknown --format "sarif". Use pretty | json | github.',
    );
  });

  it("produces byte-identical output across runs", () => {
    const first = run(
      ["check", "-g", violationsGraph, "-f", "json"],
      violations,
    );
    const second = run(
      ["check", "-g", violationsGraph, "-f", "json"],
      violations,
    );
    expect(first.stdout).toBe(second.stdout);
  });

  // Proposal 0046 stress test 13: `kg.provenance` enumerated the twelve
  // fillable fields; a free JSON Pointer cannot, so the guard moved here.
  it("reports a meta-provenance pointer under a hand-curated field", () => {
    const { stdout, status } = run(
      ["check", "-g", curatedGraph, "-f", "json"],
      curated,
    );
    expect(status).toBe(1);
    const parsed = JSON.parse(stdout) as {
      findings: Array<{
        severity: string;
        shaclSeverity: string;
        message: string;
        path?: string;
        focusNode: string;
        docs: string[];
      }>;
    };
    const curatedFindings = parsed.findings.filter((f) =>
      f.message.includes("curated by hand"),
    );
    expect(
      curatedFindings.map((f) => [f.severity, f.docs.join(","), f.message]),
    ).toEqual([
      [
        // The curated-field finding ships at the family's `error` after the
        // mapping (proposal 0051 §2): it is a SHACL-side `violation`.
        "error",
        "docs/lineage.md",
        "meta-provenance attributes /graph/derived-from to m2 — derived-from is curated by hand, never filled by a machine",
      ],
      [
        "error",
        "docs/lineage.md",
        "meta-provenance attributes /graph/revision-of to m2 — revision-of is curated by hand, never filled by a machine",
      ],
      [
        "error",
        "docs/sections.md",
        "meta-provenance attributes /graph/sections to m1 — sections is curated by hand, never filled by a machine",
      ],
    ]);
    // docs/clean.md names only fillable pointers, so nothing is said about it.
    expect(
      curatedFindings.some((f) => f.docs.includes("docs/clean.md")),
    ).toBe(false);
  });

  it("fails with exit 2 for a missing shapes file", () => {
    const { status, stderr } = run(
      ["check", "-g", corpusGraph, "--shapes", "no-such-shapes.ttl"],
      corpus,
    );
    expect(status).toBe(2);
    expect(stderr).toContain("Shapes file not found");
  });

  it("fails with exit 2 when the graph has not been built", () => {
    const { status, stderr } = run(
      ["check", "-g", "missing-graph.ttl"],
      corpus,
    );
    expect(status).toBe(2);
    expect(stderr).toContain("run `manni kg build` first");
  });
});
