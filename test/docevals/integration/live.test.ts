/**
 * Live smoke test — runs one real eval and one real script generation via the
 * Claude CLI (local auth, no API key). Opt-in:
 *
 *   MOOSE_DOCEVALS_LIVE=1 npm test
 *
 * Asserts only shape and zone membership, never exact verdicts — live model
 * output is nondeterministic by nature.
 */
import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runEvals } from "../../../src/docevals/core/engine.js";
import { nestUnderDocevals } from "../helpers/config.js";
import { makeJudge } from "../../../src/docevals/judge/judge.js";
import { makeGenerateScripts } from "../../../src/docevals/graders/scriptgen.js";
import { ClaudeCliProvider } from "@hawkeyexl/inference";

const ROOT = resolve(import.meta.dirname, "../../..");
const LIVE = process.env.MOOSE_DOCEVALS_LIVE === "1";

describe.skipIf(!LIVE)("live smoke via Claude CLI", () => {
  const provider = new ClaudeCliProvider("claude-sonnet-4-5");

  it("judges one fixture eval end-to-end", async () => {
    const judge = makeJudge({ provider, root: ROOT });
    const report = await runEvals({
      cwd: ROOT,
      globs: ["test/docevals/fixtures/pages/docs/get-started/concepts.md"],
      generate: false,
      judgeOptions: { runs: 1, noCache: true },
      judge,
    });
    const judged = report.evalResults.find(
      (r) => r.evalName === "defines-core-terms",
    );
    expect(judged?.consensus).toBeDefined();
    expect(judged?.consensus?.runs).toHaveLength(1);
    const verdictRun = judged?.consensus?.runs[0];
    expect(verdictRun?.verdict ?? verdictRun?.error).toBeDefined();
    expect(["auto-pass", "auto-fail", "human-review"]).toContain(
      judged?.consensus?.zone,
    );
  }, 300000);

  it("generates a real check script for a plain-language assertion", async () => {
    const root = mkdtempSync(join(tmpdir(), "manni-docevals-live-"));
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(
      join(root, "docs", "page.md"),
      [
        "---",
        "title: Live",
        "evals:",
        "  - id: has-code-block",
        "    assertion: The page contains at least one fenced code block.",
        "    grader: command",
        "---",
        "",
        "# Live page",
        "",
        "```bash",
        "echo hello",
        "```",
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(root, "manni.config.yaml"),
      nestUnderDocevals('version: 1\nfiles:\n  include: ["docs/**/*.md"]\n'),
    );
    const report = await runEvals({
      cwd: root,
      deterministicOnly: true,
      generateScripts: makeGenerateScripts({ provider, root }),
    });
    expect(report.generated).toHaveLength(1);
    const result = report.evalResults.find((r) => r.evalName === "has-code-block");
    // The generated script must run; a correct script passes this page.
    expect(["pass", "fail"]).toContain(result?.outcome);
  }, 300000);
});
