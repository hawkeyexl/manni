/**
 * `checkCitations` over the fixture pages, with `test/fixtures/cite` as the
 * root (the way `--root test/fixtures/cite` would). An entry has two ends and
 * both are classified here: the claim against the page, the source against the
 * files. Git is a fake that knows the tracked files and, unless a test says
 * otherwise, nothing of history, so every `changed` pin with a commit degrades
 * to "history unavailable" and produces the run notice.
 */
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkCitations } from "../../src/cite/core/check-page.js";
import { noGit } from "../../src/cite/core/git.js";
import { hashLines, hashRange } from "../../src/cite/core/hash.js";
import { encryptSourcePath } from "../../src/cite/core/sources.js";
import type {
  CheckPageOptions,
  CitationInput,
  GitClient,
  PageCitationReport,
  ShownFile,
} from "../../src/cite/types.js";
import { makeTempRepo, removeTempRepo } from "../helpers/temp-repo.js";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "fixtures", "cite");
const PAGES = join(ROOT, "pages");

/** `src/limits.ts` line 2, and lines 1-3: the ladder's golden pins. */
const PIN_L2 = "sha256-78af1d3321f9cbb177a7e4c958e39be56fd14cb93c1e441778bc4232e0fe4b1f";
const PIN_1_3 = "sha256-d2981e71e50b9bd645ab30ad36aeb87dcb3c3268ff8d90ed3b021a45dfbed1d6";
/** The claim pin every fixture page carries for "The fetch timeout is 10 seconds." */
const CLAIM_10 = "sha256-921b21cccab21a4577f224ec4171aa56a3414bb3a5a4704ab8b6f314c46aa094";
const COMMIT = "0123456789abcdef0123456789abcdef01234567";
/** The key `pages/encrypted.md` was encrypted with; the fixture config carries it too. */
const FIXTURE_KEY = "cite-fixture-key-0123456789abcdef";

/** Knows the tracked files; `shown` is all git can say about any commit. */
function shallowGit(files: string[], available = true, shown?: ShownFile): GitClient {
  return {
    available: () => Promise.resolve(available),
    head: () => Promise.resolve(null),
    lsFiles: () => Promise.resolve(files),
    showFile: () => Promise.resolve(shown ?? { missing: "commit" }),
    subjectsSince: () => Promise.resolve(["raise the fetch timeout"]),
    diffSince: () => Promise.resolve("-old\n+new\n"),
  };
}

const FIXTURE_FILES = ["src/a.txt", "src/limits.ts", "src/changed.ts", "src/moved.ts"];

const NO_HISTORY =
  "git is not available here, so citations are checked without history: no never-true, no diffs, no commit subjects.";
const SHALLOW =
  "commit 0123456 not found in history; use fetch-depth: 0 to enable never-true and diffs";

function check(name: string, over?: Partial<CheckPageOptions>): Promise<PageCitationReport> {
  const file = join(PAGES, name);
  return checkCitations(
    { file, content: readFileSync(file, "utf8") },
    { root: ROOT, gitClient: shallowGit(FIXTURE_FILES), ...over },
  );
}

/** A page written here rather than kept as a fixture: the entries, then the body. */
function inline(entry: string[], body: string[]): string {
  return ["---", "citations:", ...entry, "---", "# Limits", "", ...body, ""].join("\n");
}

function page(
  content: string,
  over?: Partial<CheckPageOptions>,
  file = "docs/page.md",
): Promise<PageCitationReport> {
  return checkCitations(
    { file, content },
    { root: ROOT, gitClient: shallowGit(FIXTURE_FILES), ...over },
  );
}

/** One entry pinned to a source that changed, with a commit a shallow git cannot show. */
const SHALLOW_ENTRY = [
  "  - id: fetch-timeout",
  "    source:",
  "      file: src/changed.ts",
  "      lines: 2",
  `      integrity: ${PIN_L2}`,
  `      commit-sha: ${COMMIT}`,
];

const claimStatuses = (report: PageCitationReport): (string | null)[] =>
  report.citations.map((c) => c.claim?.status ?? null);
