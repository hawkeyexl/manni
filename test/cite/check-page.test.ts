/**
 * `checkCitations` over the fixture pages, with `test/fixtures/cite` as the
 * root (the way `--root test/fixtures/cite` would). Git is a fake that knows
 * the tracked files and nothing of history, so every `changed` pin with a
 * commit degrades to "history unavailable" and produces the run notice.
 */
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkCitations } from "../../src/cite/core/check-page.js";
import { noGit } from "../../src/cite/core/git.js";
import { hashRange } from "../../src/cite/core/hash.js";
import { encryptSourcePath } from "../../src/cite/core/sources.js";
import type { CheckPageOptions, GitClient, PageCitationReport } from "../../src/cite/types.js";
import { makeTempRepo, removeTempRepo } from "../helpers/temp-repo.js";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "fixtures", "cite");
const PAGES = join(ROOT, "pages");
const PIN = "sha256-78af1d3321f9cbb177a7e4c958e39be56fd14cb93c1e441778bc4232e0fe4b1f";
const PIN_1_3 = "sha256-d2981e71e50b9bd645ab30ad36aeb87dcb3c3268ff8d90ed3b021a45dfbed1d6";

/** Knows the tracked files; every commit is unknown, as in a depth-1 clone. */
function shallowGit(files: string[], available = true): GitClient {
  return {
    available: () => Promise.resolve(available),
    head: () => Promise.resolve(null),
    lsFiles: () => Promise.resolve(files),
    showFile: () => Promise.resolve({ missing: "commit" }),
    subjectsSince: () => Promise.reject(new Error("no history")),
    diffSince: () => Promise.reject(new Error("no history")),
  };
}

const FIXTURE_FILES = ["src/a.txt", "src/limits.ts"];

const NO_HISTORY =
  "git is not available here, so citations are checked without history: no never-true, no diffs, no commit subjects.";

function check(name: string, over?: Partial<CheckPageOptions>): Promise<PageCitationReport> {
  const file = join(PAGES, name);
  return checkCitations(
    { file, content: readFileSync(file, "utf8") },
    { root: ROOT, gitClient: shallowGit(FIXTURE_FILES), ...over },
  );
}

const statuses = (report: PageCitationReport): string[] => report.citations.map((c) => c.status);
const rules = (report: PageCitationReport): string[] => report.findings.map((f) => f.rule);

describe("checkCitations", () => {
  it("classifies both channels and merges the findings in line order", async () => {
    const report = await check("inline.md");
    expect(report.file).toBe(join(PAGES, "inline.md"));
    expect(report.format).toBe("markdown");
    expect(statuses(report)).toEqual(["current", "changed", "changed"]);
    expect(report.findings).toEqual([
      {
        rule: "changed",
        ruleId: "manni:cite/changed",
        severity: "error",
        message: "changed",
        line: 19,
        id: "retries",
        src: "src/limits.ts:3",
        index: 1,
      },
      {
        rule: "changed",
        ruleId: "manni:cite/changed",
        severity: "error",
        message: "changed",
        line: 21,
        src: "src/limits.ts:1",
      },
    ]);
    expect(report.notices).toEqual([]);
  });

  it("holds across crlf pages and formats without frontmatter", async () => {
    expect(rules(await check("crlf.md"))).toEqual([]);
    const html = await check("inline.html");
    expect(html.format).toBe("html");
    expect(statuses(html)).toEqual(["current"]);
  });

  it("takes the page-level commit and notices a commit history cannot show", async () => {
    const report = await check("frontmatter-only.md");
    expect(statuses(report)).toEqual(["current", "changed"]);
    expect(report.citations[1]?.historyAvailable).toBe(false);
    expect(report.findings.map((f) => f.message)).toEqual([
      "changed (history unavailable: commit 0123456 not found; fetch-depth: 0)",
    ]);
    expect(report.notices).toEqual([
      "commit 0123456 not found in history; use fetch-depth: 0 to enable never-true and diffs",
    ]);
  });

  it("keeps page-side findings and marks every source skipped under checkSources: false", async () => {
    const orphan = await check("statement-orphan.md", { checkSources: false });
    expect(statuses(orphan)).toEqual(["skipped"]);
    expect(rules(orphan)).toEqual(["statement-orphan"]);
    const inline = await check("inline.md", { checkSources: false });
    expect(statuses(inline)).toEqual(["skipped", "skipped", "skipped"]);
    expect(inline.findings).toEqual([]);
  });

  it("re-applies the severity table to page-side findings too, dropping off rules", async () => {
    const report = await check("inline.md", {
      severity: { changed: "warning", current: "warning" },
    });
    expect(report.findings.map((f) => [f.rule, f.severity])).toEqual([
      ["current", "warning"],
      ["changed", "warning"],
      ["changed", "warning"],
    ]);
    const off = await check("statement-orphan.md", { severity: { "statement-orphan": "off" } });
    expect(off.findings).toEqual([]);
    const ambiguous = await check("claim-ambiguous.md", { severity: { "claim-ambiguous": "error" } });
    expect(ambiguous.findings.map((f) => [f.rule, f.severity])).toEqual([
      ["claim-ambiguous", "error"],
      ["changed", "error"],
    ]);
  });

  it("reports a git-free run as changed without history, and says why", async () => {
    const report = await check("frontmatter-only.md", { gitClient: noGit() });
    expect(statuses(report)).toEqual(["current", "changed"]);
    expect(report.citations[1]?.historyAvailable).toBeUndefined();
    expect(report.notices).toEqual([NO_HISTORY]);
  });

  it("says nothing about git when no citation carries a commit, or the sources are off", async () => {
    const plain = await check("inline.md", { gitClient: shallowGit(FIXTURE_FILES, false) });
    expect(statuses(plain)).toEqual(["current", "changed", "changed"]);
    expect(plain.notices).toEqual([]);
    const skipped = await check("frontmatter-only.md", { gitClient: noGit(), checkSources: false });
    expect(skipped.notices).toEqual([]);
  });

  it("honours a forced format", async () => {
    const file = join(PAGES, "inline.md");
    const report = await checkCitations(
      { file: "-", content: readFileSync(file, "utf8"), format: "markdown" },
      { root: ROOT, gitClient: shallowGit(FIXTURE_FILES) },
    );
    expect(report.format).toBe("markdown");
    expect(statuses(report)).toEqual(["current", "changed", "changed"]);
  });

  it("takes a prebuilt source index", async () => {
    const report = await check("inline.md", {
      sourceIndex: { files: () => [], has: () => false },
    });
    expect(statuses(report)).toEqual(["missing", "missing", "missing"]);
  });
});

