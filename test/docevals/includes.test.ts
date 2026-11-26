/**
 * docevals grades a page the way a reader sees it (proposal 0130): the
 * regex grader reads text that lives only in a partial, a match there reports
 * at the include directive, and the partial is not evaluated alone.
 */
import { appendFileSync, cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runEvals } from "../../src/docevals/core/engine.js";

const MDX = resolve(__dirname, "../fixtures/includes/mdx");

/** The MDX fixture, with one regex eval declared on the page. */
function scaffold(match: "contains" | "not-contains"): string {
  const dir = mkdtempSync(join(tmpdir(), "manni-docevals-includes-"));
  cpSync(MDX, dir, { recursive: true });
  appendFileSync(
    join(dir, "manni.config.yaml"),
    [
      "",
      "docevals:",
      "  evals:",
      "    node-version:",
      "      grader: tool:regex",
      "      options:",
      '        pattern: "Node\\\\.js 20"',
      `        match: ${match}`,
      "",
    ].join("\n"),
  );
  const page = join(dir, "docs/install.mdx");
  writeFileSync(
    page,
    readFileSync(page, "utf8").replace("type: how-to\n", "type: how-to\nevals:\n  - use: node-version\n"),
  );
  return dir;
}

describe("docevals with includes", () => {
  it("matches text that lives only in a partial", async () => {
    const report = await runEvals({ cwd: scaffold("contains"), generate: false });
    const results = report.evalResults.filter((r) => r.evalName === "node-version");
    expect(results.map((r) => [r.file, r.outcome])).toEqual([["docs/install.mdx", "pass"]]);
  });

  it("reports a match in a partial at the directive, naming its line", async () => {
    const report = await runEvals({ cwd: scaffold("not-contains"), generate: false });
    const result = report.evalResults.find((r) => r.evalName === "node-version");
    expect(result?.outcome).toBe("fail");
    const finding = result?.findings?.[0];
    // `<Prereqs />` sits on line 9 once the eval is added to the frontmatter.
    expect(finding?.line).toBe(9);
    expect(finding?.includedFrom).toEqual({ file: "docs/_partials/prereqs.mdx", line: 3 });
  });
});
