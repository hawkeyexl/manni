/**
 * A run that checked nothing must not read as success (ADR 01041).
 *
 * The shape this file exists for: a corpus whose pages carry no eval
 * frontmatter, against a config whose `defaults.suite` is `null`. Every page
 * discovers, every page resolves, and not one eval attaches — so `runEvals`
 * returned `evalResults: []`, `hasFailure` had no "nothing ran" term, and the
 * run exited **0** after printing a blank line and the word `Suites`. The same
 * condition reached through `--eval no-such-eval` was already exit 2 with a
 * careful message (ADR 01018); reached through configuration it was silence.
 *
 * The boundary these tests pin is *where* the check sits. It reads the
 * **resolved** plan, before any narrowing:
 *
 * - `--eval` / `--suite` own their own empty-match error (ADR 01018), and it
 *   names what was asked for.
 * - `--since` deliberately answers "no page changed" with exit 0 and a
 *   sentence (ADR 01040), so it must not be converted into a usage error by a
 *   check that runs after scoping.
 * - A resolution error is itself the diagnosis, and must not be swallowed by
 *   an empty-plan error raised in front of it.
 */
import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runEvals } from "../../../src/docevals/core/engine.js";
import { DocevalsError } from "../../../src/docevals/types.js";
import type { ExecFn, ExecResult } from "../../../src/docevals/graders/types.js";

const BODY = "\n# Install\n\nRun the installer.\n";

const OK: ExecResult = { code: 0, stdout: "", stderr: "", timedOut: false };

/**
 * A config that defines an eval and a suite but attaches neither by default —
 * exactly what `init` scaffolded, and the state every corpus is in on day one.
 */
const CONFIG = [
  "docevals:",
  "  version: 1",
  "  files:",
  '    include: ["docs/**/*.md"]',
  "  defaults:",
  "    suite: null",
  "  evals:",
  "    fresh-enough:",
  "      assertion: The page was reviewed within the last century.",
  "      grader: tool:freshness",
  "      options:",
  "        max-age-days: 100000",
  "      severity: error",
  "    no-future-promises:",
  "      assertion: The page makes no claims about unreleased functionality.",
  "      grader: ai",
  "  suites:",
  "    default:",
  "      target-pass-rate: 1.0",
  "      evals: [fresh-enough]",
  "    judged:",
  "      target-pass-rate: 1.0",
  "      evals: [no-future-promises]",
  "",
];

interface PageSpec {
  name: string;
  frontmatter: string[];
}

function scaffold(pages: PageSpec[], config: string[] = CONFIG): string {
  const root = mkdtempSync(join(tmpdir(), "manni-docevals-nothing-"));
  mkdirSync(join(root, "docs"), { recursive: true });
  for (const p of pages) {
    writeFileSync(
      join(root, "docs", p.name),
      // A review date on every page, so `fresh-enough` passes wherever it
      // resolves — these tests are about what ran, not about what it found.
      ["---", "last-reviewed: 2026-08-01", ...p.frontmatter, "---", BODY].join(
        "\n",
      ),
    );
  }
  writeFileSync(join(root, "manni.config.yaml"), config.join("\n"));
  return root;
}

const run = (root: string, options: Record<string, unknown> = {}) =>
  runEvals({ cwd: root, generate: false, ...options });

/** git that reports a clean tree, so `--since` scopes the run to nothing. */
const cleanGit: ExecFn = (cmd) =>
  Promise.resolve(
    cmd[1] === "rev-parse" ? { ...OK, stdout: `${process.cwd()}\n` } : OK,
  );

describe("a run that resolved no evals at all", () => {
  it("is a usage error, not a green run over nothing", async () => {
    const root = scaffold([
      { name: "a.md", frontmatter: ["title: A"] },
      { name: "b.md", frontmatter: ["title: B"] },
    ]);
    await expect(run(root)).rejects.toThrow(DocevalsError);
  });

  // The whole population of this error is a config that selects nothing, so
  // the message has to name the two keys that would attach an eval, and the
  // command that shows the resolved plan.
  it("names how many pages resolved nothing, and how to attach an eval", async () => {
    const root = scaffold([{ name: "a.md", frontmatter: ["title: A"] }]);
    await expect(run(root)).rejects.toThrow(/No evals resolved/);
    await expect(run(root)).rejects.toThrow(/1 page/);
    await expect(run(root)).rejects.toThrow(/defaults\.suite/);
    await expect(run(root)).rejects.toThrow(/eval-suite/);
    await expect(run(root)).rejects.toThrow(/manni docevals list/);
  });

  it("does not fire when a single page resolves a single eval", async () => {
    const root = scaffold([
      { name: "a.md", frontmatter: ["title: A", "eval-suite: default"] },
      { name: "b.md", frontmatter: ["title: B"] },
    ]);
    const report = await run(root);
    expect(report.evalResults).toHaveLength(1);
    expect(report.exitCode).toBe(0);
  });

  // A page whose frontmatter is broken resolves zero evals *and* an
  // error-level problem. The problem is the diagnosis; raising the empty-plan
  // error in front of it would replace a message naming the bad key with one
  // telling the reader to configure a suite they already configured.
  it("yields to a resolution error rather than hiding it", async () => {
    const root = scaffold([
      { name: "a.md", frontmatter: ["title: A", "eval-suit: default"] },
    ]);
    const report = await run(root);
    expect(report.exitCode).toBe(1);
    expect(report.problems.map((p) => p.message).join("\n")).toMatch(
      /eval-suit/,
    );
  });
});

