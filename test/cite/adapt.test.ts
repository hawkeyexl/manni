/**
 * Findings and their meta adapter. Messages are spelled from the page's own
 * `src`; the FieldError identity (schema, keyword, instancePath, subject) is
 * what the baseline fingerprint and the SARIF rule id are built from, so both
 * are pinned here to survive a move and a line shift.
 */
import { describe, expect, it } from "vitest";
import { findingsFor, messageFor, toValidationResult } from "../../src/cite/core/adapt.js";
import { DEFAULT_SEVERITY, resolveSeverity } from "../../src/cite/core/severity.js";
import type {
  CitationFinding,
  CitationResult,
  MissingReason,
  PageCitationReport,
} from "../../src/cite/types.js";
import { fingerprint, ruleIdFor } from "../../src/meta/internal.js";
import type { FieldError } from "../../src/meta/index.js";

const PIN = "sha256-78af1d3321f9cbb177a7e4c958e39be56fd14cb93c1e441778bc4232e0fe4b1f";
const COMMIT = "3f9c2a1e7b0d4c5a6f8e9d0b1a2c3d4e5f607182";
/** Ciphertext-shaped: `~` and 84 base64url characters. Only its spelling matters here. */
const TOKEN = "~" + "AQx7Vb2_Kp-9Qm".repeat(6);

function result(over: Partial<CitationResult> & { status: CitationResult["status"] }): CitationResult {
  return {
    citation: { id: "fetch-timeout", src: "lib/limits.ts:2", integrity: PIN },
    origin: { kind: "frontmatter", index: 0, line: 4, anchorLine: 9 },
    resolvedPath: "lib/limits.ts",
    ...over,
  };
}

describe("messageFor", () => {
  it("spells each status per the plan's table", () => {
    expect(messageFor(result({ status: "current" }))).toBe("current");
    expect(messageFor(result({ status: "moved", newSrc: "lib/limits.ts:4" }))).toBe("moved -> lib/limits.ts:4");
    expect(
      messageFor(result({ status: "moved-ambiguous", candidates: ["lib/limits.ts:4", "lib/limits.ts:11"] })),
    ).toBe("moved, 2 candidates (lib/limits.ts:4, lib/limits.ts:11); widen the range");
    expect(messageFor(result({ status: "changed" }))).toBe("changed");
    expect(messageFor(result({ status: "changed", commit: COMMIT }))).toBe("changed since 3f9c2a1");
    expect(
      messageFor(result({ status: "changed", commit: COMMIT, historyAvailable: true, commitsSince: ["a", "b"] })),
    ).toBe("changed since 3f9c2a1, 2 commits");
    expect(
      messageFor(result({ status: "changed", commit: COMMIT, historyAvailable: true, commitsSince: ["a"] })),
    ).toBe("changed since 3f9c2a1, 1 commit");
    expect(
      messageFor(result({ status: "changed", commit: COMMIT, historyAvailable: true, commitsSince: [] })),
    ).toBe("changed since 3f9c2a1, 0 commits");
    expect(messageFor(result({ status: "changed", commit: COMMIT, historyAvailable: false }))).toBe(
      "changed (history unavailable: commit 3f9c2a1 not found; fetch-depth: 0)",
    );
    expect(messageFor(result({ status: "never-true", commit: COMMIT }))).toBe(
      "never true: the pin does not match at 3f9c2a1",
    );
    expect(messageFor(result({ status: "missing" }))).toBe("missing");
    expect(messageFor(result({ status: "skipped" }))).toBe("skipped");
  });

  it("says why an encrypted source is missing, and never which path", () => {
    const missing = (reason: MissingReason, src = `${TOKEN}:2`): string => {
      const r = result({ status: "missing", citation: { src, integrity: PIN }, missingReason: reason });
      delete r.resolvedPath;
      return messageFor(r);
    };
    expect(missing("no-key")).toBe("missing (no encryption key is available to decrypt it)");
    expect(missing("undecryptable")).toBe("missing (does not decrypt under the current key)");
    expect(missing("untracked")).toBe("missing (no tracked file matches; wrong --root?)");
    expect(missing("unreadable")).toBe("missing");
    // A plain path names its file already; the bare status says the rest.
    expect(missing("untracked", "lib/limits.ts:2")).toBe("missing");
  });

  it("never spells the resolved path", () => {
    const moved = result({
      status: "moved",
      citation: { src: `${TOKEN}:2`, integrity: PIN },
      newSrc: `${TOKEN}:4`,
      resolvedPath: "private/SECRET.ts",
      commitsSince: ["touch private/SECRET.ts"],
      diff: "--- private/SECRET.ts",
    });
    expect(messageFor(moved)).toBe(`moved -> ${TOKEN}:4`);
    const changed = { ...moved, status: "changed" as const, commit: COMMIT, historyAvailable: true };
    expect(messageFor(changed)).not.toContain("SECRET");
  });
});

