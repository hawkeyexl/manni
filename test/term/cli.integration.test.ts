/**
 * `manni term …` against the built `dist/cli.js`: the grammar, the ladder rungs
 * that do not need a large docset, and every usage error in proposal 0052's
 * table that a fixture can reach, with its exact stderr line and exit code.
 *
 * Every run works in a throwaway copy of `test/fixtures/term/cli`, because
 * `write` and `--baseline` write into it.
 */
import { execSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { writeFormats } from "../../src/term/commands/write.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const manni = resolve(root, "dist", "cli.js");
const FIXTURES = resolve(root, "test", "fixtures", "term", "cli");

const valeOnPath = spawnSync("vale", ["--version"], { encoding: "utf8" }).status === 0;

interface Run {
  stdout: string;
  stderr: string;
  status: number;
}

let work: string;

function term(
  args: string[],
  opts: { cwd?: string; input?: string; env?: Record<string, string> } = {},
): Run {
  const r = spawnSync(process.execPath, [manni, "term", ...args], {
    cwd: opts.cwd ?? join(work, "clean"),
    encoding: "utf8",
    input: opts.input,
    env: { ...process.env, NO_COLOR: "1", ...(opts.env ?? {}) },
  });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status ?? 1 };
}

beforeAll(() => {
  if (!existsSync(manni)) execSync("npm run build", { cwd: root, stdio: "ignore" });
}, 180000);

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "manni-term-cli-"));
  cpSync(FIXTURES, work, { recursive: true });
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