describe("the narrowing flags keep their own answers", () => {
  // ADR 01040: a clean tree is exit 0 and a sentence, never a usage error.
  // Scoping runs *after* this check, so an empty scope must not reach it.
  it("an empty --since scope still exits 0 on a corpus that resolves evals", async () => {
    const root = scaffold([
      { name: "a.md", frontmatter: ["title: A", "eval-suite: default"] },
    ]);
    const report = await run(root, { since: "HEAD", exec: cleanGit });
    expect(report.exitCode).toBe(0);
    expect(report.since?.pagesSelected).toBe(0);
    expect(report.evalResults).toHaveLength(0);
  });

  // ADR 01018's message names what was asked for; the empty-plan error must
  // not pre-empt it on a corpus that does resolve evals.
  it("--eval matching nothing keeps its own message", async () => {
    const root = scaffold([
      { name: "a.md", frontmatter: ["title: A", "eval-suite: default"] },
    ]);
    await expect(run(root, { evalNames: ["no-such-eval"] })).rejects.toThrow(
      /no-such-eval/,
    );
  });
});

describe("evals resolved, but none of them graded", () => {
  // Deliberately *not* an error: `eval-skip` is a feature, the report is not
  // empty, and every line in it says `skip`. It still must not be silent.
  it("warns when every resolved eval was skipped at the page level", async () => {
    const root = scaffold([
      {
        name: "a.md",
        frontmatter: ["title: A", "eval-suite: default", "eval-skip: true"],
      },
    ]);
    const report = await run(root);
    expect(report.exitCode).toBe(0);
    expect(report.evalResults.every((r) => r.outcome === "skipped")).toBe(true);
    const warnings = report.problems.filter((p) => p.level === "warning");
    expect(warnings.map((p) => p.message).join("\n")).toMatch(
      /graded nothing/,
    );
  });

  // The same warning through a different route: a corpus of ai evals under
  // `--deterministic-only` grades nothing either, and that combination is a
  // standing CI invocation rather than a mistake anyone notices.
  it("warns when a grader-class flag skipped everything", async () => {
    const root = scaffold([
      { name: "a.md", frontmatter: ["title: A", "eval-suite: judged"] },
    ]);
    const report = await run(root, { deterministicOnly: true });
    expect(report.exitCode).toBe(0);
    expect(report.problems.map((p) => p.message).join("\n")).toMatch(
      /graded nothing/,
    );
  });

  // The guard against fixing the above by warning on every run.
  it("stays quiet when something actually reached a verdict", async () => {
    const root = scaffold([
      { name: "a.md", frontmatter: ["title: A", "eval-suite: default"] },
    ]);
    const report = await run(root);
    expect(report.problems.map((p) => p.message).join("\n")).not.toMatch(
      /graded nothing/,
    );
  });

  // Human review is work, not silence: those results are reported, counted,
  // and the human reporter already tells the reader to run `review`.
  it("stays quiet when the only results need human review", async () => {
    const root = scaffold(
      [{ name: "a.md", frontmatter: ["title: A", "eval-suite: default"] }],
      CONFIG.map((l) => l.replace("grader: tool:freshness", "grader: human")),
    );
    const report = await run(root);
    expect(report.evalResults.every((r) => r.outcome === "needs-review")).toBe(
      true,
    );
    expect(report.problems.map((p) => p.message).join("\n")).not.toMatch(
      /graded nothing/,
    );
  });
});

describe("a skipped page is not an unconfigured one", () => {
  // The regression that found this rule's first draft too wide.
  // `test/fixtures/pages/index.mdx` carries `eval-skip: true` and nothing
  // else, against a config with `defaults.suite: null` — so it resolves *zero*
  // evals rather than evals that are then skipped, and a rule counting
  // resolved evals over every page turned a documented, deliberate skip into a
  // usage error. `docs/src/content/docs/evals/index.mdx` runs exactly that
  // command and expects exit 0.
  it("does not raise the empty-plan error when every page is skipped", async () => {
    const root = scaffold([
      { name: "a.md", frontmatter: ["title: A", "eval-skip: true"] },
      { name: "b.md", frontmatter: ["title: B", "eval-skip: true"] },
    ]);
    const report = await run(root);
    expect(report.exitCode).toBe(0);
  });

  // ...but it still must not be an indistinguishable green: there are no
  // results at all to look at here, so the warning is the only signal.
  it("still says the run graded nothing", async () => {
    const root = scaffold([
      { name: "a.md", frontmatter: ["title: A", "eval-skip: true"] },
    ]);
    const report = await run(root);
    expect(report.evalResults).toHaveLength(0);
    expect(report.problems.map((p) => p.message).join("\n")).toMatch(
      /graded nothing/,
    );
  });

  // The guard against widening the rule past the skip: one page the author did
  // *not* skip, with nothing configured to check it, is still the original
  // defect and still exit 2.
  it("still raises when one unskipped page resolves nothing", async () => {
    const root = scaffold([
      { name: "a.md", frontmatter: ["title: A", "eval-skip: true"] },
      { name: "b.md", frontmatter: ["title: B"] },
    ]);
    await expect(run(root)).rejects.toThrow(/No evals resolved/);
  });

  // An empty `--since` scope produces no results either, and ADR 01040 gives
  // it its own sentence. The general warning fires as well rather than being
  // carved out — a carve-out is how this class of bug comes back.
  it("says so for an empty --since scope too", async () => {
    const root = scaffold([
      { name: "a.md", frontmatter: ["title: A", "eval-suite: default"] },
    ]);
    const report = await run(root, { since: "HEAD", exec: cleanGit });
    expect(report.exitCode).toBe(0);
    expect(report.problems.map((p) => p.message).join("\n")).toMatch(
      /graded nothing/,
    );
  });
});
