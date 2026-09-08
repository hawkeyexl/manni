/**
 * `manni meta derive` through the built umbrella bin, plus the two flags the
 * derived channel adds to its neighbours: `validate --no-derive` and
 * `get --derived`. The behaviour behind those two is tested with their
 * command cores; here only the parser's acceptance is pinned.
 *
 * The corpus is staged into a temp repository with pinned commit dates, as
 * `derive.test.ts` does, because a fixture directory inside this repository
 * would derive this repository's history rather than the corpus's.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { execFileSync, execSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnText } from "./helpers/spawn.js";
import { commit, makeTempRepo, removeTempRepo, writeFile } from "./helpers/temp-repo.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const bin = resolve(root, "dist", "cli.js");
const CORPUS = resolve(here, "fixtures", "derive", "corpus");

const D1 = "2026-08-20T10:00:00+00:00";
const D2 = "2026-09-01T10:00:00+00:00";

interface Run {
  stdout: string;
  stderr: string;
  status: number;
}

function run(args: string[], cwd: string = root): Run {
  const r = spawnText(
    spawnSync("node", [bin, "meta", ...args], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" },
    }),
  );
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status ?? 1 };
}

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) removeTempRepo(d);
});

/** The corpus as two commits; see `derive.test.ts` for the shape. */
function stageCorpus(): { dir: string; second: string } {
  const dir = makeTempRepo({ files: {} });
  dirs.push(dir);
  cpSync(CORPUS, dir, { recursive: true });
  const final = readFileSync(join(CORPUS, "docs", "install.md"), "utf8");
  writeFile(dir, "docs/install.md", final.replace("\nThen restart.\n", ""));
  commit(dir, "add docs", { authorDate: D1 });
  writeFile(dir, "docs/install.md", final);
  const second = commit(dir, "expand install", { authorDate: D2 });
  return { dir, second };
}

// Every case spawns the built bin at least once, and one stages a repository
// and spawns it three times. Under the full suite's load that is well past
// vitest's 5 s default, so the budget is set here as the other bin suites do.
describe("manni meta derive (built bin)", { timeout: 60_000 }, () => {
  beforeAll(() => {
    if (!existsSync(bin)) execSync("npm run build", { cwd: root, stdio: "ignore" });
  }, 180000);

  it("--check -f github annotates each stale or unset field and exits 1", () => {
    const { dir, second } = stageCorpus();
    const r = run(["derive", "--check", "-f", "github"], dir);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain(
      `::error file=docs/install.md,line=3::[derived:stale] /last-updated last-updated says 2026-08-20; git says 2026-09-01 (body changed in ${second.slice(0, 7)} (2026-09-01)) — run manni meta derive`,
    );
    expect(r.stdout).toContain("::error file=docs/install.md,line=1::[derived:stale] /created created is not set");
    expect(r.stdout).toContain("::error file=docs/install.md,line=1::[derived:stale] /owner owner is not set");
    expect(r.stdout).not.toContain("docs/faq.md");
    // The config notice is a diagnostic, and github output owns stdout.
    expect(r.stdout).not.toContain("Using manni.config.yaml");
    expect(r.stderr).toContain("Using manni.config.yaml");
    // --check never writes.
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8" }).trim()).toBe("");
  });

  it("stamps the fields, then --check has nothing to report", () => {
    const { dir } = stageCorpus();
    const apply = run(["derive"], dir);
    expect(apply.status).toBe(0);
    expect(apply.stdout).toContain("Using manni.config.yaml");
    expect(apply.stdout).toContain("docs/faq.md  current");
    expect(apply.stdout).toContain("last-updated  2026-08-20 → 2026-09-01");
    expect(apply.stdout).toContain("2 files, 1 changed, 3 fields written");
    expect(readFileSync(join(dir, "docs", "install.md"), "utf8")).toContain("created: 2026-08-20");

    const check = run(["derive", "--check"], dir);
    expect(check.status).toBe(0);
    expect(check.stdout).toContain("2 files checked, 2 passed, 0 failed, 0 errors");

    const github = run(["derive", "--check", "-f", "github"], dir);
    expect(github.status).toBe(0);
    expect(github.stdout).toBe("");
  });

  it("--dry-run reports and writes nothing", () => {
    const { dir } = stageCorpus();
    const r = run(["derive", "--dry-run", "docs/install.md"], dir);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("1 file, 1 would change, 3 fields — dry run, nothing written");
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8" }).trim()).toBe("");
  });

  it("-f json is the run", () => {
    const { dir } = stageCorpus();
    const r = run(["derive", "--dry-run", "-f", "json"], dir);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout) as { dryRun: boolean; summary: { changed: number } };
    expect(parsed.dryRun).toBe(true);
    expect(parsed.summary.changed).toBe(1);
  });

  it("refuses stdin", () => {
    const { dir } = stageCorpus();
    const r = run(["derive", "-", "--as", "markdown"], dir);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("manni: cannot derive <stdin>: no history behind it");
  });

  it("refuses a field that is not derivable", () => {
    const { dir } = stageCorpus();
    const r = run(["derive", "--fields", "verified-against"], dir);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(
      '"verified-against" is not derivable; derivable fields are created, last-updated, authors, owner, reviewed-by, last-reviewed',
    );
  });

  it("refuses a findings format without --check", () => {
    const { dir } = stageCorpus();
    const r = run(["derive", "-f", "sarif"], dir);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("sarif is a findings format, which only --check produces");
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8" }).trim()).toBe("");
  });

  it("refuses an unknown format", () => {
    const { dir } = stageCorpus();
    const r = run(["derive", "-f", "yaml"], dir);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('Unknown --format "yaml"');
  });

  it("has nothing to derive with --no-config and no --fields", () => {
    const { dir } = stageCorpus();
    const r = run(["derive", "--no-config", "docs/install.md"], dir);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(
      "nothing to derive: set derive.fields in manni.config.yaml or pass --fields",
    );
  });

  it("--help lists the options", () => {
    const r = run(["derive", "--help"]);
    expect(r.status).toBe(0);
    for (const flag of [
      "--fields <list>",
      "--sources <list>",
      "--dry-run",
      "--check",
      "-f, --format <format>",
      "--no-cache",
      "--ext <list>",
      "--exclude <glob>",
      "--as <format>",
      "-c, --config <path>",
      "--no-config",
      "--allow-empty",
      "--no-gitignore",
    ]) {
      expect(r.stdout).toContain(flag);
    }
    expect(r.stdout).toContain("[paths...]");
  });

  it("is listed by meta --help", () => {
    const r = run(["--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^\s+derive\b/m);
  });
});

describe("the derived channel's flags on validate and get (built bin)", { timeout: 60_000 }, () => {
  it("validate accepts --no-derive", () => {
    const r = run(["validate", "--no-derive", "test/fixtures/valid.md"]);
    expect(r.stderr).not.toContain("unknown option");
    expect(r.status).toBe(0);
  });

  it("get accepts --derived", () => {
    // Only the parser is under test: what `--derived` does (and whether this
    // checkout can answer for it) belongs to get's own tests.
    const r = run(["get", "--derived", "title", "test/fixtures/valid.md"]);
    expect(r.stderr).not.toContain("unknown option");
  });

  it("validate --help and get --help name the flags", () => {
    expect(run(["validate", "--help"]).stdout).toContain("--no-derive");
    expect(run(["get", "--help"]).stdout).toContain("--derived");
  });
});
