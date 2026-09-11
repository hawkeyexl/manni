/**
 * `runCheck` over the fixture pages with `test/fixtures/cite` as both cwd and
 * root, the way `manni cite check --root test/fixtures/cite pages/x.md` runs
 * from that directory. The fixture cases inject a git that is not there
 * (`noGit()`), so the source index walks the directory (a fixture added on a
 * branch is not yet tracked, and a `git ls-files` index would call it
 * missing); the git-dependent cases build a throwaway repository.
 *
 * An entry has two ends, so a page's verdict is read as a pair: the claim's
 * status (or `null` for a bare pin) and the source's. The first block
 * recomputes every fixture pin at both ends, so a hand-typed hash cannot rot
 * without a test saying so.
 */
import { afterEach, describe, expect, it } from "vitest";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCheck } from "../../src/cite/commands/check.js";
import { DEFAULT_CITE_BASELINE_PATH } from "../../src/cite/core/config.js";
import { noGit } from "../../src/cite/core/git.js";
import { hashLines, hashRange, splitLines } from "../../src/cite/core/hash.js";
import { readPage } from "../../src/cite/core/page.js";
import { parseSrc } from "../../src/cite/core/range.js";
import { decryptSourcePath, encryptSourcePath } from "../../src/cite/core/sources.js";
import { CiteError } from "../../src/cite/errors.js";
import type { CheckOptions, CheckRun, GitClient } from "../../src/cite/types.js";
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
const NO_HISTORY =
  "git is not available here, so citations are checked without history: no never-true, no diffs, no commit subjects.";

const source = (name: string): string => readFileSync(join(SRC, name), "utf8");
const page = (name: string): string => readFileSync(join(PAGES, name), "utf8");

/** Both ends of every citation: `[claim status | null, source status]`. */
const ends = (run: CheckRun, i = 0): (string | null)[][] =>
  (run.pages[i]?.citations ?? []).map((c) => [c.claim?.status ?? null, c.source.status]);
const rules = (run: CheckRun, i = 0): string[] => (run.pages[i]?.findings ?? []).map((f) => f.rule);
const messages = (run: CheckRun, i = 0): string[] =>
  (run.pages[i]?.findings ?? []).map((f) => f.message);

/** `runCheck` from the fixture directory, without git, no config unless a case says so. */
function check(over: Partial<CheckOptions> & { inputs: string[] }): Promise<CheckRun> {
  return runCheck({ cwd: ROOT, root: ROOT, noConfig: true, gitClient: noGit(), env: {}, ...over });
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
  const sources: { page: string; index: number; file: string; key?: string; at?: [number, number] }[] = [
    { page: "current.md", index: 0, file: "limits.ts", at: [2, 2] },
    { page: "claim-changed.md", index: 0, file: "limits.ts", at: [2, 2] },
    { page: "source-changed.md", index: 0, file: "limits.ts", at: [2, 2] },
    { page: "marker.md", index: 0, file: "limits.ts", at: [3, 3] },
    { page: "moved.md", index: 0, file: "moved.ts", at: [4, 4] },
    { page: "missing.md", index: 0, file: "limits.ts", at: [2, 2] },
    { page: "quote.md", index: 0, file: "limits.ts", at: [1, 3] },
    { page: "whole-file.md", index: 0, file: "limits.ts" },
    { page: "encrypted.md", index: 0, file: "limits.ts", at: [2, 2], key: FIXTURE_KEY },
  ];

  it.each(sources)("$page entry $index was minted from $file", ({ page: name, index, file, at, key }) => {
    const citation = readPage(name, page(name)).citations[index]?.citation;
    expect(citation).toBeDefined();
    const range = at ? { start: at[0], end: at[1] } : undefined;
    expect(citation?.source.integrity).toBe(hashRange(source(file), range, key));
    const parsed = parseSrc(citation?.source.file ?? "");
    expect(parsed.encrypted).toBe(key !== undefined);
    if (key !== undefined) expect(decryptSourcePath(parsed.path, key)).toBe(`src/${file}`);
  });

  /** Page, entry, and the file lines its claim pin was taken over. */
  const claims: { page: string; index: number; at: [number, number] }[] = [
    { page: "current.md", index: 0, at: [15, 15] },
    { page: "claim-range.md", index: 0, at: [15, 16] },
    { page: "claim-moved.md", index: 0, at: [17, 17] },
    { page: "marker.md", index: 0, at: [19, 19] },
    { page: "quote.md", index: 0, at: [16, 20] },
  ];

  it.each(claims)("$page entry $index pins page lines $at", ({ page: name, index, at }) => {
    const lines = splitLines(page(name));
    const claim = readPage(name, page(name)).citations[index]?.citation.claim;
    expect(claim?.integrity).toBe(hashLines(lines.slice(at[0] - 1, at[1]).join("\n")));
  });

  it("the drifted sources no longer hash to the pin they carry", () => {
    expect(hashRange(source("changed.ts"), { start: 2, end: 2 })).not.toBe(PIN_L2);
    expect(hashRange(source("moved.ts"), { start: 2, end: 2 })).not.toBe(PIN_L2);
  });
});

