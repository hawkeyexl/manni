/**
 * Findings and their meta adapter. An entry has two ends, so `findingsFor`
 * reports on both: the claim end against the page, the source end against the
 * files. Messages are spelled from the entry's own `source`; the FieldError
 * identity (schema, keyword, instancePath, subject) is what the baseline
 * fingerprint and the SARIF rule id are built from, so both are pinned here to
 * survive a move, a line shift and an accepted claim.
 */
import { describe, expect, it } from "vitest";
import { claimMessageFor, findingsFor, messageFor, toValidationResult } from "../../src/cite/core/adapt.js";
import { DEFAULT_SEVERITY, resolveSeverity } from "../../src/cite/core/severity.js";
import type {
  CitationFinding,
  CitationResult,
  ClaimEnd,
  MissingReason,
  PageCitationReport,
  SourceEnd,
} from "../../src/cite/types.js";
import { fingerprint, ruleIdFor } from "../../src/meta/internal.js";
import type { FieldError } from "../../src/meta/index.js";

const PIN = "sha256-78af1d3321f9cbb177a7e4c958e39be56fd14cb93c1e441778bc4232e0fe4b1f";
const CLAIM_PIN = "sha256-921b21cccab21a4577f224ec4171aa56a3414bb3a5a4704ab8b6f314c46aa094";
const COMMIT = "3f9c2a1e7b0d4c5a6f8e9d0b1a2c3d4e5f607182";
/** Ciphertext-shaped: `~` and 84 base64url characters. Only its spelling matters here. */
const TOKEN = "~" + "AQx7Vb2_Kp-9Qm".repeat(6);

/** A source end, `lib/limits.ts:2` unless a test says otherwise. */
function source(over: Partial<SourceEnd> & { status: SourceEnd["status"] }): SourceEnd {
  return { src: "lib/limits.ts:2", resolvedPath: "lib/limits.ts", ...over };
}

/** A claim end pinned at body line 3, file line 9. */
function claim(over: Partial<ClaimEnd> & { status: ClaimEnd["status"] }): ClaimEnd {
  return { lines: "3", fileLines: "9", ...over };
}

function result(over: Partial<CitationResult> & { source: SourceEnd }): CitationResult {
  return {
    citation: {
      id: "fetch-timeout",
      source: { file: "lib/limits.ts", lines: 2, integrity: PIN },
    },
    origin: { kind: "frontmatter", file: "docs/limits.md", line: 4, index: 0 },
    anchor: "claim",
    anchorLine: 9,
    claim: null,
    ...over,
  };
}

/**
 * An entry with nothing anchoring it on the page: a bare pin, or a claim pin
 * with neither lines nor a marker. Its findings sit on the entry's own line.
 */
function unanchored(over: Partial<CitationResult> & { source: SourceEnd }): CitationResult {
  const out = result({ anchor: null, claim: null, ...over });
  delete out.anchorLine;
  return out;
}