const sourceStatuses = (report: PageCitationReport): string[] =>
  report.citations.map((c) => c.source.status);
const rules = (report: PageCitationReport): string[] => report.findings.map((f) => f.rule);
const messages = (report: PageCitationReport): string[] => report.findings.map((f) => f.message);

describe("checkCitations", () => {
  it("classifies both ends of an entry and merges the findings in line order", async () => {
    const report = await page(
      inline(
        [
          "  - id: fetch-timeout",
          "    claim:",
          "      lines: 3",
          `      integrity: ${CLAIM_10}`,
          "    source:",
          "      file: src/changed.ts",
          "      lines: 2",
          `      integrity: ${PIN_L2}`,
        ],
        ["The fetch timeout is 30 seconds."],
      ),
    );
    expect(report.file).toBe("docs/page.md");
    expect(report.format).toBe("markdown");
    const [only] = report.citations;
    expect(only?.anchor).toBe("claim");
    expect(only?.anchorLine).toBe(14);
    expect(only?.claim).toEqual({
      lines: "3",
      fileLines: "14",
      status: "changed",
      text: ["The fetch timeout is 30 seconds."],
    });
    expect(only?.source).toMatchObject({ src: "src/changed.ts:2", status: "changed" });
    // The claim end first: both sit on line 14, and the page side reads first.
    expect(report.findings).toEqual([
      {
        rule: "claim-changed",
        ruleId: "manni:cite/claim-changed",
        severity: "warning",
        message: "fetch-timeout: the claim at line 14 has changed since it was pinned.",
        src: "src/changed.ts:2",
        index: 0,
        line: 14,
        id: "fetch-timeout",
      },
      {
        rule: "source-changed",
        ruleId: "manni:cite/source-changed",
        severity: "error",
        message: "changed",
        src: "src/changed.ts:2",
        index: 0,
        line: 14,
        id: "fetch-timeout",
      },
    ]);
    expect(report.notices).toEqual([]);
  });

  it("holds where nothing drifted, across crlf, a claim range and a page with no entries", async () => {
    for (const name of ["current.md", "crlf.md", "claim-range.md", "frontmatter-tag.md"]) {
      const report = await check(name);
      expect([name, claimStatuses(report), sourceStatuses(report)]).toEqual([
        name,
        ["current"],
        ["current"],
      ]);
      expect(report.findings).toEqual([]);
    }
    const empty = await check("no-citations.md");
    expect(empty.citations).toEqual([]);
    expect(empty.findings).toEqual([]);
  });

  it("reports a moved claim as a notice naming the line it went to", async () => {
    const report = await check("claim-moved.md");
    expect(report.citations[0]?.claim).toEqual({
      lines: "3",
      fileLines: "15",
      status: "moved",
      newLines: "5",
      newFileLines: "17",
    });
    expect(report.citations[0]?.anchorLine).toBe(17);
    expect(report.findings).toEqual([
      {
        rule: "claim-moved",
        ruleId: "manni:cite/claim-moved",
        severity: "notice",
        message: "fetch-timeout: the claim moved from line 15 to line 17.",
        src: "src/limits.ts:2",
        index: 0,
        line: 15,
        id: "fetch-timeout",
      },
    ]);
  });

  it("names every line an ambiguous claim now appears at", async () => {
    const report = await check("claim-moved-ambiguous.md");
    expect(report.citations[0]?.claim).toMatchObject({
      status: "moved-ambiguous",
      candidates: ["5", "9"],
      candidateFileLines: ["17", "21"],
    });
    expect(report.findings.map((f) => [f.rule, f.severity, f.line, f.message])).toEqual([
      [
        "claim-moved-ambiguous",
        "warning",
        15,
        "retries: the claim at line 15 now appears at lines 17 and 21.",
      ],
    ]);
  });

  it("reports a changed claim as a warning at the claim's own line", async () => {
    const report = await check("claim-changed.md");
    expect(claimStatuses(report)).toEqual(["changed"]);
    expect(sourceStatuses(report)).toEqual(["current"]);
    expect(report.findings.map((f) => [f.rule, f.severity, f.line, f.message])).toEqual([
      [
        "claim-changed",
        "warning",
        15,
        "fetch-timeout: the claim at line 15 has changed since it was pinned.",
      ],
    ]);
  });

  it("judges a marker-anchored claim where the marker anchors, in every format", async () => {
    for (const name of ["marker.md", "marker.mdx", "marker.adoc", "marker.rst"]) {
      const report = await check(name);
      const [only] = report.citations;
      expect([name, only?.anchor, claimStatuses(report)]).toEqual([name, "marker", ["current"]]);
      expect(only?.markerLine).toBeDefined();
      expect(only?.anchorLine).toBe((only?.markerLine ?? 0) + 1);
      expect(report.findings).toEqual([]);
    }
    const changed = await check("marker-changed.md");
    expect(changed.citations[0]).toMatchObject({ anchor: "marker", markerLine: 14, anchorLine: 15 });
    expect(changed.citations[0]?.claim).toMatchObject({ fileLines: "15", status: "changed" });
    expect(changed.findings.map((f) => [f.rule, f.line, f.message])).toEqual([
      ["claim-changed", 15, "retries: the claim at line 15 has changed since it was pinned."],
    ]);
  });

  it("says a claim pin with neither lines nor a marker anchors nothing, on the entry's line", async () => {
    const report = await page(
      inline(
        [
          "  - id: fetch-timeout",
          "    claim:",
          `      integrity: ${CLAIM_10}`,
          "    source:",
          "      file: src/limits.ts",
          "      lines: 2",
          `      integrity: ${PIN_L2}`,
        ],
        ["The fetch timeout is 10 seconds."],
      ),
    );
    expect(report.citations[0]?.anchor).toBeNull();
    expect(report.citations[0]?.claim).toEqual({ status: "changed" });
    expect(report.findings.map((f) => [f.rule, f.line, f.message])).toEqual([
      [
        "claim-changed",
        3,
        "fetch-timeout: the claim has no lines and no marker names the entry, so its pin anchors nothing.",
      ],
    ]);
  });

  it("leaves the source skipped under checkSources: false and still catches a changed claim", async () => {
    // The public-docs job: no source tree, and the claim end is still judged.
    const changed = await check("claim-changed.md", { checkSources: false });
    expect(sourceStatuses(changed)).toEqual(["skipped"]);
    expect(claimStatuses(changed)).toEqual(["changed"]);
    expect(changed.findings.map((f) => [f.rule, f.line, f.message])).toEqual([
      ["claim-changed", 15, "fetch-timeout: the claim at line 15 has changed since it was pinned."],
    ]);
    const moved = await check("claim-moved.md", { checkSources: false });
    expect(rules(moved)).toEqual(["claim-moved"]);
    // A source that drifted is not looked at at all.
    const source = await check("source-changed.md", { checkSources: false });
    expect(sourceStatuses(source)).toEqual(["skipped"]);
    expect(source.findings).toEqual([]);
  });

  it("keeps the page-side rules under checkSources: false too", async () => {
    expect(rules(await check("marker-orphan.md", { checkSources: false }))).toEqual([
      "marker-orphan",
    ]);
    expect(rules(await check("anchor-both.md", { checkSources: false }))).toEqual([
      "anchor-invalid",
    ]);
    expect(rules(await check("entry-invalid.md", { checkSources: false }))).toEqual([
      "entry-invalid",
      "entry-invalid",
    ]);
  });

  it("re-applies the severity table to both ends and to the page-side rules", async () => {
    const claim = await check("claim-changed.md", { severity: { "claim-changed": "error" } });
    expect(claim.findings.map((f) => [f.rule, f.severity])).toEqual([["claim-changed", "error"]]);
    const off = await check("claim-moved.md", { severity: { "claim-moved": "off" } });
    expect(off.findings).toEqual([]);
    const source = await check("moved.md", { severity: { "source-moved": "notice" } });
    expect(source.findings.map((f) => [f.rule, f.severity])).toEqual([["source-moved", "notice"]]);
    const repeated = await check("marker-repeated.md", { severity: { "marker-repeated": "off" } });
    expect(repeated.findings).toEqual([]);
  });

  it("spells each source status the way the plan's table does", async () => {
    expect(messages(await check("moved.md"))).toEqual(["moved -> src/moved.ts:4"]);
    expect(messages(await check("source-changed.md"))).toEqual(["changed"]);
    expect(messages(await check("missing.md"))).toEqual(["missing"]);
    const neverTrue = await page(inline(SHALLOW_ENTRY, ["Body."]), {
      // git can show the commit, and the pinned bytes are nowhere in it.
      gitClient: shallowGit(FIXTURE_FILES, true, { text: "a\nb\nc\n" }),
    });
    expect(sourceStatuses(neverTrue)).toEqual(["never-true"]);
    expect(neverTrue.findings.map((f) => [f.rule, f.severity, f.message])).toEqual([
      ["source-never-true", "error", "never true: the pin does not match at 0123456"],
    ]);
  });

  it("says which commit history could not show, once per run", async () => {
    const report = await page(inline(SHALLOW_ENTRY, ["Body."]));
    expect(report.citations[0]?.source.historyAvailable).toBe(false);
    expect(messages(report)).toEqual([
      "changed (history unavailable: commit 0123456 not found; fetch-depth: 0)",
    ]);
    expect(report.notices).toEqual([SHALLOW]);
  });

  it("reports a git-free run as changed without history, and says why", async () => {
    const report = await page(inline(SHALLOW_ENTRY, ["Body."]), {
      gitClient: noGit(),
      sourceIndex: { files: () => FIXTURE_FILES, has: () => true },
    });
    expect(sourceStatuses(report)).toEqual(["changed"]);
    expect(report.citations[0]?.source.historyAvailable).toBeUndefined();
    expect(messages(report)).toEqual(["changed since 0123456"]);
    expect(report.notices).toEqual([NO_HISTORY]);
  });

  it("says nothing about git when no citation carries a commit, or the sources are off", async () => {
    const plain = await check("source-changed.md", { gitClient: shallowGit(FIXTURE_FILES, false) });
    expect(sourceStatuses(plain)).toEqual(["changed"]);
    expect(plain.notices).toEqual([]);
    const skipped = await page(inline(SHALLOW_ENTRY, ["Body."]), {
      gitClient: noGit(),
      checkSources: false,
    });
    expect(skipped.notices).toEqual([]);
  });

  it("honours a forced format for a page read from stdin", async () => {
    const file = join(PAGES, "current.md");
    const report = await checkCitations(
      { file: "-", content: readFileSync(file, "utf8"), format: "markdown" },
      { root: ROOT, gitClient: shallowGit(FIXTURE_FILES) },
    );
    expect(report.format).toBe("markdown");
    expect(claimStatuses(report)).toEqual(["current"]);
    expect(sourceStatuses(report)).toEqual(["current"]);
  });

  it("takes a prebuilt source index, and judges the claim end regardless", async () => {
    const report = await check("current.md", {
      sourceIndex: { files: () => [], has: () => false },
    });
    expect(sourceStatuses(report)).toEqual(["missing"]);
    expect(claimStatuses(report)).toEqual(["current"]);
    expect(rules(report)).toEqual(["source-missing"]);
  });
});

