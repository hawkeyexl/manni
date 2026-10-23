/**
 * `manni strategy …` against the built `dist/cli.js`: the grammar, the flags it
 * shares with meta and term, the ladder of proposal 0102, and every usage
 * error with its exact stderr line and exit code.
 *
 * Every run works in a throwaway copy of `test/fixtures/strategy`, because
 * `--baseline` writes into it and some rungs edit a config.
 */
import { execSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

  it("4. breaks every rule on the failing and steps fixtures, each at its default severity", () => {
    const findings = ["failing", "steps"].flatMap((fixture) => {
      const r = strategy(["check", "-f", "json"], { cwd: join(work, fixture) });
      expect(r.status).toBe(1);
      return (JSON.parse(r.stdout) as { findings: { rule: (typeof STRATEGY_RULES)[number]; severity: string }[] }).findings;
    });
    expect(new Set(findings.map((f) => f.rule))).toEqual(new Set(STRATEGY_RULES));
    for (const finding of findings) expect(finding.severity).toBe(DEFAULT_SEVERITY[finding.rule]);
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

describe("manni strategy (journey steps)", () => {
  const steps = (): string => join(work, "steps");

  it("check exits 1 on the broken step, and files each step finding at its line", () => {
    const r = strategy(["check", "-f", "json"], { cwd: steps() });
    expect(r.status).toBe(1);
    const json = JSON.parse(r.stdout) as { findings: { rule: string; line: number; field: string }[]; summary: { steps: number } };
    expect(json.findings.map((f) => [f.rule, f.line])).toEqual([
      ["missing-journey", 16],
      ["broken-step", 18],
      ["stale-step", 21],
      ["unwritten-step", 22],
      ["unwritten-step", 25],
    ]);
    expect(json.findings.every((f) => f.field === "steps")).toBe(true);
    expect(json.summary.steps).toBe(10);
  });

  it("check pretty prints each message, its advice on the next line", () => {
    const r = strategy(["check"], { cwd: steps() });
    expect(r.stdout).toContain(
      [
        "strategy/journeys/m1.md:18",
        '  error   manni:strategy/broken-step          step 5: doc "docs/gide.md" names no page.',
        "                                              Correct doc, or set exists: false if the page does not exist.",
      ].join("\n"),
    );
    expect(r.stdout.trimEnd().split("\n").at(-1)).toBe("1 error, 2 warnings, 2 notices in 4 records");
  });

  it("check -f github annotates a notice as ::notice", () => {
    const r = strategy(["check", "-f", "github"], { cwd: steps() });
    expect(r.stdout).toMatch(
      /^::notice file=strategy\/journeys\/m1\.md,line=25,title=manni%3Astrategy\/unwritten-step::step 8: no page carries this stage\./m,
    );
  });

  it("get prints the steps row, and its json the coverage", () => {
    const pretty = strategy(["get", "m1"], { cwd: steps() });
    expect(pretty.status).toBe(0);
    expect(pretty.stdout).toContain("  steps         3 of 9 served\n                1  served     Read the guide\n");
    const json = strategy(["get", "m1", "-f", "json"], { cwd: steps() });
    expect((JSON.parse(json.stdout) as { coverage: unknown }).coverage).toEqual({ served: 3, steps: 9 });
  });

  it("list shows the steps column", () => {
    const r = strategy(["list"], { cwd: steps() });
    expect(r.status).toBe(0);
    expect(r.stdout.split("\n")[0]).toBe("record            pages  steps  title");
    expect(r.stdout).toContain("    m1                2    3/9  Stand up metadata validation for my repo\n");
  });

  it("an invalid graph: section fails a run whose steps name a / route, with graph's message, exit 2", () => {
    const cwd = steps();
    const path = join(cwd, "manni.config.yaml");
    writeFileSync(path, readFileSync(path, "utf8").replace("      root: docs\n", ""));
    const r = strategy(["check"], { cwd });
    expect(r.status).toBe(2);
    expect(r.stdout).toBe("");
    // The runner prefixes each stderr line, as it does for `manni graph build` on the same config.
    expect(r.stderr).toMatch(/^manni: Invalid config in .*manni\.config\.yaml:\nmanni: {3}\/graph\/routes\/0: must have required property 'root'\n$/);
  });
});

describe("manni strategy (borrowed records, proposal 0112)", () => {
  const consumer = (): string => join(work, "shared", "consumer");
  const owner = (...parts: string[]): string => join(work, "shared", "owner", ...parts);
  /** The record files under the owner's three folders, read at test time. */
  const ownerRecords = (): number =>
    ["audiences", "personas", "journeys"].reduce((n, dir) => n + readdirSync(owner(dir)).filter((f) => f.endsWith(".md")).length, 0);
  const edit = (path: string, from: string, to: string): void => {
    writeFileSync(path, readFileSync(path, "utf8").replace(from, to));
  };
  const manniIn = (args: string[], cwd: string): Run => {
    const r = spawnSync(process.execPath, [manni, ...args], { cwd, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
    return { stdout: r.stdout, stderr: r.stderr, status: r.status ?? 1 };
  };
  type Findings = { findings: { rule: string; file: string; line: number; message: string }[]; summary: Record<string, unknown> };

  it("check exits 0, and the pretty line counts the borrowed records", () => {
    const r = strategy(["check"], { cwd: consumer() });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(new RegExp(`^✓ \\d+ records \\(${String(ownerRecords())} borrowed\\), \\d+ references, no findings\\n$`));
  });

  it("check -f json carries summary.borrowed, and no finding sits under ../owner", () => {
    const clean = JSON.parse(strategy(["check", "-f", "json"], { cwd: consumer() }).stdout) as Findings;
    expect(clean.summary["borrowed"]).toBe(ownerRecords());
    expect(Object.keys(clean.summary).slice(0, 3)).toEqual(["records", "borrowed", "references"]);
    // A typo on the consumer's page, and a broken value in a borrowed record.
    edit(join(consumer(), "docs", "page.md"), "personas: [maya]", "personas: [mya]");
    edit(owner("journeys", "j2.md"), "personas: [maya]", "personas: [nobody]");
    const r = strategy(["check", "-f", "json"], { cwd: consumer() });
    expect(r.status).toBe(1);
    const json = JSON.parse(r.stdout) as Findings;
    expect(
      json.findings.some((f) => f.rule === "undefined-reference" && f.file === "docs/page.md" && f.message.includes('Did you mean "maya"?')),
    ).toBe(true);
    expect(json.findings.every((f) => !f.file.startsWith("../owner"))).toBe(true);
  });

  it("check -f junit has no testcase, and -f github no annotation, for a borrowed file", () => {
    edit(owner("journeys", "j2.md"), "personas: [maya]", "personas: [nobody]");
    const junit = strategy(["check", "-f", "junit"], { cwd: consumer() });
    expect(junit.stdout).toContain("<testcase");
    expect(junit.stdout).not.toContain("../owner");
    expect(strategy(["check", "-f", "github"], { cwd: consumer() })).toMatchObject({ status: 0, stdout: "" });
  });

  it("a kept copy of a borrowed record gets the borrowed duplicate-id fix, exit 1", () => {
    mkdirSync(join(consumer(), "strategy", "personas"));
    cpSync(owner("personas", "maya.md"), join(consumer(), "strategy", "personas", "maya.md"));
    const paths = ["../owner/audiences/", "../owner/personas/", "../owner/journeys/", "strategy/", "docs/"];
    const r = strategy(["check", ...paths, "-f", "json"], { cwd: consumer() });
    expect(r.status).toBe(1);
    expect((JSON.parse(r.stdout) as Findings).findings.map((f) => [f.rule, f.file, f.line, f.message])).toEqual([
      [
        "duplicate-id",
        "strategy/personas/maya.md",
        3,
        'id: "maya" is also the id of ../owner/personas/maya.md:3. That record is borrowed from outside this repository. Remove this copy, or give it its own id.',
      ],
    ]);
  });

  it("an owned journey no page names still draws unserved-journey", () => {
    writeFileSync(join(consumer(), "strategy", "journeys", "p2.md"), "---\ntype: journey\nid: p2\npersonas: [maya]\n---\n");
    const json = JSON.parse(strategy(["check", "-f", "json"], { cwd: consumer() }).stdout) as Findings;
    expect(json.findings.map((f) => [f.rule, f.file])).toEqual([["unserved-journey", "strategy/journeys/p2.md"]]);
  });

  it("get maya prints the borrowed file and the consumer's page", () => {
    const r = strategy(["get", "maya"], { cwd: consumer() });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("../owner/personas/maya.md:1");
    expect(r.stdout).toMatch(/^ {2}pages {9}docs\/page\.md$/m);
  });

  it("get j1 shows each borrowed step unchecked with no coverage line, and list no steps column", () => {
    const r = strategy(["get", "j1"], { cwd: consumer() });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("  steps         1  unchecked  Read the guide\n");
    expect(r.stdout).toContain("                2  unchecked  Write a tutorial\n");
    expect(r.stdout).not.toContain("served");
    const json = JSON.parse(strategy(["get", "j1", "-f", "json"], { cwd: consumer() }).stdout) as { steps: { state: string }[] };
    expect(json.steps.map((s) => s.state)).toEqual(["unchecked", "unchecked"]);
    expect(json).not.toHaveProperty("coverage");
    expect(strategy(["list"], { cwd: consumer() }).stdout).not.toMatch(/^record.*steps/);
  });

  it("-c missing.config.yaml exits 2 with File not found", () => {
    const r = strategy(["check", "-c", "missing.config.yaml"], { cwd: consumer() });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("File not found");
    expect(r.stderr).toContain("../nowhere/personas/");
  });

  it("meta validate exits 0, judging the owned journey by the owner's schema and never a borrowed record", () => {
    const r = manniIn(["meta", "validate", "-f", "json"], consumer());
    expect(r.status).toBe(0);
    const json = JSON.parse(r.stdout) as { results: { file: string; schemas: string[] }[] };
    expect(json.results.map((x) => x.file).sort()).toEqual(["docs/page.md", "strategy/journeys/p1.md"]);
    expect(json.results.find((x) => x.file === "strategy/journeys/p1.md")?.schemas).toEqual(["../owner/schemas/journey.schema.json"]);
  });

  it("this repository's own check carries no borrowed key", () => {
    const json = manniIn(["strategy", "check", "-f", "json"], root);
    expect((JSON.parse(json.stdout) as Findings).summary).not.toHaveProperty("borrowed");
    expect(manniIn(["strategy", "check"], root).stdout).not.toContain("borrowed");
  }, 180000);
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
      'manni: Unknown key "unserved" under strategy.severity: in manni.config.yaml. Supported keys: undefined-reference, duplicate-id, missing-parent, orphan-record, unserved-journey, unused-record, broken-step, stale-step, missing-journey, unwritten-step.',
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
