/**
 * `runCheck` over the fixture pages with `test/fixtures/cite` as both cwd and
 * root, the way `manni cite check --root test/fixtures/cite pages/x.md` runs
 * from that directory. Git is off for the fixture cases so the source index
 * walks the directory (a fixture added on a branch is not yet tracked, and a
 * `git ls-files` index would call it missing); the git-dependent cases build
 * a throwaway repository. The first block recomputes every fixture pin, so a
 * hand-typed hash cannot rot without a test saying so.
 */
import { afterEach, describe, expect, it } from "vitest";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCheck } from "../../src/cite/commands/check.js";
import { DEFAULT_CITE_BASELINE_PATH } from "../../src/cite/core/config.js";
import { hashRange } from "../../src/cite/core/hash.js";
import { readPage } from "../../src/cite/core/page.js";
import { parseSrc } from "../../src/cite/core/range.js";
import { decryptSourcePath, encryptSourcePath } from "../../src/cite/core/sources.js";
import { CiteError } from "../../src/cite/errors.js";
import type { CheckOptions, CheckRun } from "../../src/cite/types.js";
import { commitAll, gitAvailable, makeTempRepo, removeTempRepo } from "../helpers/temp-repo.js";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "fixtures", "cite");
const PAGES = join(ROOT, "pages");
const SRC = join(ROOT, "src");
/** The fixed test key pages/encrypted.md was encrypted with. Never the developer's environment. */
const FIXTURE_KEY = "cite-fixture-key-0123456789abcdef";
const SENTINEL = "sentinel-key-0123456789abcdef012345";
const OTHER = "another-key-0123456789abcdef012345";
const PIN_L2 = "sha256-78af1d3321f9cbb177a7e4c958e39be56fd14cb93c1e441778bc4232e0fe4b1f";
const UNKNOWN = "0123456789abcdef0123456789abcdef01234567";

const source = (name: string): string => readFileSync(join(SRC, name), "utf8");
const page = (name: string): string => readFileSync(join(PAGES, name), "utf8");

const statuses = (run: CheckRun, i = 0): string[] =>
  (run.pages[i]?.citations ?? []).map((c) => c.status);
const rules = (run: CheckRun, i = 0): string[] => (run.pages[i]?.findings ?? []).map((f) => f.rule);

/** `runCheck` from the fixture directory, git off, no config unless a case says so. */
function check(over: Partial<CheckOptions> & { inputs: string[] }): Promise<CheckRun> {
  return runCheck({ cwd: ROOT, root: ROOT, noConfig: true, git: false, env: {}, ...over });
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(CiteError);
    return (e as Error).message;
  }
  throw new Error("expected a refusal");
}

const temps: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "manni-cite-check-"));
  temps.push(dir);
  return dir;
}
/** A directory holding one `manni.config.yaml` with the given `cite:` body, and the family key when given. */
function tempConfig(cite: string, key?: string): string {
  const dir = tempDir();
  const path = join(dir, "manni.config.yaml");
  const family = key === undefined ? "" : `encryptionKey: ${key}\n`;
  writeFileSync(path, `${family}cite:\n${cite.replace(/^/gm, "  ")}\n`, "utf8");
  return path;
}
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("fixture pins", () => {
  /** Page, entry, the source it was minted from and the range that still holds there. */
  const holds: { page: string; index: number; file: string; key?: string; at?: [number, number] }[] = [
    { page: "current.md", index: 0, file: "limits.ts", at: [2, 2] },
    { page: "stale-claim.md", index: 0, file: "limits.ts", at: [2, 2] },
    { page: "moved.md", index: 0, file: "moved.ts", at: [4, 4] },
    { page: "moved.md", index: 1, file: "moved.ts", at: [5, 5] },
    { page: "missing.md", index: 0, file: "limits.ts", at: [2, 2] },
    { page: "whole-file.md", index: 0, file: "limits.ts" },
    { page: "encrypted.md", index: 0, file: "limits.ts", at: [2, 2], key: FIXTURE_KEY },
  ];

  it.each(holds)("$page entry $index was minted from $file", ({ page: name, index, file, at, key }) => {
    const citation = readPage(name, page(name)).citations[index]?.citation;
    expect(citation).toBeDefined();
    const range = at ? { start: at[0], end: at[1] } : undefined;
    expect(citation?.integrity).toBe(hashRange(source(file), range, key));
    const parsed = parseSrc(citation?.src ?? "");
    expect(parsed.encrypted).toBe(key !== undefined);
    if (key !== undefined) expect(decryptSourcePath(parsed.path, key)).toBe(`src/${file}`);
  });

  it("stale-claim.md drifted: changed.ts line 2 no longer hashes to the pin", () => {
    expect(hashRange(source("changed.ts"), { start: 2, end: 2 })).not.toBe(PIN_L2);
    expect(hashRange(source("moved.ts"), { start: 2, end: 2 })).not.toBe(PIN_L2);
  });
});

