/**
 * The citation tool's own reporters over hand-built runs. The pretty shapes
 * follow the plan's ladder; json and github are pinned to the output rule:
 * a source is spelled as the page spelled it, and `resolvedPath`, `diff`
 * and `commitsSince` reach output only through pretty under `--reveal` /
 * `--show-diff`. The sentinel test at the end is the rule stated as a test.
 */
import { describe, expect, it } from "vitest";
import { renderCheckGithub } from "../../src/cite/reporters/github.js";
import { renderCheckJson, renderUpdateJson } from "../../src/cite/reporters/json.js";
import {
  DIFF_LINE_CAP,
  renderCheckPretty,
  renderUpdatePretty,
  splitBaselined,
} from "../../src/cite/reporters/pretty.js";
import type {
  CheckRun,
  CitationFinding,
  CitationResult,
  PageCitationReport,
  UpdateRun,
} from "../../src/cite/types.js";
import { toValidationResult } from "../../src/cite/core/adapt.js";
import type { RunSummary, ValidationResult } from "../../src/meta/index.js";

const PIN = "sha256-78af1d3321f9cbb177a7e4c958e39be56fd14cb93c1e441778bc4232e0fe4b1f";
const COMMIT = "3f9c2a1e7b0d4c5a6f8e9d0b1a2c3d4e5f607182";
/** Ciphertext-shaped: `~` and 84 base64url characters. Only its spelling matters here. */
const TOKEN = "~" + "AQx7Vb2_Kp-9Qm".repeat(6);
const SECRET = "private/SECRET.ts";
const KEY = "sentinel-key-0123456789abcdef012345";

function citation(over: Partial<CitationResult> & { status: CitationResult["status"] }): CitationResult {
  return {
    citation: { id: "fetch-timeout", src: "lib/limits.ts:2", integrity: PIN },
    origin: { kind: "frontmatter", index: 0, line: 4, anchorLine: 9 },
    ...over,
  };
}

function finding(over: Partial<CitationFinding> & { rule: CitationFinding["rule"] }): CitationFinding {
  return {
    ruleId: `manni:cite/${over.rule}`,
    severity: "error",
    message: over.rule,
    line: 9,
    id: "fetch-timeout",
    src: "lib/limits.ts:2",
    index: 0,
    ...over,
  };
}

function page(over: Partial<PageCitationReport> = {}): PageCitationReport {
  return {
    file: "docs/limits.md",
    format: "markdown",
    citations: [],
    findings: [],
    notices: [],
    ...over,
  };
}

/** A run whose adapted results and summary are derived the way the core derives them. */
function runOf(pages: PageCitationReport[], over: Partial<CheckRun> = {}): CheckRun {
  const results = pages.map(toValidationResult);
  const errors = results.reduce(
    (n, r) => n + r.errors.filter((e) => e.severity !== "warning").length,
    0,
  );
  const warnings = results.reduce(
    (n, r) => n + r.errors.filter((e) => e.severity === "warning").length,
    0,
  );
  const failed = results.filter((r) => !r.ok).length;
  const summary: RunSummary = {
    files: results.length,
    passed: results.length - failed,
    failed,
    errors,
    ...(warnings > 0 ? { warnings } : {}),
  };
  return {
    results,
    summary,
    frame: { cwd: "/repo", base: "/repo" },
    pages,
    warnings,
    ...over,
  };
}

const NO_COLOR = { color: false };

