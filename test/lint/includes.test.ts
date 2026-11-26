/**
 * Lint reads a page the way a reader sees it (proposal 0130): its includes
 * expanded, a partial assessed through its includer, and a finding in
 * included text reported at the directive with the file it came from.
 */
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runLint } from "../../src/lint/commands/lint.js";
import { render } from "../../src/lint/reporters/index.js";
import { defined } from "./helpers.js";

const MDX = resolve(__dirname, "../fixtures/includes/mdx");

/** A copy of the MDX fixture, so a test can break its partial. */
function copyFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "manni-lint-includes-"));
  cpSync(MDX, dir, { recursive: true });
  return dir;
}

describe("lint structure with includes", () => {
  it("passes a page whose required section lives in a partial, and skips the partial", async () => {
    const run = await runLint({ inputs: [], cwd: MDX });
    expect(run.summary).toMatchObject({ checked: 1, failed: 0, skipped: 0, partials: 1 });
    const partial = defined(run.results.find((r) => r.file === "docs/_partials/prereqs.mdx"));
    expect(partial.skipped).toBe("partial");
    expect(render(run, "pretty")).toContain(
      "1 file checked, 1 passed, 0 failed, 0 skipped, 1 partial assessed through its includer",
    );
  });

  it("reports a broken partial at the directive, naming the partial's line", async () => {
    const dir = copyFixture();
    const partial = join(dir, "docs/_partials/prereqs.mdx");
    writeFileSync(partial, readFileSync(partial, "utf8").replace("Before you begin", "Before you start"));

    const run = await runLint({ inputs: [], cwd: dir });
    expect(run.summary.failed).toBe(1);
    const page = defined(run.results.find((r) => r.file === "docs/install.mdx"));
    const finding = defined(page.findings.find((f) => f.includedFrom !== undefined));
    expect(finding.position.start.line).toBe(7);
    expect(finding.includedFrom).toEqual({ file: "docs/_partials/prereqs.mdx", line: 1 });

    expect(render(run, "pretty")).toContain("(included from docs/_partials/prereqs.mdx:1)");
    expect(render(run, "github")).toMatch(
      /::error file=docs\/install\.mdx,line=7,.*\(included from docs\/_partials\/prereqs\.mdx:1\)/,
    );
    expect(render(run, "junit")).toContain("(included from docs/_partials/prereqs.mdx:1)");

    const json = JSON.parse(render(run, "json")) as {
      file: string;
      skipped: string | null;
      errors: { includedFrom?: unknown }[];
    }[];
    const jsonPage = defined(json.find((r) => r.file === "docs/install.mdx"));
    expect(jsonPage.errors.some((e) => e.includedFrom !== undefined)).toBe(true);
    expect(json.find((r) => r.file === "docs/_partials/prereqs.mdx")?.skipped).toBe("partial");

    const sarif = JSON.parse(render(run, "sarif", { root: dir })) as {
      runs: { results: { relatedLocations?: { physicalLocation: { artifactLocation: { uri: string } } }[] }[] }[];
    };
    const related = sarif.runs[0]?.results.flatMap((r) => r.relatedLocations ?? []) ?? [];
    expect(related.map((l) => l.physicalLocation.artifactLocation.uri)).toContain(
      "docs/_partials/prereqs.mdx",
    );
  });

  it("lints a partial alone when its includer is not in the run", async () => {
    const run = await runLint({ inputs: ["docs/_partials/prereqs.mdx"], cwd: MDX });
    expect(run.summary.partials).toBe(0);
    expect(run.summary.checked).toBe(1);
  });
});