describe("runCheck: a page that is current", () => {
  it("passes a current page and labels it relative to cwd", async () => {
    const run = await check({ inputs: ["pages/current.md"] });
    expect(ends(run)).toEqual([["current", "current"]]);
    expect(rules(run)).toEqual([]);
    expect(run.results.map((r) => [r.file, r.ok])).toEqual([["pages/current.md", true]]);
    expect(run.summary).toEqual({ files: 1, passed: 1, failed: 0, errors: 0 });
    expect(run.warnings).toBe(0);
    expect(run.frame).toEqual({ cwd: ROOT, base: ROOT, runBase: ROOT });
  });

  it("passes a claim range, a frontmatter with other keys, CRLF, and a page with no citations", async () => {
    const run = await check({
      inputs: ["pages/claim-range.md", "pages/frontmatter-tag.md", "pages/crlf.md", "pages/no-citations.md"],
    });
    expect(run.results.every((r) => r.ok)).toBe(true);
    expect(run.pages.map((p) => p.findings.length)).toEqual([0, 0, 0, 0]);
    // A claim's lines are body lines, so the extra `tags:` key does not move it.
    const tagged = run.pages.find((p) => p.file === "pages/frontmatter-tag.md");
    expect(tagged?.citations[0]?.claim).toMatchObject({ lines: "3", fileLines: "16", status: "current" });
  });

  it("passes a whole-file pin and a bare pin, both with no claim end at all", async () => {
    const run = await check({ inputs: ["pages/whole-file.md", "pages/frontmatter-only.md"] });
    expect(run.pages.map((p) => p.file)).toEqual(["pages/frontmatter-only.md", "pages/whole-file.md"]);
    // frontmatter-only.md holds a claim-anchored entry and a bare whole-file pin.
    expect(ends(run, 0)).toEqual([
      ["current", "current"],
      [null, "current"],
    ]);
    expect(ends(run, 1)).toEqual([[null, "current"]]);
    expect(run.results.every((r) => r.ok)).toBe(true);
  });
});