describe("renderCheckPretty", () => {
  it("prints the ladder's clean rung", () => {
    const run = runOf([page({ citations: [citation({ status: "current" })] })]);
    expect(renderCheckPretty(run, NO_COLOR)).toBe(
      [
        "✓ docs/limits.md",
        "    ✓ fetch-timeout   lib/limits.ts:2   current",
        "",
        "1 file checked, 1 passed, 0 failed, 0 findings",
      ].join("\n"),
    );
  });

  it("prints a moved warning under ⚠ with the new src and the line", () => {
    const run = runOf([
      page({
        citations: [citation({ status: "moved", newSrc: "lib/limits.ts:4" })],
        findings: [
          finding({ rule: "moved", severity: "warning", message: "moved -> lib/limits.ts:4", newSrc: "lib/limits.ts:4" }),
        ],
      }),
    ]);
    expect(renderCheckPretty(run, NO_COLOR)).toBe(
      [
        "⚠ docs/limits.md",
        "    ↕ fetch-timeout   lib/limits.ts:2   moved -> lib/limits.ts:4   (line 9)",
        "",
        "1 file checked, 1 passed, 0 failed, 1 finding (1 warning)",
      ].join("\n"),
    );
  });

  it("prints a changed error under ✗, with subjects and diff only under showDiff", () => {
    const run = runOf([
      page({
        citations: [
          citation({
            status: "changed",
            commit: COMMIT,
            commitsSince: ["raise fetch timeout to 30s"],
            diff: "-export const FETCH_TIMEOUT_MS = 10_000;\n+export const FETCH_TIMEOUT_MS = 30_000;\n",
          }),
        ],
        findings: [finding({ rule: "changed", message: "changed since 3f9c2a1, 1 commit" })],
      }),
    ]);
    const plain = renderCheckPretty(run, NO_COLOR);
    expect(plain).toBe(
      [
        "✗ docs/limits.md",
        "    ✗ fetch-timeout   lib/limits.ts:2   changed since 3f9c2a1, 1 commit   (line 9)",
        "",
        "1 file checked, 0 passed, 1 failed, 1 finding",
      ].join("\n"),
    );
    expect(plain).not.toContain("raise fetch timeout");

    expect(renderCheckPretty(run, { ...NO_COLOR, showDiff: true })).toBe(
      [
        "✗ docs/limits.md",
        "    ✗ fetch-timeout   lib/limits.ts:2   changed since 3f9c2a1, 1 commit   (line 9)",
        "        raise fetch timeout to 30s",
        "        -export const FETCH_TIMEOUT_MS = 10_000;",
        "        +export const FETCH_TIMEOUT_MS = 30_000;",
        "",
        "1 file checked, 0 passed, 1 failed, 1 finding",
      ].join("\n"),
    );
  });

  it("caps the diff and says how much it left out", () => {
    const diff = Array.from({ length: DIFF_LINE_CAP + 5 }, (_, i) => `+line ${String(i)}`).join("\n");
    const run = runOf([
      page({
        citations: [citation({ status: "changed", diff })],
        findings: [finding({ rule: "changed", message: "changed" })],
      }),
    ]);
    const out = renderCheckPretty(run, { ...NO_COLOR, showDiff: true });
    expect(out).toContain(`+line ${String(DIFF_LINE_CAP - 1)}`);
    expect(out).not.toContain(`+line ${String(DIFF_LINE_CAP)}`);
    expect(out).toContain("… (5 more lines)");
  });

  it("marks a skipped source with · and reports no finding", () => {
    const run = runOf([
      page({ citations: [citation({ status: "skipped", citation: { src: `${TOKEN}:2`, integrity: PIN, id: "fetch-timeout" } })] }),
    ]);
    expect(renderCheckPretty(run, NO_COLOR)).toContain(`    · fetch-timeout   ${TOKEN}:2   skipped`);
  });

  it("reveals the decrypted path beside an encrypted source only under reveal", () => {
    const run = runOf([
      page({
        citations: [
          citation({
            status: "current",
            citation: { src: `${TOKEN}:2`, integrity: PIN, id: "fetch-timeout" },
            resolvedPath: "lib/limits.ts",
          }),
        ],
      }),
    ]);
    expect(renderCheckPretty(run, NO_COLOR)).not.toContain("lib/limits.ts");
    expect(renderCheckPretty(run, { ...NO_COLOR, reveal: true })).toContain(
      `    ✓ fetch-timeout   ${TOKEN}:2 (lib/limits.ts)   current`,
    );
  });

  it("does not repeat a plain path beside itself under reveal", () => {
    const run = runOf([
      page({ citations: [citation({ status: "current", resolvedPath: "lib/limits.ts" })] }),
    ]);
    expect(renderCheckPretty(run, { ...NO_COLOR, reveal: true })).toContain(
      "    ✓ fetch-timeout   lib/limits.ts:2   current",
    );
    expect(renderCheckPretty(run, { ...NO_COLOR, reveal: true })).not.toContain("(lib/limits.ts)");
  });

  it("labels an id-less frontmatter entry by index and an inline one as inline", () => {
    const run = runOf([
      page({
        citations: [
          citation({ status: "current", citation: { src: "lib/limits.ts", integrity: PIN }, origin: { kind: "frontmatter", index: 1 } }),
          citation({ status: "current", citation: { src: "lib/limits.ts:1", integrity: PIN }, origin: { kind: "inline", line: 21 } }),
        ],
      }),
    ]);
    const out = renderCheckPretty(run, NO_COLOR);
    expect(out).toContain("    ✓ #1   lib/limits.ts   current");
    expect(out).toContain("    ✓ inline   lib/limits.ts:1   current");
  });

  it("prints page-side findings as rows of their own", () => {
    const run = runOf([
      page({
        findings: [
          finding({ rule: "statement-orphan", message: "statement references no entry", id: "gone", src: undefined, index: undefined, line: 12 }),
          finding({ rule: "claim-ambiguous", severity: "warning", message: "claim occurs 2 times", line: 30 }),
        ],
      }),
    ]);
    expect(renderCheckPretty(run, NO_COLOR)).toBe(
      [
        "✗ docs/limits.md",
        "    ✗ gone   statement references no entry   (line 12)",
        "    ↕ fetch-timeout   claim occurs 2 times   (line 30)",
        "",
        "1 file checked, 0 passed, 1 failed, 2 findings (1 warning)",
      ].join("\n"),
    );
  });

  it("hides current rows and clean files under quiet", () => {
    const run = runOf([
      page({ file: "docs/clean.md", citations: [citation({ status: "current" })] }),
      page({
        citations: [
          citation({ status: "current", citation: { src: "lib/a.ts:1", integrity: PIN, id: "a" }, origin: { kind: "frontmatter", index: 0 } }),
          citation({ status: "changed", origin: { kind: "frontmatter", index: 1, anchorLine: 9 } }),
        ],
        findings: [finding({ rule: "changed", message: "changed", index: 1 })],
      }),
    ]);
    expect(renderCheckPretty(run, { ...NO_COLOR, quiet: true })).toBe(
      [
        "✗ docs/limits.md",
        "    ✗ fetch-timeout   lib/limits.ts:2   changed   (line 9)",
        "",
        "2 files checked, 1 passed, 1 failed, 1 finding",
      ].join("\n"),
    );
  });

  it("dims a baselined finding, keeps the file passing, and counts it in the summary", () => {
    const p = page({
      citations: [citation({ status: "changed" })],
      findings: [finding({ rule: "changed", message: "changed" })],
    });
    // What the baseline ratchet leaves behind: the error gone from the adapted
    // result, its count on `baselined`, the file passing.
    const forgiven: ValidationResult = { ...toValidationResult(p), ok: true, errors: [], baselined: 1 };
    const run: CheckRun = {
      results: [forgiven],
      summary: {
        files: 1,
        passed: 1,
        failed: 0,
        errors: 0,
        baseline: { path: ".manni-cite-baseline.json", written: false, recorded: 1, suppressed: 1, stale: 0 },
      },
      frame: { cwd: "/repo", base: "/repo" },
      pages: [p],
      warnings: 0,
    };
    expect(splitBaselined(p, forgiven)).toEqual({ reported: [], baselined: p.findings });
    expect(renderCheckPretty(run, NO_COLOR)).toBe(
      [
        "✓ docs/limits.md  (1 baselined)",
        "    · fetch-timeout   lib/limits.ts:2   changed (baselined)   (line 9)",
        "",
        "1 file checked, 1 passed, 0 failed, 1 finding (1 baselined)",
      ].join("\n"),
    );
    expect(renderCheckGithub(run)).toBe("");
  });

  it("counts baselined findings without pluralising the word", () => {
    const p = page({
      citations: [
        citation({ status: "changed", origin: { kind: "frontmatter", index: 0, anchorLine: 9 } }),
        citation({ status: "changed", citation: { src: "lib/a.ts:1", integrity: PIN, id: "a" }, origin: { kind: "frontmatter", index: 1, anchorLine: 12 } }),
      ],
      findings: [
        finding({ rule: "changed", message: "changed" }),
        finding({ rule: "changed", message: "changed", id: "a", src: "lib/a.ts:1", index: 1, line: 12 }),
      ],
    });
    const forgiven: ValidationResult = { ...toValidationResult(p), ok: true, errors: [], baselined: 2 };
    const run: CheckRun = {
      results: [forgiven],
      summary: {
        files: 1,
        passed: 1,
        failed: 0,
        errors: 0,
        baseline: { path: ".manni-cite-baseline.json", written: false, recorded: 2, suppressed: 2, stale: 0 },
      },
      frame: { cwd: "/repo", base: "/repo" },
      pages: [p],
      warnings: 0,
    };
    const out = renderCheckPretty(run, NO_COLOR);
    expect(out).toContain("✓ docs/limits.md  (2 baselined)");
    expect(out).not.toContain("baselineds");
    expect(out).toContain("2 findings (2 baselined)");
  });

  it("colours the marks, the id column and the locations", () => {
    const run = runOf([
      page({
        citations: [citation({ status: "changed" })],
        findings: [finding({ rule: "changed", message: "changed" })],
      }),
    ]);
    const out = renderCheckPretty(run, { color: true });
    expect(out).toContain("[31m✗[39m docs/limits.md");
    expect(out).toContain("[36mfetch-timeout[39m");
    expect(out).toContain("[2m   (line 9)[22m");
  });
});