describe("messageFor", () => {
  it("spells each source status per the plan's table", () => {
    expect(messageFor(source({ status: "current" }))).toBe("current");
    expect(messageFor(source({ status: "moved", newSrc: "lib/limits.ts:4" }))).toBe(
      "moved -> lib/limits.ts:4",
    );
    expect(
      messageFor(
        source({
          status: "moved-ambiguous",
          candidates: ["lib/limits.ts:4", "lib/limits.ts:11"],
        }),
      ),
    ).toBe("moved, 2 candidates (lib/limits.ts:4, lib/limits.ts:11); widen the range");
    expect(messageFor(source({ status: "changed" }))).toBe("changed");
    expect(messageFor(source({ status: "changed", commitSha: COMMIT }))).toBe("changed since 3f9c2a1");
    expect(
      messageFor(
        source({ status: "changed", commitSha: COMMIT, historyAvailable: true, commitsSince: ["a", "b"] }),
      ),
    ).toBe("changed since 3f9c2a1, 2 commits");
    expect(
      messageFor(
        source({ status: "changed", commitSha: COMMIT, historyAvailable: true, commitsSince: ["a"] }),
      ),
    ).toBe("changed since 3f9c2a1, 1 commit");
    expect(
      messageFor(
        source({ status: "changed", commitSha: COMMIT, historyAvailable: true, commitsSince: [] }),
      ),
    ).toBe("changed since 3f9c2a1, 0 commits");
    expect(messageFor(source({ status: "changed", commitSha: COMMIT, historyAvailable: false }))).toBe(
      "changed (history unavailable: commit 3f9c2a1 not found; fetch-depth: 0)",
    );
    expect(messageFor(source({ status: "never-true", commitSha: COMMIT }))).toBe(
      "never true: the pin does not match at 3f9c2a1",
    );
    expect(messageFor(source({ status: "never-true" }))).toBe(
      "never true: the pin does not match at the recorded commit",
    );
    expect(messageFor(source({ status: "missing" }))).toBe("missing");
    expect(messageFor(source({ status: "skipped" }))).toBe("skipped");
  });

  it("says why an encrypted source is missing, and never which path", () => {
    const missing = (reason: MissingReason, src = `${TOKEN}:2`): string =>
      messageFor({ src, status: "missing", missingReason: reason });
    expect(missing("no-key")).toBe("missing (no encryption key is available to decrypt it)");
    expect(missing("undecryptable")).toBe("missing (does not decrypt under the current key)");
    expect(missing("untracked")).toBe("missing (no tracked file matches; wrong --root?)");
    expect(missing("unreadable")).toBe("missing");
    // A plain path names its file already; the bare status says the rest.
    expect(missing("untracked", "lib/limits.ts:2")).toBe("missing");
  });

  it("never spells the resolved path", () => {
    const moved = source({
      status: "moved",
      src: `${TOKEN}:2`,
      newSrc: `${TOKEN}:4`,
      resolvedPath: "private/SECRET.ts",
      commitsSince: ["touch private/SECRET.ts"],
      diff: "--- private/SECRET.ts",
    });
    expect(messageFor(moved)).toBe(`moved -> ${TOKEN}:4`);
    const changed: SourceEnd = { ...moved, status: "changed", commitSha: COMMIT, historyAvailable: true };
    expect(messageFor(changed)).not.toContain("SECRET");
  });
});

describe("claimMessageFor", () => {
  it("spells each claim status, in the page lines a reviewer reads", () => {
    expect(
      claimMessageFor(
        result({
          source: source({ status: "current" }),
          claim: claim({ status: "moved", newLines: "5", newFileLines: "11" }),
        }),
      ),
    ).toBe("fetch-timeout: the claim moved from line 9 to line 11.");
    expect(
      claimMessageFor(
        result({
          source: source({ status: "current" }),
          claim: claim({
            status: "moved-ambiguous",
            candidates: ["5", "24"],
            candidateFileLines: ["11", "30"],
          }),
        }),
      ),
    ).toBe("fetch-timeout: the claim at line 9 now appears at lines 11 and 30.");
    expect(
      claimMessageFor(
        result({ source: source({ status: "current" }), claim: claim({ status: "changed" }) }),
      ),
    ).toBe("fetch-timeout: the claim at line 9 has changed since it was pinned.");
    // A pin with neither lines nor a marker anchors nothing at all.
    expect(
      claimMessageFor(
        result({ source: source({ status: "current" }), anchor: null, claim: { status: "changed" } }),
      ),
    ).toBe(
      "fetch-timeout: the claim has no lines and no marker names the entry, so its pin anchors nothing.",
    );
    // `current` and `skipped` are not findings, and have nothing to say.
    expect(
      claimMessageFor(
        result({ source: source({ status: "current" }), claim: claim({ status: "current" }) }),
      ),
    ).toBe("");
    expect(
      claimMessageFor(
        result({ source: source({ status: "skipped" }), claim: claim({ status: "skipped" }) }),
      ),
    ).toBe("");
    expect(claimMessageFor(result({ source: source({ status: "current" }) }))).toBe("");
  });

  it("drops the id prefix for an entry that has none, and reads a marker's line", () => {
    const anonymous = result({
      citation: { source: { file: "lib/limits.ts", lines: 2, integrity: PIN } },
      source: source({ status: "current" }),
      claim: claim({ status: "changed" }),
    });
    expect(claimMessageFor(anonymous)).toBe("the claim at line 9 has changed since it was pinned.");
    // A marker-anchored claim carries no `lines`; the marker's line is where it sits.
    const marked = result({
      source: source({ status: "current" }),
      anchor: "marker",
      markerLine: 14,
      anchorLine: 15,
      claim: { fileLines: "15", status: "changed" },
    });
    expect(claimMessageFor(marked)).toBe(
      "fetch-timeout: the claim at line 15 has changed since it was pinned.",
    );
  });
});

