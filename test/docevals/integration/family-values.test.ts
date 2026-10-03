/**
 * `manni docevals` speaking the family's shared values, against the built
 * `dist/cli.js`: the format names every domain uses, with each usage error's
 * stderr line and exit code.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../../..");
const MANNI = join(ROOT, "dist", "cli.js");
// The fixture showcase's config sits beside its pages, so a run started there
// discovers it, and the page is named the way a reader in that directory would.
const PAGES = join(ROOT, "test/docevals/fixtures/pages");
const PAGE = "docs/actions/find.mdx";

interface Run {
  stdout: string;
  stderr: string;
  status: number | null;
}

function manni(args: string[], cwd = PAGES): Run {
  const r = spawnSync("node", [MANNI, "docevals", ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status };
}

describe("manni docevals --format", () => {
  it("lists all seven run formats in its help", () => {
    const run = manni(["run", "--help"]);
    expect(run.status).toBe(0);
    expect(run.stdout.replace(/\s+/g, " ")).toContain(
      "Output format: pretty | json | markdown | github | sarif | junit | html (default: \"pretty\")",
    );
  });

  it("lists pretty and json for list and fill", () => {
    for (const verb of ["list", "fill"]) {
      const run = manni([verb, "--help"]);
      expect(run.stdout.replace(/\s+/g, " ")).toContain(
        'Output format: pretty | json (default: "pretty")',
      );
    }
  });

  it("renders pretty by default and when named", () => {
    const bare = manni(["list", PAGE]);
    const named = manni(["list", PAGE, "-f", "pretty"]);
    expect(bare.status).toBe(0);
    expect(named.stdout).toBe(bare.stdout);
  });

  it("refuses human on run, exit 2", () => {
    const run = manni(["run", PAGE, "--deterministic-only", "-f", "human"]);
    expect(run.status).toBe(2);
    expect(run.stdout).toBe("");
    expect(run.stderr).toBe(
      'manni: --format must be one of pretty | json | markdown | github | sarif | junit | html, got "human"\n',
    );
  });

  it("refuses human on list and fill, exit 2", () => {
    for (const verb of ["list", "fill"]) {
      const run = manni([verb, PAGE, "-f", "human"]);
      expect(run.status).toBe(2);
      expect(run.stderr).toBe('manni: --format must be one of pretty | json, got "human"\n');
    }
  });
});

describe("manni docevals usage errors", () => {
  // Commander's own parse errors exit 1 unless the program overrides its exit,
  // which reads as "the corpus failed" to a CI job. Every other domain maps
  // them to 2; docevals must too.
  it("refuses a flag the verb does not take, exit 2", () => {
    const run = manni(["list", PAGE, "--since", "main"]);
    expect(run.status).toBe(2);
    expect(run.stdout).toBe("");
    expect(run.stderr).toBe("error: unknown option '--since'\n(add --help for usage)\n");
  });

  it("refuses an option with its argument missing, exit 2", () => {
    const run = manni(["run", PAGE, "--deterministic-only", "--since"]);
    expect(run.status).toBe(2);
    expect(run.stderr).toBe("error: option '--since <ref>' argument missing\n(add --help for usage)\n");
  });

  it("refuses the removed page-embedded-steps grant, exit 2", () => {
    const run = manni([
      "run",
      PAGE,
      "--deterministic-only",
      "--allow-execution",
      "page-embedded-steps",
    ]);
    expect(run.status).toBe(2);
    expect(run.stdout).toBe("");
    expect(run.stderr).toBe(
      'manni: --allow-execution must be one of frontmatter-commands, got "page-embedded-steps"\n',
    );
  });

  it("still exits 0 for --help and --version", () => {
    expect(manni(["list", "--help"]).status).toBe(0);
    expect(manni(["--version"]).status).toBe(0);
  });
});

describe("manni docevals configuration", () => {
  it("refuses a kebab-case section key, naming its camelCase spelling", () => {
    const run = manni(["list", "docs/page.md"], join(ROOT, "test/docevals/fixtures/kebab-section-key"));
    expect(run.status).toBe(2);
    expect(run.stderr).toMatch(/^manni: Invalid config in .*manni\.config\.yaml:\n/);
    expect(run.stderr).toContain(
      '\nmanni:   /docevals/judge: unknown key "ensemble-runs"; did you mean "ensembleRuns"?\n',
    );
  });

  it("refuses an eval naming a grader that is not registered, exit 2", () => {
    const cwd = mkdtempSync(join(tmpdir(), "manni-docevals-unknown-grader-"));
    mkdirSync(join(cwd, "docs"));
    writeFileSync(join(cwd, "docs", "page.md"), "---\ntitle: Page\n---\nBody.\n");
    writeFileSync(
      join(cwd, "manni.config.yaml"),
      [
        "docevals:",
        "  evals:",
        "    fresh-enough:",
        "      assertion: The page was reviewed within the last year.",
        "      grader: tool:freshness",
        "",
      ].join("\n"),
    );
    const expected =
      'manni: manni.config.yaml: eval "fresh-enough" names grader "tool:freshness", ' +
      "which is not registered. Registered graders: ai, command, human, tool:regex.\n";
    const verbs = [
      ["run", "docs/page.md", "--deterministic-only"],
      ["list", "docs/page.md"],
    ];
    for (const args of verbs) {
      const run = manni(args, cwd);
      expect(run.status).toBe(2);
      expect(run.stdout).toBe("");
      expect(run.stderr).toBe(expected);
    }
  });

  it("refuses severity: info as a schema error", () => {
    const run = manni(["list", "docs/page.md"], join(ROOT, "test/docevals/fixtures/info-severity"));
    expect(run.status).toBe(2);
    expect(run.stderr).toContain(
      "\nmanni:   /docevals/evals/no-todo-markers/severity: must be equal to one of the allowed values\n",
    );
  });
});