describe("findingsFor", () => {
  const severity = resolveSeverity();

  it("produces one finding per result whose rule is on, at the anchor line", () => {
    const results = [
      result({ status: "current" }),
      result({ status: "moved", newSrc: "lib/limits.ts:4" }),
      result({
        status: "changed",
        citation: { src: "lib/limits.ts:3", integrity: PIN },
        origin: { kind: "inline", line: 12 },
      }),
      result({ status: "skipped", origin: { kind: "frontmatter", index: 2 } }),
    ];
    const findings = findingsFor(results, severity);
    expect(findings).toEqual([
      {
        rule: "moved",
        ruleId: "manni:cite/moved",
        severity: "warning",
        message: "moved -> lib/limits.ts:4",
        line: 9,
        id: "fetch-timeout",
        src: "lib/limits.ts:2",
        newSrc: "lib/limits.ts:4",
        index: 0,
      },
      {
        rule: "changed",
        ruleId: "manni:cite/changed",
        severity: "error",
        message: "changed",
        line: 12,
        src: "lib/limits.ts:3",
      },
    ]);
  });

  it("falls back to the entry line when nothing anchors it, and omits it when unknown", () => {
    const [unanchored] = findingsFor(
      [result({ status: "missing", origin: { kind: "frontmatter", index: 1, line: 5 } })],
      severity,
    );
    expect(unanchored?.line).toBe(5);
    const [unknown] = findingsFor(
      [result({ status: "missing", origin: { kind: "frontmatter", index: 1 } })],
      severity,
    );
    expect(unknown).toBeDefined();
    expect(unknown).not.toHaveProperty("line");
  });

  it("honours the severity table: off drops, and a rule can move either way", () => {
    const results = [result({ status: "current" }), result({ status: "moved", newSrc: "x:1" }), result({ status: "changed" })];
    const findings = findingsFor(results, resolveSeverity({ current: "warning", moved: "off", changed: "warning" }));
    expect(findings.map((f) => [f.rule, f.severity])).toEqual([
      ["current", "warning"],
      ["changed", "warning"],
    ]);
    expect(DEFAULT_SEVERITY.current).toBe("off");
  });
});

function report(findings: CitationFinding[], citations: CitationResult[] = []): PageCitationReport {
  return { file: "docs/limits.md", format: "markdown", citations, findings, notices: [] };
}