describe("findingsFor", () => {
  const severity = resolveSeverity();

  it("reports both ends of a citation, each at the line a reviewer reads", () => {
    const findings = findingsFor(
      [
        result({
          source: source({ status: "moved", newSrc: "lib/limits.ts:4" }),
          claim: claim({ status: "changed" }),
        }),
      ],
      severity,
    );
    expect(findings).toEqual([
      {
        rule: "claim-changed",
        ruleId: "manni:cite/claim-changed",
        severity: "warning",
        message: "fetch-timeout: the claim at line 9 has changed since it was pinned.",
        src: "lib/limits.ts:2",
        index: 0,
        line: 9,
        id: "fetch-timeout",
      },
      {
        rule: "source-moved",
        ruleId: "manni:cite/source-moved",
        severity: "warning",
        message: "moved -> lib/limits.ts:4",
        src: "lib/limits.ts:2",
        index: 0,
        line: 9,
        id: "fetch-timeout",
        newSrc: "lib/limits.ts:4",
      },
    ]);
  });

  it("says nothing about an end that holds, or one that was never looked at", () => {
    const findings = findingsFor(
      [
        result({ source: source({ status: "current" }), claim: claim({ status: "current" }) }),
        // `--no-check-sources`: the source end is skipped, the claim still judged.
        result({
          source: source({ status: "skipped" }),
          claim: claim({ status: "changed" }),
          origin: { kind: "frontmatter", file: "docs/limits.md", line: 12, index: 1 },
        }),
      ],
      severity,
    );
    expect(findings.map((f) => [f.rule, f.index])).toEqual([["claim-changed", 1]]);
  });

  it("puts a finding with no page line on the entry's own line, in its own file", () => {
    // A bare pin: no claim to anchor it, and the source drifted.
    const [bare] = findingsFor([unanchored({ source: source({ status: "changed" }) })], severity);
    expect(bare).toMatchObject({ rule: "source-changed", line: 4 });
    expect(bare).not.toHaveProperty("file");
    // The same entry, owned by a manifest: the finding names the manifest.
    const [owned] = findingsFor(
      [
        unanchored({
          source: source({ status: "changed" }),
          origin: { kind: "manifest", file: "docs/citations.yaml", line: 7, index: 0 },
        }),
      ],
      severity,
    );
    expect(owned).toMatchObject({ rule: "source-changed", line: 7, file: "docs/citations.yaml" });
    // And a claim pin that anchors nothing sits there too.
    const [nowhere] = findingsFor(
      [
        unanchored({
          source: source({ status: "current" }),
          origin: { kind: "manifest", file: "docs/citations.yaml", line: 7, index: 0 },
          claim: { status: "changed" },
        }),
      ],
      severity,
    );
    expect(nowhere).toMatchObject({ rule: "claim-changed", line: 7, file: "docs/citations.yaml" });
  });

  it("omits the line altogether when nothing knows one", () => {
    const [unknown] = findingsFor(
      [
        unanchored({
          source: source({ status: "missing" }),
          origin: { kind: "frontmatter", file: "docs/limits.md", index: 1 },
        }),
      ],
      severity,
    );
    expect(unknown).toBeDefined();
    expect(unknown).not.toHaveProperty("line");
  });

  it("honours the severity table: off drops, and a rule can move either way", () => {
    const results = [
      result({ source: source({ status: "moved", newSrc: "x:1" }), claim: claim({ status: "moved", newFileLines: "11" }) }),
      result({
        source: source({ status: "changed" }),
        claim: claim({ status: "changed" }),
        origin: { kind: "frontmatter", file: "docs/limits.md", line: 12, index: 1 },
      }),
    ];
    const findings = findingsFor(
      results,
      resolveSeverity({ "claim-moved": "off", "source-moved": "error", "claim-changed": "error" }),
    );
    expect(findings.map((f) => [f.rule, f.severity])).toEqual([
      ["source-moved", "error"],
      ["claim-changed", "error"],
      ["source-changed", "error"],
    ]);
    // The defaults a repository is expected to re-level are the claim's.
    expect(DEFAULT_SEVERITY["claim-moved"]).toBe("notice");
    expect(DEFAULT_SEVERITY["claim-changed"]).toBe("warning");
    expect(DEFAULT_SEVERITY["source-moved"]).toBe("warning");
  });
});

