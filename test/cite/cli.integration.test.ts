/**
 * `manni cite …` against the built `dist/cli.js`: the grammar, every usage
 * error in the plan's ladder with its exact stderr line and exit code, and
 * the deterministic rungs of the ladder itself.
 *
 * Every run that touches sources works in a throwaway copy of
 * `test/fixtures/cite`, with that copy as `--root`. The copy is in the temp
 * directory, outside any git work tree, so the source index is a walk of the
 * copy and nothing depends on which fixtures happen to be tracked in this
 * repository. `add` and `update` write, so they need the copy anyway.
 */
import { execSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_CITE_BASELINE_PATH } from "../../src/cite/core/config.js";
import { hashRange } from "../../src/cite/core/hash.js";
import { encryptSourcePath } from "../../src/cite/core/sources.js";
import { supportedExtensions } from "../../src/meta/index.js";
import { commitAll, gitAvailable, makeTempRepo, removeTempRepo } from "../helpers/temp-repo.js";
import type { Command } from "commander";
import { buildProgram as buildCite, colorFor } from "../../src/cite/cli.js";
import { buildProgram as buildUmbrella } from "../../src/cli.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const manni = resolve(root, "dist", "cli.js");
const FIXTURES = resolve(root, "test", "fixtures", "cite");
/** The fixed test key pages/encrypted.md was encrypted with. Never a real key. */
const FIXTURE_KEY = "cite-fixture-key-0123456789abcdef";
/** Another fixed test key, for the runs that bring their own. */
const CLI_KEY = "cli-key-0123456789abcdef0123456789abc";
const NO_HISTORY =
  "git is not available here, so citations are checked without history: no never-true, no diffs, no commit subjects.";
const NO_COMMIT = "git is not available here, so the citation records no commit.";

interface Run {
  stdout: string;
  stderr: string;
  status: number;
}

/**
 * `spawnSync`, not `execFileSync`: a run that exits 0 can still say something
 * on stderr (`add -` reports there, so the page owns stdout), and
 * `execFileSync` hands back only stdout on success.
 */
function run(args: string[], opts: { cwd?: string; input?: string; env?: Record<string, string> } = {}): Run {
  const r = spawnSync("node", [manni, ...args], {
    cwd: opts.cwd ?? root,
    encoding: "utf8",
    input: opts.input,
    // The developer's key never reaches a run: an empty MANNI_ENCRYPTION_KEY
    // counts as unset, and a case that wants a key passes its own.
    env: { ...process.env, NO_COLOR: "1", MANNI_ENCRYPTION_KEY: "", ...(opts.env ?? {}) },
  });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status ?? 1 };
}

/** A fresh copy of the fixture tree; the tests write into it. */
let work: string;
/** `cite <verb> …`, run from the copy. */
const cite = (args: string[], opts: { input?: string; env?: Record<string, string> } = {}): Run =>
  run(["cite", ...args], { cwd: work, ...opts });

beforeAll(() => {
  if (!existsSync(manni)) execSync("npm run build", { cwd: root, stdio: "ignore" });
}, 180000);

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "manni-cite-"));
  cpSync(FIXTURES, work, { recursive: true });
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

describe("manni cite (grammar)", () => {
  it("lists check, add and update, and nothing else", () => {
    const r = run(["cite", "--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^Usage: manni cite /m);
    expect(r.stdout).toMatch(/^\s+check\b/m);
    expect(r.stdout).toMatch(/^\s+add\b/m);
    expect(r.stdout).toMatch(/^\s+update\b/m);
    // The key moved to the family: `manni key set|rotate`.
    expect(r.stdout).not.toMatch(/^\s+salt\b/m);
  });

  it("has no default subcommand: bare `manni cite` is a usage error", () => {
    const r = run(["cite"]);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/^Usage: manni cite \[options\] \[command\]/m);
  });

  it("has no salt command: `manni cite salt set` is a usage error", () => {
    const r = run(["cite", "salt", "set"]);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/unknown command 'salt'/);
  });

  it("shows the qualified usage line on every subcommand", () => {
    expect(run(["cite", "check", "--help"]).stdout).toMatch(/^Usage: manni cite check /m);
    expect(run(["cite", "add", "--help"]).stdout).toMatch(/^Usage: manni cite add /m);
    expect(run(["cite", "update", "--help"]).stdout).toMatch(/^Usage: manni cite update /m);
  });
});