describe("renderCheckJson", () => {
  it("serializes summary and pages, spelling sources as the page did", () => {
    const run = runOf([
      page({
        citations: [
          citation({
            status: "moved",
            citation: { src: `${TOKEN}:2`, integrity: PIN, id: "fetch-timeout" },
            newSrc: `${TOKEN}:4`,
            resolvedPath: "lib/limits.ts",
            commitsSince: ["a subject"],
            diff: "-a\n+b\n",
          }),
        ],
        findings: [finding({ rule: "moved", severity: "warning", message: `moved -> ${TOKEN}:4`, src: `${TOKEN}:2`, newSrc: `${TOKEN}:4` })],
      }),
    ]);
    const parsed = JSON.parse(renderCheckJson(run)) as {
      summary: RunSummary;
      pages: { citations: Record<string, unknown>[]; findings: CitationFinding[] }[];
    };
    expect(parsed.summary).toEqual({ files: 1, passed: 1, failed: 0, errors: 0, warnings: 1 });
    const [c] = parsed.pages[0]?.citations ?? [];
    expect(c).toEqual({
      citation: { src: `${TOKEN}:2`, integrity: PIN, id: "fetch-timeout" },
      origin: { kind: "frontmatter", index: 0, line: 4, anchorLine: 9 },
      status: "moved",
      newSrc: `${TOKEN}:4`,
    });
    expect(c).not.toHaveProperty("resolvedPath");
    expect(c).not.toHaveProperty("diff");
    expect(c).not.toHaveProperty("commitsSince");
    expect(parsed.pages[0]?.findings[0]?.newSrc).toBe(`${TOKEN}:4`);
  });
});

