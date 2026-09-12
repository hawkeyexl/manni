/**
 * The citation tool's own reporters over hand-built runs.
 *
 * A citation is one row: its mark, its id, its claim end, its source end, and
 * where a manifest keeps it. Both ends read in file lines, the only lines a
 * person sees. Findings that are not an end print under the row; findings
 * about no entry print after the rows. json and github are pinned to the
 * output rule: a source is spelled as the page spelled it, and
 * `resolvedPath`, `diff`, `commitsSince` and a changed claim's current lines
 * reach output only through pretty under `--reveal` / `--show-diff`. The
 * sentinel test at the end is the rule stated as a test.
 */
import { describe, expect, it } from "vitest";
import { renderCheckGithub } from "../../src/cite/reporters/github.js";
import { renderCheckJson, renderUpdateJson } from "../../src/cite/reporters/json.js";
import {
  DIFF_LINE_CAP,
  renderCheckPretty,
  renderUpdatePretty,
  rewriteLine,
  splitBaselined,
} from "../../src/cite/reporters/pretty.js";
import type {
  CheckRun,
  CitationFinding,
  CitationResult,
  ClaimEnd,
  PageCitationReport,
  SourceEnd,
  UpdateRewrite,
  UpdateRun,
} from "../../src/cite/types.js";
import { toValidationResult } from "../../src/cite/core/adapt.js";
import type { RunSummary, ValidationResult } from "../../src/meta/index.js";

const PIN = "sha256-78af1d3321f9cbb177a7e4c958e39be56fd14cb93c1e441778bc4232e0fe4b1f";
const CLAIM_PIN = "sha256-921b21cccab21a4577f224ec4171aa56a3414bb3a5a4704ab8b6f314c46aa094";
const COMMIT = "3f9c2a1e7b0d4c5a6f8e9d0b1a2c3d4e5f607182";
/** Ciphertext-shaped: `~` and 84 base64url characters. Only its spelling matters here. */
const TOKEN = "~" + "AQx7Vb2_Kp-9Qm".repeat(6);
const SECRET = "private/SECRET.ts";
const KEY = "sentinel-key-0123456789abcdef012345";

/** A claim end at file line 12, body line 3. */
function claim(over: Partial<ClaimEnd> = {}): ClaimEnd {
  return { lines: "3", fileLines: "12", status: "current", ...over };
}

function sourceEnd(over: Partial<SourceEnd> = {}): SourceEnd {
  return { src: "lib/limits.ts:2", status: "current", ...over };
}

function citation(over: Partial<CitationResult> = {}): CitationResult {
  return {
    citation: {
      id: "fetch-timeout",
      claim: { lines: 3, integrity: CLAIM_PIN },
      source: { file: "lib/limits.ts", lines: 2, integrity: PIN },
    },
    origin: { kind: "frontmatter", file: "docs/limits.md", index: 0, line: 4 },
    anchor: "claim",
    anchorLine: 12,
    claim: claim(),
    source: sourceEnd(),
    ...over,
  };
}