describe("runCheck: the claim end", () => {
  it("reports a claim that moved as a notice that does not fail the file", async () => {
    const run = await check({ inputs: ["pages/claim-moved.md"] });
    expect(ends(run)).toEqual([["moved", "current"]]);
    expect(run.pages[0]?.citations[0]?.claim).toMatchObject({
      lines: "3",
      fileLines: "15",
      newLines: "5",
      newFileLines: "17",
    });
    expect(run.pages[0]?.findings.map((f) => [f.rule, f.severity, f.line, f.message])).toEqual([
      ["claim-moved", "notice", 15, "fetch-timeout: the claim moved from line 15 to line 17."],
    ]);
    expect(run.results[0]?.ok).toBe(true);
    expect(run.summary).toEqual({ files: 1, passed: 1, failed: 0, errors: 0, notices: 1 });
  });

  it("reports a claim found in two places as a warning, naming both", async () => {
    const run = await check({ inputs: ["pages/claim-moved-ambiguous.md"] });
    expect(ends(run)).toEqual([["moved-ambiguous", "current"]]);
    expect(run.pages[0]?.citations[0]?.claim).toMatchObject({
      candidates: ["5", "9"],
      candidateFileLines: ["17", "21"],
    });
    expect(run.pages[0]?.findings.map((f) => [f.rule, f.severity, f.message])).toEqual([
      ["claim-moved-ambiguous", "warning", "retries: the claim at line 15 now appears at lines 17 and 21."],
    ]);
    expect(run.results[0]?.ok).toBe(true);
  });

  it("reports an edited claim as a warning at its line, carrying the lines it reads now", async () => {
    const run = await check({ inputs: ["pages/claim-changed.md"] });
    expect(ends(run)).toEqual([["changed", "current"]]);
    // `text` is the page as it stands, for `--show-diff`; nothing else prints it.
    expect(run.pages[0]?.citations[0]?.claim?.text).toEqual(["The fetch timeout is 30 seconds."]);
    expect(run.pages[0]?.findings.map((f) => [f.rule, f.severity, f.line, f.message])).toEqual([
      ["claim-changed", "warning", 15, "fetch-timeout: the claim at line 15 has changed since it was pinned."],
    ]);
    expect(run.summary).toEqual({ files: 1, passed: 1, failed: 0, errors: 0, warnings: 1 });
  });

  it("judges a marker-anchored claim against what the marker anchors", async () => {
    const run = await check({ inputs: ["pages/marker.md", "pages/marker-changed.md"] });
    expect(run.pages.map((p) => p.file)).toEqual(["pages/marker-changed.md", "pages/marker.md"]);
    expect(ends(run, 1)).toEqual([["current", "current"]]);
    expect(run.pages[1]?.citations[0]).toMatchObject({ anchor: "marker", markerLine: 18, anchorLine: 19 });
    // The marker travels with its text, so a marker-anchored claim never moves:
    // it is current, or it is changed.
    expect(ends(run, 0)).toEqual([["changed", "current"]]);
    expect(run.pages[0]?.findings.map((f) => [f.rule, f.line])).toEqual([["claim-changed", 15]]);
  });

  it("finds a marker in every format's comment syntax", async () => {
    const run = await check({ inputs: ["pages/marker.mdx", "pages/marker.adoc", "pages/marker.rst"] });
    expect(run.pages.map((p) => [p.file, p.citations[0]?.markerLine, p.citations[0]?.claim?.status])).toEqual([
      ["pages/marker.adoc", 14, "current"],
      ["pages/marker.mdx", 14, "current"],
      ["pages/marker.rst", 15, "current"],
    ]);
    expect(run.results.every((r) => r.ok)).toBe(true);
  });
});

describe("runCheck: markers and anchors", () => {
  it("fails a marker that names no entry, in markdown and in html", async () => {
    const run = await check({ inputs: ["pages/marker-orphan.md", "pages/marker.html"] });
    expect(run.pages[0]?.findings.map((f) => [f.rule, f.severity, f.id, f.line, f.message])).toEqual([
      ["marker-orphan", "error", "nope", 12, 'no entry has id "nope"'],
    ]);
    expect(run.pages[1]?.findings.map((f) => [f.rule, f.id, f.line])).toEqual([
      ["marker-orphan", "fetch-timeout", 5],
    ]);
    expect(run.results.every((r) => r.ok)).toBe(false);
  });

  it("fails a marker that carries JSON rather than an id, and names no entry for it", async () => {
    const run = await check({ inputs: ["pages/marker-json.md"] });
    const [finding] = run.pages[0]?.findings ?? [];
    expect(finding).toEqual({
      rule: "marker-invalid",
      ruleId: "manni:cite/marker-invalid",
      severity: "error",
      message: "A marker names an entry by id. Write the entry in frontmatter or the sidecar.",
      line: 12,
    });
    // The entry itself is fine; only the marker is not.
    expect(ends(run)).toEqual([[null, "current"]]);
  });

  it("warns when two markers name one entry, and says which one anchors it", async () => {
    const run = await check({ inputs: ["pages/marker-repeated.md"] });
    expect(ends(run)).toEqual([["current", "current"]]);
    expect(run.pages[0]?.findings.map((f) => [f.rule, f.severity, f.line, f.message])).toEqual([
      ["marker-repeated", "warning", 19, "retries is named by markers at lines 14 and 19; the first anchors it."],
    ]);
    expect(run.results[0]?.ok).toBe(true);
  });

  it("fails an entry anchored both ways, and judges neither anchor", async () => {
    const run = await check({ inputs: ["pages/anchor-both.md"] });
    expect(ends(run)).toEqual([["skipped", "current"]]);
    expect(run.pages[0]?.citations[0]?.anchor).toBeNull();
    expect(run.pages[0]?.findings.map((f) => [f.rule, f.severity, f.line, f.message])).toEqual([
      ["anchor-invalid", "error", 15, "fetch-timeout has claim lines and a marker. Keep one."],
    ]);
  });

  it("fails a quote with no anchor, and a quote whose claim lines stopped being a block", async () => {
    const run = await check({ inputs: ["pages/anchor-quote.md", "pages/anchor-unfenced.md"] });
    expect(run.pages[0]?.findings.map((f) => [f.rule, f.line, f.message])).toEqual([
      ["anchor-invalid", 4, "header: quote needs a claim or a marker."],
    ]);
    expect(run.pages[1]?.findings.map((f) => [f.rule, f.line, f.message])).toEqual([
      ["anchor-invalid", 16, "header: the quote's claim lines 16-18 are no longer a fenced block."],
    ]);
    expect(run.results.map((r) => r.ok)).toEqual([false, false]);
  });

  it("passes a faithful quote, anchored by lines or by a marker", async () => {
    const run = await check({ inputs: ["pages/quote.md", "pages/quote-marker.md"] });
    expect(ends(run, 0)).toEqual([["current", "current"]]);
    expect(ends(run, 1)).toEqual([["current", "current"]]);
    expect(run.pages.flatMap((p) => p.findings)).toEqual([]);
  });

  it("reports quote-drift when the fenced block stops reproducing the cited lines", async () => {
    const run = await check({
      inputs: ["-"],
      as: "markdown",
      stdinContent: [
        "---",
        "citations:",
        "  - id: timeout",
        "    claim:",
        "      lines: 1-3",
        `      integrity: ${hashLines("```ts\nexport const FETCH_TIMEOUT_MS = 99_000;\n```")}`,
        "    source:",
        "      file: src/limits.ts",
        "      lines: 2",
        `      integrity: ${PIN_L2}`,
        "    quote: true",
        "---",
        "```ts",
        "export const FETCH_TIMEOUT_MS = 99_000;",
        "```",
        "",
      ].join("\n"),
    });
    expect(run.pages[0]?.findings.map((f) => [f.rule, f.severity, f.message])).toEqual([
      ["quote-drift", "error", "quote: true, but the fenced block does not reproduce the cited lines"],
    ]);
  });
});