function report(findings: CitationFinding[], citations: CitationResult[] = []): PageCitationReport {
  return { file: "docs/limits.md", format: "markdown", citations, findings, notices: [] };
}

describe("toValidationResult", () => {
  const results = [
    result({ source: source({ status: "moved", newSrc: "lib/limits.ts:4" }) }),
    result({
      citation: {
        source: { file: "lib/limits.ts", lines: 3, integrity: "sha256-" + "3".repeat(64) },
      },
      source: source({ src: "lib/limits.ts:3", status: "changed" }),
      origin: { kind: "frontmatter", file: "docs/limits.md", line: 12, index: 1 },
      anchorLine: 13,
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
        keyword: "source-moved",
        subject: "fetch-timeout",
        line: 9,
        severity: "warning",
      },
      {
        schema: "manni:cite",
        instancePath: "/citations/1",
        message: "changed",
        keyword: "source-changed",
        subject: "sha256-" + "3".repeat(64),
        line: 13,
        severity: "error",
      },
    ]);
  });

  it("carries the manifest and its line for a finding that sits there", () => {
    const owned = findingsFor(
      [
        unanchored({
          source: source({ status: "changed" }),
          origin: { kind: "manifest", file: "docs/citations.yaml", line: 7, index: 0 },
        }),
      ],
      resolveSeverity(),
    );
    expect(owned[0]).toMatchObject({ line: 7, file: "docs/citations.yaml" });
    // `file` says which file line 7 belongs to, so both travel: every
    // reporter locates the entry in the manifest rather than in the page.
    const [error] = toValidationResult(report(owned)).errors;
    expect(error).toMatchObject({
      keyword: "source-changed",
      instancePath: "/citations/0",
      file: "docs/citations.yaml",
      line: 7,
    });
  });

  it("falls back to the page for a manifest outside the repository", () => {
    const outside = findingsFor(
      [
        unanchored({
          source: source({ status: "changed" }),
          origin: { kind: "manifest", file: "../private/citations.yaml", line: 7, index: 0 },
        }),
      ],
      resolveSeverity(),
    );
    // SARIF drops a uri that rebases outside the repository, and a line in
    // another file would read as a line in this one: neither travels.
    const [error] = toValidationResult(report(outside)).errors;
    expect(error).toMatchObject({ keyword: "source-changed", instancePath: "/citations/0" });
    expect(error).not.toHaveProperty("line");
    expect(error).not.toHaveProperty("file");
  });

  it("is ok when no finding is an error, and when there are none", () => {
    const warnings = findings.map((f) => ({ ...f, severity: "warning" as const }));
    expect(toValidationResult(report(warnings, results)).ok).toBe(true);
    const notices = findings.map((f) => ({ ...f, severity: "notice" as const }));
    expect(toValidationResult(report(notices, results)).ok).toBe(true);
    expect(toValidationResult(report([])).ok).toBe(true);
    expect(toValidationResult(report([])).errors).toEqual([]);
  });

  it("carries a page-side finding with no result: subject is the id when there is one", () => {
    const pageSide: CitationFinding = {
      rule: "entry-invalid",
      ruleId: "manni:cite/entry-invalid",
      severity: "error",
      message: "/source must have required property 'integrity'",
      line: 4,
      index: 0,
      id: "fetch-timeout",
    };
    const anonymous: CitationFinding = {
      rule: "marker-invalid",
      ruleId: "manni:cite/marker-invalid",
      severity: "error",
      message: "invalid marker: malformed json",
      line: 20,
    };
    const [a, b] = toValidationResult(report([pageSide, anonymous])).errors;
    expect(a).toMatchObject({
      instancePath: "/citations/0",
      keyword: "entry-invalid",
      subject: "fetch-timeout",
    });
    expect(b).toMatchObject({ instancePath: "", keyword: "marker-invalid", line: 20 });
    expect(b).not.toHaveProperty("subject");
  });

  it("yields manni:cite/<rule> from ruleIdFor, with and without a frame", () => {
    const [first] = toValidationResult(report(findings, results)).errors;
    expect(first).toBeDefined();
    if (!first) return;
    expect(ruleIdFor(first)).toBe("manni:cite/source-moved");
    expect(ruleIdFor(first, { cwd: "/repo/docs", base: "/repo" })).toBe("manni:cite/source-moved");
  });
});

