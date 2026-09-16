/**
 * What `manni kg check` prints, per format.
 *
 * Synthetic reports rather than a built graph: the shapes cannot produce a
 * finding at every severity, nor one that blames no document, and both are
 * shapes the renderers have to get right. The CLI-level coverage of the real
 * thing is in test/kg/integration/check.test.ts.
 */
import { describe, expect, it } from "vitest";
import { renderCheck, type CheckReport } from "../../../src/kg/commands/check.js";
import type { CheckFinding } from "../../../src/kg/core/shacl.js";

const finding = (over: Partial<CheckFinding> = {}): CheckFinding => ({
  severity: "error",
  shaclSeverity: "violation",
  message: "constraint violated",
  focusNode: "https://example.com/kg/doc/docs/a.md",
  docs: ["docs/a.md"],
  ...over,
});

const report = (findings: CheckFinding[]): CheckReport => ({
  findings,
  errors: findings.filter((f) => f.severity === "error").length,
  warnings: findings.filter((f) => f.severity === "warning").length,
  notices: findings.filter((f) => f.severity === "notice").length,
  shapes: ["shapes.ttl"],
  exitCode: findings.some((f) => f.severity === "error") ? 1 : 0,
});

/** A finding about a shared concept: two docs blame it, the first anchors it. */
const collision = finding({
  severity: "warning",
  shaclSeverity: "warning",
  message: "label collision",
  focusNode: "https://example.com/kg/concept/setup",
  docs: ["docs/a.md", "docs/b.md"],
});

const three = [
  finding(),
  collision,
  finding({
    severity: "notice",
    shaclSeverity: "info",
    message: "advisory",
    // Nothing in the graph traces this node back to a file.
    focusNode: "https://example.com/kg/scheme",
    docs: [],
  }),
];

describe("renderCheck pretty", () => {
  it("counts errors, warnings and notices", () => {
    expect(renderCheck(report(three), "pretty")).toContain(
      "1 error, 1 warning, 1 notice",
    );
  });

  it("pluralizes each count independently", () => {
    expect(renderCheck(report([]), "pretty")).toBe(
      "0 errors, 0 warnings, 0 notices",
    );
  });

  it("leads each line with the family severity", () => {
    const lines = renderCheck(report(three), "pretty").split("\n");
    expect(lines[0]).toContain("error: ");
    expect(lines[1]).toContain("warning: ");
    expect(lines[2]).toContain("notice: ");
  });
});

describe("renderCheck json", () => {
  it("names the counts errors, warnings and notices", () => {
    const parsed = JSON.parse(renderCheck(report(three), "json")) as Record<
      string,
      unknown
    >;
    expect(parsed.errors).toBe(1);
    expect(parsed.warnings).toBe(1);
    expect(parsed.notices).toBe(1);
    expect(parsed).not.toHaveProperty("violations");
    expect(parsed).not.toHaveProperty("exitCode");
  });

  it("carries both scales on every finding", () => {
    const parsed = JSON.parse(renderCheck(report(three), "json")) as {
      findings: Array<{ severity: string; shaclSeverity: string }>;
    };
    expect(
      parsed.findings.map((f) => [f.severity, f.shaclSeverity]),
    ).toEqual([
      ["error", "violation"],
      ["warning", "warning"],
      ["notice", "info"],
    ]);
  });
});

describe("renderCheck github", () => {
  it("writes one annotation per finding, at the finding's level", () => {
    expect(renderCheck(report(three), "github").split("\n")).toEqual([
      "::error file=docs/a.md::constraint violated (https://example.com/kg/doc/docs/a.md)",
      "::warning file=docs/a.md::label collision (https://example.com/kg/concept/setup)",
      "::notice::advisory (https://example.com/kg/scheme)",
    ]);
  });

  it("anchors on the first doc a finding blames", () => {
    expect(renderCheck(report([collision]), "github")).toBe(
      "::warning file=docs/a.md::label collision (https://example.com/kg/concept/setup)",
    );
  });

  it("says nothing when the run is clean", () => {
    expect(renderCheck(report([]), "github")).toBe("");
  });

  it("escapes the message and the file property", () => {
    const rendered = renderCheck(
      report([
        finding({
          message: "two\nlines and 100%",
          docs: ["docs/a,b.md"],
        }),
      ]),
      "github",
    );
    expect(rendered).toContain("file=docs/a%2Cb.md");
    expect(rendered).toContain("two%0Alines and 100%25");
  });
});
