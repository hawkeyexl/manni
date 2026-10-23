/**
 * `manni strategy …` against the built `dist/cli.js`: the grammar, the flags it
 * shares with meta and term, the ladder of proposal 0102, and every usage
 * error with its exact stderr line and exit code.
 *
 * Every run works in a throwaway copy of `test/fixtures/strategy`, because
 * `--baseline` writes into it and some rungs edit a config.
 */
import { execSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SEVERITY } from "../../src/strategy/core/severity.js";
import { STRATEGY_RULES } from "../../src/strategy/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const manni = resolve(root, "dist", "cli.js");
const FIXTURES = resolve(root, "test", "fixtures", "strategy");

interface Run {
  stdout: string;
  stderr: string;
  status: number;
}

let work: string;

function strategy(args: string[], opts: { cwd?: string; input?: string } = {}): Run {
  const r = spawnSync(process.execPath, [manni, "strategy", ...args], {
    cwd: opts.cwd ?? join(work, "clean"),
    encoding: "utf8",
    input: opts.input,
    env: { ...process.env, NO_COLOR: "1" },
  });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status ?? 1 };
}

/** A fixture's config with more appended. */
function configure(fixture: string, extra: string): string {
  const cwd = join(work, fixture);
  const path = join(cwd, "manni.config.yaml");
  writeFileSync(path, `${readFileSync(path, "utf8")}${extra}`);
  return cwd;
}

beforeAll(() => {
  if (!existsSync(manni)) execSync("npm run build", { cwd: root, stdio: "ignore" });
}, 180000);

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "manni-strategy-cli-"));
  cpSync(FIXTURES, work, { recursive: true });
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