describe("checkCitations: quote", () => {
  const page = (content: string, name = "page.md"): Promise<PageCitationReport> =>
    checkCitations({ file: name, content }, { root: ROOT, gitClient: shallowGit(FIXTURE_FILES) });

  it("holds when the anchored blocks reproduce the ranges", async () => {
    const report = await check("quote.md");
    expect(statuses(report)).toEqual(["current", "current"]);
    expect(report.findings).toEqual([]);
  });

  it("flags an inline block that no longer reproduces the range", async () => {
    const content = [
      `<!-- cite {"src": "src/limits.ts:2", "integrity": "${PIN}", "quote": true} -->`,
      "```ts",
      "export const FETCH_TIMEOUT_MS = 30_000;",
      "```",
      "",
    ].join("\n");
    const report = await page(content);
    expect(statuses(report)).toEqual(["current"]);
    // Anchored at the block, as every source finding anchors at anchorLine ?? line.
    expect(report.findings).toMatchObject([
      { rule: "quote-drift", line: 2, src: "src/limits.ts:2", severity: "error" },
    ]);
  });

  it("flags a referenced block that drifted, once", async () => {
    const content = [
      "---",
      "citations:",
      "  - id: header",
      "    src: src/limits.ts:1-3",
      `    integrity: ${PIN_1_3}`,
      "    quote: true",
      "---",
      "<!-- cite header -->",
      "```ts",
      "export const MAX_FILES = 10_000;",
      "```",
      "",
    ].join("\n");
    const report = await page(content);
    expect(rules(report)).toEqual(["quote-drift"]);
    expect(report.findings[0]).toMatchObject({ id: "header", index: 0, src: "src/limits.ts:1-3" });
  });

  it("searches every fenced block for a frontmatter entry with no reference", async () => {
    const head = [
      "---",
      "citations:",
      "  - src: src/limits.ts:1-3",
      `    integrity: ${PIN_1_3}`,
      "    quote: true",
      "---",
      "# Limits",
      "",
    ];
    const good = [...head, "```ts", "unrelated", "```", "", "~~~ts", ...readFileSync(join(ROOT, "src", "limits.ts"), "utf8").split("\n").slice(0, 3), "~~~", ""].join("\n");
    expect(rules(await page(good))).toEqual([]);
    const bad = [...head, "```ts", "unrelated", "```", ""].join("\n");
    expect(rules(await page(bad))).toEqual(["quote-drift"]);
    const none = [...head, "prose only", ""].join("\n");
    expect(rules(await page(none))).toEqual(["quote-drift"]);
  });

  it("does not double-report a statement with no block after it", async () => {
    const content = `<!-- cite {"src": "src/limits.ts:2", "integrity": "${PIN}", "quote": true} -->\nprose only\n`;
    expect(rules(await page(content))).toEqual(["quote-drift"]);
  });

  it("skips the quote check when the source is missing", async () => {
    const content = `<!-- cite {"src": "src/gone.ts:2", "integrity": "${PIN}", "quote": true} -->\n\`\`\`\nx\n\`\`\`\n`;
    expect(rules(await page(content))).toEqual(["missing"]);
  });

  it("is not fooled by a block that still shows the pinned text after a move", async () => {
    // With the block equal to the pinned bytes, the quote is faithful to the
    // citation even though the range now holds other lines.
    const content = `<!-- cite {"src": "src/limits.ts:1", "integrity": "${PIN}", "quote": true} -->\n\`\`\`ts\nexport const FETCH_TIMEOUT_MS = 10_000;\n\`\`\`\n`;
    const report = await page(content);
    expect(statuses(report)).toEqual(["moved"]);
    expect(rules(report)).toEqual(["moved"]);
  });
});

