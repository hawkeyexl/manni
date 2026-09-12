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
 *
 * An entry has two ends now, `claim` and `source`, and `add` takes the claim
 * as the page's own lines: `add <page>[:L|:L1-L2] <src>`.
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
import { buildProgram as buildCite, colorFor, splitPageArgument } from "../../src/cite/cli.js";
import { STDIN_LINES_MARKER, normalizeStdinArgv } from "../../src/shared/run.js";
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

/** A page with a fenced block and no citations yet, for the `--quote` rungs. */
const QUOTABLE = [
  "---",
  "title: Limits",
  "---",
  "# Limits",
  "",
  "```ts",
  "export const MAX_FILES = 10_000;",
  "export const FETCH_TIMEOUT_MS = 10_000;",
  "export const RETRIES = 3;",
  "```",
  "",
].join("\n");

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

  it("spells add's arguments as <page> and <src>, with the page's lines on the page", () => {
    const help = run(["cite", "add", "--help"]).stdout;
    expect(help).toMatch(/^Usage: manni cite add \[options\] <page> <src>$/m);
    // Commander wraps the argument descriptions, so match the parts.
    expect(help).toContain("the page to cite from, with the claim's lines");
    expect(help).toMatch(/page:L or\s+page:L1-L2/);
    // The two options a claim used to reach the command through are gone.
    expect(help).not.toContain("--claim");
    expect(help).not.toContain("--inline");
    expect(help).toContain("--no-commit-sha");
  });
});

/**
 * `splitPageArgument` reads only a trailing line suffix, so a path that
 * carries a colon keeps it and `-:9` is still stdin. Tested in-process
 * because commander eats a leading `-` before the core ever sees it.
 */