describe("manni strategy (grammar)", () => {
  it("is mounted on the umbrella, after term", () => {
    const r = spawnSync(process.execPath, [manni, "--help"], { encoding: "utf8" });
    expect(r.stdout).toMatch(/^ {2}term \[options\][\s\S]*^ {2}strategy \[options\] +Check a docset's pages against its audiences,/m);
  });

  it("lists the three verbs", () => {
    const r = strategy(["--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^Usage: manni strategy /m);
    for (const verb of ["list", "get", "check"]) expect(r.stdout).toMatch(new RegExp(`^\\s+${verb}\\b`, "m"));
  });

  it("has no default subcommand: a bare run prints the full help to stderr, exit 2", () => {
    const r = strategy([]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/^Usage: manni strategy \[options\] \[command\]/m);
    for (const verb of ["list", "get", "check"]) expect(r.stderr).toMatch(new RegExp(`^\\s+${verb}\\b`, "m"));
  });

  it("shows each verb's usage line and the shared flags", () => {
    for (const verb of ["list", "check"]) {
      expect(strategy([verb, "--help"]).stdout).toMatch(
        new RegExp(`^Usage: manni strategy ${verb} \\[options\\] \\[paths\\.\\.\\.\\]$`, "m"),
      );
    }
    expect(strategy(["get", "--help"]).stdout).toMatch(/^Usage: manni strategy get \[options\] <id> \[paths\.\.\.\]$/m);
    for (const verb of ["list", "get", "check"]) {
      const help = strategy([verb, "--help"]).stdout;
      for (const flag of [
        "--as <format>",
        "--ext <list>",
        "--exclude <glob>",
        "--collection <name>",
        "--allow-empty",
        "--no-gitignore",
        "-c, --config <path>",
        "--no-color",
        "-f, --format <format>",
      ]) {
        expect(help, `${verb} ${flag}`).toContain(flag);
      }
    }
    expect(strategy(["check", "--help"]).stdout).toContain("--baseline");
    expect(strategy(["list", "--help"]).stdout).not.toContain("--baseline");
  });
});

describe("manni strategy (flags shared with meta and term)", () => {
  it("--allow-empty says no records in its help, and turns an empty set into success", () => {
    const help = strategy(["check", "--help"]).stdout.replace(/\s+/g, " ");
    expect(help).toContain("--allow-empty treat a missing path, no matched files or no records as success");
    const r = strategy(["check", "docs", "--allow-empty"]);
    expect(r.stdout).toBe("✓ 0 records, 7 references, no findings\n");
    expect(r.status).toBe(0);
    expect(strategy(["check", "nowhere/", "--allow-empty"]).status).toBe(0);
  });

  it("--ext keeps only the named extensions in a walk", () => {
    writeFileSync(
      join(work, "clean", "strategy", "journeys", "m3.html"),
      '<html><head><meta name="type" content="journey"><meta name="personas" content="maya"></head></html>',
    );
    expect(strategy(["list", "strategy"]).stdout).toContain("1 audience, 1 persona, 3 journeys");
    expect(strategy(["list", "strategy", "--ext", "md"]).stdout).toContain("1 audience, 1 persona, 2 journeys");
  });

  it("--exclude is repeatable, one glob per occurrence", () => {
    const r = strategy(["list", "strategy", "--exclude", "**/m1.md", "--exclude", "**/m2.md"]);
    expect(r.stdout).toContain("1 audience, 1 persona, 0 journeys");
  });

  it("--collection reads one configured collection", () => {
    expect(strategy(["list", "--collection", "strategy"]).stdout).toContain("1 audience, 1 persona, 2 journeys");
  });

  it("-c reads the config it names", () => {
    const cwd = join(work, "clean");
    mkdirSync(join(cwd, "elsewhere"));
    writeFileSync(join(cwd, "elsewhere", "strict.yaml"), `${readFileSync(join(cwd, "manni.config.yaml"), "utf8")}strategy:\n  severity:\n    unserved-journey: error\n`);
    writeFileSync(join(cwd, "docs", "guide.md"), "---\ntitle: Guide\naudiences: [docs-engineers]\npersonas: [maya]\njourneys: [m1]\n---\n");
    expect(strategy(["check", "strategy", "docs"]).status).toBe(0);
    const r = strategy(["check", "strategy", "docs", "-c", "elsewhere/strict.yaml"]);
    expect(r.stdout).toContain("error   manni:strategy/unserved-journey");
    expect(r.status).toBe(1);
  });
});

describe("manni strategy (the ladder)", () => {
  it("1. checks a clean set, exit 0", () => {
    const r = strategy(["check"]);
    expect(r.stdout).toBe("✓ 4 records, 10 references, no findings\n");
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });

  it("2. lists the tree", () => {
    const r = strategy(["list"]);
    expect(r.stdout).toBe(
      [
        "record            pages  title",
        "docs-engineers        2  Docs-as-code teams",
        "  maya                2  Maya, Documentation Engineer",
        "    m1                2  Stand up metadata validation for my repo",
        "    m2                1  Tighten the standard without breaking the build",
        "1 audience, 1 persona, 2 journeys",
        "",
      ].join("\n"),
    );
    expect(r.status).toBe(0);
    const json = JSON.parse(strategy(["list", "-f", "json"]).stdout) as { records: { id: string }[] };
    expect(json.records.map((record) => record.id)).toEqual(["docs-engineers", "maya", "m1", "m2"]);
  });

  it("3. gets a record by its id in any case", () => {
    const r = strategy(["get", "M1"]);
    expect(r.stdout).toBe(
      [
        "Stand up metadata validation for my repo      strategy/journeys/m1.md:1",
        "  type          journey",
        "  id            m1",
        "  personas      maya  Maya, Documentation Engineer",
        "  pages         docs/ci.md",
        "                docs/guide.md",
        "",
      ].join("\n"),
    );
    expect(r.status).toBe(0);
    expect(JSON.parse(strategy(["get", "m1", "-f", "json"]).stdout)).toEqual({
      id: "m1",
      type: "journey",
      title: "Stand up metadata validation for my repo",
      file: "strategy/journeys/m1.md",
      line: 1,
      personas: ["maya"],
      namedBy: { pages: ["docs/ci.md", "docs/guide.md"] },
    });
  });

  it("3. prints pages none for a record no page names", () => {
    writeFileSync(join(work, "clean", "docs", "guide.md"), "---\ntitle: Guide\naudiences: [docs-engineers]\npersonas: [maya]\njourneys: [m1]\n---\n");
    expect(strategy(["get", "m2"]).stdout.split("\n")).toContain("  pages         none");
  });

  it("4. annotates in CI: nothing when clean, exit 1 only on an error", () => {
    const clean = strategy(["check", "-f", "github"]);
    expect(clean.stdout).toBe("");
    expect(clean.status).toBe(0);

    writeFileSync(join(work, "clean", "docs", "guide.md"), "---\ntitle: Guide\naudiences: [docs-engineers]\npersonas: [maya]\njourneys: [m1]\n---\n");
    const warned = strategy(["check", "-f", "github"]);
    expect(warned.stdout).toBe(
      "::warning file=strategy/journeys/m2.md,line=3,title=manni%3Astrategy/unserved-journey::no page names this journey in journeys:. Name it on the pages that serve it.%0Amanni:strategy unserved-journey: No page names the journey in journeys:. Records do not count, and a draft or archived journey is exempt.%0AGuide: https://hawkeyexl.github.io/manni/strategy/reference/rules/#unserved-journey\n",
    );
    expect(warned.status).toBe(0);

    const failed = strategy(["check", "-f", "github"], { cwd: join(work, "failing") });
    expect(failed.stdout).toMatch(/^::error file=docs\/guide\.md,line=5,title=manni%3Astrategy\/undefined-reference::/m);
    expect(failed.status).toBe(1);
  });

  it("4. breaks every rule on the failing fixture, each at its default severity", () => {
    const r = strategy(["check", "-f", "json"], { cwd: join(work, "failing") });
    expect(r.status).toBe(1);
    const json = JSON.parse(r.stdout) as { findings: { rule: (typeof STRATEGY_RULES)[number]; severity: string }[] };
    expect(new Set(json.findings.map((f) => f.rule))).toEqual(new Set(STRATEGY_RULES));
    for (const finding of json.findings) expect(finding.severity).toBe(DEFAULT_SEVERITY[finding.rule]);
  });

  it("4. prints the failing set in term's layout", () => {
    const r = strategy(["check"], { cwd: join(work, "failing") });
    const lines = r.stdout.split("\n");
    expect(lines.slice(0, 5)).toEqual([
      "docs/guide.md:5",
      '  warning manni:strategy/missing-parent       personas: does not name "maya", the persona of journey "m1".',
      `${" ".repeat(46)}Add it, or drop "m1" from journeys:.`,
      `${" ".repeat(46)}manni:strategy missing-parent: A page names a journey but none of its personas in personas:, or a persona but not its audience in audiences:.`,
      `${" ".repeat(46)}Guide: https://hawkeyexl.github.io/manni/strategy/reference/rules/#missing-parent`,
    ]);
    expect(lines.at(-2)).toBe("3 errors, 3 warnings, 1 notice in 7 records");
    expect(r.status).toBe(1);
  });

  it("4. suggests the id a typo meant, and names the parent of a value of the wrong type", () => {
    const r = strategy(["check", "-f", "json"], { cwd: join(work, "did-you-mean") });
    const messages = (JSON.parse(r.stdout) as { findings: { message: string }[] }).findings.map((f) => f.message);
    expect(messages).toContain(
      'journeys: "s-17" names no journey. Did you mean "s17"? Correct the value, or add a record with type: journey and id: s-17.',
    );
    expect(messages).toContain('personas: "s17" is a journey, not a persona. Did you mean its persona, "sara"?');
    expect(messages).toContain('personas: "mya" names no persona. Did you mean "maya"?');
    expect(r.status).toBe(1);
  });

  it("4. files a finding about a sidecar's value at the sidecar's line", () => {
    const r = strategy(["check", "-f", "json"], { cwd: join(work, "sidecars") });
    const findings = (JSON.parse(r.stdout) as { findings: { rule: string; file: string; line: number }[] }).findings;
    expect(findings.map((f) => [f.rule, f.file, f.line])).toEqual([
      ["missing-parent", "docs/guide.meta.yaml", 3],
      ["undefined-reference", "docs/guide.meta.yaml", 4],
    ]);
    expect(JSON.parse(strategy(["get", "m1", "-f", "json"], { cwd: join(work, "sidecars") }).stdout)).toMatchObject({
      namedBy: { pages: ["docs/guide.md"] },
    });
  });

  it("5. prints a summary for a script", () => {
    const json = JSON.parse(strategy(["check", "-f", "json"], { cwd: join(work, "failing") }).stdout) as {
      summary: Record<string, unknown>;
    };
    expect(Object.keys(json.summary)).toEqual(["records", "references", "errors", "warnings", "notices"]);
    expect(json.summary).toMatchObject({ records: 7, errors: 3, warnings: 3, notices: 1 });
  });

  it("6. records a baseline on the first run, then fails only on new findings", () => {
    const cwd = join(work, "failing");
    const first = strategy(["check", "--baseline"], { cwd });
    expect(first.stdout).toBe("✓ 7 findings recorded in .manni-strategy-baseline.json\n");
    expect(first.status).toBe(0);
    const again = strategy(["check", "--baseline"], { cwd });
    expect(again.stdout).toBe("✓ 7 records, 8 references, no findings, 7 baselined\n");
    expect(again.status).toBe(0);
    writeFileSync(join(cwd, "docs", "new.md"), "---\ntitle: New\njourneys: [zz9]\n---\n");
    const fresh = strategy(["check", "--baseline"], { cwd });
    expect(fresh.stdout).toContain('journeys: "zz9" names no journey.');
    expect(fresh.stdout.split("\n").at(-2)).toBe("1 error in 7 records, 7 baselined");
    expect(fresh.status).toBe(1);
  });

  it("7. reads the records and the pages named on the command line", () => {
    const r = strategy(["check", "strategy/", "docs/guide.md"]);
    expect(r.stdout).toBe("✓ 4 records, 7 references, no findings\n");
    const records = strategy(["check", "strategy/"]);
    expect(records.stdout).toContain("manni:strategy/unserved-journey");
    expect(records.status).toBe(0);
  });

  it("8. adds stdin as one more input", () => {
    const r = strategy(["check", "strategy/", "-", "--as", "markdown"], {
      input: "---\ntitle: Piped\naudiences: [docs-engineers]\npersonas: [maya]\njourneys: [m1, m2]\n---\n",
    });
    expect(r.stdout).toBe("✓ 4 records, 7 references, no findings\n");
    expect(r.status).toBe(0);
  });

  it("9. composes every option, positional and collection forms", () => {
    const positional = strategy([
      "check",
      "strategy/",
      "docs/",
      "--ext",
      "md,mdx",
      "--exclude",
      "**/ci.md",
      "--no-gitignore",
      "--baseline",
      "-c",
      "manni.config.yaml",
      "-f",
      "sarif",
      "--no-color",
    ]);
    expect(positional.status).toBe(0);
    expect(existsSync(join(work, "clean", ".manni-strategy-baseline.json"))).toBe(true);
    const sarif = JSON.parse(positional.stdout) as { runs: { tool: { driver: { informationUri: string } } }[] };
    expect(sarif.runs[0]?.tool.driver.informationUri).toBe("https://hawkeyexl.github.io/manni/strategy/");

    const collections = strategy(["check", "--collection", "site", "--collection", "strategy", "--allow-empty", "--baseline", "-f", "junit"]);
    expect(collections.status).toBe(0);
    expect(collections.stdout).toContain('classname="manni.strategy"');
  });
});

describe("manni strategy (usage errors)", () => {
  /** An empty directory outside the repository, where discovery finds no config. */
  function bare(): string {
    const cwd = join(work, "bare");
    mkdirSync(cwd);
    return cwd;
  }

  function refused(r: Run, stderr: string): void {
    expect(r.stderr).toBe(`${stderr}\n`);
    expect(r.stdout).toBe("");
    expect(r.status).toBe(2);
  }

  it("get with no id", () => {
    const r = strategy(["get"]);
    expect(r.stderr.split("\n")[0]).toBe("error: missing required argument 'id'");
    expect(r.status).toBe(2);
  });

  it("get with no such record, near one", () => {
    refused(strategy(["get", "m11"]), 'manni: no record "m11". 4 records; did you mean "m1"?');
  });

  it("get with no such record, near none", () => {
    refused(strategy(["get", "zzzz"]), 'manni: no record "zzzz". 4 records.');
  });

  it("an unknown -f", () => {
    refused(strategy(["check", "-f", "xml"]), 'manni: unknown format "xml". Expected pretty | json | github | sarif | junit.');
    refused(strategy(["list", "-f", "csv"]), 'manni: unknown format "csv". Expected pretty | json.');
  });

  it("a run that finds no records", () => {
    refused(
      strategy(["check", "docs/"]),
      "manni: no strategy records found. A record is a page declaring type: audience, type: persona or type: journey.",
    );
  });

  it("stdin with no --as", () => {
    refused(strategy(["check", "-"], { input: "" }), "manni: Reading from stdin (`-`) requires --as <format> to choose an extractor.");
  });

  it("--collection beside paths", () => {
    refused(
      strategy(["check", "--collection", "site", "docs/"]),
      "manni: --collection selects a configured collection; it cannot be combined with paths.",
    );
  });

  it("--collection with no config", () => {
    refused(strategy(["check", "--collection", "site"], { cwd: bare() }), "manni: --collection needs a config file to select from.");
  });

  it("--collection naming no collection", () => {
    refused(
      strategy(["check", "--collection", "nope"]),
      'manni: no collection named "nope" in manni.config.yaml. Configured: site, strategy.',
    );
  });

  it("a path that matches nothing", () => {
    refused(
      strategy(["check", "nowhere/"]),
      'manni: File not found: "nowhere/". Check the path. Named paths resolve from the working directory.',
    );
  });

  it("no inputs and no collections", () => {
    refused(
      strategy(["check"], { cwd: bare() }),
      "manni: No files to read. Pass paths/globs, or declare a collection under `collections:` in manni.config.yaml.",
    );
  });

  it.each(["paths", "exclude"])("strategy.%s in config", (key) => {
    const cwd = configure("clean", `strategy:\n  ${key}: [x]\n`);
    refused(
      strategy(["check"], { cwd }),
      `manni: manni.config.yaml: strategy does not carry "${key}". Name a collection under collections:.`,
    );
  });

  it("strategy: that is not a mapping", () => {
    refused(strategy(["check"], { cwd: configure("clean", "strategy: [1]\n") }), "manni: strategy: in manni.config.yaml must be a mapping.");
  });

  it("an unknown key under strategy:", () => {
    refused(
      strategy(["check"], { cwd: configure("clean", "strategy:\n  rules: {}\n") }),
      'manni: Unknown key "rules" under strategy: in manni.config.yaml. Supported keys: severity, baseline, allowEmpty, respectGitignore.',
    );
  });

  it("an unknown rule under strategy.severity", () => {
    refused(
      strategy(["check"], { cwd: configure("clean", "strategy:\n  severity:\n    unserved: error\n") }),
      'manni: Unknown key "unserved" under strategy.severity: in manni.config.yaml. Supported keys: undefined-reference, duplicate-id, missing-parent, orphan-record, unserved-journey, unused-record.',
    );
  });

  it("strategy.allowEmpty that is not a boolean, never quoting the value", () => {
    refused(
      strategy(["check"], { cwd: configure("clean", 'strategy:\n  allowEmpty: "yes"\n') }),
      "manni: strategy.allowEmpty in manni.config.yaml must be a boolean.",
    );
  });

  it("a severity that is not a level", () => {
    refused(
      strategy(["check"], { cwd: configure("clean", "strategy:\n  severity:\n    unserved-journey: fatal\n") }),
      'manni: manni.config.yaml: strategy.severity.unserved-journey "fatal" is not a level. Expected notice | warning | error | off.',
    );
  });

  it("a configured baseline file that is missing", () => {
    refused(
      strategy(["check"], { cwd: configure("clean", "strategy:\n  baseline: .manni-strategy-baseline.json\n") }),
      'manni: Baseline ".manni-strategy-baseline.json" not found. Record one with `manni strategy check --baseline`.',
    );
  });
});