describe("runCheck: the source end", () => {
  it("reports a moved source as a warning that does not fail the file", async () => {
    const run = await check({ inputs: ["pages/moved.md"] });
    expect(ends(run)).toEqual([["current", "moved"]]);
    expect(run.pages[0]?.citations[0]?.source).toMatchObject({
      newSrc: "src/moved.ts:4",
      newLines: "4",
    });
    expect(run.pages[0]?.findings.map((f) => [f.rule, f.severity, f.message])).toEqual([
      ["source-moved", "warning", "moved -> src/moved.ts:4"],
    ]);
    expect(run.results[0]?.ok).toBe(true);
    expect(run.summary).toEqual({ files: 1, passed: 1, failed: 0, errors: 0, warnings: 1 });
  });

  it("fails a changed source at the line the citation anchors to", async () => {
    const run = await check({ inputs: ["pages/source-changed.md"] });
    expect(ends(run)).toEqual([["current", "changed"]]);
    expect(run.results[0]?.ok).toBe(false);
    expect(run.results[0]?.errors).toEqual([
      {
        schema: "manni:cite",
        instancePath: "/citations/0",
        message: "changed",
        keyword: "source-changed",
        severity: "error",
        subject: "fetch-timeout",
        line: 15,
      },
    ]);
    expect(run.summary).toEqual({ files: 1, passed: 0, failed: 1, errors: 1 });
  });

  it("fails a source no tracked file matches", async () => {
    const run = await check({ inputs: ["pages/missing.md"] });
    expect(ends(run)).toEqual([["current", "missing"]]);
    expect(run.pages[0]?.citations[0]?.source.missingReason).toBe("untracked");
    expect(messages(run)).toEqual(["missing"]);
    expect(run.results[0]?.ok).toBe(false);
  });

  it("decrypts an encrypted source with the configured key, or the environment's", async () => {
    const fromConfig = await check({
      inputs: ["pages/encrypted.md"],
      noConfig: false,
      configPath: tempConfig("", FIXTURE_KEY),
    });
    expect(ends(fromConfig)).toEqual([["current", "current"]]);
    expect(fromConfig.results[0]?.ok).toBe(true);
    const fromEnv = await check({ inputs: ["pages/encrypted.md"], env: { MANNI_ENCRYPTION_KEY: FIXTURE_KEY } });
    expect(ends(fromEnv)).toEqual([["current", "current"]]);
  });

  it("with no key, an encrypted citation is missing and an error; --no-check-sources skips it", async () => {
    const without = await check({ inputs: ["pages/encrypted.md"] });
    expect(ends(without)).toEqual([["current", "missing"]]);
    expect(without.pages[0]?.findings.map((f) => [f.rule, f.severity, f.message])).toEqual([
      ["source-missing", "error", "missing (no encryption key is available to decrypt it)"],
    ]);
    expect(without.results[0]?.ok).toBe(false);
    expect(without.summary).toEqual({ files: 1, passed: 0, failed: 1, errors: 1 });

    const skipped = await check({ inputs: ["pages/encrypted.md"], checkSources: false });
    expect(ends(skipped)).toEqual([["current", "skipped"]]);
    expect(skipped.results[0]?.ok).toBe(true);
    expect(skipped.summary).toEqual({ files: 1, passed: 1, failed: 0, errors: 0 });
  });

  it("under another key, an encrypted citation is missing and says so", async () => {
    const run = await check({ inputs: ["pages/encrypted.md"], env: { MANNI_ENCRYPTION_KEY: OTHER } });
    expect(ends(run)).toEqual([["current", "missing"]]);
    expect(messages(run)).toEqual(["missing (does not decrypt under the current key)"]);
  });

  it("refuses an encrypted source pinned plain, before it is ever classified", async () => {
    const run = await check({ inputs: ["pages/hmac-mismatch.md"], env: { MANNI_ENCRYPTION_KEY: FIXTURE_KEY } });
    expect(run.pages[0]?.citations).toEqual([]);
    expect(run.pages[0]?.findings.map((f) => [f.rule, f.severity, f.line, f.message])).toEqual([
      ["entry-invalid", "error", 4, "fetch-timeout: an encrypted source is pinned with hmac-sha256-, not sha256-."],
    ]);
  });

  it("fails an entry the schema rejects and a duplicate id, and checks the rest", async () => {
    const run = await check({ inputs: ["pages/entry-invalid.md"] });
    expect(run.pages[0]?.findings.map((f) => [f.rule, f.line, f.index, f.message])).toEqual([
      ["entry-invalid", 4, 0, "/source must have required property 'integrity'"],
      ["entry-invalid", 13, 2, 'duplicate id "fetch-timeout"'],
    ]);
    // The entry with no `integrity` is never classified; the two valid ones are.
    expect(ends(run)).toEqual([
      [null, "current"],
      [null, "current"],
    ]);
  });
});