describe("runCheck", () => {
  it("passes a current page and labels it relative to cwd", async () => {
    const run = await check({ inputs: ["pages/current.md"] });
    expect(statuses(run)).toEqual(["current"]);
    expect(rules(run)).toEqual([]);
    expect(run.results.map((r) => [r.file, r.ok])).toEqual([["pages/current.md", true]]);
    expect(run.summary).toEqual({ files: 1, passed: 1, failed: 0, errors: 0 });
    expect(run.warnings).toBe(0);
    expect(run.frame).toEqual({ cwd: ROOT, base: ROOT, runBase: ROOT });
  });

  it("fails a stale claim at the sentence's line", async () => {
    const run = await check({ inputs: ["pages/stale-claim.md"] });
    expect(statuses(run)).toEqual(["changed"]);
    expect(run.results[0]?.ok).toBe(false);
    expect(run.results[0]?.errors).toEqual([
      {
        schema: "manni:cite",
        instancePath: "/citations/0",
        message: "changed",
        keyword: "changed",
        severity: "error",
        subject: "fetch-timeout",
        line: 9,
      },
    ]);
    expect(run.summary).toEqual({ files: 1, passed: 0, failed: 1, errors: 1 });
  });

  it("reports moved entries in both channels as warnings that do not fail the file", async () => {
    const run = await check({ inputs: ["pages/moved.md"] });
    expect(statuses(run)).toEqual(["moved", "moved"]);
    expect(run.pages[0]?.citations.map((c) => c.newSrc)).toEqual(["src/moved.ts:4", "src/moved.ts:5"]);
    expect(run.results[0]?.ok).toBe(true);
    expect(run.warnings).toBe(2);
    expect(run.summary).toEqual({ files: 1, passed: 1, failed: 0, errors: 0, warnings: 2 });
  });

  it("fails a missing source and passes a whole-file pin", async () => {
    const missing = await check({ inputs: ["pages/missing.md"] });
    expect(statuses(missing)).toEqual(["missing"]);
    expect(missing.results[0]?.ok).toBe(false);
    const whole = await check({ inputs: ["pages/whole-file.md"] });
    expect(statuses(whole)).toEqual(["current"]);
    expect(whole.results[0]?.ok).toBe(true);
  });

  it("decrypts an encrypted source with the configured key, or the environment's", async () => {
    const fromConfig = await check({
      inputs: ["pages/encrypted.md"],
      noConfig: false,
      configPath: tempConfig("", FIXTURE_KEY),
    });
    expect(statuses(fromConfig)).toEqual(["current"]);
    expect(fromConfig.results[0]?.ok).toBe(true);
    const fromEnv = await check({ inputs: ["pages/encrypted.md"], env: { MANNI_ENCRYPTION_KEY: FIXTURE_KEY } });
    expect(statuses(fromEnv)).toEqual(["current"]);
  });

  it("with no key, an encrypted citation is missing and an error; --no-sources skips it", async () => {
    const without = await check({ inputs: ["pages/encrypted.md"] });
    expect(statuses(without)).toEqual(["missing"]);
    expect(without.pages[0]?.findings.map((f) => [f.severity, f.message])).toEqual([
      ["error", "missing (no encryption key is available to decrypt it)"],
    ]);
    expect(without.results[0]?.ok).toBe(false);
    expect(without.summary).toEqual({ files: 1, passed: 0, failed: 1, errors: 1 });

    const skipped = await check({ inputs: ["pages/encrypted.md"], sources: false });
    expect(statuses(skipped)).toEqual(["skipped"]);
    expect(skipped.results[0]?.ok).toBe(true);
    expect(skipped.summary).toEqual({ files: 1, passed: 1, failed: 0, errors: 0 });
  });

  it("under another key, an encrypted citation is missing and says so", async () => {
    const run = await check({ inputs: ["pages/encrypted.md"], env: { MANNI_ENCRYPTION_KEY: OTHER } });
    expect(statuses(run)).toEqual(["missing"]);
    expect(run.pages[0]?.findings.map((f) => f.message)).toEqual([
      "missing (does not decrypt under the current key)",
    ]);
  });

  it("sums several pages in sorted order and honours --exclude", async () => {
    const run = await check({
      inputs: ["pages/stale-claim.md", "pages/moved.md", "pages/current.md"],
    });
    expect(run.results.map((r) => r.file)).toEqual([
      "pages/current.md",
      "pages/moved.md",
      "pages/stale-claim.md",
    ]);
    expect(run.summary).toEqual({ files: 3, passed: 2, failed: 1, errors: 1, warnings: 2 });
    const excluded = await check({ inputs: ["pages/*.md"], exclude: ["**/stale-*"] });
    expect(excluded.results.map((r) => r.file)).not.toContain("pages/stale-claim.md");
    expect(excluded.results.map((r) => r.file)).toContain("pages/current.md");
  });

  it("takes the severity table from config: warning keeps the file passing, off drops the finding", async () => {
    const warning = await check({
      inputs: ["pages/stale-claim.md"],
      noConfig: false,
      configPath: tempConfig("severity:\n  changed: warning"),
    });
    expect(warning.results[0]?.ok).toBe(true);
    expect(warning.warnings).toBe(1);
    const off = await check({
      inputs: ["pages/stale-claim.md"],
      noConfig: false,
      configPath: tempConfig("severity:\n  changed: off"),
    });
    expect(statuses(off)).toEqual(["changed"]);
    expect(rules(off)).toEqual([]);
    expect(off.summary).toEqual({ files: 1, passed: 1, failed: 0, errors: 0 });
  });

  it("skips every source under sources: false, from the flag or the config", async () => {
    const flag = await check({ inputs: ["pages/stale-claim.md"], sources: false });
    expect(statuses(flag)).toEqual(["skipped"]);
    expect(flag.results[0]?.ok).toBe(true);
    const configured = await check({
      inputs: ["pages/stale-claim.md"],
      noConfig: false,
      configPath: tempConfig("sources: false"),
    });
    expect(statuses(configured)).toEqual(["skipped"]);
    // The flag is explicit-true only when someone wrote it; absent leaves config in charge.
    const overridden = await check({
      inputs: ["pages/stale-claim.md"],
      sources: true,
      noConfig: false,
      configPath: tempConfig("sources: false"),
    });
    expect(statuses(overridden)).toEqual(["changed"]);
  });

  it("refuses to run with no inputs and no config", async () => {
    expect(await refusal(check({ inputs: [] }))).toBe(
      "No files to check. Pass paths/globs, or declare a collection under `collections:` in manni.config.yaml.",
    );
  });

  it("refuses an unknown --as format, naming the supported extensions", async () => {
    const message = await refusal(check({ inputs: ["pages/current.md"], as: "foo" }));
    expect(message).toMatch(/^Unknown format "foo"\. Supported extensions: \.md, /);
  });

  it("refuses an empty match unless allowEmpty", async () => {
    await expect(check({ inputs: ["pages/*.nope"] })).rejects.toThrow(/No files matched/);
    const run = await check({ inputs: ["pages/*.nope"], allowEmpty: true });
    expect(run.results).toEqual([]);
    expect(run.summary).toEqual({ files: 0, passed: 0, failed: 0, errors: 0 });
  });

  it("reads stdin beside named paths, and requires --as for it", async () => {
    expect(await refusal(check({ inputs: ["-"], stdinContent: page("current.md") }))).toBe(
      "Reading from stdin (`-`) requires --as <format> to choose an extractor.",
    );
    const run = await check({
      inputs: ["-", "pages/current.md"],
      as: "markdown",
      stdinContent: page("stale-claim.md"),
    });
    expect(run.results.map((r) => [r.file, r.ok])).toEqual([
      ["<stdin>", false],
      ["pages/current.md", true],
    ]);
    expect(run.pages.map((p) => p.file)).toEqual(["<stdin>", "pages/current.md"]);
  });

  it("forces the format for every input with --as", async () => {
    const dir = tempDir();
    mkdirSync(join(dir, "src"));
    copyFileSync(join(SRC, "limits.ts"), join(dir, "src", "limits.ts"));
    writeFileSync(join(dir, "page.txt"), page("current.md"), "utf8");
    const run = await check({ cwd: dir, root: dir, inputs: ["page.txt"], as: "markdown" });
    expect(run.pages[0]?.format).toBe("markdown");
    expect(statuses(run)).toEqual(["current"]);
  });

  describe("baseline", () => {
    /** A cwd of its own, so the baseline file lands somewhere disposable. */
    function project(): string {
      const dir = tempDir();
      mkdirSync(join(dir, "src"));
      mkdirSync(join(dir, "pages"));
      copyFileSync(join(SRC, "changed.ts"), join(dir, "src", "changed.ts"));
      copyFileSync(join(PAGES, "stale-claim.md"), join(dir, "pages", "stale-claim.md"));
      return dir;
    }

    it("records the findings under the cite default path, then suppresses them", async () => {
      const dir = project();
      const written = await check({ cwd: dir, root: dir, inputs: ["pages/stale-claim.md"], writeBaseline: true });
      const file = join(dir, DEFAULT_CITE_BASELINE_PATH);
      expect(existsSync(file)).toBe(true);
      expect(written.results[0]?.ok).toBe(true);
      expect(written.summary.baseline).toEqual({
        path: DEFAULT_CITE_BASELINE_PATH,
        written: true,
        recorded: 1,
        suppressed: 1,
        stale: 0,
        added: 1,
        removed: 0,
      });
      const baseline = JSON.parse(readFileSync(file, "utf8")) as { entries: Record<string, string[]> };
      expect(Object.keys(baseline.entries)).toEqual(["pages/stale-claim.md"]);

      const read = await check({ cwd: dir, root: dir, inputs: ["pages/stale-claim.md"], baseline: true });
      expect(read.results[0]?.ok).toBe(true);
      expect(read.summary).toEqual({
        files: 1,
        passed: 1,
        failed: 0,
        errors: 0,
        baseline: { path: DEFAULT_CITE_BASELINE_PATH, written: false, recorded: 1, suppressed: 1, stale: 0 },
      });
      // The page reports still carry the finding: the baseline is a ratchet, not a reclassification.
      expect(rules(read)).toEqual(["changed"]);
    });

    it("names the cite command when the baseline is missing", async () => {
      const dir = project();
      expect(await refusal(check({ cwd: dir, root: dir, inputs: ["pages/stale-claim.md"], baseline: true }))).toBe(
        `Baseline "${DEFAULT_CITE_BASELINE_PATH}" not found. Record one with \`manni cite check --write-baseline\`, or drop --baseline.`,
      );
    });

    it("never records stdin", async () => {
      const dir = project();
      const run = await check({
        cwd: dir,
        root: dir,
        inputs: ["-"],
        as: "markdown",
        stdinContent: page("stale-claim.md"),
        writeBaseline: true,
      });
      expect(run.summary.baseline?.recorded).toBe(0);
      expect(run.results[0]?.ok).toBe(false);
      const baseline = JSON.parse(readFileSync(join(dir, DEFAULT_CITE_BASELINE_PATH), "utf8")) as {
        entries: Record<string, string[]>;
      };
      expect(baseline.entries).toEqual({});
    });

    it("resolves a configured baseline against the config directory", async () => {
      const dir = project();
      mkdirSync(join(dir, "ci"));
      writeFileSync(
        join(dir, "manni.config.yaml"),
        "collections:\n  - name: pages\n    paths: ['pages/*.md']\ncite:\n  git: false\n  baseline: ci/cite.json\n",
        "utf8",
      );
      const written = await check({ cwd: dir, inputs: [], noConfig: false, writeBaseline: true });
      expect(written.summary.baseline?.path).toBe("ci/cite.json");
      expect(existsSync(join(dir, "ci", "cite.json"))).toBe(true);
      const read = await check({ cwd: dir, inputs: [], noConfig: false });
      expect(read.results[0]?.ok).toBe(true);
      expect(read.summary.baseline?.suppressed).toBe(1);
      const off = await check({ cwd: dir, inputs: [], noConfig: false, baseline: false });
      expect(off.results[0]?.ok).toBe(false);
      expect(off.summary.baseline).toBeUndefined();
    });
  });

  describe("config", () => {
    /**
     * A project whose `pages` collection lists `docs/*.md` and whose config
     * resolves sources from its own directory. A second collection, `notes`,
     * covers `notes/*.md`; the `--collection` cases pick between them.
     */
    function configured(init: boolean, collections?: string): string {
      const dir = makeTempRepo({
        files: {
          "src/changed.ts": source("changed.ts"),
          "src/limits.ts": source("limits.ts"),
          "docs/stale.md": page("stale-claim.md"),
          "docs/ok.md": page("current.md"),
          "notes/ok.md": page("current.md"),
          "manni.config.yaml":
            (collections ??
              "collections:\n  - name: pages\n    paths: ['docs/*.md']\n  - name: notes\n    paths: ['notes/*.md']\n") +
            "cite:\n  root: .\n  git: false\n",
        },
        init,
      });
      temps.push(dir);
      return dir;
    }
    const files = (run: CheckRun): [string, boolean][] => run.results.map((r) => [r.file, r.ok]);

    it("falls back to every collection's paths: from the config", async () => {
      const dir = configured(false);
      const loaded: { path: string; dir: string }[] = [];
      const run = await runCheck({ cwd: dir, inputs: [], onConfigLoaded: (info) => loaded.push(info) });
      expect(loaded).toEqual([{ path: join(dir, "manni.config.yaml"), dir }]);
      expect(files(run)).toEqual([
        ["docs/ok.md", true],
        ["docs/stale.md", false],
        ["notes/ok.md", true],
      ]);
      expect(run.frame).toEqual({ cwd: dir, base: dir, runBase: dir });
    });

    it("--collection narrows the run to the named collection", async () => {
      const dir = configured(false);
      const run = await runCheck({ cwd: dir, inputs: [], collection: ["notes"] });
      expect(files(run)).toEqual([["notes/ok.md", true]]);
    });

    it("an unknown --collection is refused with the configured names", async () => {
      const dir = configured(false);
      expect(await refusal(runCheck({ cwd: dir, inputs: [], collection: ["gides"] }))).toBe(
        'no collection named "gides" in manni.config.yaml. Configured: pages, notes.',
      );
    });

    it("a collection's exclude: shapes the collection, never a typed path", async () => {
      const dir = configured(
        false,
        "collections:\n  - name: pages\n    paths: ['docs/*.md']\n    exclude: ['docs/stale*']\n",
      );
      // From the collection: the excluded page is not visited...
      const run = await runCheck({ cwd: dir, inputs: [] });
      expect(files(run)).toEqual([["docs/ok.md", true]]);
      // ...and --exclude adds to the list rather than replacing it.
      const more = await runCheck({ cwd: dir, inputs: [], exclude: ["docs/ok*"], allowEmpty: true });
      expect(files(more)).toEqual([]);
      // A typed path is what the operator asked for, whatever a collection excludes.
      const typed = await runCheck({ cwd: dir, inputs: ["docs/stale.md"] });
      expect(files(typed)).toEqual([["docs/stale.md", false]]);
    });

    it.skipIf(!gitAvailable())("resolves paths: from the config's directory when run from below it", async () => {
      const dir = configured(true);
      const cwd = join(dir, "docs");
      const run = await runCheck({ cwd, inputs: [], collection: ["pages"] });
      expect(files(run)).toEqual([
        ["docs/ok.md", true],
        ["docs/stale.md", false],
      ]);
      expect(run.frame).toEqual({ cwd, base: dir, runBase: dir });
      // Positional paths stay cwd-relative, and the label follows.
      const named = await runCheck({ cwd, inputs: ["stale.md"] });
      expect(named.results.map((r) => r.file)).toEqual(["stale.md"]);
      expect(named.frame).toEqual({ cwd, base: dir, runBase: cwd });
    });

    it("reads the fixture config: every knob lands, and allowEmpty admits a no-match", async () => {
      const cwd = join(ROOT, "config");
      const loaded: string[] = [];
      // The fixture names a baseline nobody recorded; `--no-baseline` steps past it.
      const run = await runCheck({ cwd, inputs: [], baseline: false, onConfigLoaded: (info) => loaded.push(info.path) });
      expect(loaded).toEqual([join(cwd, "manni.config.yaml")]);
      expect(run.results).toEqual([]);
      expect(run.summary.files).toBe(0);
      expect(await refusal(runCheck({ cwd, inputs: [] }))).toBe(
        'Baseline ".cite-baseline.json" not found. Record one with `manni cite check --write-baseline`, or drop --baseline.',
      );
    });

    it("notices once when no git root exists and the root falls back to cwd", async () => {
      const dir = tempDir();
      mkdirSync(join(dir, "src"));
      copyFileSync(join(SRC, "limits.ts"), join(dir, "src", "limits.ts"));
      writeFileSync(join(dir, "page.md"), page("current.md"), "utf8");
      const notices: string[] = [];
      const run = await runCheck({
        cwd: dir,
        inputs: ["page.md"],
        noConfig: true,
        git: false,
        onNotice: (m) => notices.push(m),
      });
      expect(notices).toEqual([`No git root found; resolving src: paths from ${dir}`]);
      expect(statuses(run)).toEqual(["current"]);
    });
  });

  describe("output never says more than the page did", () => {
    it("spells a token page's findings with the token, never the resolved path", async () => {
      const token = encryptSourcePath("src/moved.ts", SENTINEL);
      const keyed = hashRange(source("limits.ts"), { start: 2, end: 2 }, SENTINEL);
      const content = [
        "---",
        "citations:",
        `  - src: ${token}:2`,
        `    integrity: ${keyed}`,
        `  - src: ${encryptSourcePath("src/limits.ts", SENTINEL)}:2`,
        `    integrity: ${PIN_L2}`,
        "---",
        "Body.",
        "",
      ].join("\n");
      const run = await check({
        inputs: ["-"],
        as: "markdown",
        stdinContent: content,
        noConfig: false,
        configPath: tempConfig("", SENTINEL),
      });
      expect(statuses(run)).toEqual(["moved", "changed"]);
      expect(run.pages[0]?.citations[0]?.newSrc).toBe(`${token}:4`);
      expect(run.pages[0]?.findings.map((f) => f.message)).toEqual([`moved -> ${token}:4`, "changed"]);
      // The resolved path is carried for `--reveal` and nowhere else.
      expect(run.pages[0]?.citations.map((c) => c.resolvedPath)).toEqual(["src/moved.ts", "src/limits.ts"]);
      for (const finding of run.pages[0]?.findings ?? []) {
        expect(JSON.stringify(finding)).not.toContain(".ts");
      }
      expect(JSON.stringify(run.results)).not.toContain(".ts");
      expect(JSON.stringify(run.summary)).not.toContain(".ts");
    });
  });

  describe.skipIf(!gitAvailable())("with git", () => {
    let repo: string | undefined;
    afterEach(() => {
      removeTempRepo(repo);
      repo = undefined;
    });

    const entry = (commit: string, pin = PIN_L2): string =>
      [
        "---",
        "citations:",
        "  - id: fetch-timeout",
        "    src: src/limits.ts:2",
        `    integrity: ${pin}`,
        `    commit: ${commit}`,
        "    claim: The fetch timeout is 10 seconds.",
        "---",
        "The fetch timeout is 10 seconds.",
        "",
      ].join("\n");

    it("says a commit history cannot show once per run, however many pages hit it", async () => {
      repo = makeTempRepo({
        files: {
          "src/limits.ts": source("changed.ts"),
          "docs/a.md": entry(UNKNOWN),
          "docs/b.md": entry(UNKNOWN),
        },
      });
      commitAll(repo, "init");
      const notices: string[] = [];
      const run = await runCheck({ cwd: repo, inputs: ["docs"], noConfig: true, onNotice: (m) => notices.push(m) });
      expect(run.results.map((r) => r.file)).toEqual(["docs/a.md", "docs/b.md"]);
      expect(run.pages.map((p) => p.notices.length)).toEqual([1, 1]);
      expect(notices).toEqual([
        "commit 0123456 not found in history; use fetch-depth: 0 to enable never-true and diffs",
      ]);
      expect(run.pages[0]?.citations[0]?.historyAvailable).toBe(false);
    });

    it("classifies never-true and changed-with-history from the repository", async () => {
      repo = makeTempRepo({ files: { "src/limits.ts": source("limits.ts") } });
      const first = commitAll(repo, "add limits");
      writeFileSync(join(repo, "src", "limits.ts"), source("changed.ts"), "utf8");
      const second = commitAll(repo, "raise fetch timeout to 30s");
      const neverPin = hashRange("export const FETCH_TIMEOUT_MS = 20_000;");
      mkdirSync(join(repo, "docs"));
      writeFileSync(join(repo, "docs", "changed.md"), entry(first), "utf8");
      writeFileSync(join(repo, "docs", "never.md"), entry(second, neverPin), "utf8");
      const run = await runCheck({ cwd: repo, inputs: ["docs/changed.md", "docs/never.md"], noConfig: true });
      expect(run.pages.map(statusesOf)).toEqual([["changed"], ["never-true"]]);
      const changed = run.pages[0]?.citations[0];
      expect(changed?.historyAvailable).toBe(true);
      expect(changed?.commitsSince).toEqual(["raise fetch timeout to 30s"]);
      expect(run.pages[0]?.findings[0]?.message).toBe(`changed since ${first.slice(0, 7)}, 1 commit`);
      expect(run.pages[1]?.findings[0]?.message).toBe(
        `never true: the pin does not match at ${second.slice(0, 7)}`,
      );
      // `--no-git` turns both into a plain `changed`.
      const noGit = await runCheck({ cwd: repo, inputs: ["docs"], noConfig: true, git: false });
      expect(noGit.pages.map(statusesOf)).toEqual([["changed"], ["changed"]]);
      expect(noGit.pages[0]?.citations[0]?.historyAvailable).toBeUndefined();
    });
  });
});

const statusesOf = (report: CheckRun["pages"][number]): string[] => report.citations.map((c) => c.status);