describe("fingerprint stability", () => {
  /** The one error a result produces, fingerprinted the way the baseline does. */
  const printOf = (r: CitationResult): string => {
    const errors = toValidationResult(report(findingsFor([r], resolveSeverity()), [r])).errors;
    const [error] = errors;
    if (errors.length !== 1 || !error) throw new Error("expected exactly one error");
    return fingerprint(error, { cwd: "/repo", base: "/repo" });
  };

  const before = result({ source: source({ status: "changed" }) });

  it("is unchanged by a moved rewrite of the source, and by a line shift", () => {
    const rewritten = result({
      citation: {
        id: "fetch-timeout",
        source: { file: "lib/limits.ts", lines: 4, integrity: PIN },
      },
      source: source({ src: "lib/limits.ts:4", status: "changed" }),
    });
    const shifted = result({
      source: source({ status: "changed" }),
      origin: { kind: "frontmatter", file: "docs/limits.md", line: 7, index: 0 },
      anchorLine: 30,
    });
    expect(printOf(rewritten)).toBe(printOf(before));
    expect(printOf(shifted)).toBe(printOf(before));
  });

  it("fingerprints an entry with no id by the source pin, never the claim pin", () => {
    const anonymous = (claimPin: string, sourcePin: string): CitationResult =>
      result({
        citation: {
          claim: { lines: 3, integrity: claimPin },
          source: { file: "lib/limits.ts", lines: 2, integrity: sourcePin },
        },
        source: source({ status: "current" }),
        claim: claim({ status: "changed" }),
      });
    const pinned = anonymous(CLAIM_PIN, PIN);
    // Accepting a changed claim re-mints its pin; the baselined finding must
    // not reopen because of it.
    const accepted = anonymous("sha256-" + "1".repeat(64), PIN);
    expect(printOf(accepted)).toBe(printOf(pinned));
    // Re-minting the source pin is a different citation, and a new finding.
    const resourced = anonymous(CLAIM_PIN, "sha256-" + "2".repeat(64));
    expect(printOf(resourced)).not.toBe(printOf(pinned));
  });

  it("prefers the id over either pin when the entry has one", () => {
    const reminted = result({
      citation: {
        id: "fetch-timeout",
        source: { file: "lib/limits.ts", lines: 2, integrity: "sha256-" + "1".repeat(64) },
      },
      source: source({ status: "changed" }),
    });
    expect(printOf(reminted)).toBe(printOf(before));
  });
});

describe("leak sentinel", () => {
  const KEY = "sentinel-key-0123456789abcdef012345";
  const SECRET = "private/SECRET.ts";
  const results: CitationResult[] = (
    ["moved", "moved-ambiguous", "changed", "missing", "never-true", "current"] as const
  ).map((status, i) =>
    result({
      citation: {
        claim: { lines: 3, integrity: CLAIM_PIN },
        source: { file: TOKEN, lines: 2, integrity: PIN, "commit-sha": COMMIT },
      },
      origin: { kind: "frontmatter", file: "docs/limits.md", line: 4 + i, index: i },
      anchorLine: 9 + i,
      claim: claim({ status: "changed", text: ["The fetch timeout is 10 seconds."] }),
      source: source({
        status,
        src: `${TOKEN}:2`,
        commitSha: COMMIT,
        resolvedPath: SECRET,
        newSrc: `${TOKEN}:4`,
        candidates: [`${TOKEN}:4`, `${TOKEN}:11`],
        historyAvailable: true,
        commitsSince: [`touch ${SECRET} with ${KEY}`],
        diff: `--- a/${SECRET}\n+++ b/${SECRET}\n`,
      }),
    }),
  );

  it("keeps the decrypted path and the key out of every finding and FieldError", () => {
    const findings = findingsFor(results, resolveSeverity());
    // Every result carries a changed claim; five of the six sources report too.
    expect(findings).toHaveLength(results.length + 5);
    const errors: FieldError[] = toValidationResult(report(findings, results)).errors;
    const text = JSON.stringify({ findings, errors });
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("SECRET");
    expect(text).not.toContain(KEY);
    expect(text).toContain(TOKEN);
  });
});