describe("checkCitations: encrypted sources and the leak sentinel", () => {
  /** Fixed test keys; never the developer's environment. */
  const KEY = "sentinel-key-0123456789abcdef012345";
  const OTHER = "another-key-0123456789abcdef012345";
  const SECRET = "private/SECRET.ts";
  const SECRET_TEXT = "const a = 1;\nconst b = 2;\nconst c = 3;\n";
  let root: string | undefined;
  afterEach(() => {
    removeTempRepo(root);
    root = undefined;
  });

  /** A page citing SECRET's line 2 through an encrypted source, pinned under `pinKey`. */
  function pageFor(token: string, pinKey: string): string {
    const keyed = hashRange(SECRET_TEXT, { start: 2, end: 2 }, pinKey);
    return `---\ncitations:\n  - { id: fetch-timeout, src: "${token}:2", integrity: ${keyed} }\n---\nBody.\n`;
  }

  it("decrypts a source, and says nothing the page did not", async () => {
    root = makeTempRepo({ init: false, files: { [SECRET]: SECRET_TEXT } });
    const token = encryptSourcePath(SECRET, KEY);
    const gone = encryptSourcePath("private/GONE.ts", KEY);
    const keyed = hashRange(SECRET_TEXT, { start: 2, end: 2 }, KEY);
    const content = [
      "---",
      "citation-commit: 3f9c2a1e7b0d4c5a6f8e9d0b1a2c3d4e5f607182",
      "citations:",
      `  - { id: current, src: "${token}:2", integrity: ${keyed} }`,
      `  - { id: changed, src: "${token}:3", integrity: ${keyed} }`,
      `  - { id: gone, src: "${gone}:1", integrity: ${keyed} }`,
      "---",
      "Body.",
      "",
    ].join("\n");
    const report = await checkCitations(
      { file: "docs/page.md", content },
      { root, key: KEY, gitClient: shallowGit([SECRET]) },
    );
    expect(statuses(report)).toEqual(["current", "moved", "missing"]);
    expect(report.citations[0]?.resolvedPath).toBe(SECRET);
    expect(report.findings.map((f) => f.message)).toEqual([
      `moved -> ${token}:2`,
      "missing (no tracked file matches; wrong --root?)",
    ]);
    const text = JSON.stringify({ findings: report.findings, notices: report.notices });
    expect(text).not.toContain("SECRET");
    expect(text).not.toContain("GONE");
    expect(text).not.toContain(KEY);
  });

  it("a source encrypted under another key is missing, not a leak", async () => {
    root = makeTempRepo({ init: false, files: { [SECRET]: SECRET_TEXT } });
    const report = await checkCitations(
      { file: "docs/page.md", content: pageFor(encryptSourcePath(SECRET, OTHER), OTHER) },
      { root, key: KEY, gitClient: noGit() },
    );
    expect(statuses(report)).toEqual(["missing"]);
    expect(report.citations[0]?.resolvedPath).toBeUndefined();
    expect(report.findings.map((f) => [f.rule, f.severity, f.message])).toEqual([
      ["missing", "error", "missing (does not decrypt under the current key)"],
    ]);
    expect(JSON.stringify(report)).not.toContain("SECRET");
  });

  it("with no key, an encrypted source is missing, and an error", async () => {
    root = makeTempRepo({ init: false, files: { [SECRET]: SECRET_TEXT } });
    const report = await checkCitations(
      { file: "docs/page.md", content: pageFor(encryptSourcePath(SECRET, KEY), KEY) },
      { root, gitClient: noGit() },
    );
    expect(statuses(report)).toEqual(["missing"]);
    expect(report.findings.map((f) => [f.rule, f.severity, f.message])).toEqual([
      ["missing", "error", "missing (no encryption key is available to decrypt it)"],
    ]);
  });

  it("with the sources off, an encrypted source is skipped, key or no key", async () => {
    root = makeTempRepo({ init: false, files: { [SECRET]: SECRET_TEXT } });
    const report = await checkCitations(
      { file: "docs/page.md", content: pageFor(encryptSourcePath(SECRET, KEY), KEY) },
      { root, gitClient: noGit(), checkSources: false },
    );
    expect(statuses(report)).toEqual(["skipped"]);
    expect(report.findings).toEqual([]);
  });

  it("a pin keyed under another key is changed, not a leak", async () => {
    root = makeTempRepo({ init: false, files: { [SECRET]: SECRET_TEXT } });
    const report = await checkCitations(
      { file: "docs/page.md", content: pageFor(encryptSourcePath(SECRET, KEY), OTHER) },
      { root, key: KEY, gitClient: noGit() },
    );
    expect(statuses(report)).toEqual(["changed"]);
    expect(JSON.stringify(report.findings)).not.toContain("SECRET");
  });
});