describe("manni cite (usage errors)", () => {
  const usage = (args: string[], line: string, opts?: { input?: string }): void => {
    const r = cite(args, opts);
    expect(r.status).toBe(2);
    expect(r.stderr.split(/\r?\n/)[0]).toBe(`manni: ${line}`);
  };

  it("check with nothing to check", () => {
    usage(
      ["check", "--root", "."],
      "No files to check. Pass paths/globs, or declare a collection under `collections:` in manni.config.yaml.",
    );
  });

  it("check --collection with a name the config does not declare", () => {
    writeFileSync(
      join(work, "manni.config.yaml"),
      "collections:\n  - name: pages\n    paths: ['pages/current.md']\n",
      "utf8",
    );
    usage(
      ["check", "--collection", "gides", "--root", "."],
      'no collection named "gides" in manni.config.yaml. Configured: pages.',
    );
  });

  it("check --collection beside a path", () => {
    usage(
      ["check", "--collection", "pages", "pages/current.md", "--root", "."],
      "--collection selects a configured collection; it cannot be combined with paths.",
    );
  });

  it("check -f xml", () => {
    usage(["check", "-f", "xml", "pages/"], 'Unknown --format "xml". Use pretty, json, github, sarif, or junit.');
  });

  it("check - without --as", () => {
    usage(
      ["check", "-", "pages/", "--root", "."],
      "Reading from stdin (`-`) requires --as <format> to choose an extractor.",
      { input: "---\ntitle: t\n---\n" },
    );
  });

  it("check --as foo", () => {
    usage(
      ["check", "--as", "foo", "pages/", "--root", "."],
      `Unknown format "foo". Supported extensions: ${supportedExtensions().join(", ")}.`,
    );
  });

  it("add with a backwards range", () => {
    usage(
      ["add", "pages/no-citations.md", "src/limits.ts:9-3", "--root", "."],
      'Invalid range "src/limits.ts:9-3": end line 3 is before start line 9.',
    );
  });

  it("add past the end of the file", () => {
    usage(
      ["add", "pages/no-citations.md", "src/limits.ts:99", "--root", "."],
      "src/limits.ts has 7 lines; line 99 is out of range.",
    );
  });

  it("add a source that is not there", () => {
    usage(
      ["add", "pages/no-citations.md", "src/gone.ts", "--root", "."],
      "Source not found: src/gone.ts is not a tracked file under the root.",
    );
  });

  it("add a claim the page does not make", () => {
    usage(
      ["add", "pages/no-citations.md", "src/limits.ts:2", "--claim", "The fetch timeout is 9 seconds.", "--root", "."],
      'Claim not found in pages/no-citations.md: "The fetch timeout is 9 seconds.". Add the sentence first, or omit --claim.',
    );
  });

  it("add an id the page already cites", () => {
    usage(
      ["add", "pages/current.md", "src/limits.ts:2", "--id", "fetch-timeout", "--claim", "The fetch timeout is 10 seconds.", "--root", "."],
      'Id "fetch-timeout" is already cited in pages/current.md.',
    );
  });

  it("add --inline with nothing to anchor", () => {
    usage(
      ["add", "pages/no-citations.md", "src/limits.ts:2", "--inline", "--root", "."],
      "--inline needs --claim or --quote: an inline statement anchors the paragraph or block that follows it.",
    );
  });

  it("add --quote with no block reproducing the range", () => {
    usage(
      ["add", "pages/no-citations.md", "src/limits.ts:1-3", "--quote", "--root", "."],
      "No fenced block in pages/no-citations.md reproduces src/limits.ts:1-3.",
    );
  });

  it("add to a page with no frontmatter", () => {
    usage(
      ["add", "pages/inline.html", "src/limits.ts:2", "--claim", "The fetch timeout is 10 seconds.", "--root", "."],
      "pages/inline.html has no frontmatter to write to. Use --inline.",
    );
  });

  it("update -f sarif", () => {
    usage(["update", "-f", "sarif", "pages/"], 'Unknown --format "sarif". Use pretty or json.');
  });

  it("update --no-check-sources", () => {
    usage(
      ["update", "--no-check-sources", "pages/"],
      "update needs the sources: drop --no-check-sources (or `checkSources: false`).",
    );
  });

  it("--no-git and --no-sources are gone, with no alias", () => {
    const gone: [string[], string][] = [
      [["check", "--no-git", "pages/current.md"], "--no-git"],
      [["add", "pages/no-citations.md", "src/limits.ts:2", "--no-git"], "--no-git"],
      [["update", "--no-git", "pages/moved.md"], "--no-git"],
      [["check", "--no-sources", "pages/current.md"], "--no-sources"],
      [["update", "--no-sources", "pages/moved.md"], "--no-sources"],
    ];
    for (const [args, flag] of gone) {
      const r = cite([...args, "--root", "."]);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain(`unknown option '${flag}'`);
    }
  });

  it("cite.git and cite.sources in config are unknown keys", () => {
    for (const key of ["git", "sources"]) {
      writeFileSync(join(work, "manni.config.yaml"), `cite:\n  ${key}: false\n`, "utf8");
      usage(
        ["check", "--root", ".", "pages/current.md"],
        `Unknown key "${key}" under cite: in manni.config.yaml. Supported keys: allowEmpty, respectGitignore, root, baseline, checkSources, severity.`,
      );
    }
  });
});

