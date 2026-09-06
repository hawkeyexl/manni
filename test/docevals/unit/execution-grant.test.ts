/**
 * The execution grant.
 *
 * Content reaches a shell by two paths: a `command` eval declared in page
 * frontmatter, and `tool:doc-detective` running steps written in a page
 * *body*. The old `scripts.allow-frontmatter-commands` boolean covered the
 * first and defaulted to **true**; nothing covered the second at all. Both are
 * now default-deny behind one grant.
 *
 * This is defense in depth, not a replacement for restricting untrusted pull
 * requests — a grant says "this corpus is trusted to execute", and a fork's
 * pages are not this corpus.
 */
import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runEvals } from "../../../src/docevals/core/engine.js";
import { parseConfig } from "../../../src/docevals/core/config.js";
import { runRun } from "../../../src/docevals/commands/run.js";

/** A page carrying a frontmatter command eval and a doc-detective eval. */
function scaffold(allow: string[]): string {
  const root = mkdtempSync(join(tmpdir(), "manni-docevals-grant-"));
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(
    join(root, "docs", "install.md"),
    [
      "---",
      "title: Install",
      "evals:",
      "  - id: runs-a-command",
      "    assertion: The check passes.",
      "    grader: command",
      "    command: [node, --version]",
      "  - id: runs-embedded-steps",
      "    assertion: The embedded steps pass.",
      "    grader: tool:doc-detective",
      "---",
      "",
      "# Install",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(root, "manni.config.yaml"),
    [
      "docevals:",
      "  version: 1",
      "  files:",
      '    include: ["docs/**/*.md"]',
      "  execution:",
      `    allow: [${allow.join(", ")}]`,
      "",
    ].join("\n"),
  );
  return root;
}

/**
 * Nothing here may reach a real binary — that is the property under test, and
 * a suite that shells out to check whether it shelled out is no test at all.
 * Every granted command resolves through this instead.
 */
const fakeExec = async (): Promise<{
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}> => ({ code: 0, stdout: "[]", stderr: "", timedOut: false });

const skipReasons = async (
  allow: string[],
  options: Record<string, unknown> = {},
) => {
  const report = await runEvals({
    cwd: scaffold(allow),
    generate: false,
    deterministicOnly: true,
    exec: fakeExec,
    ...options,
  });
  return Object.fromEntries(
    report.evalResults.map((r) => [r.evalName, r.skipReason ?? r.outcome]),
  );
};

describe("execution grant", () => {
  it("denies both paths by default", async () => {
    const reasons = await skipReasons([]);
    expect(reasons["runs-a-command"]).toContain("frontmatter commands not granted");
    expect(reasons["runs-embedded-steps"]).toContain(
      "page-embedded steps not granted",
    );
  });

  it("grants only what is named — frontmatter commands", async () => {
    const reasons = await skipReasons(["frontmatter-commands"]);
    expect(reasons["runs-a-command"]).not.toContain("not granted");
    // The other capability stays denied: trusting a repo's frontmatter is not
    // thereby trusting arbitrary steps written in its prose.
    expect(reasons["runs-embedded-steps"]).toContain(
      "page-embedded steps not granted",
    );
  });

  it("grants only what is named — page-embedded steps", async () => {
    const reasons = await skipReasons(["page-embedded-steps"]);
    expect(reasons["runs-a-command"]).toContain("frontmatter commands not granted");
    expect(reasons["runs-embedded-steps"]).not.toContain("not granted");
  });

  it("--no-execution clears a configured grant for one run", async () => {
    const reasons = await skipReasons(["frontmatter-commands"], {
      execution: false,
    });
    expect(reasons["runs-a-command"]).toContain("frontmatter commands not granted");
  });

  it("--allow-execution grants without touching the config", async () => {
    const reasons = await skipReasons([], {
      allowExecution: ["frontmatter-commands"],
    });
    expect(reasons["runs-a-command"]).not.toContain("not granted");
  });
});

describe("the removed boolean", () => {
  it("names its replacement instead of failing as an unknown key", () => {
    // Ajv would say "must NOT have additional properties" against `scripts`,
    // leaving the reader to find which child. It also flipped default — the
    // old key defaulted to true and the grant is default-deny — so a silent
    // migration would quietly stop running checks.
    expect(() =>
      parseConfig(
        [
          "docevals:",
          "  version: 1",
          "  scripts:",
          "    allow-frontmatter-commands: true",
        ].join("\n"),
        "/fake/manni.config.yaml",
      ),
    ).toThrow(/scripts\.allow-frontmatter-commands has been replaced by execution\.allow/);
  });
});

describe("the options.command bypass", () => {
  /**
   * Every `tool:*` adapter accepts an `options.command` argv override and
   * hands it to `exec`. That is a second spelling of "run this command",
   * reached without the `command` grader and so without the grant check that
   * guards it — which makes the default-deny posture decorative: a page that
   * cannot say `grader: command` can say `grader: tool:vale` with the same
   * argv and get the same shell.
   *
   * The gate is on *page-authored argv*, not on the grader, so it covers the
   * five adapters that read the key today and any added later.
   */
  function scaffoldOverride(allow: string[], source: "page" | "config"): string {
    const root = mkdtempSync(join(tmpdir(), "manni-docevals-bypass-"));
    mkdirSync(join(root, "docs"), { recursive: true });
    const pageEval =
      source === "page"
        ? [
            "evals:",
            "  - id: sneaky",
            "    assertion: The style guide passes.",
            "    grader: tool:vale",
            "    options:",
            "      command: [node, --version]",
          ]
        : ["evals:", "  - use: sneaky"];
    writeFileSync(
      join(root, "docs", "install.md"),
      ["---", "title: Install", ...pageEval, "---", "", "# Install", ""].join(
        "\n",
      ),
    );
    const configEval =
      source === "config"
        ? [
            "  evals:",
            "    sneaky:",
            "      assertion: The style guide passes.",
            "      grader: tool:vale",
            "      options:",
            "        command: [node, --version]",
          ]
        : [];
    writeFileSync(
      join(root, "manni.config.yaml"),
      [
        "docevals:",
        "  version: 1",
        "  files:",
        '    include: ["docs/**/*.md"]',
        ...configEval,
        "  execution:",
        `    allow: [${allow.join(", ")}]`,
        "",
      ].join("\n"),
    );
    return root;
  }

  const outcomeOf = async (allow: string[], source: "page" | "config") => {
    const report = await runEvals({
      cwd: scaffoldOverride(allow, source),
      generate: false,
      deterministicOnly: true,
      exec: fakeExec,
    });
    const r = report.evalResults.find((e) => e.evalName === "sneaky");
    return r?.skipReason ?? r?.outcome;
  };

  it("denies a page-authored options.command without the grant", async () => {
    expect(await outcomeOf([], "page")).toContain(
      "frontmatter commands not granted",
    );
  });

  it("runs it once the grant is given", async () => {
    expect(await outcomeOf(["frontmatter-commands"], "page")).not.toContain(
      "not granted",
    );
  });

  it("leaves a config-authored override alone", async () => {
    // The grant is about *content* driving execution. A command in
    // `manni.config.yaml` is the operator's own, and gating it would break
    // every configured tool override for no security gain.
    expect(await outcomeOf([], "config")).not.toContain("not granted");
  });
});

describe("an unknown grant is refused, not ignored", () => {
  it("throws rather than granting nothing", async () => {
    // The CLI validates its own flag, but this is also the programmatic entry
    // point. A grant nobody recognizes that silently grants nothing skips
    // every command eval and exits 0 — which reads as a clean corpus.
    await expect(
      runRun([], {
        cwd: scaffold([]),
        allowExecution: ["frontmatter-comands"],
        deterministicOnly: true,
        generate: false,
      }),
    ).rejects.toThrow(/unknown execution grant "frontmatter-comands"/);
  });

  it("names every unknown value, not just the first", async () => {
    await expect(
      runRun([], {
        cwd: scaffold([]),
        allowExecution: ["nope", "also-nope"],
        deterministicOnly: true,
        generate: false,
      }),
    ).rejects.toThrow(/unknown execution grants "nope", "also-nope"/);
  });

  it("accepts the real ones", async () => {
    await expect(
      runRun(
        [],
        {
          cwd: scaffold([]),
          allowExecution: ["frontmatter-commands", "page-embedded-steps"],
          deterministicOnly: true,
          generate: false,
        },
        { exec: fakeExec },
      ),
    ).resolves.not.toThrow();
  });
});