describe("runCheck: the run", () => {
  it("sums several pages in sorted order and honours --exclude", async () => {
    const run = await check({
      inputs: ["pages/source-changed.md", "pages/moved.md", "pages/current.md"],
    });
    expect(run.results.map((r) => r.file)).toEqual([
      "pages/current.md",
      "pages/moved.md",
      "pages/source-changed.md",
    ]);
    expect(run.summary).toEqual({ files: 3, passed: 2, failed: 1, errors: 1, warnings: 1 });
    const excluded = await check({ inputs: ["pages/*.md"], exclude: ["**/source-*"] });
    expect(excluded.results.map((r) => r.file)).not.toContain("pages/source-changed.md");
    expect(excluded.results.map((r) => r.file)).toContain("pages/current.md");
  });

  it("takes the severity table from config: warning keeps the file passing, off drops the finding", async () => {
    const warning = await check({
      inputs: ["pages/source-changed.md"],
      noConfig: false,
      configPath: tempConfig("severity:\n  source-changed: warning"),
    });
    expect(warning.results[0]?.ok).toBe(true);
    expect(warning.warnings).toBe(1);
    const off = await check({
      inputs: ["pages/source-changed.md"],
      noConfig: false,
      configPath: tempConfig("severity:\n  source-changed: off"),
    });
    expect(ends(off)).toEqual([["current", "changed"]]);
    expect(rules(off)).toEqual([]);
    expect(off.summary).toEqual({ files: 1, passed: 1, failed: 0, errors: 0 });
  });

  it("raises a claim rule to error when the table says so", async () => {
    const run = await check({
      inputs: ["pages/claim-changed.md"],
      noConfig: false,
      configPath: tempConfig("severity:\n  claim-changed: error"),
    });
    expect(run.results[0]?.ok).toBe(false);
    expect(run.summary).toEqual({ files: 1, passed: 0, failed: 1, errors: 1 });
  });

  it("reports a notice without failing the file or the run, and counts it apart", async () => {
    const run = await check({
      inputs: ["pages/source-changed.md"],
      noConfig: false,
      configPath: tempConfig("severity:\n  source-changed: notice"),
    });
    expect(run.pages[0]?.findings.map((f) => [f.rule, f.severity])).toEqual([["source-changed", "notice"]]);
    expect(run.results[0]?.ok).toBe(true);
    expect(run.results[0]?.errors.map((e) => e.severity)).toEqual(["notice"]);
    expect(run.summary).toEqual({ files: 1, passed: 1, failed: 0, errors: 0, notices: 1 });
    expect(run.warnings).toBe(0);
    expect(run.notices).toBe(1);
  });

  it("skips every source under checkSources: false, and still judges the claim", async () => {
    const flag = await check({ inputs: ["pages/source-changed.md"], checkSources: false });
    expect(ends(flag)).toEqual([["current", "skipped"]]);
    expect(flag.results[0]?.ok).toBe(true);
    // The claim end is page-side, so a public checkout still catches drift there.
    const claim = await check({ inputs: ["pages/claim-changed.md"], checkSources: false });
    expect(ends(claim)).toEqual([["changed", "skipped"]]);
    expect(rules(claim)).toEqual(["claim-changed"]);
    const configured = await check({
      inputs: ["pages/source-changed.md"],
      noConfig: false,
      configPath: tempConfig("checkSources: false"),
    });
    expect(ends(configured)).toEqual([["current", "skipped"]]);
    // The flag is explicit-true only when someone wrote it; absent leaves config in charge.
    const overridden = await check({
      inputs: ["pages/source-changed.md"],
      checkSources: true,
      noConfig: false,
      configPath: tempConfig("checkSources: false"),
    });
    expect(ends(overridden)).toEqual([["current", "changed"]]);
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
      stdinContent: page("source-changed.md"),
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
    expect(ends(run)).toEqual([["current", "current"]]);
  });
});