describe("manni cite check (the ladder)", () => {
  const check = (args: string[], opts?: { input?: string; env?: Record<string, string> }): Run =>
    cite(["check", "--root", ".", ...args], opts);

  it("--collection runs over the named collection", () => {
    writeFileSync(
      join(work, "manni.config.yaml"),
      "collections:\n  - name: pages\n    paths: ['pages/current.md']\n  - name: rest\n    paths: ['pages/moved.md']\n",
      "utf8",
    );
    const r = cite(["check", "--collection", "pages", "--root", "."]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("pages/current.md");
    expect(r.stdout).not.toContain("moved.md");
  });

  it("passes a current citation", () => {
    const r = check(["pages/current.md"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(
      [
        "✓ pages/current.md",
        "    ✓ fetch-timeout   src/limits.ts:2   current",
        "",
        "1 file checked, 1 passed, 0 failed, 0 findings",
        "",
      ].join("\n"),
    );
  });

  it("fails a changed citation", () => {
    const r = check(["pages/stale-claim.md"]);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/^✗ pages\/stale-claim\.md$/m);
    expect(r.stdout).toMatch(/^ {4}✗ fetch-timeout {3}src\/changed\.ts:2 {3}changed {3}\(line \d+\)$/m);
    expect(r.stdout).toMatch(/^1 file checked, 0 passed, 1 failed, 1 finding$/m);
  });

  it("warns on a moved citation and still exits 0", () => {
    const r = check(["pages/moved.md"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^⚠ pages\/moved\.md$/m);
    expect(r.stdout).toMatch(/^ {4}↕ fetch-timeout {3}src\/moved\.ts:2 {3}moved -> src\/moved\.ts:4 {3}\(line \d+\)$/m);
    expect(r.stdout).toMatch(/^ {4}↕ inline {3}src\/moved\.ts:3 {3}moved -> src\/moved\.ts:5 {3}\(line \d+\)$/m);
    expect(r.stdout).toMatch(/^1 file checked, 1 passed, 0 failed, 2 findings \(2 warnings\)$/m);
  });

  it("fails a missing source", () => {
    const r = check(["pages/missing.md"]);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/^ {4}✗ fetch-timeout {3}src\/gone\.ts:2 {3}missing/m);
  });

  it("labels a whole-file pin by its index", () => {
    const r = check(["pages/whole-file.md"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("    ✓ #0   src/limits.ts   current");
  });

  it("-f json parses and never carries a resolved path", () => {
    const r = check(["-f", "json", "pages/current.md", "pages/stale-claim.md"]);
    expect(r.status).toBe(1);
    const parsed = JSON.parse(r.stdout) as {
      summary: { files: number; passed: number; failed: number; errors: number };
      pages: { file: string; citations: Record<string, unknown>[]; findings: { ruleId: string }[] }[];
    };
    expect(parsed.summary).toMatchObject({ files: 2, passed: 1, failed: 1, errors: 1 });
    expect(parsed.pages.map((p) => p.file)).toEqual(["pages/current.md", "pages/stale-claim.md"]);
    expect(parsed.pages[1]?.findings[0]?.ruleId).toBe("manni:cite/changed");
    expect(r.stdout).not.toContain("resolvedPath");
    expect(r.stdout).not.toContain("commitsSince");
  });

  it("-f github prints one annotation per finding", () => {
    const r = check(["-f", "github", "pages/stale-claim.md"]);
    expect(r.status).toBe(1);
    expect(r.stdout.trim()).toMatch(
      /^::error file=pages\/stale-claim\.md,line=\d+,title=manni%3Acite\/changed::fetch-timeout \(src\/changed\.ts:2\): changed$/,
    );
    expect(check(["-f", "github", "pages/current.md"]).stdout).toBe("");
  });

  it("-f sarif carries the rule id", () => {
    const r = check(["-f", "sarif", "pages/stale-claim.md"]);
    expect(r.status).toBe(1);
    const sarif = JSON.parse(r.stdout) as { runs: { results: { ruleId: string }[] }[] };
    expect(sarif.runs[0]?.results[0]?.ruleId).toBe("manni:cite/changed");
  });

  it("-f junit ships under the cite classname", () => {
    const r = check(["-f", "junit", "pages/stale-claim.md"]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('classname="manni.cite"');
    expect(r.stdout).toContain('type="manni:cite/changed"');
  });

  it("says on stderr, once, that history is off when a citation carries a commit and git is not there", () => {
    const r = check(["pages/frontmatter-only.md", "pages/current.md"]);
    expect(r.stderr).toBe(`manni: ${NO_HISTORY}\n`);
    expect(check(["pages/current.md"]).stderr).toBe("");
    expect(check(["--show-diff", "pages/current.md"]).stderr).toBe(`manni: ${NO_HISTORY}\n`);
    // stdout stays the report's: json still parses.
    const json = check(["-f", "json", "pages/frontmatter-only.md"]);
    expect(json.stderr).toBe(`manni: ${NO_HISTORY}\n`);
    expect(() => JSON.parse(json.stdout) as unknown).not.toThrow();
  });

  it("a notice is reported in every format and never fails the check", () => {
    writeFileSync(join(work, "manni.config.yaml"), "cite:\n  severity:\n    changed: notice\n", "utf8");
    const pretty = check(["pages/stale-claim.md"]);
    expect(pretty.status).toBe(0);
    expect(pretty.stdout).toMatch(/^ℹ pages\/stale-claim\.md$/m);
    expect(pretty.stdout).toMatch(/^ {4}ℹ fetch-timeout {3}src\/changed\.ts:2 {3}changed {3}\(line \d+\)$/m);
    expect(pretty.stdout).toMatch(/^1 file checked, 1 passed, 0 failed, 1 finding \(1 notice\)$/m);
    const github = check(["-f", "github", "pages/stale-claim.md"]);
    expect(github.status).toBe(0);
    expect(github.stdout.trim()).toMatch(/^::notice file=pages\/stale-claim\.md,line=\d+,title=manni%3Acite\/changed::/);
    const sarif = check(["-f", "sarif", "pages/stale-claim.md"]);
    expect(sarif.status).toBe(0);
    const levels = (JSON.parse(sarif.stdout) as { runs: { results: { level: string }[] }[] }).runs[0]?.results.map(
      (r) => r.level,
    );
    expect(levels).toEqual(["note"]);
    const junit = check(["-f", "junit", "pages/stale-claim.md"]);
    expect(junit.status).toBe(0);
    expect(junit.stdout).not.toContain("<failure");
    expect(junit.stdout).toContain('failures="0"');
    const json = check(["-f", "json", "pages/stale-claim.md"]);
    expect(json.status).toBe(0);
    expect((JSON.parse(json.stdout) as { summary: Record<string, number> }).summary).toMatchObject({
      errors: 0,
      notices: 1,
    });
  });

  it("--no-check-sources skips every source and passes, with no key", () => {
    const token = encryptSourcePath("src/limits.ts", FIXTURE_KEY);
    const r = check(["--no-check-sources", "pages/encrypted.md"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`    · fetch-timeout   ${token}:2   skipped`);
    expect(r.stdout).toContain("1 file checked, 1 passed, 0 failed, 0 findings");
  });

  it("an encrypted citation with no key is missing, and fails the check", () => {
    const r = check(["pages/encrypted.md"]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("missing (no encryption key is available to decrypt it)");
    expect(r.stdout).not.toContain("src/limits.ts");
  });

  it("--reveal prints the decrypted path beside the encrypted source, given the key", () => {
    // The key encrypted.md was encrypted with; check.test.ts recomputes the pin.
    const token = encryptSourcePath("src/limits.ts", FIXTURE_KEY);
    expect(readFileSync(join(work, "pages", "encrypted.md"), "utf8")).toContain(`src: ${token}:2`);
    const env = { MANNI_ENCRYPTION_KEY: FIXTURE_KEY };
    const plain = check(["pages/encrypted.md"], { env });
    expect(plain.status).toBe(0);
    expect(plain.stdout).not.toContain("src/limits.ts");
    const revealed = check(["--reveal", "pages/encrypted.md"], { env });
    expect(revealed.stdout).toContain(`    ✓ fetch-timeout   ${token}:2 (src/limits.ts)   current`);
    const json = check(["--reveal", "-f", "json", "pages/encrypted.md"], { env });
    expect(json.stdout).not.toContain("src/limits.ts");
  });

  it("-q hides current rows and clean files", () => {
    const r = check(["-q", "pages/current.md", "pages/stale-claim.md"]);
    expect(r.status).toBe(1);
    expect(r.stdout).not.toContain("pages/current.md");
    expect(r.stdout).toContain("✗ pages/stale-claim.md");
  });

  it("reads stdin with --as", () => {
    const r = check(["-", "--as", "markdown"], { input: readFileSync(join(FIXTURES, "pages", "current.md"), "utf8") });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("✓ <stdin>");
    expect(r.stdout).toContain("    ✓ fetch-timeout   src/limits.ts:2   current");
  });

  it("--write-baseline records a finding, --baseline forgives it, --no-baseline does not", () => {
    // The bare flags take an optional path, so they go after the positional.
    const written = check(["pages/stale-claim.md", "--write-baseline"]);
    expect(written.status).toBe(0);
    expect(existsSync(join(work, DEFAULT_CITE_BASELINE_PATH))).toBe(true);
    const against = check(["pages/stale-claim.md", "--baseline"]);
    expect(against.status).toBe(0);
    expect(against.stdout).toMatch(/baseline/);
    const without = check(["pages/stale-claim.md", "--no-baseline"]);
    expect(without.status).toBe(1);
    expect(without.stdout).toMatch(/^1 file checked, 0 passed, 1 failed, 1 finding$/m);
  });
});

describe.skipIf(!gitAvailable())("manni cite check --show-diff", () => {
  let repo: string | undefined;
  afterEach(() => {
    removeTempRepo(repo);
    repo = undefined;
  });

  it("prints the diff and the commit subjects under a changed row", () => {
    const FIRST = "export const A = 1;\nexport const B = 2;\n";
    repo = makeTempRepo({ files: { "src/limits.ts": FIRST } });
    const first = commitAll(repo, "add limits");
    writeFileSync(
      join(repo, "limits.md"),
      [
        "---",
        "citations:",
        "  - src: src/limits.ts:2",
        `    integrity: ${hashRange(FIRST, { start: 2 })}`,
        `    commit: ${first}`,
        "---",
        "# Limits",
        "",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(join(repo, "src", "limits.ts"), "export const A = 1;\nexport const B = 3;\n", "utf8");
    commitAll(repo, "raise B to 3");

    const r = run(["cite", "check", "--show-diff", "--root", ".", "limits.md"], { cwd: repo });
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/^ {4}✗ #0 {3}src\/limits\.ts:2 {3}changed/m);
    expect(r.stdout).toMatch(/^ {8}raise B to 3$/m);
    expect(r.stdout).toMatch(/^ {8}-export const B = 2;$/m);
    expect(r.stdout).toMatch(/^ {8}\+export const B = 3;$/m);
    // Two commits and a CLI spawn: past the 5 s default on a slow Windows runner.
  }, 60000);
});

describe("manni cite add", () => {
  const CLAIM = "The fetch timeout is 10 seconds.";

  it("writes a frontmatter entry and a reference statement", () => {
    const r = cite(["add", "pages/no-citations.md", "src/limits.ts:2", "--claim", CLAIM, "--id", "fetch-timeout", "--root", "."]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toMatch(
      /^pages\/no-citations\.md: added fetch-timeout \(src\/limits\.ts:2, sha256-78af1d33…, no commit\) to frontmatter; reference at line \d+, claim at line \d+$/,
    );
    const page = readFileSync(join(work, "pages", "no-citations.md"), "utf8");
    expect(page).toContain("citations:");
    expect(page).toContain("src: src/limits.ts:2");
    expect(page).toContain("<!-- cite fetch-timeout -->");
    expect(cite(["check", "--root", ".", "pages/no-citations.md"]).status).toBe(0);
  });

  it("writes a bare pin with no anchor", () => {
    const r = cite(["add", "pages/no-citations.md", "src/limits.ts", "--root", "."]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(
      "pages/no-citations.md: added citation (src/limits.ts, sha256-aebba92f…, no commit) to frontmatter",
    );
  });

  it("writes an inline statement above the fenced block under --quote --inline", () => {
    const r = cite(["add", "pages/quote.md", "src/limits.ts:1-3", "--quote", "--inline", "--root", "."]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toMatch(
      /^pages\/quote\.md: added inline citation \(src\/limits\.ts:1-3, sha256-d2981e71…, no commit\) above the fenced block at line \d+$/,
    );
    expect(readFileSync(join(work, "pages", "quote.md"), "utf8")).toMatch(/<!-- cite \{"src": ?"src\/limits\.ts:1-3".*"quote": ?true/);
  });

  it("writes an inline statement above the claim under --claim --inline", () => {
    const ok = cite(["add", "pages/no-citations.md", "src/limits.ts:2", "--claim", CLAIM, "--inline", "--root", "."]);
    expect(ok.status).toBe(0);
    expect(ok.stdout.trim()).toMatch(
      /^pages\/no-citations\.md: added inline citation \(src\/limits\.ts:2, sha256-78af1d33…, no commit\) above the claim at line \d+$/,
    );
    expect(readFileSync(join(work, "pages", "no-citations.md"), "utf8")).toMatch(/<!-- cite \{"src": ?"src\/limits\.ts:2"/);
  });

  it("--dry-run prints the diff and writes nothing", () => {
    const before = readFileSync(join(work, "pages", "no-citations.md"), "utf8");
    const r = cite(["add", "pages/no-citations.md", "src/limits.ts:2", "--claim", CLAIM, "--dry-run", "--root", "."]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^--- pages\/no-citations\.md$/m);
    expect(r.stdout).toMatch(/^\+\+\+ pages\/no-citations\.md$/m);
    expect(r.stdout).toContain("+citations:");
    expect(readFileSync(join(work, "pages", "no-citations.md"), "utf8")).toBe(before);
  });

  it("with - writes the page to stdout and the message to stderr", () => {
    const input = readFileSync(join(FIXTURES, "pages", "no-citations.md"), "utf8");
    const r = cite(["add", "-", "src/limits.ts:2", "--as", "markdown", "--claim", CLAIM, "--root", "."], { input });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("citations:");
    expect(r.stdout).toContain("integrity: sha256-78af1d3321f9cbb177a7e4c958e39be56fd14cb93c1e441778bc4232e0fe4b1f");
    // The copy is no work tree, so the notice comes first, then the report.
    expect(r.stderr).toMatch(
      new RegExp(
        `^manni: ${NO_COMMIT.replace(/[.]/g, "\\.")}\\n<stdin>: added citation \\(src/limits\\.ts:2, sha256-78af1d33…, no commit\\) to frontmatter; claim at line \\d+\\n$`,
      ),
    );
  });

  it("with - and --dry-run writes the page to stdout, the diff and the message to stderr", () => {
    const input = readFileSync(join(FIXTURES, "pages", "no-citations.md"), "utf8");
    const r = cite(["add", "-", "src/limits.ts:2", "--as", "markdown", "--claim", CLAIM, "--dry-run", "--root", "."], { input });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("citations:");
    expect(r.stdout).toContain("src: src/limits.ts:2");
    expect(r.stderr).toMatch(/^--- <stdin>$/m);
    expect(r.stderr).toContain("+citations:");
    expect(r.stderr.trim()).toMatch(
      /<stdin>: added citation \(src\/limits\.ts:2, sha256-78af1d33…, no commit\) to frontmatter; claim at line \d+$/,
    );
  });

  it.skipIf(!gitAvailable())("records HEAD where the root is in a work tree, and says so where it is not", () => {
    // The fixture tree inside this repository as the root, so HEAD exists there.
    const withHead = cite(["add", "pages/no-citations.md", "src/limits.ts:2", "--root", FIXTURES]);
    expect(withHead.status).toBe(0);
    expect(withHead.stdout).toMatch(/\(src\/limits\.ts:2, sha256-78af1d33…, [0-9a-f]{7}\)/);
    expect(withHead.stderr).toBe("");
    // The copy as the root: no work tree, so no commit, and one line saying why.
    const without = cite(["add", "pages/no-citations.md", "src/limits.ts:3", "--root", "."]);
    expect(without.status).toBe(0);
    expect(without.stdout).toContain("(src/limits.ts:3, sha256-e9f5bdf9…, no commit)");
    expect(without.stderr).toBe(`manni: ${NO_COMMIT}\n`);
    // Under --no-commit nothing was wanted from git, so nothing is said.
    const unwanted = cite(["add", "pages/no-citations.md", "src/limits.ts:1", "--no-commit", "--root", "."]);
    expect(unwanted.status).toBe(0);
    expect(unwanted.stderr).toBe("");
  });

  it("a key in the environment encrypts without --encrypt", () => {
    const token = encryptSourcePath("src/limits.ts", CLI_KEY);
    const r = cite(
      ["add", "pages/no-citations.md", "src/limits.ts:2", "--claim", CLAIM, "--root", "."],
      { env: { MANNI_ENCRYPTION_KEY: CLI_KEY } },
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`(${token}:2, sha256-`);
    expect(r.stdout).not.toContain("src/limits.ts");
    expect(readFileSync(join(work, "pages", "no-citations.md"), "utf8")).toContain(`src: ${token}:2`);
  });

  it("a key in the config encrypts without --encrypt, and check reads it back", () => {
    writeFileSync(join(work, "manni.config.yaml"), `encryptionKey: ${CLI_KEY}\n`, "utf8");
    const token = encryptSourcePath("src/limits.ts", CLI_KEY);
    const r = cite(["add", "pages/no-citations.md", "src/limits.ts:2", "--claim", CLAIM, "--root", "."]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`(${token}:2, sha256-`);
    expect(readFileSync(join(work, "pages", "no-citations.md"), "utf8")).toContain(`src: ${token}:2`);
    const after = cite(["check", "--root", ".", "pages/no-citations.md"]);
    expect(after.status).toBe(0);
    expect(after.stdout).toContain(`${token}:2   current`);
  });

  it("--encrypt with no key, off a terminal, refuses without a question and writes nothing", () => {
    const before = readFileSync(join(work, "pages", "no-citations.md"), "utf8");
    const r = cite(["add", "pages/no-citations.md", "src/limits.ts:2", "--claim", CLAIM, "--encrypt", "--root", "."]);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr.split(/\r?\n/)[0]).toBe(
      "manni: src/limits.ts:2 must be encrypted, and no encryption key is available. Run `manni key set`, or set MANNI_ENCRYPTION_KEY.",
    );
    expect(r.stderr).not.toContain("[y/N]");
    expect(readFileSync(join(work, "pages", "no-citations.md"), "utf8")).toBe(before);
    expect(existsSync(join(work, "manni.config.yaml"))).toBe(false);
  });

  it("--obfuscate is gone, with no alias", () => {
    const r = cite(["add", "pages/no-citations.md", "src/limits.ts:2", "--obfuscate", "--root", "."]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/unknown option '--obfuscate'/);
  });

  it("config salt: is refused, naming the family key, and never echoing the value", () => {
    writeFileSync(join(work, "manni.config.yaml"), "cite:\n  salt: s3cret-value\n", "utf8");
    const r = cite(["add", "pages/no-citations.md", "src/limits.ts:2", "--root", "."]);
    expect(r.status).toBe(2);
    expect(r.stderr.split(/\r?\n/)[0]).toBe(
      'manni: manni.config.yaml: "salt" is no longer a cite key. Values are encrypted with a family key: a top-level encryptionKey:, or MANNI_ENCRYPTION_KEY. Run `manni key set`.',
    );
    expect(r.stderr).not.toContain("s3cret-value");
  });
});

describe("manni cite update", () => {
  it("rewrites moved entries so the next check is clean", () => {
    const r = cite(["update", "--root", ".", "pages/moved.md"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("pages/moved.md: fetch-timeout  src/moved.ts:2 -> src/moved.ts:4  (moved)");
    expect(r.stdout).toContain("pages/moved.md: inline  src/moved.ts:3 -> src/moved.ts:5  (moved)");
    expect(r.stdout).toContain("2 citations rewritten in 1 file, 0 skipped");
    const page = readFileSync(join(work, "pages", "moved.md"), "utf8");
    expect(page).toContain("src: src/moved.ts:4");
    expect(page).toContain('"src": "src/moved.ts:5"');

    const again = cite(["check", "--root", ".", "pages/moved.md"]);
    expect(again.status).toBe(0);
    expect(again.stdout).toContain("1 file checked, 1 passed, 0 failed, 0 findings");
  });

  it("--dry-run prints the diffs and leaves the page alone", () => {
    const before = readFileSync(join(work, "pages", "moved.md"), "utf8");
    const r = cite(["update", "--dry-run", "--root", ".", "pages/moved.md"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^--- pages\/moved\.md$/m);
    expect(r.stdout).toContain("+    src: src/moved.ts:4");
    expect(r.stdout).toContain("2 citations rewritten in 1 file, 0 skipped");
    expect(readFileSync(join(work, "pages", "moved.md"), "utf8")).toBe(before);
  });

  it("skips a changed entry without --accept and exits 1; --accept re-mints it", () => {
    const skipped = cite(["update", "--root", ".", "pages/stale-claim.md"]);
    expect(skipped.status).toBe(1);
    expect(skipped.stdout).toContain("pages/stale-claim.md: fetch-timeout  ✗ skipped: changed");
    expect(skipped.stdout).toContain("0 citations rewritten in 0 files, 1 skipped");

    const accepted = cite(["update", "--accept", "-f", "json", "--root", ".", "pages/stale-claim.md"]);
    expect(accepted.status).toBe(0);
    const parsed = JSON.parse(accepted.stdout) as {
      pages: { file: string; rewritten: { id?: string; reason: string }[]; written: boolean }[];
      rewritten: number;
      skipped: number;
      exitCode: number;
    };
    expect(parsed).toMatchObject({ rewritten: 1, skipped: 0, exitCode: 0 });
    expect(parsed.pages[0]).toMatchObject({ file: "pages/stale-claim.md", written: true });
    expect(parsed.pages[0]?.rewritten[0]).toMatchObject({ id: "fetch-timeout", reason: "accepted" });
    expect(cite(["check", "--root", ".", "pages/stale-claim.md"]).status).toBe(0);
  });

  it("with - writes the rewritten page to stdout and the summary to stderr", () => {
    const input = readFileSync(join(FIXTURES, "pages", "moved.md"), "utf8");
    const r = cite(["update", "-", "--as", "markdown", "--root", "."], { input });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("src: src/moved.ts:4");
    expect(r.stdout).toContain('"src": "src/moved.ts:5"');
    expect(r.stdout).toContain("Retries default to 3.");
    expect(r.stdout).not.toContain("citations rewritten");
    expect(r.stderr).toContain("<stdin>: fetch-timeout  src/moved.ts:2 -> src/moved.ts:4  (moved)");
    expect(r.stderr).toContain("2 citations rewritten in 1 file, 0 skipped");
  });

  it("with - and --dry-run prints the diff and the summary only", () => {
    const input = readFileSync(join(FIXTURES, "pages", "moved.md"), "utf8");
    const r = cite(["update", "-", "--dry-run", "--as", "markdown", "--root", "."], { input });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^--- <stdin>$/m);
    expect(r.stdout).toContain("+    src: src/moved.ts:4");
    expect(r.stdout).toContain("2 citations rewritten in 1 file, 0 skipped");
    // The page itself is not printed: `# Limits` is outside every hunk's context.
    expect(r.stdout).not.toContain("# Limits");
    expect(r.stderr).toBe("");
  });

  it("--only limits the rewrite to the named id", () => {
    const r = cite(["update", "--only", "fetch-timeout", "--root", ".", "pages/moved.md"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("1 citation rewritten in 1 file, 0 skipped");
    const page = readFileSync(join(work, "pages", "moved.md"), "utf8");
    expect(page).toContain("src: src/moved.ts:4");
    expect(page).toContain('"src": "src/moved.ts:3"');
  });
});

/**
 * Colour only happens on a TTY, which a spawned bin never is, so the
 * resolution is tested in-process: parse through commander's real routing
 * with `check`'s action swapped for a no-op, then ask `colorFor` about the
 * command the action would have received, with `isTTY` forced on.
 */
describe("manni cite --no-color (resolution)", () => {
  function find(parent: Command, name: string): Command {
    const found = parent.commands.find((c) => c.name() === name);
    if (found === undefined) throw new Error(`no ${name} command under ${parent.name()}`);
    return found;
  }

  async function parsedCheck(program: Command, check: Command, argv: string[]): Promise<Command> {
    check.action(() => undefined);
    await program.parseAsync(argv);
    return check;
  }

  const umbrellaCheck = (args: string[]): Promise<Command> => {
    const program = buildUmbrella();
    return parsedCheck(program, find(find(program, "cite"), "check"), ["node", "manni", "cite", ...args]);
  };

  const standaloneCheck = (args: string[]): Promise<Command> => {
    const program = buildCite();
    return parsedCheck(program, find(program, "check"), ["node", "cite", ...args]);
  };

  it("colours a TTY when nothing turns it off (the control)", async () => {
    expect(colorFor(await umbrellaCheck(["check", "x.md"]), true, {})).toBe(true);
    expect(colorFor(await standaloneCheck(["check", "x.md"]), true, {})).toBe(true);
  });

  it("under the umbrella, --no-color before the verb turns colour off on a TTY", async () => {
    expect(colorFor(await umbrellaCheck(["--no-color", "check", "x.md"]), true, {})).toBe(false);
  });

  it("under the umbrella, --no-color after the verb turns colour off on a TTY", async () => {
    expect(colorFor(await umbrellaCheck(["check", "--no-color", "x.md"]), true, {})).toBe(false);
  });

  it("the standalone cite program honours --no-color the same way", async () => {
    expect(colorFor(await standaloneCheck(["--no-color", "check", "x.md"]), true, {})).toBe(false);
  });

  it("NO_COLOR and a non-TTY still turn colour off", async () => {
    const check = await umbrellaCheck(["check", "x.md"]);
    expect(colorFor(check, true, { NO_COLOR: "1" })).toBe(false);
    expect(colorFor(check, undefined, {})).toBe(false);
  });
});
