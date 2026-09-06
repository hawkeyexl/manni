import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  updatePageEval,
  updateConfigEval,
  hasEditableEval,
} from "../../../src/docevals/core/frontmatter-edit.js";
import { makeGenerateScripts, scriptLocationFor } from "../../../src/docevals/graders/scriptgen.js";
import { MockProvider } from "@hawkeyexl/inference";
import { parseConfig } from "../../../src/docevals/core/config.js";
import { parseDocevalsConfig, nestUnderDocevals } from "../helpers/config.js";
import { readPage } from "../../../src/docevals/core/discover.js";
import { resolvePage } from "../../../src/docevals/core/resolve.js";
import { sha256 } from "../../../src/docevals/judge/cache.js";
import { runEvals } from "../../../src/docevals/core/engine.js";
import { DocevalsError } from "../../../src/docevals/types.js";
import type { GraderTarget } from "../../../src/docevals/graders/types.js";

const PAGE = [
  "---",
  "title: Sample",
  "# a comment that must survive",
  "evals:",
  "  - id: gen-me",
  "    assertion: The page has a heading.",
  "    grader: command",
  "---",
  "",
  "# Heading",
  "",
  "Body text stays byte-identical.",
  "",
].join("\n");

describe("updatePageEval", () => {
  it("adds command and the assertion hash, preserving body and comments", () => {
    const updated = updatePageEval(PAGE, "page.md", "gen-me", {
      command: ["node", "manni-docevals/sample.gen-me.mjs", "{file}"],
      "generated-assertion-hash": "abc",
    });
    expect(updated).toContain('command: [ node, manni-docevals/sample.gen-me.mjs, "{file}" ]');
    expect(updated).toContain("generated-assertion-hash: abc");
    expect(updated).toContain("# a comment that must survive");
    // Body after the closing fence is byte-identical.
    const bodyOf = (s: string) => s.slice(s.indexOf("\n---\n", 4) + 5);
    expect(bodyOf(updated)).toBe(bodyOf(PAGE));
  });

  it("throws for a missing eval", () => {
    expect(() => updatePageEval(PAGE, "page.md", "ghost", { grader: "command" })).toThrow(
      DocevalsError,
    );
  });

  it("throws for pages without YAML frontmatter", () => {
    expect(() =>
      updatePageEval("# No frontmatter\n", "page.md", "x", { grader: "command" }),
    ).toThrow(/no YAML frontmatter/);
  });

  it("preserves CRLF line endings in the frontmatter block", () => {
    const crlf = PAGE.replaceAll("\n", "\r\n");
    const updated = updatePageEval(crlf, "page.md", "gen-me", {
      "generated-assertion-hash": "abc",
    });
    expect(updated).toContain("generated-assertion-hash: abc\r\n");
  });

  it("hasEditableEval finds inline evals only", () => {
    expect(hasEditableEval(PAGE, "gen-me")).toBe(true);
    expect(hasEditableEval(PAGE, "ghost")).toBe(false);
  });
});

describe("updateConfigEval", () => {
  it("rewrites a named eval in place", () => {
    const config = [
      "docevals:",
      "  version: 1",
      "  evals:",
      "    check-links:",
      "      assertion: All links resolve.",
      "      grader: command",
      "  suites: {}",
    ].join("\n");
    const updated = updateConfigEval(config, "cfg.yaml", "check-links", {
      command: ["node", "manni-docevals-scripts/check-links.mjs", "{file}"],
      "generated-assertion-hash": "xyz",
    });
    expect(updated).toContain("manni-docevals-scripts/check-links.mjs");
    expect(updated).toContain("generated-assertion-hash: xyz");
    expect(updated).toContain("version: 1");
    expect(updated).toContain("docevals:");
  });
});

// --- generation end-to-end on a temp workspace ---

const SCRIPT_CODE = [
  'import { readFileSync } from "node:fs";',
  "const content = readFileSync(process.argv[2], \"utf8\");",
  "process.exit(/^#{1,6}\\s+/m.test(content) ? 0 : 1);",
  "",
].join("\n");

function tempWorkspace(): { root: string; pagePath: string } {
  const root = mkdtempSync(join(tmpdir(), "manni-docevals-gen-"));
  mkdirSync(join(root, "docs"), { recursive: true });
  const pagePath = join(root, "docs", "sample.md");
  writeFileSync(pagePath, PAGE);
  // A real manni.config.yaml on disk: the engine loads this one itself.
  writeFileSync(
    join(root, "manni.config.yaml"),
    // A generated script becomes a `command` eval on the page, so running it
    // needs the execution grant — without it these tests assert on a skip.
    nestUnderDocevals(
      'version: 1\nfiles:\n  include: ["docs/**/*.md"]\nexecution:\n  allow: [frontmatter-commands]\n',
    ),
  );
  return { root, pagePath };
}