function finding(over: Partial<CitationFinding> & { rule: CitationFinding["rule"] }): CitationFinding {
  return {
    ruleId: `manni:cite/${over.rule}`,
    severity: "error",
    message: over.rule,
    line: 12,
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
  const count = (severity: string): number =>
    results.reduce((n, r) => n + r.errors.filter((e) => e.severity === severity).length, 0);
  const errors = count("error");
  const warnings = count("warning");
  const notices = count("notice");
  const failed = results.filter((r) => !r.ok).length;
  const summary: RunSummary = {
    files: results.length,
    passed: results.length - failed,
    failed,
    errors,
    ...(warnings > 0 ? { warnings } : {}),
    ...(notices > 0 ? { notices } : {}),
  };
  return {
    results,
    summary,
    frame: { cwd: "/repo", base: "/repo" },
    pages,
    warnings,
    notices,
    ...over,
  };
}

const NO_COLOR = { color: false };

describe("renderCheckPretty: one citation, one row", () => {
  it("prints the ladder's clean rung: both ends current", () => {
    const run = runOf([page({ citations: [citation()] })]);
    expect(renderCheckPretty(run, NO_COLOR)).toBe(
      [
        "✓ docs/limits.md",
        "    ✓ fetch-timeout   :12 current   lib/limits.ts:2 current",
        "",
        "1 file checked, 1 passed, 0 failed, 0 findings",
      ].join("\n"),
    );
  });

  it("prints a moved claim as a notice, naming the line it moved to", () => {
    const run = runOf([
      page({
        citations: [
          citation({
            claim: claim({ status: "moved", newLines: "5", newFileLines: "14" }),
            anchorLine: 14,
          }),
        ],
        findings: [
          finding({
            rule: "claim-moved",
            severity: "notice",
            message: "fetch-timeout: the claim moved from line 12 to line 14.",
          }),
        ],
      }),
    ]);
    expect(renderCheckPretty(run, NO_COLOR)).toBe(
      [
        "ℹ docs/limits.md",
        "    ℹ fetch-timeout   :12 moved -> :14   lib/limits.ts:2 current",
        "",
        "1 file checked, 1 passed, 0 failed, 1 finding (1 notice)",
      ].join("\n"),
    );
  });

  it("prints every candidate of an ambiguous claim in file lines", () => {
    const run = runOf([
      page({
        citations: [
          citation({
            claim: claim({
              status: "moved-ambiguous",
              candidates: ["5", "9"],
              candidateFileLines: ["14", "18"],
            }),
          }),
        ],
        findings: [finding({ rule: "claim-moved-ambiguous", severity: "warning", message: "ambiguous" })],
      }),
    ]);
    expect(renderCheckPretty(run, NO_COLOR).split("\n")[1]).toBe(
      "    ↕ fetch-timeout   :12 moved, 2 candidates (:14, :18)   lib/limits.ts:2 current",
    );
  });

  it("prints a marker-anchored claim as `marker :<line>`", () => {
    const run = runOf([
      page({
        citations: [
          citation({
            citation: {
              id: "retries",
              claim: { integrity: CLAIM_PIN },
              source: { file: "lib/limits.ts", lines: 3, integrity: PIN },
            },
            anchor: "marker",
            markerLine: 30,
            anchorLine: 31,
            claim: { fileLines: "31", status: "current" },
            source: sourceEnd({ src: "lib/limits.ts:3" }),
          }),
        ],
      }),
    ]);
    expect(renderCheckPretty(run, NO_COLOR).split("\n")[1]).toBe(
      "    ✓ retries   marker :30 current   lib/limits.ts:3 current",
    );
  });

  it("leaves the claim column empty for a bare pin, and the id column for an id-less entry", () => {
    const run = runOf([
      page({
        citations: [
          citation({
            citation: { source: { file: "lib/limits.ts", integrity: PIN } },
            origin: { kind: "frontmatter", file: "docs/limits.md", index: 0, line: 4 },
            anchor: null,
            claim: null,
            source: sourceEnd({ src: "lib/limits.ts" }),
          }),
        ],
      }),
    ]);
    // Nothing is padded into either column, and the trailing run is trimmed.
    expect(renderCheckPretty(run, NO_COLOR).split("\n")[1]).toBe("    ✓       lib/limits.ts current");
  });

  it("prints a changed claim beside a current source, and the reverse", () => {
    const drifted = runOf([
      page({
        citations: [citation({ claim: claim({ status: "changed", text: ["The fetch timeout is 30 seconds."] }) })],
        findings: [finding({ rule: "claim-changed", severity: "warning", message: "changed" })],
      }),
    ]);
    expect(renderCheckPretty(drifted, NO_COLOR).split("\n")[1]).toBe(
      "    ↕ fetch-timeout   :12 changed   lib/limits.ts:2 current",
    );
    const stale = runOf([
      page({
        citations: [
          citation({
            source: sourceEnd({ status: "changed", commitSha: COMMIT, commitsSince: ["raise fetch timeout to 30s"] }),
          }),
        ],
        findings: [finding({ rule: "source-changed", message: "changed since 3f9c2a1, 1 commit" })],
      }),
    ]);
    expect(renderCheckPretty(stale, NO_COLOR).split("\n")[1]).toBe(
      "    ✗ fetch-timeout   :12 current   lib/limits.ts:2 changed since 3f9c2a1, 1 commit",
    );
  });

  it("says where a manifest keeps the entry, in its own column", () => {
    const run = runOf([
      page({
        citations: [
          citation({ origin: { kind: "manifest", file: "docs/citations.yaml", index: 0, line: 7 } }),
          citation({
            citation: { id: "retries", source: { file: "lib/limits.ts", lines: 3, integrity: PIN } },
            origin: { kind: "frontmatter", file: "docs/limits.md", index: 1, line: 9 },
            anchor: null,
            claim: null,
            source: sourceEnd({ src: "lib/limits.ts:3" }),
          }),
        ],
      }),
    ]);
    const rows = renderCheckPretty(run, NO_COLOR).split("\n").slice(1, 3);
    expect(rows).toEqual([
      "    ✓ fetch-timeout   :12 current   lib/limits.ts:2 current   docs/citations.yaml:7",
      "    ✓ retries                       lib/limits.ts:3 current",
    ]);
  });

  it("pads the columns to the widest row on the page", () => {
    const run = runOf([
      page({
        citations: [
          citation(),
          citation({
            citation: { id: "a", source: { file: "lib/a.ts", lines: 1, integrity: PIN } },
            origin: { kind: "frontmatter", file: "docs/limits.md", index: 1, line: 9 },
            claim: claim({ lines: "1", fileLines: "9" }),
            source: sourceEnd({ src: "lib/a.ts:1" }),
          }),
        ],
      }),
    ]);
    expect(renderCheckPretty(run, NO_COLOR).split("\n").slice(1, 3)).toEqual([
      "    ✓ fetch-timeout   :12 current   lib/limits.ts:2 current",
      "    ✓ a               :9 current    lib/a.ts:1 current",
    ]);
  });
});

describe("renderCheckPretty: findings that are not an end", () => {
  it("prints a finding about the entry as a line under its row", () => {
    const run = runOf([
      page({
        citations: [citation()],
        findings: [
          finding({
            rule: "marker-repeated",
            severity: "warning",
            message: "fetch-timeout is named by markers at lines 12 and 20; the first anchors it.",
            line: 20,
          }),
        ],
      }),
    ]);
    expect(renderCheckPretty(run, NO_COLOR)).toBe(
      [
        "⚠ docs/limits.md",
        "    ↕ fetch-timeout   :12 current   lib/limits.ts:2 current",
        "      ↕ fetch-timeout is named by markers at lines 12 and 20; the first anchors it.   (line 20)",
        "",
        "1 file checked, 1 passed, 0 failed, 1 finding (1 warning)",
      ].join("\n"),
    );
  });

  it("prints anchor-invalid, quote-drift and entry-invalid under the row they belong to", () => {
    const run = runOf([
      page({
        citations: [citation({ claim: claim({ status: "skipped" }) })],
        findings: [
          finding({ rule: "anchor-invalid", message: "fetch-timeout has claim lines and a marker. Keep one." }),
          finding({
            rule: "quote-drift",
            message: "quote: true, but the fenced block does not reproduce the cited lines",
          }),
        ],
      }),
    ]);
    expect(renderCheckPretty(run, NO_COLOR).split("\n").slice(1, 4)).toEqual([
      "    ✗ fetch-timeout   :12 skipped   lib/limits.ts:2 current",
      "      ✗ fetch-timeout has claim lines and a marker. Keep one.   (line 12)",
      "      ✗ quote: true, but the fenced block does not reproduce the cited lines   (line 12)",
    ]);
  });

  it("prints a finding about no entry after the rows, labelled by what it names", () => {
    const run = runOf([
      page({
        citations: [citation()],
        findings: [
          finding({ rule: "marker-orphan", message: 'no entry has id "gone"', id: "gone", src: undefined, index: undefined, line: 21 }),
          finding({
            rule: "marker-invalid",
            message: "A marker names an entry by id. Write the entry in frontmatter or the sidecar.",
            id: undefined,
            src: undefined,
            index: undefined,
            line: 25,
          }),
        ],
      }),
    ]);
    expect(renderCheckPretty(run, NO_COLOR)).toBe(
      [
        "✗ docs/limits.md",
        "    ✓ fetch-timeout   :12 current   lib/limits.ts:2 current",
        '    ✗ gone   no entry has id "gone"   (line 21)',
        "    ✗ page   A marker names an entry by id. Write the entry in frontmatter or the sidecar.   (line 25)",
        "",
        "1 file checked, 0 passed, 1 failed, 2 findings",
      ].join("\n"),
    );
  });
});

describe("renderCheckPretty: --show-diff and --reveal", () => {
  it("prints the source's subjects and diff only under showDiff", () => {
    const run = runOf([
      page({
        citations: [
          citation({
            source: sourceEnd({
              status: "changed",
              commitSha: COMMIT,
              commitsSince: ["raise fetch timeout to 30s"],
              diff: "-export const FETCH_TIMEOUT_MS = 10_000;\n+export const FETCH_TIMEOUT_MS = 30_000;\n",
            }),
          }),
        ],
        findings: [finding({ rule: "source-changed", message: "changed since 3f9c2a1, 1 commit" })],
      }),
    ]);
    expect(renderCheckPretty(run, NO_COLOR)).not.toContain("raise fetch timeout");
    expect(renderCheckPretty(run, { ...NO_COLOR, showDiff: true })).toBe(
      [
        "✗ docs/limits.md",
        "    ✗ fetch-timeout   :12 current   lib/limits.ts:2 changed since 3f9c2a1, 1 commit",
        "        raise fetch timeout to 30s",
        "        -export const FETCH_TIMEOUT_MS = 10_000;",
        "        +export const FETCH_TIMEOUT_MS = 30_000;",
        "",
        "1 file checked, 0 passed, 1 failed, 1 finding",
      ].join("\n"),
    );
  });

  it("prints a changed claim's current lines only under showDiff", () => {
    const run = runOf([
      page({
        citations: [
          citation({
            claim: claim({
              status: "changed",
              text: ["The fetch timeout is 30 seconds. It is", "not configurable."],
            }),
          }),
        ],
        findings: [finding({ rule: "claim-changed", severity: "warning", message: "changed" })],
      }),
    ]);
    expect(renderCheckPretty(run, NO_COLOR)).not.toContain("30 seconds");
    expect(renderCheckPretty(run, { ...NO_COLOR, showDiff: true }).split("\n").slice(1, 4)).toEqual([
      "    ↕ fetch-timeout   :12 changed   lib/limits.ts:2 current",
      "        The fetch timeout is 30 seconds. It is",
      "        not configurable.",
    ]);
  });

  it("caps the diff and says how much it left out", () => {
    const diff = Array.from({ length: DIFF_LINE_CAP + 5 }, (_, i) => `+line ${String(i)}`).join("\n");
    const run = runOf([
      page({
        citations: [citation({ source: sourceEnd({ status: "changed", diff }) })],
        findings: [finding({ rule: "source-changed", message: "changed" })],
      }),
    ]);
    const out = renderCheckPretty(run, { ...NO_COLOR, showDiff: true });
    expect(out).toContain(`+line ${String(DIFF_LINE_CAP - 1)}`);
    expect(out).not.toContain(`+line ${String(DIFF_LINE_CAP)}`);
    expect(out).toContain("… (5 more lines)");
  });

  it("abbreviates an encrypted source, and reveals its path only under reveal", () => {
    const run = runOf([
      page({
        citations: [
          citation({
            citation: {
              id: "fetch-timeout",
              source: { file: TOKEN, lines: 2, integrity: `hmac-${PIN}` },
            },
            claim: null,
            anchor: null,
            source: sourceEnd({ src: `${TOKEN}:2`, resolvedPath: "lib/limits.ts" }),
          }),
        ],
      }),
    ]);
    expect(renderCheckPretty(run, NO_COLOR).split("\n")[1]).toBe(
      "    ✓ fetch-timeout      ~AQx7…:2 current",
    );
    expect(renderCheckPretty(run, NO_COLOR)).not.toContain("lib/limits.ts");
    expect(renderCheckPretty(run, { ...NO_COLOR, reveal: true }).split("\n")[1]).toBe(
      "    ✓ fetch-timeout      ~AQx7…:2 (lib/limits.ts) current",
    );
  });

  it("does not repeat a plain path beside itself under reveal", () => {
    const run = runOf([page({ citations: [citation({ source: sourceEnd({ resolvedPath: "lib/limits.ts" }) })] })]);
    const out = renderCheckPretty(run, { ...NO_COLOR, reveal: true });
    expect(out).toContain("    ✓ fetch-timeout   :12 current   lib/limits.ts:2 current");
    expect(out).not.toContain("(lib/limits.ts)");
  });
});

describe("renderCheckPretty: quiet, baselines and colour", () => {
  it("hides current rows and clean files under quiet", () => {
    const run = runOf([
      page({ file: "docs/clean.md", citations: [citation()] }),
      page({
        citations: [
          citation({
            citation: { id: "a", source: { file: "lib/a.ts", lines: 1, integrity: PIN } },
            origin: { kind: "frontmatter", file: "docs/limits.md", index: 1, line: 9 },
            claim: null,
            anchor: null,
            source: sourceEnd({ src: "lib/a.ts:1" }),
          }),
          citation({
            origin: { kind: "frontmatter", file: "docs/limits.md", index: 2, line: 14 },
            source: sourceEnd({ status: "changed" }),
          }),
        ],
        findings: [finding({ rule: "source-changed", message: "changed", index: 2 })],
      }),
    ]);
    expect(renderCheckPretty(run, { ...NO_COLOR, quiet: true })).toBe(
      [
        "✗ docs/limits.md",
        "    ✗ fetch-timeout   :12 current   lib/limits.ts:2 changed",
        "",
        "2 files checked, 1 passed, 1 failed, 1 finding",
      ].join("\n"),
    );
  });

  it("dims a baselined finding, keeps the file passing, and counts it in the summary", () => {
    const p = page({
      citations: [citation({ source: sourceEnd({ status: "changed" }) })],
      findings: [finding({ rule: "source-changed", message: "changed" })],
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
      notices: 0,
    };
    expect(splitBaselined(p, forgiven)).toEqual({ reported: [], baselined: p.findings });
    expect(renderCheckPretty(run, NO_COLOR)).toBe(
      [
        "✓ docs/limits.md  (1 baselined)",
        "    · fetch-timeout   :12 current   lib/limits.ts:2 changed (baselined)",
        "",
        "1 file checked, 1 passed, 0 failed, 1 finding (1 baselined)",
      ].join("\n"),
    );
    expect(renderCheckGithub(run)).toBe("");
  });

  it("counts baselined findings without pluralising the word", () => {
    const p = page({
      citations: [
        citation({ source: sourceEnd({ status: "changed" }) }),
        citation({
          citation: { id: "a", source: { file: "lib/a.ts", lines: 1, integrity: PIN } },
          origin: { kind: "frontmatter", file: "docs/limits.md", index: 1, line: 9 },
          claim: claim({ lines: "1", fileLines: "9" }),
          source: sourceEnd({ src: "lib/a.ts:1", status: "changed" }),
        }),
      ],
      findings: [
        finding({ rule: "source-changed", message: "changed" }),
        finding({ rule: "source-changed", message: "changed", id: "a", src: "lib/a.ts:1", index: 1, line: 9 }),
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
      notices: 0,
    };
    const out = renderCheckPretty(run, NO_COLOR);
    expect(out).toContain("✓ docs/limits.md  (2 baselined)");
    expect(out).not.toContain("baselineds");
    expect(out).toContain("2 findings (2 baselined)");
  });

  it("names warnings and notices apart on the summary line", () => {
    const run = runOf([
      page({
        citations: [citation({ source: sourceEnd({ status: "changed" }) })],
        findings: [
          finding({ rule: "source-changed", message: "changed" }),
          finding({ rule: "claim-moved", severity: "notice", message: "the claim moved" }),
          finding({ rule: "marker-repeated", severity: "warning", message: "named twice" }),
        ],
      }),
    ]);
    const out = renderCheckPretty(run, NO_COLOR).split("\n");
    expect(out[0]).toBe("✗ docs/limits.md");
    expect(out.at(-1)).toBe("1 file checked, 0 passed, 1 failed, 3 findings (1 warning) (1 notice)");
  });

  it("colours the marks, the id column and the locations", () => {
    const run = runOf([
      page({
        citations: [citation({ source: sourceEnd({ status: "changed" }) })],
        findings: [
          finding({ rule: "source-changed", message: "changed" }),
          finding({ rule: "marker-repeated", severity: "warning", message: "named twice", line: 20 }),
        ],
      }),
    ]);
    const out = renderCheckPretty(run, { color: true });
    expect(out).toContain("[31m✗[39m docs/limits.md");
    expect(out).toContain("[36mfetch-timeout[39m");
    expect(out).toContain("[2m   (line 20)[22m");
  });
});

describe("renderCheckJson", () => {
  it("prints a citation as its two ends, spelling the source as the page did", () => {
    const run = runOf([
      page({
        citations: [
          citation({
            citation: {
              id: "fetch-timeout",
              claim: { lines: 3, integrity: CLAIM_PIN },
              source: { file: TOKEN, lines: 2, integrity: `hmac-${PIN}`, "commit-sha": COMMIT },
            },
            source: sourceEnd({
              src: `${TOKEN}:2`,
              status: "moved",
              newSrc: `${TOKEN}:4`,
              newLines: "4",
              commitSha: COMMIT,
              historyAvailable: true,
              resolvedPath: "lib/limits.ts",
              commitsSince: ["a subject"],
              diff: "-a\n+b\n",
            }),
          }),
        ],
        findings: [
          finding({
            rule: "source-moved",
            severity: "warning",
            message: `moved -> ${TOKEN}:4`,
            src: `${TOKEN}:2`,
            newSrc: `${TOKEN}:4`,
          }),
        ],
      }),
    ]);
    const parsed = JSON.parse(renderCheckJson(run)) as {
      summary: RunSummary;
      pages: { citations: Record<string, unknown>[]; findings: CitationFinding[] }[];
    };
    expect(parsed.summary).toEqual({ files: 1, passed: 1, failed: 0, errors: 0, warnings: 1 });
    const [c] = parsed.pages[0]?.citations ?? [];
    expect(c).toEqual({
      id: "fetch-timeout",
      origin: { kind: "frontmatter", file: "docs/limits.md", line: 4 },
      anchor: "claim",
      claim: { lines: "3", fileLines: "12", status: "current" },
      source: {
        src: `${TOKEN}:2`,
        status: "moved",
        newLines: "4",
        newSrc: `${TOKEN}:4`,
        commitSha: COMMIT,
        historyAvailable: true,
      },
    });
    // The entry itself is no longer printed, and neither is anything pretty-only.
    expect(c).not.toHaveProperty("citation");
    expect(c).not.toHaveProperty("resolvedPath");
    expect(JSON.stringify(c)).not.toContain("lib/limits.ts");
    expect(JSON.stringify(c)).not.toContain("a subject");
    expect(parsed.pages[0]?.findings[0]?.newSrc).toBe(`${TOKEN}:4`);
  });

  it("prints `claim: null` for a bare pin, and `anchor: null` with it", () => {
    const run = runOf([
      page({
        citations: [
          citation({
            citation: { source: { file: "lib/limits.ts", integrity: PIN } },
            anchor: null,
            claim: null,
            source: sourceEnd({ src: "lib/limits.ts" }),
          }),
        ],
      }),
    ]);
    const parsed = JSON.parse(renderCheckJson(run)) as { pages: { citations: Record<string, unknown>[] }[] };
    expect(parsed.pages[0]?.citations[0]).toEqual({
      origin: { kind: "frontmatter", file: "docs/limits.md", line: 4 },
      anchor: null,
      claim: null,
      source: { src: "lib/limits.ts", status: "current" },
    });
  });

  it("prints a claim's candidates and a moved claim's new lines", () => {
    const run = runOf([
      page({
        citations: [
          citation({
            claim: claim({
              status: "moved-ambiguous",
              candidates: ["5", "9"],
              candidateFileLines: ["14", "18"],
              text: ["never printed"],
            }),
          }),
        ],
      }),
    ]);
    const parsed = JSON.parse(renderCheckJson(run)) as { pages: { citations: { claim: unknown }[] }[] };
    expect(parsed.pages[0]?.citations[0]?.claim).toEqual({
      lines: "3",
      fileLines: "12",
      status: "moved-ambiguous",
      candidates: ["5", "9"],
    });
  });
});

describe("renderCheckGithub", () => {
  it("emits one workflow command per finding, titled by rule id", () => {
    const run = runOf([
      page({
        findings: [
          finding({ rule: "source-changed", message: "changed since 3f9c2a1, 1 commit", src: "lib/limits.ts:4" }),
          finding({ rule: "source-moved", severity: "warning", message: "moved -> lib/b.ts:2", line: undefined }),
          finding({ rule: "marker-invalid", message: "A marker names an entry by id.", id: undefined, src: undefined, index: undefined, line: 3 }),
        ],
      }),
    ]);
    expect(renderCheckGithub(run)).toBe(
      [
        "::error file=docs/limits.md,line=12,title=manni%3Acite/source-changed::fetch-timeout (lib/limits.ts:4): changed since 3f9c2a1, 1 commit",
        "::warning file=docs/limits.md,title=manni%3Acite/source-moved::fetch-timeout (lib/limits.ts:2): moved -> lib/b.ts:2",
        "::error file=docs/limits.md,line=3,title=manni%3Acite/marker-invalid::A marker names an entry by id.",
      ].join("\n"),
    );
  });

  it("does not name the subject twice when the message already opens with it", () => {
    const run = runOf([
      page({
        findings: [
          finding({
            rule: "claim-changed",
            severity: "warning",
            message: "fetch-timeout: the claim at line 12 has changed since it was pinned.",
          }),
          finding({
            rule: "marker-repeated",
            severity: "warning",
            message: "fetch-timeout is named by markers at lines 12 and 20; the first anchors it.",
            line: 20,
          }),
          finding({
            rule: "anchor-invalid",
            message: "fetch-timeout has claim lines and a marker. Keep one.",
          }),
        ],
      }),
    ]);
    expect(renderCheckGithub(run).split("\n")).toEqual([
      "::warning file=docs/limits.md,line=12,title=manni%3Acite/claim-changed::fetch-timeout: the claim at line 12 has changed since it was pinned.",
      "::warning file=docs/limits.md,line=20,title=manni%3Acite/marker-repeated::fetch-timeout is named by markers at lines 12 and 20; the first anchors it.",
      "::error file=docs/limits.md,line=12,title=manni%3Acite/anchor-invalid::fetch-timeout has claim lines and a marker. Keep one.",
    ]);
  });

  it("annotates a finding a manifest owns on the manifest", () => {
    const run = runOf([
      page({
        findings: [
          finding({ rule: "entry-invalid", message: "duplicate id \"fetch-timeout\"", file: "docs/citations.yaml", line: 7 }),
        ],
      }),
    ]);
    expect(renderCheckGithub(run)).toBe(
      '::error file=docs/citations.yaml,line=7,title=manni%3Acite/entry-invalid::fetch-timeout (lib/limits.ts:2): duplicate id "fetch-timeout"',
    );
  });

  it("names an id-less entry by its src once, and escapes the message", () => {
    const run = runOf([
      page({
        file: "docs/a,b.md",
        findings: [finding({ rule: "source-changed", message: "changed 100%\nsecond", id: undefined })],
      }),
    ]);
    expect(renderCheckGithub(run)).toBe(
      "::error file=docs/a%2Cb.md,line=12,title=manni%3Acite/source-changed::lib/limits.ts:2: changed 100%25%0Asecond",
    );
  });

  it("is empty on a clean run, and emits ::notice for a notice", () => {
    expect(renderCheckGithub(runOf([page({ citations: [citation()] })]))).toBe("");
    const run = runOf([
      page({ findings: [finding({ rule: "source-changed", severity: "notice", message: "changed" })] }),
    ]);
    expect(renderCheckGithub(run)).toBe(
      "::notice file=docs/limits.md,line=12,title=manni%3Acite/source-changed::fetch-timeout (lib/limits.ts:2): changed",
    );
  });
});

describe("rewriteLine", () => {
  const rewrite = (over: Partial<UpdateRewrite>): UpdateRewrite => ({
    id: "fetch-timeout",
    index: 0,
    line: 4,
    end: "claim",
    reason: "moved",
    status: "moved",
    from: "14",
    to: "16",
    ...over,
  });

  it("says a moved claim in lines, singular or plural", () => {
    expect(rewriteLine(rewrite({ id: "retries" }))).toBe("claim line 14 -> 16 (moved)");
    expect(rewriteLine(rewrite({ from: "14-15", to: "16-17" }))).toBe("claim lines 14-15 -> 16-17 (moved)");
  });

  it("says a moved source by its src, abbreviating an encrypted one", () => {
    expect(rewriteLine(rewrite({ end: "source", from: "lib/limits.ts:2", to: "lib/limits.ts:4" }))).toBe(
      "source lib/limits.ts:2 -> lib/limits.ts:4 (moved)",
    );
    expect(rewriteLine(rewrite({ end: "source", from: `${TOKEN}:2`, to: `${TOKEN}:4` }))).toBe(
      "source ~AQx7…:2 -> ~AQx7…:4 (moved)",
    );
  });

  it("quotes the text an accepted claim now pins", () => {
    expect(
      rewriteLine(
        rewrite({
          reason: "accepted",
          status: "changed",
          from: CLAIM_PIN,
          to: PIN,
          at: 9,
          text: "The fetch timeout is 30 seconds.",
        }),
      ),
    ).toBe('claim at line 9 re-pinned (changed; now "The fetch timeout is 30 seconds.")');
  });

  it("says an accepted source by its src, its commit and its pins, and spells never-true", () => {
    expect(
      rewriteLine(
        rewrite({
          end: "source",
          reason: "accepted",
          status: "changed",
          from: "sha256-11aa1234000000000000000000000000000000000000000000000000000000aa",
          to: "sha256-22bb5678000000000000000000000000000000000000000000000000000000bb",
          src: "lib/limits.ts:5",
          commitSha: "9b1e04c1a2b3c4d5e6f708192a3b4c5d6e7f8091",
        }),
      ),
    ).toBe("source lib/limits.ts:5 re-pinned at 9b1e04c (changed; sha256-11aa1234… -> sha256-22bb5678…)");
    expect(
      rewriteLine(
        rewrite({ end: "source", reason: "accepted", status: "never-true", from: PIN, to: PIN, src: "lib/limits.ts:5" }),
      ),
    ).toBe("source lib/limits.ts:5 re-pinned (never true; sha256-78af1d33… -> sha256-78af1d33…)");
  });
});

describe("update reporters", () => {
  const run: UpdateRun = {
    pages: [
      {
        file: "docs/limits.md",
        rewritten: [
          {
            id: "retries",
            index: 0,
            line: 4,
            end: "claim",
            reason: "moved",
            status: "moved",
            from: "14",
            to: "16",
          },
          {
            index: 1,
            line: 9,
            end: "source",
            reason: "accepted",
            status: "changed",
            from: "sha256-11aa1234000000000000000000000000000000000000000000000000000000aa",
            to: "sha256-22bb5678000000000000000000000000000000000000000000000000000000bb",
            src: "lib/limits.ts:5",
          },
        ],
        skipped: [finding({ rule: "source-missing", message: "missing", id: undefined, index: 2, src: "lib/gone.ts" })],
        diff: "--- docs/limits.md\n+++ docs/limits.md\n@@ -4,1 +4,1 @@\n-      lines: 14\n+      lines: 16\n",
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
        "docs/limits.md: retries claim line 14 -> 16 (moved)",
        "docs/limits.md: #1 source lib/limits.ts:5 re-pinned (changed; sha256-11aa1234… -> sha256-22bb5678…)",
        "docs/limits.md: #2  ✗ skipped: missing",
        "2 citations rewritten in 1 file, 1 skipped",
      ].join("\n"),
    );
  });

  it("prints the diffs first under showDiff", () => {
    const out = renderUpdatePretty(run, { ...NO_COLOR, showDiff: true });
    expect(out.split("\n").slice(0, 2)).toEqual(["--- docs/limits.md", "+++ docs/limits.md"]);
    expect(out).toContain("+      lines: 16");
  });

  it("marks a skipped finding by its severity: ✗, ↕, ℹ", () => {
    const skipped: UpdateRun = {
      pages: [
        {
          file: "docs/limits.md",
          rewritten: [],
          skipped: [
            finding({ rule: "source-changed", message: "changed" }),
            finding({ rule: "claim-moved-ambiguous", severity: "warning", message: "ambiguous" }),
            finding({ rule: "claim-moved", severity: "notice", message: "the claim moved" }),
          ],
          diff: "",
          written: false,
        },
      ],
      rewritten: 0,
      skipped: 3,
      exitCode: 1,
    };
    expect(renderUpdatePretty(skipped, NO_COLOR).split("\n")).toEqual([
      "docs/limits.md: fetch-timeout  ✗ skipped: changed",
      "docs/limits.md: fetch-timeout  ↕ skipped: ambiguous",
      "docs/limits.md: fetch-timeout  ℹ skipped: the claim moved",
      "0 citations rewritten in 0 files, 3 skipped",
    ]);
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
          citation: {
            id: "fetch-timeout",
            claim: { lines: 3, integrity: CLAIM_PIN },
            source: { file: TOKEN, lines: 2, integrity: `hmac-${PIN}` },
          },
          claim: claim({ status: "changed", text: [`the line from ${SECRET}`] }),
          source: sourceEnd({
            src: `${TOKEN}:2`,
            status: "changed",
            resolvedPath: SECRET,
            commitsSince: [`touch ${SECRET}`],
            diff: `--- a/${SECRET}\n+++ b/${SECRET}\n`,
          }),
        }),
      ],
      findings: [finding({ rule: "source-changed", message: "changed", src: `${TOKEN}:2` })],
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
    }
    expect(renderCheckJson(sentinel)).toContain(TOKEN);
  });

  it("prints the resolved path only under reveal, and the diff only under showDiff", () => {
    expect(renderCheckPretty(sentinel, { ...NO_COLOR, reveal: true })).toContain(`~AQx7…:2 (${SECRET})`);
    expect(renderCheckPretty(sentinel, { ...NO_COLOR, reveal: true })).not.toContain("--- a/");
    expect(renderCheckPretty(sentinel, { ...NO_COLOR, showDiff: true })).toContain(`--- a/${SECRET}`);
  });
});