describe("checkCitations: citations a manifest owns", () => {
  const HTML_PAGE = join(PAGES, "marker.html");
  const html = readFileSync(HTML_PAGE, "utf8");
  /** What the marker in `marker.html` anchors: the paragraph runs to the end of the file. */
  const ANCHORED = hashLines("<p>The fetch timeout is 10 seconds.</p>\n</body>\n</html>");
  const MANIFEST = "docs/citations.yaml";

  const injected = (entry: unknown): CitationInput[] => [
    { entry, origin: { kind: "manifest", file: MANIFEST, line: 7 } },
  ];

  it("classifies an injected entry, and carries the manifest to the result", async () => {
    const report = await page(
      html,
      {
        citations: injected({
          id: "fetch-timeout",
          claim: { integrity: ANCHORED },
          source: { file: "src/limits.ts", lines: 2, integrity: PIN_L2 },
        }),
      },
      HTML_PAGE,
    );
    expect(report.format).toBe("html");
    const [only] = report.citations;
    expect(only?.origin).toEqual({ kind: "manifest", file: MANIFEST, line: 7, index: 0 });
    expect(only).toMatchObject({ anchor: "marker", markerLine: 5, anchorLine: 6 });
    expect(claimStatuses(report)).toEqual(["current"]);
    expect(sourceStatuses(report)).toEqual(["current"]);
    expect(report.findings).toEqual([]);
  });

  it("puts a finding about the entry itself on the manifest that holds it", async () => {
    const report = await page(
      html,
      // No `integrity` under `source`: the entry itself is what is wrong.
      { citations: injected({ id: "fetch-timeout", source: { file: "src/limits.ts", lines: 2 } }) },
      HTML_PAGE,
    );
    expect(report.citations).toEqual([]);
    expect(report.findings).toEqual([
      // The entry never registered its id, so the page's marker is an orphan.
      {
        rule: "marker-orphan",
        ruleId: "manni:cite/marker-orphan",
        severity: "error",
        message: 'no entry has id "fetch-timeout"',
        line: 5,
        id: "fetch-timeout",
      },
      {
        rule: "entry-invalid",
        ruleId: "manni:cite/entry-invalid",
        severity: "error",
        message: "/source must have required property 'integrity'",
        line: 7,
        file: MANIFEST,
        id: "fetch-timeout",
        src: "src/limits.ts",
        index: 0,
      },
    ]);
  });

  it("classifies both ends of an injected entry, anchored by the page's marker", async () => {
    const report = await page(
      html,
      {
        citations: injected({
          id: "fetch-timeout",
          claim: { integrity: CLAIM_10 },
          source: { file: "src/changed.ts", lines: 2, integrity: PIN_L2 },
        }),
      },
      HTML_PAGE,
    );
    expect(claimStatuses(report)).toEqual(["changed"]);
    expect(sourceStatuses(report)).toEqual(["changed"]);
    // Both findings sit on the page, at the line the marker anchors.
    expect(report.findings.map((f) => [f.rule, f.line, f.file])).toEqual([
      ["claim-changed", 6, undefined],
      ["source-changed", 6, undefined],
    ]);
  });

  it("does not read the page's own frontmatter when entries are injected", async () => {
    const current = readFileSync(join(PAGES, "current.md"), "utf8");
    const report = await page(
      current,
      {
        citations: injected({
          source: {
            file: "src/limits.ts",
            integrity: "sha256-aebba92fe4cddf100cc781281d1f24ad7c234b6189413e2130d5fe71ed86e023",
          },
        }),
      },
      join(PAGES, "current.md"),
    );
    // One entry, the injected one; `current.md`'s own `fetch-timeout` is gone.
    expect(report.citations).toHaveLength(1);
    expect(report.citations[0]?.citation.id).toBeUndefined();
    expect(report.citations[0]?.origin.kind).toBe("manifest");
    expect(report.citations[0]?.source.src).toBe("src/limits.ts");
    expect(report.findings).toEqual([]);
  });
});