describe("splitPageArgument", () => {
  it("reads a trailing :L and :L1-L2", () => {
    expect(splitPageArgument("docs/limits.md")).toEqual({ page: "docs/limits.md" });
    expect(splitPageArgument("docs/limits.md:9")).toEqual({
      page: "docs/limits.md",
      lines: { start: 9, end: 9 },
    });
    expect(splitPageArgument("docs/limits.md:14-18")).toEqual({
      page: "docs/limits.md",
      lines: { start: 14, end: 18 },
    });
  });

  it("keeps `-` as the page, with or without lines", () => {
    expect(splitPageArgument("-")).toEqual({ page: "-" });
    expect(splitPageArgument("-:9")).toEqual({ page: "-", lines: { start: 9, end: 9 } });
  });

  it("reads the marker the bin leaves where a stdin dash was", () => {
    // `-:9` cannot reach commander as an operand, so the bin rewrites it and
    // the command reads both spellings as the same argument.
    expect(splitPageArgument(`${STDIN_LINES_MARKER}:9`)).toEqual({
      page: "-",
      lines: { start: 9, end: 9 },
    });
    expect(splitPageArgument(`${STDIN_LINES_MARKER}:14-18`)).toEqual({
      page: "-",
      lines: { start: 14, end: 18 },
    });
  });

  it("normalizes only the stdin-with-lines token, never an option or a path", () => {
    expect(normalizeStdinArgv(["node", "manni", "cite", "add", "-:9", "src.ts:2"])).toEqual([
      "node",
      "manni",
      "cite",
      "add",
      `${STDIN_LINES_MARKER}:9`,
      "src.ts:2",
    ]);
    // A bare dash, a real option and a path with a line suffix are untouched.
    expect(normalizeStdinArgv(["-", "--id", "-x", "docs/a.md:9", "-:0"])).toEqual([
      "-",
      "--id",
      "-x",
      "docs/a.md:9",
      "-:0",
    ]);
  });

  it("reads only the last colon, so a path may carry one", () => {
    expect(splitPageArgument("C:/docs/limits.md:9")).toEqual({
      page: "C:/docs/limits.md",
      lines: { start: 9, end: 9 },
    });
    expect(splitPageArgument("C:/docs/limits.md")).toEqual({ page: "C:/docs/limits.md" });
  });

  it("refuses an end line before the start line", () => {
    expect(() => splitPageArgument("docs/limits.md:18-14")).toThrow(
      'Invalid range "docs/limits.md:18-14": end line 14 is before start line 18.',
    );
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
    const r = cite(["check", "--collection", "gides", "--root", "."]);
    expect(r.status).toBe(2);
    expect(r.stderr.split(/\r?\n/)[0]).toBe(
      'manni: no collection named "gides" in manni.config.yaml. Configured: pages.',
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

  it("add with a backwards page range", () => {
    usage(
      ["add", "pages/no-citations.md:18-14", "src/limits.ts:2", "--root", "."],
      'Invalid range "pages/no-citations.md:18-14": end line 14 is before start line 18.',
    );
  });

  it("add with a backwards source range", () => {
    usage(
      ["add", "pages/no-citations.md:6", "src/limits.ts:9-3", "--root", "."],
      'Invalid range "src/limits.ts:9-3": end line 3 is before start line 9.',
    );
  });

  it("add past the end of the source file", () => {
    usage(
      ["add", "pages/no-citations.md:6", "src/limits.ts:99", "--root", "."],
      "src/limits.ts has 7 lines; line 99 is out of range.",
    );
  });

  it("add a source that is not there", () => {
    usage(
      ["add", "pages/no-citations.md:6", "src/gone.ts", "--root", "."],
      "Source not found: src/gone.ts is not a tracked file under the root.",
    );
  });

  it("add a page that is not there", () => {
    usage(["add", "pages/nope.md:6", "src/limits.ts:2", "--root", "."], 'File not found: "pages/nope.md".');
  });

  it("add page lines past the end of the page", () => {
    usage(
      ["add", "pages/no-citations.md:99", "src/limits.ts:2", "--root", "."],
      "pages/no-citations.md:99 is past the end of the page (6 lines).",
    );
  });

  it("add page lines inside the frontmatter", () => {
    usage(
      ["add", "pages/no-citations.md:2", "src/limits.ts:2", "--root", "."],
      "pages/no-citations.md:2 is in the frontmatter. A claim is body text.",
    );
  });

  it("add --marker with no page lines, and with no --id", () => {
    usage(
      ["add", "pages/no-citations.md", "src/limits.ts:2", "--marker", "--id", "x", "--root", "."],
      "--marker needs the page lines to anchor: pages/no-citations.md:L.",
    );
    usage(
      ["add", "pages/no-citations.md:6", "src/limits.ts:2", "--marker", "--root", "."],
      "--marker needs --id: the marker names the entry.",
    );
  });

  it("add --quote with no page lines", () => {
    usage(
      ["add", "pages/no-citations.md", "src/limits.ts:1-3", "--quote", "--root", "."],
      "--quote needs the block's lines: pages/no-citations.md:L1-L2.",
    );
  });

  it("add --quote where the lines are not a fenced block", () => {
    usage(
      ["add", "pages/no-citations.md:6", "src/limits.ts:1-3", "--quote", "--root", "."],
      "pages/no-citations.md:6 is not a fenced block, so it cannot be a quote.",
    );
  });

  it("add --quote where the block does not reproduce the source", () => {
    writeFileSync(
      join(work, "pages", "other-quote.md"),
      QUOTABLE.replace("export const RETRIES = 3;", "export const RETRIES = 9;"),
      "utf8",
    );
    usage(
      ["add", "pages/other-quote.md:6-10", "src/limits.ts:1-3", "--quote", "--root", "."],
      "The block at pages/other-quote.md:6-10 does not reproduce src/limits.ts:1-3.",
    );
  });

  it("add an id the page already cites", () => {
    usage(
      ["add", "pages/current.md:15", "src/limits.ts:2", "--id", "fetch-timeout", "--root", "."],
      "pages/current.md already has an entry fetch-timeout.",
    );
  });

  it("add a marker id the page already carries", () => {
    usage(
      ["add", "pages/marker-orphan.md:15", "src/limits.ts:2", "--id", "nope", "--marker", "--root", "."],
      "pages/marker-orphan.md already has a marker nope at line 12.",
    );
  });

  it("add an id the schema's grammar refuses", () => {
    usage(
      ["add", "pages/no-citations.md:6", "src/limits.ts:2", "--id", "Fetch_Timeout", "--root", "."],
      'Invalid id "Fetch_Timeout": use lowercase letters, digits and hyphens, starting with a letter or digit.',
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

  it("--claim and --inline are gone, with no alias", () => {
    // The claim is the page's own lines now; an inline entry is a marker.
    const gone: [string[], string][] = [
      [["add", "pages/no-citations.md:6", "src/limits.ts:2", "--claim", "The fetch timeout is 10 seconds."], "--claim"],
      [["add", "pages/no-citations.md:6", "src/limits.ts:2", "--inline"], "--inline"],
    ];
    for (const [args, flag] of gone) {
      const r = cite([...args, "--root", "."]);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain(`unknown option '${flag}'`);
      expect(r.stdout).toBe("");
    }
  });

  it("--no-commit is now --no-commit-sha, with no alias", () => {
    const r = cite(["add", "pages/no-citations.md:6", "src/limits.ts:2", "--no-commit", "--root", "."]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("unknown option '--no-commit'");
  });

  it("--no-git, --no-sources and --obfuscate are gone, with no alias", () => {
    const gone: [string[], string][] = [
      [["check", "--no-git", "pages/current.md"], "--no-git"],
      [["add", "pages/no-citations.md:6", "src/limits.ts:2", "--no-git"], "--no-git"],
      [["update", "--no-git", "pages/moved.md"], "--no-git"],
      [["check", "--no-sources", "pages/current.md"], "--no-sources"],
      [["update", "--no-sources", "pages/moved.md"], "--no-sources"],
      [["add", "pages/no-citations.md:6", "src/limits.ts:2", "--obfuscate"], "--obfuscate"],
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

  it("an old rule name under cite.severity is an unknown key", () => {
    // Every rule says which end it is about now; `changed` names neither.
    writeFileSync(join(work, "manni.config.yaml"), "cite:\n  severity:\n    changed: notice\n", "utf8");
    const r = cite(["check", "--root", ".", "pages/current.md"]);
    expect(r.status).toBe(2);
    expect(r.stderr.split(/\r?\n/)[0]).toBe(
      'manni: Unknown key "changed" under cite.severity: in manni.config.yaml. Supported keys: source-moved, source-moved-ambiguous, source-changed, source-never-true, source-missing, claim-moved, claim-moved-ambiguous, claim-changed, marker-orphan, marker-invalid, marker-repeated, anchor-invalid, entry-invalid, quote-drift.',
    );
  });

  it("config salt: is refused, naming the family key, and never echoing the value", () => {
    writeFileSync(join(work, "manni.config.yaml"), "cite:\n  salt: s3cret-value\n", "utf8");
    const r = cite(["add", "pages/no-citations.md:6", "src/limits.ts:2", "--root", "."]);
    expect(r.status).toBe(2);
    expect(r.stderr.split(/\r?\n/)[0]).toBe(
      'manni: manni.config.yaml: "salt" is no longer a cite key. Values are encrypted with a family key: a top-level encryptionKey:, or MANNI_ENCRYPTION_KEY. Run `manni key set`.',
    );
    expect(r.stderr).not.toContain("s3cret-value");
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

  it("passes a current citation, spelling both ends", () => {
    const r = check(["pages/current.md"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(
      [
        "✓ pages/current.md",
        "    ✓ fetch-timeout   :15 current   src/limits.ts:2 current",
        "",
        "1 file checked, 1 passed, 0 failed, 0 findings",
        "",
      ].join("\n"),
    );
  });

  it("fails a changed source under source-changed", () => {
    const r = check(["pages/source-changed.md"]);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/^✗ pages\/source-changed\.md$/m);
    expect(r.stdout).toMatch(/^ {4}✗ fetch-timeout {3}:15 current {3}src\/changed\.ts:2 changed$/m);
    expect(r.stdout).toMatch(/^1 file checked, 0 passed, 1 failed, 1 finding$/m);
  });

  it("warns on a moved source and still exits 0", () => {
    const r = check(["pages/moved.md"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^⚠ pages\/moved\.md$/m);
    expect(r.stdout).toMatch(
      /^ {4}↕ fetch-timeout {3}:15 current {3}src\/moved\.ts:2 moved -> src\/moved\.ts:4$/m,
    );
    expect(r.stdout).toMatch(/^1 file checked, 1 passed, 0 failed, 1 finding \(1 warning\)$/m);
  });

  it("judges the claim end on its own: claim-changed warns, claim-moved notices", () => {
    const r = check(["pages/claim-changed.md", "pages/claim-moved.md"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^ {4}↕ fetch-timeout {3}:15 changed {3}src\/limits\.ts:2 current$/m);
    expect(r.stdout).toMatch(/^ {4}ℹ fetch-timeout {3}:15 moved -> :17 {3}src\/limits\.ts:2 current$/m);
    expect(r.stdout).toMatch(
      /^2 files checked, 2 passed, 0 failed, 2 findings \(1 warning\) \(1 notice\)$/m,
    );
  });

  it("fails a missing source", () => {
    const r = check(["pages/missing.md"]);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/^ {4}✗ fetch-timeout {3}:15 current {3}src\/gone\.ts:2 missing$/m);
  });

  it("leaves the label empty for a bare pin on a whole file", () => {
    const r = check(["pages/whole-file.md"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("    ✓       src/limits.ts current");
  });

  it("reports an invalid entry on the entry's own line", () => {
    const r = check(["pages/entry-invalid.md"]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("/source must have required property 'integrity'");
    expect(r.stdout).toContain('duplicate id "fetch-timeout"');
  });

  it("reports a marker that names no entry, and a repeated one", () => {
    const orphan = check(["pages/marker-orphan.md"]);
    expect(orphan.status).toBe(1);
    expect(orphan.stdout).toContain('no entry has id "nope"');

    const repeated = check(["pages/marker-repeated.md"]);
    expect(repeated.status).toBe(0);
    expect(repeated.stdout).toContain(
      "retries is named by markers at lines 14 and 19; the first anchors it.",
    );
    expect(repeated.stdout).toMatch(/^1 file checked, 1 passed, 0 failed, 1 finding \(1 warning\)$/m);
  });

  it("-f json parses, carries the new rule ids, and never a resolved path", () => {
    const r = check(["-f", "json", "pages/current.md", "pages/source-changed.md"]);
    expect(r.status).toBe(1);
    const parsed = JSON.parse(r.stdout) as {
      summary: { files: number; passed: number; failed: number; errors: number };
      pages: {
        file: string;
        citations: { claim: { status: string } | null; source: { status: string } }[];
        findings: { ruleId: string; rule: string }[];
      }[];
    };
    expect(parsed.summary).toMatchObject({ files: 2, passed: 1, failed: 1, errors: 1 });
    expect(parsed.pages.map((p) => p.file)).toEqual([
      "pages/current.md",
      "pages/source-changed.md",
    ]);
    expect(parsed.pages[0]?.citations[0]?.claim?.status).toBe("current");
    expect(parsed.pages[1]?.findings[0]?.rule).toBe("source-changed");
    expect(parsed.pages[1]?.findings[0]?.ruleId).toBe("manni:cite/source-changed");
    expect(r.stdout).not.toContain("resolvedPath");
    expect(r.stdout).not.toContain("commitsSince");
  });

  it("-f github prints one annotation per finding, under the end's rule", () => {
    const r = check(["-f", "github", "pages/source-changed.md", "pages/claim-changed.md"]);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(
      /^::error file=pages\/source-changed\.md,line=15,title=manni%3Acite\/source-changed::fetch-timeout \(src\/changed\.ts:2\): changed$/m,
    );
    expect(r.stdout).toMatch(
      /^::warning file=pages\/claim-changed\.md,line=15,title=manni%3Acite\/claim-changed::fetch-timeout: the claim at line 15 has changed since it was pinned\.$/m,
    );
    expect(check(["-f", "github", "pages/current.md"]).stdout).toBe("");
  });

  it("-f sarif carries the rule id", () => {
    const r = check(["-f", "sarif", "pages/source-changed.md"]);
    expect(r.status).toBe(1);
    const sarif = JSON.parse(r.stdout) as { runs: { results: { ruleId: string }[] }[] };
    expect(sarif.runs[0]?.results[0]?.ruleId).toBe("manni:cite/source-changed");
  });

  it("-f junit ships under the cite classname", () => {
    const r = check(["-f", "junit", "pages/source-changed.md"]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('classname="manni.cite"');
    expect(r.stdout).toContain('type="manni:cite/source-changed"');
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
    writeFileSync(join(work, "manni.config.yaml"), "cite:\n  severity:\n    source-changed: notice\n", "utf8");
    const pretty = check(["pages/source-changed.md"]);
    expect(pretty.status).toBe(0);
    expect(pretty.stdout).toMatch(/^ℹ pages\/source-changed\.md$/m);
    expect(pretty.stdout).toMatch(/^ {4}ℹ fetch-timeout {3}:15 current {3}src\/changed\.ts:2 changed$/m);
    expect(pretty.stdout).toMatch(/^1 file checked, 1 passed, 0 failed, 1 finding \(1 notice\)$/m);
    const github = check(["-f", "github", "pages/source-changed.md"]);
    expect(github.status).toBe(0);
    expect(github.stdout.trim()).toMatch(
      /^::notice file=pages\/source-changed\.md,line=\d+,title=manni%3Acite\/source-changed::/,
    );
    const sarif = check(["-f", "sarif", "pages/source-changed.md"]);
    expect(sarif.status).toBe(0);
    const levels = (JSON.parse(sarif.stdout) as { runs: { results: { level: string }[] }[] }).runs[0]?.results.map(
      (r) => r.level,
    );
    expect(levels).toEqual(["note"]);
    const junit = check(["-f", "junit", "pages/source-changed.md"]);
    expect(junit.status).toBe(0);
    expect(junit.stdout).not.toContain("<failure");
    expect(junit.stdout).toContain('failures="0"');
    const json = check(["-f", "json", "pages/source-changed.md"]);
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
    expect(r.stdout).toContain(`${token.slice(0, 5)}…:2 skipped`);
    expect(r.stdout).toContain("1 file checked, 1 passed, 0 failed, 0 findings");
  });

  it("an encrypted citation with no key is missing, and fails the check", () => {
    const r = check(["pages/encrypted.md"]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("missing (no encryption key is available to decrypt it)");
    expect(r.stdout).not.toContain("src/limits.ts");
  });

  it("--reveal prints the decrypted path beside the encrypted source, given the key", () => {
    // The key encrypted.md was encrypted with; the pin there is keyed.
    const token = encryptSourcePath("src/limits.ts", FIXTURE_KEY);
    const page = readFileSync(join(work, "pages", "encrypted.md"), "utf8");
    expect(page).toContain(`file: ${token}`);
    expect(page).toContain("integrity: hmac-sha256-");
    const env = { MANNI_ENCRYPTION_KEY: FIXTURE_KEY };
    const plain = check(["pages/encrypted.md"], { env });
    expect(plain.status).toBe(0);
    expect(plain.stdout).not.toContain("src/limits.ts");
    const revealed = check(["--reveal", "pages/encrypted.md"], { env });
    expect(revealed.stdout).toContain(`${token.slice(0, 5)}…:2 (src/limits.ts) current`);
    const json = check(["--reveal", "-f", "json", "pages/encrypted.md"], { env });
    expect(json.stdout).not.toContain("src/limits.ts");
  });

  it("an encrypted source pinned plain is an invalid entry", () => {
    const r = check(["pages/hmac-mismatch.md"], { env: { MANNI_ENCRYPTION_KEY: FIXTURE_KEY } });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain(
      "fetch-timeout: an encrypted source is pinned with hmac-sha256-, not sha256-.",
    );
  });

  it("-q hides current rows and clean files", () => {
    const r = check(["-q", "pages/current.md", "pages/source-changed.md"]);
    expect(r.status).toBe(1);
    expect(r.stdout).not.toContain("pages/current.md");
    expect(r.stdout).toContain("✗ pages/source-changed.md");
  });

  it("reads stdin with --as", () => {
    const r = check(["-", "--as", "markdown"], { input: readFileSync(join(FIXTURES, "pages", "current.md"), "utf8") });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("✓ <stdin>");
    expect(r.stdout).toContain("    ✓ fetch-timeout   :15 current   src/limits.ts:2 current");
  });

  it("--write-baseline records a finding, --baseline forgives it, --no-baseline does not", () => {
    // The bare flags take an optional path, so they go after the positional.
    const written = check(["pages/source-changed.md", "--write-baseline"]);
    expect(written.status).toBe(0);
    expect(existsSync(join(work, DEFAULT_CITE_BASELINE_PATH))).toBe(true);
    const against = check(["pages/source-changed.md", "--baseline"]);
    expect(against.status).toBe(0);
    expect(against.stdout).toMatch(/baseline/);
    const without = check(["pages/source-changed.md", "--no-baseline"]);
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
        "  - source:",
        "      file: src/limits.ts",
        "      lines: 2",
        `      integrity: ${hashRange(FIRST, { start: 2 })}`,
        `      commit-sha: ${first}`,
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
    expect(r.stdout).toMatch(/^ {4}✗ {7}src\/limits\.ts:2 changed since [0-9a-f]{7}, 1 commit$/m);
    expect(r.stdout).toMatch(/^ {8}raise B to 3$/m);
    expect(r.stdout).toMatch(/^ {8}-export const B = 2;$/m);
    expect(r.stdout).toMatch(/^ {8}\+export const B = 3;$/m);
    // Two commits and a CLI spawn: past the 5 s default on a slow Windows runner.
  }, 60000);
});

describe("manni cite add", () => {
  it("pins the page's lines as the claim and the source lines beside them", () => {
    const r = cite(["add", "pages/no-citations.md:6", "src/limits.ts:2", "--id", "fetch-timeout", "--root", "."]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(
      "pages/no-citations.md: added fetch-timeout to frontmatter (claim at line 15, sha256-921b21cc…; source src/limits.ts:2, sha256-78af1d33…, no commit)",
    );
    const page = readFileSync(join(work, "pages", "no-citations.md"), "utf8");
    // What it writes is byte for byte the current.md fixture's entry.
    expect(page).toContain("  - id: fetch-timeout\n    claim:\n      lines: 3\n");
    expect(page).toContain("    source:\n      file: src/limits.ts\n      lines: 2\n");
    expect(cite(["check", "--root", ".", "pages/no-citations.md"]).status).toBe(0);
  });

  it("stores the claim in body lines, so the frontmatter it just wrote does not move it", () => {
    const r = cite(["add", "pages/no-citations.md:6", "src/limits.ts:2", "--root", "."]);
    expect(r.status).toBe(0);
    // Page line 6 before the write, body line 3, page line 15 after it.
    expect(r.stdout).toContain("claim at line 14");
    expect(readFileSync(join(work, "pages", "no-citations.md"), "utf8")).toContain("      lines: 3\n");
  });

  it("writes a bare pin when the page carries no lines", () => {
    const r = cite(["add", "pages/no-citations.md", "src/limits.ts", "--root", "."]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(
      "pages/no-citations.md: added a bare pin to frontmatter (source src/limits.ts, sha256-aebba92f…, no commit)",
    );
    const page = readFileSync(join(work, "pages", "no-citations.md"), "utf8");
    expect(page).toContain("citations:");
    expect(page).not.toContain("claim:");
  });

  it("--marker writes the marker above the lines and pins what it anchors", () => {
    const r = cite([
      "add", "pages/no-citations.md:6", "src/limits.ts:2", "--id", "timeouts", "--marker", "--root", ".",
    ]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(
      "pages/no-citations.md: added timeouts to frontmatter; marker at line 14, claim pinned at line 15",
    );
    const page = readFileSync(join(work, "pages", "no-citations.md"), "utf8");
    expect(page).toContain("<!-- cite timeouts -->\nThe fetch timeout is 10 seconds.");
    // A marker anchors the claim, so the entry records no claim lines.
    expect(page).toContain("    claim:\n      integrity: sha256-921b21cc");
    expect(cite(["check", "--root", ".", "pages/no-citations.md"]).status).toBe(0);
  });

  it("--quote pins the whole block and says what it reproduces", () => {
    writeFileSync(join(work, "pages", "plain-quote.md"), QUOTABLE, "utf8");
    const r = cite(["add", "pages/plain-quote.md:6-10", "src/limits.ts:1-3", "--quote", "--root", "."]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(
      "pages/plain-quote.md: added an entry to frontmatter (claim lines 15-19, a block that reproduces src/limits.ts:1-3)",
    );
    const page = readFileSync(join(work, "pages", "plain-quote.md"), "utf8");
    expect(page).toContain("      lines: 3-7\n");
    expect(page).toContain("    quote: true\n");
    expect(cite(["check", "--root", ".", "pages/plain-quote.md"]).status).toBe(0);
  });

  it("--dry-run prints the diff to stdout, the message to stderr, and writes nothing", () => {
    const before = readFileSync(join(work, "pages", "no-citations.md"), "utf8");
    const r = cite(["add", "pages/no-citations.md:6", "src/limits.ts:2", "--dry-run", "--root", "."]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^--- pages\/no-citations\.md$/m);
    expect(r.stdout).toMatch(/^\+\+\+ pages\/no-citations\.md$/m);
    expect(r.stdout).toContain("+citations:");
    expect(r.stderr).toContain("added an entry to frontmatter");
    expect(readFileSync(join(work, "pages", "no-citations.md"), "utf8")).toBe(before);
  });

  it("with - writes the page to stdout and the message to stderr", () => {
    const input = readFileSync(join(FIXTURES, "pages", "no-citations.md"), "utf8");
    const r = cite(["add", "-", "src/limits.ts:2", "--as", "markdown", "--root", "."], { input });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("citations:");
    expect(r.stdout).toContain("integrity: sha256-78af1d3321f9cbb177a7e4c958e39be56fd14cb93c1e441778bc4232e0fe4b1f");
    // The copy is no work tree, so the notice comes first, then the report.
    expect(r.stderr).toBe(
      `manni: ${NO_COMMIT}\n<stdin>: added a bare pin to frontmatter (source src/limits.ts:2, sha256-78af1d33…, no commit)\n`,
    );
  });

  it("with -:L, the page comes from stdin and its lines are the claim", () => {
    // The ladder's form, typed exactly as a person types it. Commander reads
    // any leading `-` as an option, so the bin rewrites this one first
    // (`normalizeStdinArgv`); that it works from argv is the point of the test.
    const input = readFileSync(join(FIXTURES, "pages", "no-citations.md"), "utf8");
    const r = cite(
      ["add", "-:6", "src/limits.ts:2", "--as", "markdown", "--id", "fetch-timeout", "--root", "."],
      { input },
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("  - id: fetch-timeout\n    claim:\n      lines: 3\n");
    expect(r.stderr).toContain(
      "<stdin>: added fetch-timeout to frontmatter (claim at line 15, sha256-921b21cc…; source src/limits.ts:2, sha256-78af1d33…, no commit)",
    );
  });

  it("with -:L after --, the page still comes from stdin", () => {
    const input = readFileSync(join(FIXTURES, "pages", "no-citations.md"), "utf8");
    const r = cite(
      ["add", "--as", "markdown", "--id", "fetch-timeout", "--root", ".", "--", "-:6", "src/limits.ts:2"],
      { input },
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("  - id: fetch-timeout\n    claim:\n      lines: 3\n");
  });

  it("still refuses an unknown option that starts with a dash", () => {
    // The rewrite is exactly `-:L` and nothing else, so a typo is still a typo.
    const r = cite(["add", "pages/current.md:6", "src/limits.ts:2", "--claim", "x", "--root", "."]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("error: unknown option '--claim'");
  });

  it("with - and --dry-run writes the page to stdout, the diff and the message to stderr", () => {
    const input = readFileSync(join(FIXTURES, "pages", "no-citations.md"), "utf8");
    const r = cite(["add", "-", "src/limits.ts:2", "--as", "markdown", "--dry-run", "--root", "."], { input });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("citations:");
    expect(r.stdout).toContain("file: src/limits.ts");
    expect(r.stderr).toMatch(/^--- <stdin>$/m);
    expect(r.stderr).toContain("+citations:");
    expect(r.stderr.trim()).toMatch(/<stdin>: added a bare pin to frontmatter \(source src\/limits\.ts:2, /);
  });

  it.skipIf(!gitAvailable())("records HEAD where the root is in a work tree, and says so where it is not", () => {
    // The fixture tree inside this repository as the root, so HEAD exists there.
    const withHead = cite(["add", "pages/no-citations.md:6", "src/limits.ts:2", "--root", FIXTURES]);
    expect(withHead.status).toBe(0);
    expect(withHead.stdout).toMatch(/source src\/limits\.ts:2, sha256-78af1d33…, [0-9a-f]{7}\)$/m);
    expect(withHead.stderr).toBe("");
    expect(readFileSync(join(work, "pages", "no-citations.md"), "utf8")).toMatch(
      /^ {6}commit-sha: [0-9a-f]{40}$/m,
    );
  });

  it("says once that git recorded no commit, and nothing at all under --no-commit-sha", () => {
    // The copy is no work tree, so there is no HEAD to record.
    const without = cite(["add", "pages/no-citations.md:6", "src/limits.ts:3", "--root", "."]);
    expect(without.status).toBe(0);
    expect(without.stdout).toContain("source src/limits.ts:3, sha256-e9f5bdf9…, no commit)");
    expect(without.stderr).toBe(`manni: ${NO_COMMIT}\n`);
    // Under --no-commit-sha nothing was wanted from git, so nothing is said.
    // A different page, because the add above shifted this one's body down.
    const unwanted = cite(["add", "pages/current.md:17", "src/limits.ts:1", "--no-commit-sha", "--root", "."]);
    expect(unwanted.status).toBe(0);
    expect(unwanted.stderr).toBe("");
    expect(readFileSync(join(work, "pages", "current.md"), "utf8")).not.toContain("commit-sha:");
  });

  it("a key in the environment encrypts without --encrypt, and keys the pin", () => {
    const token = encryptSourcePath("src/limits.ts", CLI_KEY);
    const r = cite(
      ["add", "pages/no-citations.md:6", "src/limits.ts:2", "--root", "."],
      { env: { MANNI_ENCRYPTION_KEY: CLI_KEY } },
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`source ${token.slice(0, 5)}…:2, hmac-sha256-`);
    expect(r.stdout).not.toContain("src/limits.ts");
    const page = readFileSync(join(work, "pages", "no-citations.md"), "utf8");
    expect(page).toContain(`file: ${token}`);
    expect(page).toMatch(/^ {6}integrity: hmac-sha256-[0-9a-f]{64}$/m);
  });

  it("a key in the config encrypts without --encrypt, and check reads it back", () => {
    writeFileSync(join(work, "manni.config.yaml"), `encryptionKey: ${CLI_KEY}\n`, "utf8");
    const token = encryptSourcePath("src/limits.ts", CLI_KEY);
    const r = cite(["add", "pages/no-citations.md:6", "src/limits.ts:2", "--root", "."]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`source ${token.slice(0, 5)}…:2, hmac-sha256-`);
    expect(readFileSync(join(work, "pages", "no-citations.md"), "utf8")).toContain(`file: ${token}`);
    const after = cite(["check", "--root", ".", "pages/no-citations.md"]);
    expect(after.status).toBe(0);
    expect(after.stdout).toContain(`${token.slice(0, 5)}…:2 current`);
  });

  it("--encrypt with no key, off a terminal, refuses without a question and writes nothing", () => {
    const before = readFileSync(join(work, "pages", "no-citations.md"), "utf8");
    const r = cite(["add", "pages/no-citations.md:6", "src/limits.ts:2", "--encrypt", "--root", "."]);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr.split(/\r?\n/)[0]).toBe(
      "manni: src/limits.ts:2 must be encrypted, and no encryption key is available. Run `manni key set`, or set MANNI_ENCRYPTION_KEY.",
    );
    expect(r.stderr).not.toContain("[y/N]");
    expect(readFileSync(join(work, "pages", "no-citations.md"), "utf8")).toBe(before);
    expect(existsSync(join(work, "manni.config.yaml"))).toBe(false);
  });
});

describe("manni cite update", () => {
  it("rewrites a moved source so the next check is clean", () => {
    const r = cite(["update", "--root", ".", "pages/moved.md"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("pages/moved.md: fetch-timeout source src/moved.ts:2 -> src/moved.ts:4 (moved)");
    expect(r.stdout).toContain("1 citation rewritten in 1 file, 0 skipped");
    expect(readFileSync(join(work, "pages", "moved.md"), "utf8")).toContain(
      "      file: src/moved.ts\n      lines: 4\n",
    );

    const again = cite(["check", "--root", ".", "pages/moved.md"]);
    expect(again.status).toBe(0);
    expect(again.stdout).toContain("1 file checked, 1 passed, 0 failed, 0 findings");
  });

  it("rewrites a moved claim in the page's own body lines", () => {
    const r = cite(["update", "--root", ".", "pages/claim-moved.md"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("pages/claim-moved.md: fetch-timeout claim line 15 -> 17 (moved)");
    expect(readFileSync(join(work, "pages", "claim-moved.md"), "utf8")).toContain(
      "    claim:\n      lines: 5\n",
    );
    expect(cite(["check", "--root", ".", "pages/claim-moved.md"]).status).toBe(0);
  });

  it("--dry-run prints the diffs and leaves the page alone", () => {
    const before = readFileSync(join(work, "pages", "moved.md"), "utf8");
    const r = cite(["update", "--dry-run", "--root", ".", "pages/moved.md"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^--- pages\/moved\.md$/m);
    expect(r.stdout).toContain("+      lines: 4");
    expect(r.stdout).toContain("1 citation rewritten in 1 file, 0 skipped");
    expect(readFileSync(join(work, "pages", "moved.md"), "utf8")).toBe(before);
  });

  it("skips a changed entry without --accept and exits 1; --accept re-mints it", () => {
    const skipped = cite(["update", "--root", ".", "pages/source-changed.md"]);
    expect(skipped.status).toBe(1);
    expect(skipped.stdout).toContain("pages/source-changed.md: fetch-timeout  ✗ skipped: changed");
    expect(skipped.stdout).toContain("0 citations rewritten in 0 files, 1 skipped");

    const accepted = cite(["update", "--accept", "-f", "json", "--root", ".", "pages/source-changed.md"]);
    expect(accepted.status).toBe(0);
    const parsed = JSON.parse(accepted.stdout) as {
      pages: { file: string; rewritten: { id?: string; end: string; reason: string; status: string }[]; written: boolean }[];
      rewritten: number;
      skipped: number;
      exitCode: number;
    };
    expect(parsed).toMatchObject({ rewritten: 1, skipped: 0, exitCode: 0 });
    expect(parsed.pages[0]).toMatchObject({ file: "pages/source-changed.md", written: true });
    expect(parsed.pages[0]?.rewritten[0]).toMatchObject({
      id: "fetch-timeout",
      end: "source",
      reason: "accepted",
      status: "changed",
    });
    expect(cite(["check", "--root", ".", "pages/source-changed.md"]).status).toBe(0);
  });

  it("--accept says which pin it replaced", () => {
    const r = cite(["update", "--accept", "--root", ".", "pages/source-changed.md"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(
      /^pages\/source-changed\.md: fetch-timeout source src\/changed\.ts:2 re-pinned \(changed; sha256-78af1d33… -> sha256-[0-9a-f]{8}…\)$/m,
    );
  });

  it("with - writes the rewritten page to stdout and the summary to stderr", () => {
    const input = readFileSync(join(FIXTURES, "pages", "moved.md"), "utf8");
    const r = cite(["update", "-", "--as", "markdown", "--root", "."], { input });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("      file: src/moved.ts\n      lines: 4\n");
    expect(r.stdout).toContain("The fetch timeout is 10 seconds.");
    expect(r.stdout).not.toContain("citations rewritten");
    expect(r.stderr).toContain("<stdin>: fetch-timeout source src/moved.ts:2 -> src/moved.ts:4 (moved)");
    expect(r.stderr).toContain("1 citation rewritten in 1 file, 0 skipped");
  });

  it("with - and --dry-run prints the diff and the summary only", () => {
    const input = readFileSync(join(FIXTURES, "pages", "moved.md"), "utf8");
    const r = cite(["update", "-", "--dry-run", "--as", "markdown", "--root", "."], { input });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^--- <stdin>$/m);
    expect(r.stdout).toContain("+      lines: 4");
    expect(r.stdout).toContain("1 citation rewritten in 1 file, 0 skipped");
    // The page itself is not printed: `# Limits` is outside every hunk's context.
    expect(r.stdout).not.toContain("# Limits");
    expect(r.stderr).toBe("");
  });

  it("--only limits the rewrite to the named id", () => {
    const none = cite(["update", "--only", "nothing-here", "--root", ".", "pages/moved.md"]);
    expect(none.status).toBe(0);
    expect(none.stdout).toContain("0 citations rewritten in 0 files, 0 skipped");
    expect(readFileSync(join(work, "pages", "moved.md"), "utf8")).toContain("      lines: 2\n");

    const named = cite(["update", "--only", "fetch-timeout", "--root", ".", "pages/moved.md"]);
    expect(named.status).toBe(0);
    expect(named.stdout).toContain("1 citation rewritten in 1 file, 0 skipped");
    expect(readFileSync(join(work, "pages", "moved.md"), "utf8")).toContain("      lines: 4\n");
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
