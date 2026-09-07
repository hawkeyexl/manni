/**
 * `manni cite …` against the built `dist/cli.js`: the grammar, every usage
 * error in the plan's ladder with its exact stderr line and exit code, and
 * the deterministic rungs of the ladder itself.
 *
 * Every run that touches sources works in a throwaway copy of
 * `test/fixtures/cite`, with that copy as `--root` and git switched off, so
 * the source index is a walk of the copy and nothing depends on which
 * fixtures happen to be tracked in this repository. `add` and `update` write,
 * so they need the copy anyway.
 */
import { execSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { obfuscatePath } from "../../src/cite/core/sources.js";
import { supportedExtensions } from "../../src/meta/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const manni = resolve(root, "dist", "cli.js");
const FIXTURES = resolve(root, "test", "fixtures", "cite");

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
    env: { ...process.env, NO_COLOR: "1", ...(opts.env ?? {}) },
  });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status ?? 1 };
}

/** A fresh copy of the fixture tree; the tests write into it. */
let work: string;
/** `cite <verb> … --root . --no-git`, run from the copy. */
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
  it("lists check, add and update", () => {
    const r = run(["cite", "--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^Usage: manni cite /m);
    expect(r.stdout).toMatch(/^\s+check\b/m);
    expect(r.stdout).toMatch(/^\s+add\b/m);
    expect(r.stdout).toMatch(/^\s+update\b/m);
  });

  it("has no default subcommand: bare `manni cite` is a usage error", () => {
    const r = run(["cite"]);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/^Usage: manni cite \[options\] \[command\]/m);
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
      ["check", "--root", ".", "--no-git"],
      "No files to check. Pass paths/globs, or add `paths:` under `cite:` in manni.config.yaml.",
    );
  });

  it("check -f xml", () => {
    usage(["check", "-f", "xml", "pages/"], 'Unknown --format "xml". Use pretty, json, github, sarif, or junit.');
  });

  it("check - without --as", () => {
    usage(
      ["check", "-", "pages/", "--root", ".", "--no-git"],
      "Reading from stdin (`-`) requires --as <format> to choose an extractor.",
      { input: "---\ntitle: t\n---\n" },
    );
  });

  it("check --as foo", () => {
    usage(
      ["check", "--as", "foo", "pages/", "--root", ".", "--no-git"],
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

  it("update --no-sources", () => {
    usage(["update", "--no-sources", "pages/"], "update needs the sources: drop --no-sources (or `sources: false`).");
  });
});

describe("manni cite check (the ladder)", () => {
  const check = (args: string[], opts?: { input?: string; env?: Record<string, string> }): Run =>
    cite(["check", "--root", ".", "--no-git", ...args], opts);

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

  it("--no-sources skips every source and passes", () => {
    const r = check(["--no-sources", "pages/obfuscated.md"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("    · fetch-timeout   ~e22f931c1370b13e:2   skipped");
    expect(r.stdout).toContain("1 file checked, 1 passed, 0 failed, 0 findings");
  });

  it("--reveal prints the resolved path beside the token, given the salt", () => {
    // The salt obfuscated.md was minted with; check.test.ts recomputes the pin.
    const token = obfuscatePath("src/limits.ts", "SALT-FIXTURE");
    expect(readFileSync(join(work, "pages", "obfuscated.md"), "utf8")).toContain(`src: ${token}:2`);
    const env = { MANNI_CITE_SALT: "SALT-FIXTURE" };
    const plain = check(["pages/obfuscated.md"], { env });
    expect(plain.status).toBe(0);
    expect(plain.stdout).not.toContain("src/limits.ts");
    const revealed = check(["--reveal", "pages/obfuscated.md"], { env });
    expect(revealed.stdout).toContain(`    ✓ fetch-timeout   ${token}:2 (src/limits.ts)   current`);
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
    expect(cite(["check", "--root", ".", "--no-git", "pages/no-citations.md"]).status).toBe(0);
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
    expect(r.stderr.trim()).toMatch(
      /^<stdin>: added citation \(src\/limits\.ts:2, sha256-78af1d33…, no commit\) to frontmatter; claim at line \d+$/,
    );
  });

  it("--obfuscate writes a token, keyed by the salt", () => {
    const token = obfuscatePath("src/limits.ts", "SALT-LADDER");
    const r = cite(
      ["add", "pages/no-citations.md", "src/limits.ts:2", "--claim", CLAIM, "--obfuscate", "--root", "."],
      { env: { MANNI_CITE_SALT: "SALT-LADDER" } },
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`(${token}:2, sha256-`);
    expect(r.stdout).not.toContain("src/limits.ts");
    expect(readFileSync(join(work, "pages", "no-citations.md"), "utf8")).toContain(`src: ${token}:2`);
  });
});

describe("manni cite update", () => {
  it("rewrites moved entries so the next check is clean", () => {
    const r = cite(["update", "--root", ".", "--no-git", "pages/moved.md"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("pages/moved.md: fetch-timeout  src/moved.ts:2 -> src/moved.ts:4  (moved)");
    expect(r.stdout).toContain("pages/moved.md: inline  src/moved.ts:3 -> src/moved.ts:5  (moved)");
    expect(r.stdout).toContain("2 citations rewritten in 1 file, 0 skipped");
    const page = readFileSync(join(work, "pages", "moved.md"), "utf8");
    expect(page).toContain("src: src/moved.ts:4");
    expect(page).toContain('"src": "src/moved.ts:5"');

    const again = cite(["check", "--root", ".", "--no-git", "pages/moved.md"]);
    expect(again.status).toBe(0);
    expect(again.stdout).toContain("1 file checked, 1 passed, 0 failed, 0 findings");
  });

  it("--dry-run prints the diffs and leaves the page alone", () => {
    const before = readFileSync(join(work, "pages", "moved.md"), "utf8");
    const r = cite(["update", "--dry-run", "--root", ".", "--no-git", "pages/moved.md"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^--- pages\/moved\.md$/m);
    expect(r.stdout).toContain("+    src: src/moved.ts:4");
    expect(r.stdout).toContain("2 citations rewritten in 1 file, 0 skipped");
    expect(readFileSync(join(work, "pages", "moved.md"), "utf8")).toBe(before);
  });

  it("skips a changed entry without --accept and exits 1; --accept re-mints it", () => {
    const skipped = cite(["update", "--root", ".", "--no-git", "pages/stale-claim.md"]);
    expect(skipped.status).toBe(1);
    expect(skipped.stdout).toContain("pages/stale-claim.md: fetch-timeout  ✗ skipped: changed");
    expect(skipped.stdout).toContain("0 citations rewritten in 0 files, 1 skipped");

    const accepted = cite(["update", "--accept", "-f", "json", "--root", ".", "--no-git", "pages/stale-claim.md"]);
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
    expect(cite(["check", "--root", ".", "--no-git", "pages/stale-claim.md"]).status).toBe(0);
  });

  it("--only limits the rewrite to the named id", () => {
    const r = cite(["update", "--only", "fetch-timeout", "--root", ".", "--no-git", "pages/moved.md"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("1 citation rewritten in 1 file, 0 skipped");
    const page = readFileSync(join(work, "pages", "moved.md"), "utf8");
    expect(page).toContain("src: src/moved.ts:4");
    expect(page).toContain('"src": "src/moved.ts:3"');
  });
});