describe("checkCitations: quote", () => {
  const BLOCK_30 = hashLines(
    [
      "```ts",
      "export const MAX_FILES = 10_000;",
      "export const FETCH_TIMEOUT_MS = 30_000;",
      "export const RETRIES = 3;",
      "```",
    ].join("\n"),
  );

  it("holds when the anchored block reproduces the cited lines, by claim and by marker", async () => {
    for (const name of ["quote.md", "quote-marker.md"]) {
      const report = await check(name);
      expect([name, claimStatuses(report), sourceStatuses(report)]).toEqual([
        name,
        ["current"],
        ["current"],
      ]);
      expect(report.findings).toEqual([]);
    }
  });

  it("is anchor-invalid when the quote's claim lines are no longer a fenced block", async () => {
    const report = await check("anchor-unfenced.md");
    expect(report.findings.map((f) => [f.rule, f.severity, f.line, f.message])).toEqual([
      [
        "anchor-invalid",
        "error",
        16,
        "header: the quote's claim lines 16-18 are no longer a fenced block.",
      ],
    ]);
  });

  it("is quote-drift when the block no longer reproduces the cited lines", async () => {
    const report = await page(
      inline(
        [
          "  - id: header",
          "    claim:",
          "      lines: 3-7",
          `      integrity: ${BLOCK_30}`,
          "    source:",
          "      file: src/limits.ts",
          "      lines: 1-3",
          `      integrity: ${PIN_1_3}`,
          "    quote: true",
        ],
        [
          "```ts",
          "export const MAX_FILES = 10_000;",
          "export const FETCH_TIMEOUT_MS = 30_000;",
          "export const RETRIES = 3;",
          "```",
        ],
      ),
    );
    // The claim end holds: the page is what it was pinned as. The block simply
    // is not the source any more.
    expect(claimStatuses(report)).toEqual(["current"]);
    expect(report.findings.map((f) => [f.rule, f.severity, f.line, f.message])).toEqual([
      [
        "quote-drift",
        "error",
        15,
        "quote: true, but the fenced block does not reproduce the cited lines",
      ],
    ]);
  });

  it("says so when a quote's marker has no fenced block after it", async () => {
    const report = await page(
      inline(
        [
          "  - id: timeout",
          "    claim:",
          `      integrity: ${hashLines("Just prose.")}`,
          "    source:",
          "      file: src/limits.ts",
          "      lines: 2",
          `      integrity: ${PIN_L2}`,
          "    quote: true",
        ],
        ["<!-- cite timeout -->", "Just prose."],
      ),
    );
    expect(report.findings[0]).toMatchObject({
      rule: "quote-drift",
      severity: "error",
      line: 14,
      message: "quote: true, but no fenced block follows the marker",
      id: "timeout",
      index: 0,
    });
  });

  it("skips the quote check when the source cannot be read", async () => {
    const report = await page(
      inline(
        [
          "  - id: header",
          "    claim:",
          "      lines: 3-5",
          `      integrity: ${hashLines("```ts\nnope\n```")}`,
          "    source:",
          "      file: src/gone.ts",
          "      lines: 1-3",
          `      integrity: ${PIN_1_3}`,
          "    quote: true",
        ],
        ["```ts", "nope", "```"],
      ),
    );
    expect(rules(report)).toEqual(["source-missing"]);
  });

  it("keeps anchor-invalid, the page-side half, under checkSources: false", async () => {
    const report = await check("anchor-unfenced.md", { checkSources: false });
    expect(rules(report)).toEqual(["anchor-invalid"]);
    const held = await check("quote.md", { checkSources: false });
    expect(held.findings).toEqual([]);
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

  /** A page pinning SECRET's line 2 through an encrypted source, keyed under `pinKey`. */
  function secretPage(token: string, pinKey: string): string {
    const keyed = hashRange(SECRET_TEXT, { start: 2, end: 2 }, pinKey);
    return inline(
      [
        "  - id: fetch-timeout",
        "    source:",
        `      file: ${token}`,
        "      lines: 2",
        `      integrity: ${keyed}`,
      ],
      ["Body."],
    );
  }

  it("decrypts a source under the family key, and reads the claim beside it", async () => {
    const report = await check("encrypted.md", { key: FIXTURE_KEY });
    expect(sourceStatuses(report)).toEqual(["current"]);
    expect(claimStatuses(report)).toEqual(["current"]);
    expect(report.citations[0]?.source.resolvedPath).toBe("src/limits.ts");
    expect(report.findings).toEqual([]);
  });

  it("without a key an encrypted source is missing, and the claim is judged anyway", async () => {
    const report = await check("encrypted.md");
    expect(sourceStatuses(report)).toEqual(["missing"]);
    expect(claimStatuses(report)).toEqual(["current"]);
    expect(report.citations[0]?.source.missingReason).toBe("no-key");
    expect(report.findings.map((f) => [f.rule, f.severity, f.message])).toEqual([
      ["source-missing", "error", "missing (no encryption key is available to decrypt it)"],
    ]);
  });

  it("a source encrypted under another key is missing, not a leak", async () => {
    root = makeTempRepo({ init: false, files: { [SECRET]: SECRET_TEXT } });
    const report = await checkCitations(
      { file: "docs/page.md", content: secretPage(encryptSourcePath(SECRET, OTHER), OTHER) },
      { root, key: KEY, gitClient: noGit() },
    );
    expect(sourceStatuses(report)).toEqual(["missing"]);
    expect(report.citations[0]?.source.resolvedPath).toBeUndefined();
    expect(report.findings.map((f) => [f.rule, f.severity, f.message])).toEqual([
      ["source-missing", "error", "missing (does not decrypt under the current key)"],
    ]);
    expect(JSON.stringify(report)).not.toContain("SECRET");
  });

  it("decrypts a source and says nothing the page did not", async () => {
    root = makeTempRepo({ init: false, files: { [SECRET]: SECRET_TEXT } });
    const token = encryptSourcePath(SECRET, KEY);
    const gone = encryptSourcePath("private/GONE.ts", KEY);
    const keyed = hashRange(SECRET_TEXT, { start: 2, end: 2 }, KEY);
    const content = [
      "---",
      "citations:",
      "  - id: current",
      "    source:",
      `      file: ${token}`,
      "      lines: 2",
      `      integrity: ${keyed}`,
      "  - id: elsewhere",
      "    source:",
      `      file: ${token}`,
      "      lines: 3",
      `      integrity: ${keyed}`,
      "  - id: gone",
      "    source:",
      `      file: ${gone}`,
      "      lines: 1",
      `      integrity: ${keyed}`,
      "---",
      "Body.",
      "",
    ].join("\n");
    const report = await checkCitations(
      { file: "docs/page.md", content },
      { root, key: KEY, gitClient: shallowGit([SECRET]) },
    );
    expect(sourceStatuses(report)).toEqual(["current", "moved", "missing"]);
    expect(report.citations[0]?.source.resolvedPath).toBe(SECRET);
    expect(messages(report)).toEqual([
      `moved -> ${token}:2`,
      "missing (no tracked file matches; wrong --root?)",
    ]);
    const text = JSON.stringify({ findings: report.findings, notices: report.notices });
    expect(text).not.toContain("SECRET");
    expect(text).not.toContain("GONE");
    expect(text).not.toContain(KEY);
  });

  it("with the sources off, an encrypted source is skipped, key or no key", async () => {
    root = makeTempRepo({ init: false, files: { [SECRET]: SECRET_TEXT } });
    const report = await checkCitations(
      { file: "docs/page.md", content: secretPage(encryptSourcePath(SECRET, KEY), KEY) },
      { root, gitClient: noGit(), checkSources: false },
    );
    expect(sourceStatuses(report)).toEqual(["skipped"]);
    expect(report.findings).toEqual([]);
  });

  it("a pin keyed under another key is changed, not a leak", async () => {
    root = makeTempRepo({ init: false, files: { [SECRET]: SECRET_TEXT } });
    const report = await checkCitations(
      { file: "docs/page.md", content: secretPage(encryptSourcePath(SECRET, KEY), OTHER) },
      { root, key: KEY, gitClient: noGit() },
    );
    expect(sourceStatuses(report)).toEqual(["changed"]);
    expect(JSON.stringify(report.findings)).not.toContain("SECRET");
  });

  it("refuses an encrypted source pinned with a plain hash, before anything is read", async () => {
    const report = await check("hmac-mismatch.md", { key: FIXTURE_KEY });
    expect(report.citations).toEqual([]);
    expect(report.findings.map((f) => [f.rule, f.line, f.message])).toEqual([
      [
        "entry-invalid",
        4,
        "fetch-timeout: an encrypted source is pinned with hmac-sha256-, not sha256-.",
      ],
    ]);
  });
});
