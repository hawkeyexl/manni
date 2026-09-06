/**
 * `manni docevals generate` — the wrapper in front of script generation. What it
 * owns is *selection*: which command-graded evals still need a check script.
 * `makeGenerateScripts` itself is covered by scriptgen.test.ts, but nothing
 * exercised the loop that feeds it, and the fixture dogfood in CI runs with
 * `--no-generate`, so the branch was dark end to end as well.
 *
 * Every assertion here is about what does or does not become a target. The
 * MockProvider is scripted with one usable response and its `requests` array is
 * the ground truth for "was generation attempted at all".
 */
import { describe, it, expect } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockProvider } from "@hawkeyexl/inference";
import { runGenerate } from "../../../src/docevals/commands/generate.js";
import { sha256 } from "../../../src/docevals/judge/cache.js";

const ASSERTION = "The page has a level-1 heading.";
/** A different assertion, standing in for what the eval used to say. */
const OLD_ASSERTION = "The page links to the release notes.";

const BODY = [
  "",
  "# Install",
  "",
  "Run this:",
  "",
  "```bash",
  "npm i -g doc-detective",
  "```",
  "",
].join("\n");

const SCRIPT_CODE = [
  'import { readFileSync } from "node:fs";',
  'const content = readFileSync(process.argv[2], "utf8");',
  "process.exit(/^# /m.test(content) ? 0 : 1);",
  "",
].join("\n");

/** The command a previous generation run would have written back. */
const COMMAND =
  'command: ["node", "manni-docevals/install.heading.mjs", "{file}"]';

/** A provider holding exactly one scriptgen answer. */
const scriptgen = (): MockProvider =>
  new MockProvider([{ json: { code: SCRIPT_CODE } }]);

/** A temp repo with one page whose frontmatter is exactly `frontmatter`. */
function scaffold(frontmatter: string[]): string {
  const root = mkdtempSync(join(tmpdir(), "manni-docevals-generate-"));
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(
    join(root, "docs", "install.md"),
    ["---", "title: Install", ...frontmatter, "---", BODY].join("\n"),
  );
  writeFileSync(
    join(root, "manni.config.yaml"),
    [
      "docevals:",
      "  version: 1",
      "  files:",
      '    include: ["docs/**/*.md"]',
      // Generated scripts are `command` evals declared in page frontmatter, so
      // running them at all needs the grant. Without it these tests would
      // assert on a skip, not on generation.
      "  execution:",
      "    allow: [frontmatter-commands]",
      "",
    ].join("\n"),
  );
  return root;
}

const pagePath = (root: string) => join(root, "docs", "install.md");
const SCRIPT_REL = "docs/manni-docevals/install.heading.mjs";