describe("baseline", () => {
  /** A cwd of its own, so the baseline file lands somewhere disposable. */
  function project(): string {
    const dir = tempDir();
    mkdirSync(join(dir, "src"));
    mkdirSync(join(dir, "pages"));
    copyFileSync(join(SRC, "changed.ts"), join(dir, "src", "changed.ts"));
    copyFileSync(join(SRC, "limits.ts"), join(dir, "src", "limits.ts"));
    copyFileSync(join(PAGES, "source-changed.md"), join(dir, "pages", "source-changed.md"));
    return dir;
  }

  it("records the findings under the cite default path, then suppresses them", async () => {
    const dir = project();
    const written = await check({ cwd: dir, root: dir, inputs: ["pages/source-changed.md"], writeBaseline: true });
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
    expect(Object.keys(baseline.entries)).toEqual(["pages/source-changed.md"]);

    const read = await check({ cwd: dir, root: dir, inputs: ["pages/source-changed.md"], baseline: true });
    expect(read.results[0]?.ok).toBe(true);
    expect(read.summary).toEqual({
      files: 1,
      passed: 1,
      failed: 0,
      errors: 0,
      baseline: { path: DEFAULT_CITE_BASELINE_PATH, written: false, recorded: 1, suppressed: 1, stale: 0 },
    });
    // The page reports still carry the finding: the baseline is a ratchet, not a reclassification.
    expect(rules(read)).toEqual(["source-changed"]);
  });

  it("fingerprints an id-less citation by its source pin, so re-pinning the claim keeps it suppressed", async () => {
    const dir = project();
    const entry = (claimPin: string): string =>
      [
        "---",
        "citations:",
        "  - claim:",
        "      lines: 1",
        `      integrity: ${claimPin}`,
        "    source:",
        "      file: src/changed.ts",
        "      lines: 2",
        `      integrity: ${PIN_L2}`,
        "---",
        "The fetch timeout is 30 seconds.",
        "",
      ].join("\n");
    const file = join(dir, "pages", "bare.md");
    writeFileSync(file, entry(hashLines("The fetch timeout is 10 seconds.")), "utf8");
    // Both ends drifted, and both findings are fingerprinted by the source pin:
    // never the claim's, so accepting the claim cannot reopen them.
    const before = await check({ cwd: dir, root: dir, inputs: ["pages/bare.md"] });
    expect(rules(before)).toEqual(["claim-changed", "source-changed"]);
    expect(before.results[0]?.errors.map((e) => e.subject)).toEqual([PIN_L2, PIN_L2]);
    const written = await check({ cwd: dir, root: dir, inputs: ["pages/bare.md"], writeBaseline: true });
    expect(written.summary.baseline?.recorded).toBe(2);

    // Accepting the claim re-pins it; the source finding's fingerprint is unmoved.
    writeFileSync(file, entry(hashLines("The fetch timeout is 30 seconds.")), "utf8");
    const read = await check({ cwd: dir, root: dir, inputs: ["pages/bare.md"], baseline: true });
    expect(rules(read)).toEqual(["source-changed"]);
    expect(read.results[0]?.ok).toBe(true);
    expect(read.summary.baseline?.suppressed).toBe(1);
  });

  it("names the cite command when the baseline is missing", async () => {
    const dir = project();
    expect(await refusal(check({ cwd: dir, root: dir, inputs: ["pages/source-changed.md"], baseline: true }))).toBe(
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
      stdinContent: page("source-changed.md"),
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
      "collections:\n  - name: pages\n    paths: ['pages/*.md']\ncite:\n  baseline: ci/cite.json\n",
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
        "docs/stale.md": page("source-changed.md"),
        "docs/ok.md": page("current.md"),
        "notes/ok.md": page("current.md"),
        "manni.config.yaml":
          (collections ??
            "collections:\n  - name: pages\n    paths: ['docs/*.md']\n  - name: notes\n    paths: ['notes/*.md']\n") +
          "cite:\n  root: .\n",
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
    // `git init` with nothing committed: git would index no source, so
    // this case, about paths rather than git, runs without it.
    const dir = configured(true);
    const cwd = join(dir, "docs");
    const run = await runCheck({ cwd, inputs: [], collection: ["pages"], gitClient: noGit() });
    expect(files(run)).toEqual([
      ["docs/ok.md", true],
      ["docs/stale.md", false],
    ]);
    expect(run.frame).toEqual({ cwd, base: dir, runBase: dir });
    // Positional paths stay cwd-relative, and the label follows.
    const named = await runCheck({ cwd, inputs: ["stale.md"], gitClient: noGit() });
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
      gitClient: noGit(),
      onNotice: (m) => notices.push(m),
    });
    expect(notices).toEqual([`No git root found; resolving src: paths from ${dir}`]);
    expect(ends(run)).toEqual([["current", "current"]]);
  });
});