describe("makeGenerateScripts", () => {
  it("writes the script parallel to the doc and persists the command reference", async () => {
    const { root, pagePath } = tempWorkspace();
    // Already a complete moose config on disk, so it parses as written.
    const config = parseConfig(
      readFileSync(join(root, "manni.config.yaml"), "utf8"),
      join(root, "manni.config.yaml"),
    );
    const page = readPage(pagePath, root);
    const plan = resolvePage(page, config);
    const target: GraderTarget = { plan, eval: plan.evals[0]! };

    const provider = new MockProvider([{ json: { code: SCRIPT_CODE } }]);
    const generate = makeGenerateScripts({ provider, root });
    const { generatedPaths } = await generate([target], config, {});

    expect(generatedPaths).toEqual(["docs/manni-docevals/sample.gen-me.mjs"]);
    const scriptPath = join(root, "docs", "manni-docevals", "sample.gen-me.mjs");
    expect(existsSync(scriptPath)).toBe(true);
    expect(readFileSync(scriptPath, "utf8")).toContain("manni docevals generated check");

    // Frontmatter now references the script; hash matches the assertion.
    const updated = readFileSync(pagePath, "utf8");
    expect(updated).toContain("manni-docevals/sample.gen-me.mjs");
    expect(updated).toContain(sha256("The page has a heading."));
    expect(updated).toContain("Body text stays byte-identical.");

    // In-memory eval mutated for the current run.
    expect(target.eval.command).toEqual([
      "node",
      "manni-docevals/sample.gen-me.mjs",
      "{file}",
    ]);
  });

  it("engine generates then executes the fresh script in one run", async () => {
    const { root } = tempWorkspace();
    const provider = new MockProvider([{ json: { code: SCRIPT_CODE } }]);
    const report = await runEvals({
      cwd: root,
      deterministicOnly: true,
      generateScripts: makeGenerateScripts({ provider, root }),
    });
    const result = report.evalResults.find((r) => r.evalName === "gen-me");
    // The generated script checks for a heading; the page has one.
    expect(result?.outcome).toBe("pass");
    // Flags the eval as generated on this run, so reporters can mark it.
    expect(result?.generated).toBe(true);
    expect(report.generated).toEqual(["docs/manni-docevals/sample.gen-me.mjs"]);
  });

  it("regenerates when the assertion hash is stale", async () => {
    const { root, pagePath } = tempWorkspace();
    // Pre-persist a command with a stale hash.
    writeFileSync(
      pagePath,
      readFileSync(pagePath, "utf8").replace(
        "      grader: command",
        [
          "      grader: command",
          '      command: ["node", "manni-docevals/old.mjs", "{file}"]',
          "      generated-assertion-hash: stale-hash",
        ].join("\n"),
      ),
    );
    const provider = new MockProvider([{ json: { code: SCRIPT_CODE } }]);
    const report = await runEvals({
      cwd: root,
      deterministicOnly: true,
      generateScripts: makeGenerateScripts({ provider, root }),
    });
    expect(report.generated).toEqual(["docs/manni-docevals/sample.gen-me.mjs"]);
    expect(readFileSync(pagePath, "utf8")).toContain("sample.gen-me.mjs");
    expect(provider.requests).toHaveLength(1);
  });

  it("reports an error outcome when generation fails", async () => {
    const { root } = tempWorkspace();
    const provider = new MockProvider([{ error: "model unavailable" }]);
    const report = await runEvals({
      cwd: root,
      deterministicOnly: true,
      generateScripts: makeGenerateScripts({ provider, root }),
    });
    const result = report.evalResults.find((r) => r.evalName === "gen-me");
    expect(result?.outcome).toBe("error");
    expect(report.exitCode).toBe(1);
  });

  it("scriptLocationFor routes config-sourced evals to the config scripts dir", () => {
    const { root, pagePath } = tempWorkspace();
    const config = parseDocevalsConfig(
      [
        "version: 1",
        "evals:",
        "  central-check:",
        "    assertion: Something deterministic.",
        "    grader: command",
        "suites:",
        "  s: { evals: [central-check] }",
      ].join("\n"),
      join(root, "manni.config.yaml"),
    );
    const page = readPage(pagePath, root);
    const plan = resolvePage(
      { ...page, frontmatter: { ...page.frontmatter, data: { "eval-suite": "s" } } },
      config,
    );
    const location = scriptLocationFor(
      { plan, eval: plan.evals[0]! },
      config,
      root,
    );
    expect(location.scriptAbsPath.replace(/\\/g, "/")).toContain(
      "manni-docevals-scripts/central-check.mjs",
    );
    expect(location.command).toEqual([
      "node",
      "manni-docevals-scripts/central-check.mjs",
      "{file}",
    ]);
  });
});
