/**
 * The findings baseline (ADR 01017).
 *
 * Most of what matters here is what a fingerprint deliberately ignores. A
 * baseline is a committed artifact shared by a whole team, so an identity that
 * moves when a line moves, or when an upstream tool rewords a message, does not
 * merely churn — it presents as "manni docevals broke our build" in every
 * consuming repo at once.
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyBaseline,
  buildBaseline,
  countFingerprints,
  diffBaselines,
  fingerprint,
  parseBaseline,
  readBaseline,
  serializeBaseline,
  writeBaselineFile,
  BASELINE_VERSION,
  type Baseline,
} from "../../../src/docevals/core/baseline.js";
import { DocevalsError, type EvalResult, type Finding } from "../../../src/docevals/types.js";

const finding = (over: Partial<Finding> = {}): Finding => ({
  evalName: "markdownlint",
  file: "docs/legacy.md",
  ruleId: "MD013",
  message: "Line length",
  severity: "error",
  line: 12,
  ...over,
});

const result = (findings: Finding[], over: Partial<EvalResult> = {}): EvalResult => ({
  evalName: findings[0]?.evalName ?? "markdownlint",
  type: "regression",
  grader: "tool:markdownlint",
  file: findings[0]?.file ?? "docs/legacy.md",
  outcome: findings.some((f) => f.severity === "error") ? "fail" : "pass",
  findings,
  durationMs: 0,
  ...over,
});

const root = () => mkdtempSync(join(tmpdir(), "manni-docevals-baseline-"));

describe("fingerprint: what it ignores", () => {
  it("is stable when the finding moves down the page", () => {
    expect(fingerprint(finding({ line: 12 }))).toBe(fingerprint(finding({ line: 400 })));
  });

  // markdownlint and Vale generate these strings. If a fingerprint moved with
  // the wording, an upstream release would invalidate every consuming repo's
  // baseline at once.
  it("is stable when the tool rewords its message", () => {
    expect(fingerprint(finding({ message: "Line length" }))).toBe(
      fingerprint(finding({ message: "Line too long (81 > 80)" })),
    );
  });

  it("distinguishes different rules within one eval", () => {
    expect(fingerprint(finding({ ruleId: "MD013" }))).not.toBe(
      fingerprint(finding({ ruleId: "MD041" })),
    );
  });

  it("distinguishes different evals sharing a rule id", () => {
    expect(fingerprint(finding({ evalName: "a" }))).not.toBe(
      fingerprint(finding({ evalName: "b" })),
    );
  });

  // The NUL separator: without it ("ab", "") and ("a", "b") collide.
  it("does not collide across a field boundary", () => {
    expect(fingerprint({ evalName: "ab", ruleId: undefined })).not.toBe(
      fingerprint({ evalName: "a", ruleId: "b" }),
    );
  });

  it("emits 16 lowercase hex characters", () => {
    expect(fingerprint(finding())).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("buildBaseline", () => {
  it("records a fingerprint per file, omitting clean files", () => {
    const b = buildBaseline(
      [
        result([finding()]),
        result([], { file: "docs/clean.md", outcome: "pass", findings: undefined }),
      ],
      "0.1.0",
    );
    expect(Object.keys(b.entries)).toEqual(["docs/legacy.md"]);
    expect(countFingerprints(b)).toBe(1);
  });

  it("stores two identical findings once", () => {
    const b = buildBaseline([result([finding({ line: 1 }), finding({ line: 90 })])], "0.1.0");
    expect(countFingerprints(b)).toBe(1);
  });

  // `toString` is a legal filename, and a plain object literal would return the
  // inherited method for a clean file rather than undefined.
  it("survives a file named like an Object prototype member", () => {
    const b = buildBaseline([result([finding({ file: "toString" })])], "0.1.0");
    // Read through a variable key: a literal `.toString` access is the very
    // prototype lookup this test exists to prove does not happen.
    // Typed as `string`, not the literal: with the literal type TypeScript
    // still resolves the index to `Object.prototype.toString`, which is the
    // prototype lookup this test exists to prove does not happen.
    const key: string = "toString";
    expect(Object.keys(b.entries)).toEqual([key]);
    expect(b.entries[key]).toHaveLength(1);
    expect(() => applyBaseline([result([finding({ file: "__proto__" })])], b)).not.toThrow();
  });
});

describe("applyBaseline", () => {
  const baselined = buildBaseline([result([finding()])], "0.1.0");

  it("suppresses a recorded finding and passes the eval", () => {
    const applied = applyBaseline([result([finding()])], baselined);
    expect(applied.suppressed).toBe(1);
    expect(applied.results[0]?.outcome).toBe("pass");
    expect(applied.results[0]?.baselined).toBe(1);
  });

  it("still fails on a finding the baseline does not hold", () => {
    const applied = applyBaseline([result([finding({ ruleId: "MD041" })])], baselined);
    expect(applied.suppressed).toBe(0);
    expect(applied.results[0]?.outcome).toBe("fail");
  });

  it("fails when only some of a file's findings are baselined", () => {
    const applied = applyBaseline(
      [result([finding(), finding({ ruleId: "MD041" })])],
      baselined,
    );
    expect(applied.suppressed).toBe(1);
    expect(applied.results[0]?.outcome).toBe("fail");
    expect(applied.results[0]?.findings).toHaveLength(1);
  });

  it("treats a file with no entry as entirely new", () => {
    const applied = applyBaseline([result([finding({ file: "docs/new.md" })])], baselined);
    expect(applied.suppressed).toBe(0);
    expect(applied.results[0]?.outcome).toBe("fail");
  });

  it("reports a recorded fingerprint that no longer occurs as stale", () => {
    const applied = applyBaseline([result([finding({ ruleId: "MD041" })])], baselined);
    expect(applied.recorded).toBe(1);
    expect(applied.stale).toBe(1);
  });

  // Counting the whole baseline would make a single-page run announce that
  // every other file's entries "no longer occur".
  it("counts only the files this run checked", () => {
    const wide = buildBaseline(
      [result([finding()]), result([finding({ file: "docs/other.md" })])],
      "0.1.0",
    );
    const applied = applyBaseline([result([finding()])], wide);
    expect(applied.recorded).toBe(1);
    expect(applied.stale).toBe(0);
  });

  it("leaves an ai-graded result alone", () => {
    const ai = result([], {
      evalName: "no-future-promises",
      grader: "ai",
      outcome: "fail",
      findings: undefined,
    });
    expect(applyBaseline([ai], baselined).results[0]).toBe(ai);
  });
});

describe("canonical paths", () => {
  // A baseline is committed, so it has to name a file the same way from the
  // repo root and from inside docs/ — otherwise every entry reads as new for
  // exactly the subdirectory workflow config discovery exists to support.
  it("resolves the same entry from the repo root and a subdirectory", () => {
    const fromRoot = buildBaseline([result([finding({ file: "docs/legacy.md" })])], "0.1.0", {
      base: "/repo",
    });
    const fromSubdir = applyBaseline(
      [result([finding({ file: "legacy.md" })])],
      fromRoot,
      { base: "/repo", runBase: "/repo/docs" },
    );
    expect(fromSubdir.suppressed).toBe(1);
  });

  it("writes posix separators so a Windows baseline matches a Linux one", () => {
    const b = buildBaseline([result([finding({ file: "docs/legacy.md" })])], "0.1.0", {
      base: "/repo",
    });
    expect(Object.keys(b.entries)[0]).toBe("docs/legacy.md");
  });
});

describe("serialize and parse", () => {
  it("round-trips, with sorted keys and fingerprints", () => {
    const b: Baseline = {
      version: BASELINE_VERSION,
      generatedWith: "0.1.0",
      entries: { "b.md": ["ffffffffffffffff", "0000000000000000"], "a.md": ["1111111111111111"] },
    };
    const text = serializeBaseline(b);
    expect(text.indexOf('"a.md"')).toBeLessThan(text.indexOf('"b.md"'));
    expect(text).toContain('"0000000000000000",\n      "ffffffffffffffff"');
    // Sorted on the way out, so the round-trip normalizes rather than
    // preserving input order — which is the point: the file has to diff and
    // merge legibly for a team that all re-record it.
    expect(parseBaseline(text, "x").entries).toEqual({
      "a.md": ["1111111111111111"],
      "b.md": ["0000000000000000", "ffffffffffffffff"],
    });
  });

  it.each([
    ["invalid JSON", "{oh no", /invalid JSON/],
    ["a non-object top level", "[]", /top level must be an object/],
    ["an unknown version", '{"version":99,"entries":{}}', /unsupported version/],
    ["a non-object entries", '{"version":1,"entries":[]}', /"entries" must be an object/],
    [
      "a non-list entry",
      '{"version":1,"entries":{"a.md":"x"}}',
      /must be a list of fingerprint strings/,
    ],
  ])("rejects %s", (_label, text, pattern) => {
    expect(() => parseBaseline(text, "b.json")).toThrow(pattern);
  });

  // A hand-typed fingerprint can never match a real finding, so without this
  // the symptom is "that finding came back" with nothing to explain it.
  it("rejects a malformed fingerprint, naming the entry", () => {
    expect(() => parseBaseline('{"version":1,"entries":{"a.md":["nope"]}}', "b.json")).toThrow(
      /a\.md.*nope/s,
    );
  });

  it("throws a DocevalsError, so the CLI exits 2", () => {
    expect(() => parseBaseline("{oh no", "b.json")).toThrow(DocevalsError);
  });
});

describe("read and write", () => {
  it("returns null when the file does not exist", () => {
    expect(readBaseline(join(root(), "absent.json"), "absent.json")).toBeNull();
  });

  it("writes a file the reader accepts", () => {
    const dir = root();
    const path = join(dir, "nested", ".manni-docevals-baseline.json");
    const b = buildBaseline([result([finding()])], "0.1.0");
    writeBaselineFile(path, b, path);
    expect(readBaseline(path, path)?.entries).toEqual(b.entries);
  });

  it("tolerates a BOM an editor added", () => {
    const dir = root();
    const path = join(dir, "b.json");
    writeFileSync(path, `﻿${serializeBaseline(buildBaseline([], "0.1.0"))}`);
    expect(readBaseline(path, path)).not.toBeNull();
  });

  it("leaves no temp file behind", () => {
    const dir = root();
    const path = join(dir, "b.json");
    writeBaselineFile(path, buildBaseline([result([finding()])], "0.1.0"), path);
    expect(() => readFileSync(`${path}.tmp`)).toThrow();
  });
});

describe("diffBaselines", () => {
  // The load-bearing number. An accidental --write-baseline on a narrowed glob
  // forgives everything it did not see, and this is the only signal in a log.
  it("counts what a re-record would drop", () => {
    const before = buildBaseline(
      [result([finding()]), result([finding({ file: "docs/other.md" })])],
      "0.1.0",
    );
    const after = buildBaseline([result([finding()])], "0.1.0");
    expect(diffBaselines(before, after)).toEqual({ added: 0, removed: 1 });
  });

  it("counts a genuinely new finding as added", () => {
    const before = buildBaseline([result([finding()])], "0.1.0");
    const after = buildBaseline(
      [result([finding(), finding({ ruleId: "MD041" })])],
      "0.1.0",
    );
    expect(diffBaselines(before, after)).toEqual({ added: 1, removed: 0 });
  });

  it("treats an absent previous baseline as empty", () => {
    const after = buildBaseline([result([finding()])], "0.1.0");
    expect(diffBaselines(null, after)).toEqual({ added: 1, removed: 0 });
  });
});

describe("stale counts a file this run found clean", () => {
  // The case pruning exists for, and the normal outcome of the cleanup the
  // ratchet is meant to encourage. The early return used to precede
  // `touched.add`, so a fully-fixed file reported "0 recorded, 0 stale".
  it("reports a recorded entry whose findings are all gone", () => {
    const recorded = buildBaseline([result([finding()])], "0.1.0");
    const clean = applyBaseline(
      [result([], { outcome: "pass", findings: undefined })],
      recorded,
    );
    expect(clean.recorded).toBe(1);
    expect(clean.stale).toBe(1);
  });
});

describe("stale distinguishes checked from merely reported", () => {
  const recorded = () => buildBaseline([result([finding()])], "0.1.0");
  const bare = (over: Partial<EvalResult>): EvalResult =>
    result([], { findings: undefined, ...over });

  // A clean pass is the case pruning exists for.
  it("counts a file the run graded and found clean", () => {
    const r = applyBaseline([bare({ outcome: "pass" })], recorded());
    expect(r.recorded).toBe(1);
    expect(r.stale).toBe(1);
  });

  // These never ran. Their recorded findings are unmeasured, not gone, and
  // calling them stale invites the re-record that forgives them for good.
  it.each(["skipped", "error", "needs-review"] as const)(
    "does not count a %s result",
    (outcome) => {
      const r = applyBaseline([bare({ outcome })], recorded());
      expect(r.recorded).toBe(0);
      expect(r.stale).toBe(0);
    },
  );
});