describe("runGenerate", () => {
  // The early return in front of provider construction is the whole reason a
  // corpus with nothing to generate does not need an API key. With no provider
  // configured `makeProvider` raises a DocevalsError, so this test fails loudly
  // the moment that return moves below it.
  it("returns no targets, and needs no provider, when nothing is command-graded", async () => {
    const root = scaffold([
      "evals:",
      "  - id: heading",
      `    assertion: ${ASSERTION}`,
      "    grader: ai",
    ]);
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;

    await expect(runGenerate([], { cwd: root })).resolves.toEqual({
      generatedPaths: [],
      targets: 0,
    });
  });

  // The generation contract: `grader: command` with an assertion and no
  // command is a request for a script, not a misconfiguration.
  it("generates for a command eval with an assertion and no command", async () => {
    const root = scaffold([
      "evals:",
      "  - id: heading",
      `    assertion: ${ASSERTION}`,
      "    grader: command",
    ]);

    const run = await runGenerate([], {
      cwd: root,
      providerInstance: scriptgen(),
    });

    expect(run).toEqual({ generatedPaths: [SCRIPT_REL], targets: 1 });
    expect(existsSync(join(root, SCRIPT_REL))).toBe(true);
    // The hash write-back is what keeps the next run from regenerating it.
    expect(readFileSync(pagePath(root), "utf8")).toContain(sha256(ASSERTION));
  });

  // Idempotence. A generated eval whose assertion is unchanged is finished
  // work; regenerating would overwrite a reviewed script on every run.
  it("skips a generated eval whose hash still matches its assertion", async () => {
    const root = scaffold([
      "evals:",
      "  - id: heading",
      `    assertion: ${ASSERTION}`,
      "    grader: command",
      `    ${COMMAND}`,
      `    generated-assertion-hash: ${sha256(ASSERTION)}`,
    ]);
    const provider = scriptgen();

    await expect(
      runGenerate([], { cwd: root, providerInstance: provider }),
    ).resolves.toEqual({ generatedPaths: [], targets: 0 });
    expect(provider.requests).toHaveLength(0);
  });

  // The case the hash exists for: the author reworded the assertion, so the
  // committed script now checks something the eval no longer claims. Running
  // the old script would report a green eval for an assertion nobody verified.
  it("regenerates when the assertion changed since generation", async () => {
    const root = scaffold([
      "evals:",
      "  - id: heading",
      `    assertion: ${ASSERTION}`,
      "    grader: command",
      `    ${COMMAND}`,
      `    generated-assertion-hash: ${sha256(OLD_ASSERTION)}`,
    ]);

    const run = await runGenerate([], {
      cwd: root,
      providerInstance: scriptgen(),
    });

    expect(run).toEqual({ generatedPaths: [SCRIPT_REL], targets: 1 });
    const after = readFileSync(pagePath(root), "utf8");
    expect(after).toContain(sha256(ASSERTION));
    expect(after).not.toContain(sha256(OLD_ASSERTION));
  });

  // No hash means no machine wrote this command. A hand-authored check is the
  // author's, and regenerating over it would destroy work the tool never did.
  it("leaves a hand-written command alone when there is no generated hash", async () => {
    const root = scaffold([
      "evals:",
      "  - id: heading",
      `    assertion: ${ASSERTION}`,
      "    grader: command",
      `    ${COMMAND}`,
    ]);
    const provider = scriptgen();

    await expect(
      runGenerate([], { cwd: root, providerInstance: provider }),
    ).resolves.toEqual({ generatedPaths: [], targets: 0 });
    expect(provider.requests).toHaveLength(0);
  });

  // An assertion is the only input generation has, so an eval without one can
  // never be a target. The bare "no command, no assertion" spelling cannot
  // reach the selector at all — the frontmatter schema requires a command eval
  // to carry one or the other — so the reachable shape is a command plus a
  // hash and no assertion. That is also the shape that would hand `undefined`
  // to sha256 if the staleness check stopped guarding for the assertion.
  it("skips a command eval that has no assertion to generate from", async () => {
    const root = scaffold([
      "evals:",
      "  - id: heading",
      "    grader: command",
      `    ${COMMAND}`,
      `    generated-assertion-hash: ${sha256(OLD_ASSERTION)}`,
    ]);
    const provider = scriptgen();

    await expect(
      runGenerate([], { cwd: root, providerInstance: provider }),
    ).resolves.toEqual({ generatedPaths: [], targets: 0 });
    expect(provider.requests).toHaveLength(0);
  });

  // A skip is a declaration that this page is not being checked. Generating
  // for it anyway would write script files and rewrite frontmatter for evals
  // the author switched off.
  it("skips every eval on a page marked eval-skip", async () => {
    const root = scaffold([
      "eval-skip: true",
      "evals:",
      "  - id: heading",
      `    assertion: ${ASSERTION}`,
      "    grader: command",
    ]);
    const provider = scriptgen();

    await expect(
      runGenerate([], { cwd: root, providerInstance: provider }),
    ).resolves.toEqual({ generatedPaths: [], targets: 0 });
    expect(provider.requests).toHaveLength(0);
  });

  it("skips an individual eval marked skip", async () => {
    const root = scaffold([
      "evals:",
      "  - id: heading",
      `    assertion: ${ASSERTION}`,
      "    grader: command",
      "    skip: true",
    ]);
    const provider = scriptgen();

    await expect(
      runGenerate([], { cwd: root, providerInstance: provider }),
    ).resolves.toEqual({ generatedPaths: [], targets: 0 });
    expect(provider.requests).toHaveLength(0);
  });
});