describe("renderCheckGithub", () => {
  it("emits one workflow command per finding, titled by rule id", () => {
    const run = runOf([
      page({
        findings: [
          finding({ rule: "changed", message: "changed since 3f9c2a1, 1 commit", src: "lib/limits.ts:4" }),
          finding({ rule: "moved", severity: "warning", message: "moved -> lib/b.ts:2", line: undefined }),
          finding({ rule: "statement-orphan", message: "no entry", id: undefined, src: undefined, index: undefined, line: 3 }),
        ],
      }),
    ]);
    expect(renderCheckGithub(run)).toBe(
      [
        "::error file=docs/limits.md,line=9,title=manni%3Acite/changed::fetch-timeout (lib/limits.ts:4): changed since 3f9c2a1, 1 commit",
        "::warning file=docs/limits.md,title=manni%3Acite/moved::fetch-timeout (lib/limits.ts:2): moved -> lib/b.ts:2",
        "::error file=docs/limits.md,line=3,title=manni%3Acite/statement-orphan::no entry",
      ].join("\n"),
    );
  });

  it("names an id-less entry by its src once, and escapes the message", () => {
    const run = runOf([
      page({
        file: "docs/a,b.md",
        findings: [finding({ rule: "changed", message: "changed 100%\nsecond", id: undefined })],
      }),
    ]);
    expect(renderCheckGithub(run)).toBe(
      "::error file=docs/a%2Cb.md,line=9,title=manni%3Acite/changed::lib/limits.ts:2: changed 100%25%0Asecond",
    );
  });

  it("is empty on a clean run", () => {
    expect(renderCheckGithub(runOf([page({ citations: [citation({ status: "current" })] })]))).toBe("");
  });
});