describe("output never says more than the page did", () => {
  it("spells a token page's findings with the token, never the resolved path", async () => {
    const token = encryptSourcePath("src/moved.ts", SENTINEL);
    const keyed = hashRange(source("limits.ts"), { start: 2, end: 2 }, SENTINEL);
    const content = [
      "---",
      "citations:",
      "  - source:",
      `      file: ${token}`,
      "      lines: 2",
      `      integrity: ${keyed}`,
      "  - source:",
      `      file: ${encryptSourcePath("src/limits.ts", SENTINEL)}`,
      "      lines: 2",
      `      integrity: ${hashRange(source("limits.ts"), { start: 2, end: 2 }, SENTINEL)}`,
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
    expect(ends(run)).toEqual([
      [null, "moved"],
      [null, "current"],
    ]);
    expect(run.pages[0]?.citations[0]?.source.newSrc).toBe(`${token}:4`);
    expect(messages(run)).toEqual([`moved -> ${token}:4`]);
    // The resolved path is carried for `--reveal` and nowhere else.
    expect(run.pages[0]?.citations.map((c) => c.source.resolvedPath)).toEqual([
      "src/moved.ts",
      "src/limits.ts",
    ]);
    for (const finding of run.pages[0]?.findings ?? []) {
      expect(JSON.stringify(finding)).not.toContain(".ts");
    }
    expect(JSON.stringify(run.results)).not.toContain(".ts");
    expect(JSON.stringify(run.summary)).not.toContain(".ts");
  });
});

describe("without git", () => {
  const heard = async (over: Partial<CheckOptions> & { inputs: string[] }): Promise<string[]> => {
    const notices: string[] = [];
    await check({ ...over, onNotice: (m) => notices.push(m) });
    return notices;
  };

  it("says once per run that history is off, when a citation carries a commit", async () => {
    // Two pages carrying commits: the file and the same page on stdin.
    const notices = await heard({
      inputs: ["pages/frontmatter-only.md", "-"],
      as: "markdown",
      stdinContent: page("frontmatter-only.md"),
    });
    expect(notices).toEqual([NO_HISTORY]);
  });

  it("says it under --show-diff too, with no commit on the page", async () => {
    expect(await heard({ inputs: ["pages/current.md"], showDiff: true })).toEqual([NO_HISTORY]);
  });

  it("says nothing when nothing needed git", async () => {
    expect(
      await heard({ inputs: ["pages/current.md", "pages/moved.md", "pages/source-changed.md"] }),
    ).toEqual([]);
    // With the sources off git is never asked, commit or no commit.
    expect(await heard({ inputs: ["pages/frontmatter-only.md"], checkSources: false, showDiff: true })).toEqual([]);
  });

  it("says nothing about it when git is there", async () => {
    const there: GitClient = {
      ...noGit(),
      available: () => Promise.resolve(true),
      lsFiles: () => Promise.resolve(["src/a.txt", "src/limits.ts", "src/changed.ts"]),
    };
    const notices = await heard({
      inputs: ["-"],
      as: "markdown",
      stdinContent: [
        "---",
        "citations:",
        "  - id: fetch-timeout",
        "    source:",
        "      file: src/changed.ts",
        "      lines: 2",
        `      integrity: ${PIN_L2}`,
        `      commit-sha: ${UNKNOWN}`,
        "---",
        "Body.",
        "",
      ].join("\n"),
      gitClient: there,
      showDiff: true,
    });
    // History is asked for and a depth-1 clone cannot show it: that is the
    // shallow-clone advice, not the missing-git one.
    expect(notices).toEqual([
      "commit 0123456 not found in history; use fetch-depth: 0 to enable never-true and diffs",
    ]);
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
      "    claim:",
      "      lines: 1",
      `      integrity: ${hashLines("The fetch timeout is 10 seconds.")}`,
      "    source:",
      "      file: src/limits.ts",
      "      lines: 2",
      `      integrity: ${pin}`,
      `      commit-sha: ${commit}`,
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
    const run = await runCheck({ cwd: repo, inputs: ["docs"], noConfig: true, env: {}, onNotice: (m) => notices.push(m) });
    expect(run.results.map((r) => r.file)).toEqual(["docs/a.md", "docs/b.md"]);
    expect(run.pages.map((p) => p.notices.length)).toEqual([1, 1]);
    expect(notices).toEqual([
      "commit 0123456 not found in history; use fetch-depth: 0 to enable never-true and diffs",
    ]);
    expect(run.pages[0]?.citations[0]?.source.historyAvailable).toBe(false);
  });

  it("classifies never-true and changed-with-history from the repository", async () => {
    repo = makeTempRepo({ files: { "src/limits.ts": source("limits.ts") } });
    const first = commitAll(repo, "add limits");
    writeFileSync(join(repo, "src", "limits.ts"), source("changed.ts"), "utf8");
    const second = commitAll(repo, "raise fetch timeout to 30s");
    const neverPin = hashLines("export const FETCH_TIMEOUT_MS = 20_000;");
    mkdirSync(join(repo, "docs"));
    writeFileSync(join(repo, "docs", "changed.md"), entry(first), "utf8");
    writeFileSync(join(repo, "docs", "never.md"), entry(second, neverPin), "utf8");
    const run = await runCheck({
      cwd: repo,
      inputs: ["docs/changed.md", "docs/never.md"],
      noConfig: true,
      env: {},
    });
    expect(run.pages.map((p) => p.citations.map((c) => c.source.status))).toEqual([
      ["changed"],
      ["never-true"],
    ]);
    const changed = run.pages[0]?.citations[0]?.source;
    expect(changed?.historyAvailable).toBe(true);
    expect(changed?.commitsSince).toEqual(["raise fetch timeout to 30s"]);
    expect(run.pages[0]?.findings[0]?.message).toBe(`changed since ${first.slice(0, 7)}, 1 commit`);
    expect(run.pages[1]?.findings[0]?.message).toBe(
      `never true: the pin does not match at ${second.slice(0, 7)}`,
    );
    // Where git is not there, both are a plain `changed`, and the run says why once.
    const notices: string[] = [];
    const blind = await runCheck({
      cwd: repo,
      inputs: ["docs"],
      noConfig: true,
      env: {},
      gitClient: noGit(),
      onNotice: (m) => notices.push(m),
    });
    expect(blind.pages.map((p) => p.citations.map((c) => c.source.status))).toEqual([
      ["changed"],
      ["changed"],
    ]);
    expect(blind.pages[0]?.citations[0]?.source.historyAvailable).toBeUndefined();
    expect(notices).toEqual([NO_HISTORY]);
  });
});