/**
 * A config-defined eval is one eval, however many pages reference it.
 *
 * `makeGenerateScripts` already knows this — it carries a `doneConfigEvals` set
 * and writes one script. `runGenerate` did not, so it counted one target per
 * *page*. The counts then disagreed, and `src/cli.ts` turns that disagreement
 * into an exit code: `Generated 1/2 check script(s)` followed by
 * `process.exitCode = 1`. A completely successful run reported failure, and the
 * comparison that was supposed to catch a genuine partial generation could
 * never be trusted again. `runPromote` avoids this with `seenConfigEvals`.
 */
describe("runGenerate: a config eval shared by several pages", () => {
  function sharedConfigCorpus(): string {
    const root = mkdtempSync(join(tmpdir(), "manni-docevals-generate-shared-"));
    mkdirSync(join(root, "docs"), { recursive: true });
    for (const name of ["install.md", "second.md"]) {
      writeFileSync(
        join(root, "docs", name),
        ["---", "title: Page", "evals:", "  - use: has-heading", "---", BODY].join("\n"),
      );
    }
    writeFileSync(
      join(root, "manni.config.yaml"),
      [
        "docevals:",
        "  version: 1",
        "  files:",
        '    include: ["docs/**/*.md"]',
        "  evals:",
        "    has-heading:",
        `      assertion: ${ASSERTION}`,
        "      grader: command",
        "",
      ].join("\n"),
    );
    return root;
  }

  /**
   * The other way a page reaches a config eval: `eval-suite` pulls in the
   * suite's whole membership list, with no `evals:` key on the page at all.
   * `use:` and `eval-suite` are separate branches of `resolvePage`, so covering
   * one does not cover the other.
   */
  function sharedSuiteCorpus(): string {
    const root = mkdtempSync(join(tmpdir(), "manni-docevals-generate-suite-"));
    mkdirSync(join(root, "docs"), { recursive: true });
    for (const name of ["install.md", "second.md"]) {
      writeFileSync(
        join(root, "docs", name),
        ["---", "title: Page", "eval-suite: s", "---", BODY].join("\n"),
      );
    }
    writeFileSync(
      join(root, "manni.config.yaml"),
      [
        "docevals:",
        "  version: 1",
        "  files:",
        '    include: ["docs/**/*.md"]',
        "  evals:",
        "    central-check:",
        `      assertion: ${ASSERTION}`,
        "      grader: command",
        "  suites:",
        "    s:",
        "      evals: [central-check]",
        "",
      ].join("\n"),
    );
    return root;
  }

  it("counts a suite-reached config eval once as well", async () => {
    const result = await runGenerate([], {
      cwd: sharedSuiteCorpus(),
      providerInstance: scriptgen(),
    });
    expect(result.targets).toBe(1);
    expect(result.generatedPaths).toHaveLength(1);
  });

  it("counts it once, so a successful run does not report a partial one", async () => {
    const root = sharedConfigCorpus();
    const result = await runGenerate([], {
      cwd: root,
      providerInstance: scriptgen(),
    });

    // The count the CLI compares against generatedPaths.length to decide the
    // exit code. Two pages, one eval, one script: targets must be 1.
    expect(result.targets).toBe(1);
    expect(result.generatedPaths).toHaveLength(1);
    expect(result.generatedPaths.length).toBe(result.targets);
  });
});
