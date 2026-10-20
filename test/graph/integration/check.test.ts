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
// date. See test/graph/helpers/corpus.ts.
const corpus = detachedCorpus();
const violations = join(root, "test", "graph", "fixtures", "check-violations");
const curated = join(root, "test", "graph", "fixtures", "curated-fields");
const guidance = join(root, "test", "graph", "fixtures", "check-guidance");
const dd = join(root, "test", "graph", "fixtures", "dd");

let corpusGraph: string;
let violationsGraph: string;
let curatedGraph: string;
let guidanceGraph: string;
let ddViolationsGraph: string;
let l10nInvalidGraph: string;

function run(
  args: string[],
  cwd: string,
): { stdout: string; stderr: string; status: number } {
  try {
    const stdout = execFileSync(process.execPath, [cli, "graph", ...args], {
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
  const dir = mkdtempSync(join(tmpdir(), "manni-graph-check-"));
  corpusGraph = join(dir, "corpus.ttl");
  violationsGraph = join(dir, "violations.ttl");
  execFileSync(process.execPath, [cli, "graph", "build", "--out", corpusGraph], {
    encoding: "utf8",
    cwd: corpus,
  });
  execFileSync(process.execPath, [cli, "graph", "build", "--out", violationsGraph], {
    encoding: "utf8",
    cwd: violations,
  });
  curatedGraph = join(dir, "curated.ttl");
  execFileSync(process.execPath, [cli, "graph", "build", "--out", curatedGraph], {
    encoding: "utf8",
    cwd: curated,
  });
  guidanceGraph = join(dir, "guidance.ttl");
  execFileSync(process.execPath, [cli, "graph", "build", "--out", guidanceGraph], {
    encoding: "utf8",
    cwd: guidance,
  });
  ddViolationsGraph = join(dir, "dd-violations.ttl");
  execFileSync(
    process.execPath,
    [cli, "graph", "build", "-c", "violations.config.yaml", "--out", ddViolationsGraph],
    { encoding: "utf8", cwd: dd },
  );
  l10nInvalidGraph = join(dir, "l10n-invalid.ttl");
  execFileSync(
    process.execPath,
    [cli, "graph", "build", "-c", "l10n-invalid.config.yaml", "--out", l10nInvalidGraph],
    { encoding: "utf8", cwd: dd },
  );
});

describe("manni graph check", () => {
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
    // related ⨯ broaderTransitive, reported once for the pair
    expect(
      stdout.split("\n").filter((l) => l.includes("one of its ancestors")),
    ).toEqual([
      'error: docs/alpha.md, docs/beta.md, docs/gamma.md: "Gamma" is both related to "Alpha" and one of its ancestors. Remove one link: from `related-concepts` or `related-terms`, or from the `broader` chain between them.',
    ]);
    // skos:prefLabel collision surfaces as a warning, not a violation
    expect(stdout).toContain(
      'warning: docs/alpha.md, docs/gamma.md: Pages spell this concept two ways: "Shared Term" and "shared term". Use one spelling on every page that names it.',
    );
    expect(stdout).toContain("  at https://example.com/graph/concept/shared-term skos:prefLabel");
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
      ["check", "-g", corpusGraph, "-f", "xml"],
      corpus,
    );
    expect(status).toBe(2);
    expect(stderr).toContain(
      'Unknown --format "xml". Use pretty | json | github | sarif.',
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
      f.message.includes("a field only a person writes"),
    );
    expect(
      curatedFindings.map((f) => [f.severity, f.docs.join(","), f.message]),
    ).toEqual([
      [
        // The curated-field finding ships at the family's `error` after the
        // mapping (proposal 0051 §2): it is a SHACL-side `violation`.
        "error",
        "docs/lineage.md",
        "`meta-provenance` credits m2 with /graph/derived-from, a field only a person writes. Check the value, then delete that entry.",
      ],
      [
        "error",
        "docs/lineage.md",
        "`meta-provenance` credits m2 with /graph/revision-of, a field only a person writes. Check the value, then delete that entry.",
      ],
      [
        "error",
        "docs/sections.md",
        "`meta-provenance` credits m1 with /graph/sections, a field only a person writes. Check the value, then delete that entry.",
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
    expect(stderr).toContain(
      `manni: Shapes file not found: ${join(corpus, "no-such-shapes.ttl")}. Fix the path in --shapes or graph.check.shapes. Leave both unset to use the bundled shapes.`,
    );
  });

  it("fails with exit 2 when the graph has not been built", () => {
    const { status, stderr } = run(
      ["check", "-g", "missing-graph.ttl"],
      corpus,
    );
    expect(status).toBe(2);
    expect(stderr).toContain("run `manni graph build` first");
  });
});

/** Proposal 0089: findings speak to the page's author. */
describe("manni graph check, for the page's author", () => {
  it("leads with the page and names the shape on dd/l10n-invalid", () => {
    const { stdout, status } = run(["check", "-g", l10nInvalidGraph, "-c", "l10n-invalid.config.yaml"], dd);
    expect(status).toBe(1);
    expect(stdout).toBe(
      [
        "error: l10n-invalid/install.md: Set `lang` to a language tag such as `de` or `pt-BR`, not a language name.",
        "  at https://example.com/dd/doc/l10n-invalid/install.md dcterms:language",
        "  manni:graph-shapes:1.1.1 Document-language: The language the page is written in. Search, filters and per-language indexes group pages by it.",
        "  Guide: https://hawkeyexl.github.io/manni/graph/fix/",
        "",
        "1 error, 0 warnings, 0 notices",
        "",
      ].join("\n"),
    );
  });

  it("puts guidance last on every JSON finding", () => {
    const { stdout } = run(["check", "-g", l10nInvalidGraph, "-c", "l10n-invalid.config.yaml", "-f", "json"], dd);
    const parsed = JSON.parse(stdout) as { findings: Array<Record<string, unknown>> };
    expect(parsed.findings.map((f) => Object.keys(f))).toEqual([
      ["severity", "shaclSeverity", "message", "focusNode", "path", "docs", "guidance"],
    ]);
  });

  it("reports dd/violations as three errors, one per mistake", () => {
    const { stdout, status } = run(["check", "-g", ddViolationsGraph, "-c", "violations.config.yaml"], dd);
    expect(status).toBe(1);
    expect(stdout).toContain("3 errors, 0 warnings, 0 notices");
    expect(stdout).toContain(
      'error: violations/alpha.md, violations/beta.md, violations/gamma.md: "Alpha" and "Beta" form a broader cycle, so each is its own ancestor. Remove one `broader` or `narrower` value on the cycle.',
    );
    expect(stdout).toContain(
      "A concept is related to a concept that is also broader than it. Remove one link: from `related-concepts` or `related-terms`, or from `broader` or `narrower`.",
    );
    expect(stdout).toContain(
      "error: violations/alpha.md: The page lists a variant in both `applies-to` and `not-applicable-to`. Keep it only in the one that is true.",
    );
    expect(stdout).not.toContain("one of its ancestors");
  });

  it("names the key behind each author-reachable shape on check-guidance", () => {
    const { stdout, status } = run(["check", "-g", guidanceGraph, "-f", "json"], guidance);
    expect(status).toBe(1);
    const parsed = JSON.parse(stdout) as {
      findings: Array<{ message: string; docs: string[]; guidance: { rule: string | null } | null }>;
    };
    expect(parsed.findings.map((f) => [f.docs, f.guidance?.rule, f.message])).toEqual([
      [
        ["docs/aspect.md"],
        "Document-notSoftwareSubject",
        "The page lists an aspect in both `about-product-aspect` and `not-about-product-aspect`. Keep it only in the one that is true.",
      ],
      [
        ["docs/language.md"],
        "Document-language",
        "Set `lang` to a language tag such as `de` or `pt-BR`, not a language name.",
      ],
      [
        ["docs/section-scope.md"],
        "Section-notApplicableToVariant",
        "A section in `graph.sections` lists a variant in both `applies-to` and `not-applicable-to`. Keep it only in the one that is true.",
      ],
      [
        ["docs/section-scope.md"],
        "Section-notSoftwareSubject",
        "A section in `graph.sections` lists an aspect in both `about-product-aspect` and `not-about-product-aspect`. Keep it only in the one that is true.",
      ],
      [
        ["docs/variant-lower.md", "docs/variant-upper.md"],
        "ProductVariant-title",
        "Pages spell this variant two ways in `applies-to` or `not-applicable-to`. Use one spelling on every page.",
      ],
    ]);
  });

  it("appends the guidance lines to each GitHub annotation", () => {
    const { stdout } = run(["check", "-g", l10nInvalidGraph, "-c", "l10n-invalid.config.yaml", "-f", "github"], dd);
    expect(stdout.trim()).toBe(
      "::error file=l10n-invalid/install.md::Set `lang` to a language tag such as `de` or `pt-BR`, not a language name. (https://example.com/dd/doc/l10n-invalid/install.md)%0Amanni:graph-shapes:1.1.1 Document-language: The language the page is written in. Search, filters and per-language indexes group pages by it.%0AGuide: https://hawkeyexl.github.io/manni/graph/fix/",
    );
  });

  it("prints SARIF with page locations and keeps the exit code", () => {
    const { stdout, status } = run(["check", "-g", guidanceGraph, "-f", "sarif"], guidance);
    expect(status).toBe(1);
    const log = JSON.parse(stdout) as {
      runs: Array<{
        tool: { driver: { name: string } };
        results: Array<{ ruleId: string; locations: Array<{ physicalLocation: { artifactLocation: { uri: string }; region: { startLine: number } } }> }>;
      }>;
    };
    expect(log.runs.map((r) => r.tool.driver.name)).toEqual(["manni-graph"]);
    const language = log.runs[0]?.results.find((r) => r.ruleId === "manni:graph/Document-language");
    expect(language?.locations.map((l) => [l.physicalLocation.artifactLocation.uri, l.physicalLocation.region.startLine])).toEqual([
      ["docs/language.md", 1],
    ]);
  });

  it("exits 0 with SARIF when the graph passes", () => {
    const { stdout, status } = run(["check", "-g", corpusGraph, "-f", "sarif"], corpus);
    expect(status).toBe(0);
    expect((JSON.parse(stdout) as { runs: unknown[] }).runs).toHaveLength(1);
  });
});
