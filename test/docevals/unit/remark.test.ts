/**
 * Tool adapter: `tool:remark` (ADR 01024).
 *
 * remark replaces markdownlint on this repo's own corpora because both are
 * MDX, and markdownlint has no MDX mode: it read every MDX comment as emphasis
 * markers and every table delimiter as a style violation. remark parses MDX,
 * frontmatter and Starlight's directive asides through real plugins, so what it
 * reports is about the page rather than about the parser.
 *
 * Tested against captured output plus a fake exec, never a real binary.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { extractFrontmatter } from "../../../src/meta/index.js";
import { parseDocevalsConfig } from "../helpers/config.js";
import { stripFrontmatterBlock, type PageFile } from "../../../src/docevals/core/discover.js";
import { resolvePage } from "../../../src/docevals/core/resolve.js";
import { remarkGrader } from "../../../src/docevals/graders/tools/remark.js";
import type { ExecFn, ExecResult, GraderTarget } from "../../../src/docevals/graders/types.js";

const CONFIG = parseDocevalsConfig("version: 1\n", "/fake/manni.config.yaml");
const FIXTURES = join(import.meta.dirname, "..", "fixtures", "tool-output");
const captured = (name: string) => readFileSync(join(FIXTURES, name), "utf8");

function makeTarget(file = "docs/page.mdx", extra: string[] = []): GraderTarget {
  const content = [
    "---",
    "evals:",
    "  - id: lint-clean",
    "    assertion: The page passes remark lint rules.",
    "    grader: tool:remark",
    ...extra,
    "---",
    "Body.",
  ].join("\n");
  const page: PageFile = {
    file,
    absPath: `/fake/${file}`,
    content,
    body: stripFrontmatterBlock(content),
    frontmatter: extractFrontmatter(content, "markdown"),
  };
  const plan = resolvePage(page, CONFIG);
  if (plan.evals.length === 0) throw new Error("fixture resolved no evals");
  return { plan, eval: plan.evals[0]! };
}

function fakeExec(result: Partial<ExecResult>): { exec: ExecFn; calls: string[][] } {
  const calls: string[][] = [];
  const exec: ExecFn = (cmd) => {
    calls.push(cmd);
    return Promise.resolve({ code: 0, stdout: "", stderr: "", timedOut: false, ...result });
  };
  return { exec, calls };
}

const grade = (exec: ExecFn, targets = [makeTarget()]) =>
  remarkGrader.grade({ targets, config: CONFIG, root: "/fake", exec });

describe("remarkGrader", () => {
  it("reports nothing when remark finds nothing", async () => {
    const { exec } = fakeExec({ code: 0, stderr: captured("remark-pass.json") });
    expect(await grade(exec)).toEqual([]);
  });

  // The two flags that make this work at all: without `--no-stdout` remark
  // prints the *reformatted document* to stdout, and the report is written to
  // stderr, not stdout. An adapter that read stdout would see the document and
  // never the findings.
  it("asks remark for a JSON report and not a reformatted document", async () => {
    const { exec, calls } = fakeExec({ code: 0, stderr: "[]" });
    await grade(exec);
    const cmd = calls[0]!;
    expect(cmd).toContain("--no-stdout");
    expect(cmd).toContain("--report");
    expect(cmd[cmd.indexOf("--report") + 1]).toBe("json");
    expect(cmd).toContain("docs/page.mdx");
  });

  it("reads the report from stderr, where remark writes it", async () => {
    const { exec } = fakeExec({ code: 0, stdout: "", stderr: captured("remark-fail.json") });
    const findings = await grade(exec);
    expect(findings.length).toBeGreaterThan(0);
  });

  it("maps each message to a finding with its rule, line and column", async () => {
    const { exec } = fakeExec({ code: 0, stderr: captured("remark-fail.json") });
    const findings = await grade(exec);
    const byRule = new Map(findings.map((f) => [f.ruleId, f]));
    expect([...byRule.keys()].sort()).toEqual([
      "remark-lint/final-newline",
      "remark-lint/no-literal-urls",
      "remark-lint/no-undefined-references",
    ]);
    const literal = byRule.get("remark-lint/no-literal-urls")!;
    expect(literal.line).toBe(5);
    expect(literal.col).toBe(7);
    expect(literal.message).toMatch(/autolink/i);
    expect(literal.severity).toBe("error");
    expect(literal.diagnostic).toBeUndefined();
  });

  // remark reports `docs\page.mdx` on Windows. Without normalization the
  // lookup misses and every finding is silently dropped — the same shape that
  // made markdownlint report nothing for years.
  it("matches a backslash path back to the target file", async () => {
    const { exec } = fakeExec({ code: 0, stderr: captured("remark-fail.json") });
    const findings = await grade(exec);
    expect(findings.every((f) => f.file === "docs/page.mdx")).toBe(true);
  });

  it("honors an options.command override", async () => {
    const { exec, calls } = fakeExec({ code: 0, stderr: "[]" });
    await grade(exec, [makeTarget("docs/page.mdx", ["    options:", "      command: [my-remark]"])]);
    expect(calls[0]?.[0]).toBe("my-remark");
  });

  // A page that cannot be parsed is a claim about the *page*, not about the
  // grader, so it is an ordinary finding at the eval's severity. The JSON
  // reporter drops vfile's `cause` chain, so the message says where to look.
  it("reports an unparseable page as a finding, not a diagnostic", async () => {
    const { exec } = fakeExec({ code: 1, stderr: captured("remark-unparseable-page.json") });
    const findings = await grade(exec, [makeTarget("docs/broken.mdx")]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.diagnostic).toBeUndefined();
    expect(findings[0]?.file).toBe("docs/broken.mdx");
    expect(findings[0]?.message).toMatch(/could not parse|Cannot process file/i);
  });

  // The guard the markdownlint years earned. Findings are attributed by
  // matching the reported path to a target; when that match fails, the natural
  // implementation drops them and the eval passes on a page full of problems.
  // An unmatched path can only mean the mapping broke — remark is handed an
  // explicit file list — so say so instead of going quiet.
  it("refuses to drop findings whose file it cannot match", async () => {
    const report = JSON.stringify([
      { path: "docs/some-other-file.mdx", messages: [{ line: 1, column: 1, ruleId: "x", reason: "y" }] },
    ]);
    const { exec } = fakeExec({ code: 0, stderr: report });
    const findings = await grade(exec);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.diagnostic).toBe(true);
    expect(findings[0]?.message).toMatch(/could not be matched|did not match/i);
  });
});