describe("manni term (grammar)", () => {
  it("lists the six verbs", () => {
    const r = term(["--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^Usage: manni term /m);
    for (const verb of ["list", "get", "check", "lint", "write", "formats"]) {
      expect(r.stdout).toMatch(new RegExp(`^\\s+${verb}\\b`, "m"));
    }
  });

  it("has no default subcommand", () => {
    const r = term([]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/^Usage: manni term \[options\] \[command\]/m);
  });

  it("shows each verb's usage line and the shared flags", () => {
    for (const verb of ["list", "check", "lint", "write"]) {
      const help = term([verb, "--help"]).stdout;
      expect(help).toMatch(new RegExp(`^Usage: manni term ${verb} \\[options\\] \\[paths\\.\\.\\.\\]$`, "m"));
      for (const flag of [
        "--as <format>",
        "--ext <list>",
        "--exclude <glob>",
        "--collection <name>",
        "--allow-empty",
        "--no-gitignore",
        "-c, --config <path>",
        "--no-color",
      ]) {
        expect(help).toContain(flag);
      }
    }
    expect(term(["get", "--help"]).stdout).toMatch(/^Usage: manni term get \[options\] <term> \[paths\.\.\.\]$/m);
    expect(term(["formats", "--help"]).stdout).toMatch(/^Usage: manni term formats \[options\]$/m);
    expect(term(["check", "--help"]).stdout).toContain("--baseline");
    const write = term(["write", "--help"]).stdout;
    for (const flag of ["-o, --out <path>", "--check", "--dry-run"]) expect(write).toContain(flag);
  });
});

describe("manni term (flags shared with meta and cite)", () => {
  it("--ext keeps only the named extensions in a walk", () => {
    writeFileSync(
      join(work, "clean", "docs", "terms", "bifocal.html"),
      '<html><head><meta name="type" content="term"><meta name="label" content="bifocal"><meta name="definition" content="Two powers."></head></html>',
    );
    expect(term(["list", "docs"]).stdout).toContain("bifocal");
    const r = term(["list", "docs", "--ext", "md"]);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain("bifocal");
  });

  it("--allow-empty turns an empty set into success", () => {
    mkdirSync(join(work, "empty"));
    writeFileSync(join(work, "empty", "page.md"), "---\ntitle: Page\n---\n");
    expect(term(["check", "page.md"], { cwd: join(work, "empty") }).status).toBe(2);
    expect(term(["check", "page.md", "--allow-empty"], { cwd: join(work, "empty") }).status).toBe(0);
  });
});

describe("manni term (the ladder)", () => {
  it("1. checks a clean set, exit 0", () => {
    const r = term(["check"]);
    expect(r.stdout).toBe("✓ 2 terms, 2 references, no findings\n");
    expect(r.status).toBe(0);
  });

  it("2. lists the set", () => {
    const r = term(["list"]);
    expect(r.stdout).toBe(
      ["corrective-lens    corrective lens", "progressive-lens   progressive lens   PAL, graduated lens", "2 terms", ""].join("\n"),
    );
    expect(r.status).toBe(0);
  });

  it("3. shows one term", () => {
    const r = term(["get", "progressive-lens"]);
    expect(r.stdout.split("\n")[0]).toBe("progressive lens                        docs/terms/progressive-lens.md:1");
    expect(r.stdout).toContain("  hidden-labels  no-line bifocal\n");
    expect(r.status).toBe(0);
  });

  it("3. shows one term by its alt-label", () => {
    const r = term(["get", "PAL"]);
    expect(r.stdout.split("\n")[0]).toBe("progressive lens                        docs/terms/progressive-lens.md:1");
    expect(r.status).toBe(0);
  });

  it("4. fails on an undefined term, exit 1", () => {
    const r = term(["check"], { cwd: join(work, "failing") });
    expect(r.stdout).toBe(
      [
        "docs/guides/fitting.md:3",
        '  error  manni:term/undefined-term       concepts: "PAL" names no entry.',
        '                                         "progressive lens" lists it as an alt-label.',
        "",
        "1 error in 2 terms",
        "",
      ].join("\n"),
    );
    expect(r.status).toBe(1);
  });

  it("6. annotates the diff in CI, and says nothing when clean", () => {
    const r = term(["check", "-f", "github"], { cwd: join(work, "failing") });
    expect(r.stdout).toBe(
      '::error file=docs/guides/fitting.md,line=3,title=manni%3Aterm/undefined-term::concepts: "PAL" names no entry. "progressive lens" lists it as an alt-label.\n',
    );
    expect(r.status).toBe(1);
    const clean = term(["check", "-f", "github"]);
    expect(clean.stdout).toBe("");
    expect(clean.status).toBe(0);
  });

  it("check renders json, sarif and junit", () => {
    const cwd = join(work, "failing");
    const json = JSON.parse(term(["check", "-f", "json"], { cwd }).stdout) as { summary: { errors: number } };
    expect(json.summary.errors).toBe(1);
    const sarif = JSON.parse(term(["check", "-f", "sarif"], { cwd }).stdout) as {
      runs: {
        tool: { driver: { rules: { shortDescription: { text: string }; helpUri?: string }[] } };
        results: { ruleId: string; message: { text: string } }[];
      }[];
    };
    expect(sarif.runs[0]?.results[0]?.ruleId).toBe("manni:term/undefined-term");
    expect(sarif.runs[0]?.results[0]?.message.text).toBe(
      'concepts: "PAL" names no entry. "progressive lens" lists it as an alt-label.',
    );
    expect(sarif.runs[0]?.tool.driver.rules[0]?.helpUri).toBe(
      "https://hawkeyexl.github.io/manni/term/reference/rules/#undefined-term",
    );
    const junit = term(["check", "-f", "junit"], { cwd }).stdout;
    expect(junit).toContain('classname="manni.term"');
    expect(junit).toContain('message="concepts: &quot;PAL&quot; names no entry.');
  });

  it("7. ramps in with --baseline", () => {
    const cwd = join(work, "failing");
    const r = term(["check", "--baseline"], { cwd });
    expect(r.stdout).toBe("✓ 1 finding recorded in .manni-term-baseline.json\n");
    expect(r.status).toBe(0);
    const again = term(["check", "--baseline"], { cwd });
    expect(again.stdout).toBe("✓ 2 terms, 3 references, no findings, 1 baselined\n");
    expect(again.status).toBe(0);
  });

  it("9. renders json to a file", () => {
    const r = term(["write", "-f", "json", "-o", "build/terms.json"]);
    expect(r.stdout).toBe("Wrote 2 terms to build/terms.json\n");
    expect(r.status).toBe(0);
    const written = JSON.parse(readFileSync(join(work, "clean", "build", "terms.json"), "utf8")) as { terms: unknown[] };
    expect(written.terms).toHaveLength(2);
  });

  it("10-11. writes a Vale style to -o, and --check keeps it in step", () => {
    const cwd = join(work, "clean");
    const r = term(["write", "-f", "vale", "-o", "styles/"]);
    expect(r.stdout).toBe(
      ["Wrote 2 terms to styles/Terms", "  Lowercase.yml   3 terms", "  Deprecated.yml  1 swap", "  PAL.yml         1 acronym", ""].join("\n"),
    );
    expect(r.status).toBe(0);

    const clean = term(["write", "-f", "vale", "-o", "styles/", "--check"]);
    expect(clean.stdout).toBe("styles/Terms is up to date\n");
    expect(clean.status).toBe(0);

    const page = join(cwd, "docs", "terms", "corrective-lens.md");
    writeFileSync(page, readFileSync(page, "utf8").replace("label: corrective lens", "label: corrective lens\nhidden-labels: [spectacle lens]"));
    const drift = term(["write", "-f", "vale", "-o", "styles/", "--check"]);
    expect(drift.stdout).toBe("styles/Terms/Deprecated.yml would change\n");
    expect(drift.status).toBe(1);
  });

  it("13. --dry-run writes nothing", () => {
    const r = term(["write", "-f", "json", "-o", "terms.json", "--dry-run", "--no-color"]);
    expect(r.stdout).toBe("terms.json would be created\n");
    expect(existsSync(join(work, "clean", "terms.json"))).toBe(false);
  });

  it("12. lists as csv", () => {
    const r = term(["list", "-f", "csv"]);
    expect(r.stdout.split("\n").slice(0, 3)).toEqual([
      "id,label,alt-labels,abstract",
      "corrective-lens,corrective lens,,",
      "progressive-lens,progressive lens,PAL|graduated lens,Lenses that correct presbyopia without a visible line.",
    ]);
  });

  it("14. lists what is read and written", () => {
    const r = term(["formats"]);
    expect(r.stdout).toMatch(/^markdown +page +read/m);
    expect(r.stdout).toMatch(/^vale +style +write$/m);
    expect(r.status).toBe(0);
    const json = JSON.parse(term(["formats", "-f", "json"]).stdout) as { formats: unknown[] };
    expect(json.formats.length).toBeGreaterThan(0);
  });

  it("reads stdin alongside the named paths", () => {
    const r = term(["list", "-", "docs/terms/corrective-lens.md", "--as", "markdown"], {
      input: "---\ntype: term\nlabel: bifocal\ndefinition: Two powers.\n---\n",
    });
    expect(r.stdout).toContain("bifocal");
    expect(r.stdout).toContain("2 terms");
    expect(r.status).toBe(0);
  });

  it.skipIf(!valeOnPath)("5. lints definitions with a real Vale", () => {
    const cwd = join(work, "clean");
    mkdirSync(join(cwd, "styles", "House"), { recursive: true });
    writeFileSync(
      join(cwd, "styles", "House", "Lens.yml"),
      "extends: existence\nmessage: \"Avoid '%s'.\"\nlevel: error\ntokens:\n  - presbyopia\n",
    );
    writeFileSync(join(cwd, ".vale.ini"), "StylesPath = styles\n\n[*.md]\nBasedOnStyles = House\n");
    writeFileSync(join(cwd, "manni.config.yaml"), `${readFileSync(join(cwd, "manni.config.yaml"), "utf8")}tools:\n  vale:\n    config: .vale.ini\n`);
    const r = term(["lint"], { cwd });
    expect(r.stdout).toContain("manni:term/prose/House.Lens");
    expect(r.status).toBe(1);
  });
});

describe("manni term (usage errors)", () => {
  it("no terms anywhere", () => {
    const cwd = join(work, "clean");
    rmSync(join(cwd, "docs", "terms"), { recursive: true });
    const r = term(["check"], { cwd });
    expect(r.stderr).toBe(
      "manni: no terms found. A term is a page declaring type: term, or an entry in a file declaring type: term-set.\n",
    );
    expect(r.status).toBe(2);
  });

  it("term.paths in config", () => {
    const cwd = join(work, "clean");
    writeFileSync(join(cwd, "manni.config.yaml"), "term:\n  paths: [docs]\n");
    const r = term(["check"], { cwd });
    expect(r.stderr).toBe('manni: manni.config.yaml: term does not carry "paths". Name a collection under collections:.\n');
    expect(r.status).toBe(2);
  });

  it("stdin with no --as", () => {
    const r = term(["check", "-"], { input: "" });
    expect(r.stderr).toBe("manni: reading stdin needs --as <format>.\n");
    expect(r.status).toBe(2);
  });

  // The proposal words this `no documents matched. Named paths: nowhere/.`; the
  // loader reports it through meta's target walk, in the family's own words.
  it("a path that matches nothing", () => {
    const r = term(["check", "nowhere/"]);
    expect(r.stderr).toBe('manni: File not found: "nowhere/".\n');
    expect(r.status).toBe(2);
  });

  it("get with no such term", () => {
    const r = term(["get", "progressive-lenz"]);
    expect(r.stderr).toBe('manni: no term "progressive-lenz". 2 terms; did you mean "progressive-lens"?\n');
    expect(r.status).toBe(2);
  });

  it("get with a name nothing is near", () => {
    const r = term(["get", "missing"]);
    expect(r.stderr).toBe('manni: no term "missing". 2 terms.\n');
    expect(r.status).toBe(2);
  });

  it("an unknown -f", () => {
    const r = term(["write", "-f", "tmx"]);
    expect(r.stderr).toBe(`manni: unknown format "tmx". Expected ${writeFormats().join(" | ")}.\n`);
    expect(r.status).toBe(2);
    const list = term(["list", "-f", "xml"]);
    expect(list.stderr).toBe('manni: unknown format "xml". Expected pretty | json | csv.\n');
    expect(list.status).toBe(2);
  });

  it("-f tbx with no -o", () => {
    const r = term(["write", "-f", "tbx"]);
    expect(r.stderr).toBe("manni: -f tbx needs -o <path>.\n");
    expect(r.status).toBe(2);
  });

  it("an unmarked file in Terms/", () => {
    const cwd = join(work, "clean");
    mkdirSync(join(cwd, "styles", "Terms"), { recursive: true });
    writeFileSync(join(cwd, "styles", "Terms", "Casing.yml"), "extends: substitution\n");
    const r = term(["write", "-f", "vale", "-o", "styles"], { cwd });
    expect(r.stderr).toBe(
      "manni: styles/Terms/Casing.yml was not written by manni. Move it, or pass -o <styles directory>.\n",
    );
    expect(r.status).toBe(2);
  });

  it("an acronym named like a rule file", () => {
    const cwd = join(work, "clean");
    const page = join(cwd, "docs", "terms", "corrective-lens.md");
    writeFileSync(page, readFileSync(page, "utf8").replace("label: corrective lens", "label: corrective lens\nalt-labels: [CASING]"));
    const r = term(["write", "-f", "vale", "-o", "styles"], { cwd });
    expect(r.stderr).toBe('manni: the acronym "CASING" would replace Terms/Casing.yml. Rename the alt-label.\n');
    expect(r.status).toBe(2);
  });

  it("lint with no Vale on PATH", () => {
    const r = term(["lint"], { env: { PATH: "", Path: "" } });
    expect(r.stderr).toBe("manni: vale is not on PATH. Install Vale to lint definitions.\n");
    expect(r.status).toBe(2);
  });

  it("tools.vale.config that does not exist", () => {
    const cwd = join(work, "clean");
    writeFileSync(join(cwd, "manni.config.yaml"), `${readFileSync(join(cwd, "manni.config.yaml"), "utf8")}tools:\n  vale:\n    config: nowhere.ini\n`);
    const r = term(["lint"], { cwd });
    expect(r.stderr).toBe('manni: manni.config.yaml: tools.vale.config "nowhere.ini" does not exist.\n');
    expect(r.status).toBe(2);
  });

  it("a severity that is not a level", () => {
    const cwd = join(work, "clean");
    writeFileSync(join(cwd, "manni.config.yaml"), `${readFileSync(join(cwd, "manni.config.yaml"), "utf8")}term:\n  severity:\n    undefined-term: fatal\n`);
    const r = term(["check"], { cwd });
    expect(r.stderr).toBe(
      'manni: manni.config.yaml: term.severity.undefined-term "fatal" is not a level. Expected notice | warning | error | off.\n',
    );
    expect(r.status).toBe(2);
  });

  it("-o without -f", () => {
    const r = term(["write", "-o", "x.json"]);
    expect(r.stderr).toBe("manni: -o needs -f <format>.\n");
    expect(r.status).toBe(2);
  });
});