describe("update reporters", () => {
  const run: UpdateRun = {
    pages: [
      {
        file: "docs/limits.md",
        rewritten: [
          { id: "fetch-timeout", index: 0, line: 4, from: "lib/limits.ts:2", to: "lib/limits.ts:4", reason: "moved" },
          { index: 1, from: "sha256-78af1d33…", to: "sha256-1c4e…", reason: "accepted" },
        ],
        skipped: [finding({ rule: "missing", message: "missing", id: undefined, index: 2, src: "lib/gone.ts" })],
        diff: "--- docs/limits.md\n+++ docs/limits.md\n@@ -4,1 +4,1 @@\n-    src: lib/limits.ts:2\n+    src: lib/limits.ts:4\n",
        written: true,
      },
      { file: "docs/other.md", rewritten: [], skipped: [], diff: "", written: false },
    ],
    rewritten: 2,
    skipped: 1,
    exitCode: 1,
  };

  it("prints one line per rewrite and per skip, then the summary", () => {
    expect(renderUpdatePretty(run, NO_COLOR)).toBe(
      [
        "docs/limits.md: fetch-timeout  lib/limits.ts:2 -> lib/limits.ts:4  (moved)",
        "docs/limits.md: #1  sha256-78af1d33… -> sha256-1c4e…  (accepted)",
        "docs/limits.md: #2  ✗ skipped: missing",
        "2 citations rewritten in 1 file, 1 skipped",
      ].join("\n"),
    );
  });

  it("prints the diffs first under showDiff", () => {
    const out = renderUpdatePretty(run, { ...NO_COLOR, showDiff: true });
    expect(out.split("\n").slice(0, 2)).toEqual(["--- docs/limits.md", "+++ docs/limits.md"]);
    expect(out).toContain("+    src: lib/limits.ts:4");
  });

  it("serializes the run as is", () => {
    expect(JSON.parse(renderUpdateJson(run))).toEqual(run);
  });
});

describe("the output rule", () => {
  const sentinel = runOf([
    page({
      citations: [
        citation({
          status: "changed",
          citation: { src: `${TOKEN}:2`, integrity: PIN, id: "fetch-timeout" },
          resolvedPath: SECRET,
          commitsSince: [`touch ${SECRET}`],
          diff: `--- a/${SECRET}\n+++ b/${SECRET}\n`,
        }),
      ],
      findings: [finding({ rule: "changed", message: "changed", src: `${TOKEN}:2` })],
    }),
  ]);

  it("never prints the decrypted path, the diff or the key in json, github or plain pretty", () => {
    for (const text of [
      renderCheckJson(sentinel),
      renderCheckGithub(sentinel),
      renderCheckPretty(sentinel, NO_COLOR),
      renderCheckPretty(sentinel, { ...NO_COLOR, showDiff: false, reveal: false }),
    ]) {
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain(KEY);
      expect(text).toContain(TOKEN);
    }
  });

  it("prints the resolved path only under reveal, and the diff only under showDiff", () => {
    expect(renderCheckPretty(sentinel, { ...NO_COLOR, reveal: true })).toContain(`${TOKEN}:2 (${SECRET})`);
    expect(renderCheckPretty(sentinel, { ...NO_COLOR, reveal: true })).not.toContain("--- a/");
    expect(renderCheckPretty(sentinel, { ...NO_COLOR, showDiff: true })).toContain(`--- a/${SECRET}`);
  });
});