describe("toValidationResult", () => {
  const results = [
    result({ status: "moved", newSrc: "lib/limits.ts:4" }),
    result({
      status: "changed",
      citation: { src: "lib/limits.ts:3", integrity: "sha256-" + "3".repeat(64) },
      origin: { kind: "inline", line: 12, anchorLine: 13 },
    }),
  ];
  const findings = findingsFor(results, resolveSeverity());

  it("maps findings to FieldErrors under the manni:cite schema", () => {
    const out = toValidationResult(report(findings, results));
    expect(out.file).toBe("docs/limits.md");
    expect(out.format).toBe("markdown");
    expect(out.schemas).toEqual(["manni:cite"]);
    expect(out.ok).toBe(false);
    expect(out.errors).toEqual([
      {
        schema: "manni:cite",
        instancePath: "/citations/0",
        message: "moved -> lib/limits.ts:4",
        keyword: "moved",
        subject: "fetch-timeout",
        line: 9,
        severity: "warning",
      },
      {
        schema: "manni:cite",
        instancePath: "",
        message: "changed",
        keyword: "changed",
        subject: "sha256-" + "3".repeat(64),
        line: 13,
        severity: "error",
      },
    ]);
  });

  it("is ok when every finding is a warning, and when there are none", () => {
    const warnings = findings.map((f) => ({ ...f, severity: "warning" as const }));
    expect(toValidationResult(report(warnings, results)).ok).toBe(true);
    expect(toValidationResult(report([])).ok).toBe(true);
    expect(toValidationResult(report([])).errors).toEqual([]);
  });

  it("carries a page-side finding with no result: subject is the id when there is one", () => {
    const pageSide: CitationFinding = {
      rule: "entry-invalid",
      ruleId: "manni:cite/entry-invalid",
      severity: "error",
      message: "must have required property 'integrity'",
      line: 4,
      index: 0,
      id: "fetch-timeout",
    };
    const anonymous: CitationFinding = {
      rule: "statement-invalid",
      ruleId: "manni:cite/statement-invalid",
      severity: "error",
      message: "invalid statement: malformed json",
      line: 20,
    };
    const [a, b] = toValidationResult(report([pageSide, anonymous])).errors;
    expect(a).toMatchObject({ instancePath: "/citations/0", keyword: "entry-invalid", subject: "fetch-timeout" });
    expect(b).toMatchObject({ instancePath: "", keyword: "statement-invalid", line: 20 });
    expect(b).not.toHaveProperty("subject");
  });

  it("yields manni:cite/<rule> from ruleIdFor, with and without a frame", () => {
    const [first] = toValidationResult(report(findings, results)).errors;
    expect(first).toBeDefined();
    if (!first) return;
    expect(ruleIdFor(first)).toBe("manni:cite/moved");
    expect(ruleIdFor(first, { cwd: "/repo/docs", base: "/repo" })).toBe("manni:cite/moved");
  });
});

describe("fingerprint stability", () => {
  const before = result({ status: "changed", origin: { kind: "frontmatter", index: 0, line: 4, anchorLine: 9 } });

  const printOf = (r: CitationResult): string => {
    const [error] = toValidationResult(report(findingsFor([r], resolveSeverity()), [r])).errors;
    if (!error) throw new Error("expected one error");
    return fingerprint(error, { cwd: "/repo", base: "/repo" });
  };

  it("is unchanged by a moved rewrite of src, and by a line shift", () => {
    const rewritten = result({
      status: "changed",
      citation: { ...before.citation, src: "lib/limits.ts:4" },
      origin: { kind: "frontmatter", index: 0, line: 4, anchorLine: 9 },
    });
    const shifted = result({
      status: "changed",
      origin: { kind: "frontmatter", index: 0, line: 7, anchorLine: 30 },
    });
    expect(printOf(rewritten)).toBe(printOf(before));
    expect(printOf(shifted)).toBe(printOf(before));
  });

  it("falls back to integrity without an id, which a re-mint changes", () => {
    const anonymous = result({
      status: "changed",
      citation: { src: "lib/limits.ts:2", integrity: PIN },
      origin: { kind: "inline", line: 12 },
    });
    const reminted = result({
      status: "changed",
      citation: { src: "lib/limits.ts:2", integrity: "sha256-" + "1".repeat(64) },
      origin: { kind: "inline", line: 12 },
    });
    expect(printOf(anonymous)).not.toBe(printOf(reminted));
  });
});

describe("leak sentinel", () => {
  const KEY = "sentinel-key-0123456789abcdef012345";
  const SECRET = "private/SECRET.ts";
  const results: CitationResult[] = (
    ["moved", "moved-ambiguous", "changed", "missing", "never-true", "current"] as const
  ).map((status, i) =>
    result({
      status,
      citation: { src: `${TOKEN}:2`, integrity: PIN, commit: COMMIT },
      origin: { kind: "frontmatter", index: i, line: 4 + i },
      resolvedPath: SECRET,
      newSrc: `${TOKEN}:4`,
      candidates: [`${TOKEN}:4`, `${TOKEN}:11`],
      historyAvailable: true,
      commitsSince: [`touch ${SECRET} with ${KEY}`],
      diff: `--- a/${SECRET}\n+++ b/${SECRET}\n`,
    }),
  );

  it("keeps the decrypted path and the key out of every finding and FieldError", () => {
    const findings = findingsFor(results, resolveSeverity({ current: "warning" }));
    expect(findings).toHaveLength(results.length);
    const errors: FieldError[] = toValidationResult(report(findings, results)).errors;
    const text = JSON.stringify({ findings, errors });
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("SECRET");
    expect(text).not.toContain(KEY);
    expect(text).toContain(TOKEN);
  });
});
