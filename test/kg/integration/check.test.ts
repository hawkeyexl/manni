import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const cli = join(root, "dist", "cli.js");
const corpus = join(root, "test", "kg", "fixtures", "corpus");
const violations = join(root, "test", "kg", "fixtures", "check-violations");

let corpusGraph: string;
let violationsGraph: string;

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
  const dir = mkdtempSync(join(tmpdir(), "dockg-check-"));
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
});

describe("manni kg check", () => {
  it("passes the regression corpus (warnings allowed, no violations)", () => {
    const { stdout, status } = run(["check", "-g", corpusGraph], corpus);
    expect(status).toBe(0);
    expect(stdout).toContain("0 violations");
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

  it("emits parseable JSON with severities and blamed docs", () => {
    const { stdout, status } = run(
      ["check", "-g", violationsGraph, "-f", "json"],
      violations,
    );
    expect(status).toBe(1);
    const parsed = JSON.parse(stdout) as {
      findings: Array<{ severity: string; docs: string[] }>;
      violations: number;
      warnings: number;
    };
    expect(parsed.violations).toBeGreaterThan(0);
    expect(parsed.warnings).toBeGreaterThan(0);
    expect(parsed.findings.some((f) => f.docs.includes("docs/alpha.md"))).toBe(
      true,
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
