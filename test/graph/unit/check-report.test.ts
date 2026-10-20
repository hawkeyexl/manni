/**
 * What `manni graph check` prints, per format.
 *
 * Synthetic reports rather than a built graph: the shapes cannot produce a
 * finding at every severity, nor one that blames no document, and both are
 * shapes the renderers have to get right. The CLI-level coverage of the real
 * thing is in test/graph/integration/check.test.ts.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as AjvDraft04Ns from "ajv-draft-04";
import { describe, expect, it } from "vitest";
import { renderCheck, type CheckReport } from "../../../src/graph/commands/check.js";
import type { CheckFinding } from "../../../src/graph/core/shacl.js";

const LANGUAGE = {
  id: "manni:graph-shapes:1.1.1",
  rule: "Document-language",
  description:
    "The language the page is written in. Search, filters and per-language indexes group pages by it.",
  guide: "https://hawkeyexl.github.io/manni/graph/fix/",
};

/** Keys in the order `finding()` in shacl.ts builds them, `guidance` last. */
const finding = ({ guidance = null, ...over }: Partial<CheckFinding> = {}): CheckFinding => ({
  severity: "error",
  shaclSeverity: "violation",
  message: "constraint violated",
  focusNode: "https://example.com/graph/doc/docs/a.md",
  docs: ["docs/a.md"],
  ...over,
  guidance,
});

const report = (findings: CheckFinding[]): CheckReport => ({
  findings,
  errors: findings.filter((f) => f.severity === "error").length,
  warnings: findings.filter((f) => f.severity === "warning").length,
  notices: findings.filter((f) => f.severity === "notice").length,
  shapes: ["shapes.ttl"],
  root: "/repo/docs",
  exitCode: findings.some((f) => f.severity === "error") ? 1 : 0,
});

/** A finding about a shared concept: two docs blame it, the first anchors it. */
const collision = finding({
  severity: "warning",
  shaclSeverity: "warning",
  message: "label collision",
  focusNode: "https://example.com/graph/concept/setup",
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
    focusNode: "https://example.com/graph/scheme",
    docs: [],
  }),
];

const language = finding({
  message: "Set `lang` to a language tag such as `de` or `pt-BR`, not a language name.",
  focusNode: "https://example.com/dd/doc/l10n-invalid/install.md",
  path: "http://purl.org/dc/terms/language",
  docs: ["l10n-invalid/install.md"],
  guidance: LANGUAGE,
});

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

  it("leads with the pages, then the node and the shape that judged it", () => {
    expect(renderCheck(report([language]), "pretty")).toBe(
      [
        "error: l10n-invalid/install.md: Set `lang` to a language tag such as `de` or `pt-BR`, not a language name.",
        "  at https://example.com/dd/doc/l10n-invalid/install.md dcterms:language",
        "  manni:graph-shapes:1.1.1 Document-language: The language the page is written in. Search, filters and per-language indexes group pages by it.",
        "  Guide: https://hawkeyexl.github.io/manni/graph/fix/",
        "",
        "1 error, 0 warnings, 0 notices",
      ].join("\n"),
    );
  });

  it("joins several pages and says when a finding names none", () => {
    const lines = renderCheck(report(three), "pretty").split("\n");
    expect(lines.filter((l) => !l.startsWith("  ")).slice(0, 3)).toEqual([
      "error: docs/a.md: constraint violated",
      "warning: docs/a.md, docs/b.md: label collision",
      "notice: (no page): advisory",
    ]);
  });

  it("dims the lines under a finding when colour is on", () => {
    const lines = renderCheck(report([language]), "pretty", { color: true }).split("\n");
    expect(lines[0]).not.toContain("\u001b[2m");
    for (const line of lines.slice(1, 4)) expect(line).toMatch(/^ {2}\u001b\[2m.*\u001b\[22m$/);
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
    expect(parsed).not.toHaveProperty("root");
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

  it("puts guidance last on every finding, null where no shape judged it", () => {
    const parsed = JSON.parse(renderCheck(report([language, finding()]), "json")) as {
      findings: Array<Record<string, unknown>>;
    };
    expect(parsed.findings.map((f) => Object.keys(f).at(-1))).toEqual(["guidance", "guidance"]);
    expect(parsed.findings.map((f) => f.guidance)).toEqual([LANGUAGE, null]);
  });
});

describe("renderCheck github", () => {
  it("writes one annotation per finding, at the finding's level", () => {
    expect(renderCheck(report(three), "github").split("\n")).toEqual([
      "::error file=docs/a.md::constraint violated (https://example.com/graph/doc/docs/a.md)",
      "::warning file=docs/a.md::label collision (https://example.com/graph/concept/setup)",
      "::notice::advisory (https://example.com/graph/scheme)",
    ]);
  });

  it("appends the guidance lines after %0A", () => {
    expect(renderCheck(report([language]), "github")).toBe(
      "::error file=l10n-invalid/install.md::Set `lang` to a language tag such as `de` or `pt-BR`, not a language name. (https://example.com/dd/doc/l10n-invalid/install.md)%0Amanni:graph-shapes:1.1.1 Document-language: The language the page is written in. Search, filters and per-language indexes group pages by it.%0AGuide: https://hawkeyexl.github.io/manni/graph/fix/",
    );
  });

  it("anchors on the first doc a finding blames", () => {
    expect(renderCheck(report([collision]), "github")).toBe(
      "::warning file=docs/a.md::label collision (https://example.com/graph/concept/setup)",
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

// The meta-schema is vendored, and draft-04 is the dialect the OASIS TC
// published it in, as test/reporters.test.ts explains.
type AjvCtor = typeof import("ajv/dist/2020.js").default;
const AjvDraft04 = AjvDraft04Ns.default as unknown as AjvCtor;
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const validateSarif = new AjvDraft04({
  allErrors: true,
  strict: false,
  validateFormats: false,
  logger: false,
}).compile(
  JSON.parse(
    readFileSync(join(repoRoot, "test/fixtures/sarif-2.1.0.schema.json"), "utf8"),
  ) as Record<string, unknown>,
);

interface SarifRun {
  tool: { driver: { name: string; rules: Array<Record<string, unknown>> } };
  originalUriBaseIds: Record<string, { uri: string }>;
  invocations: Array<{
    executionSuccessful: boolean;
    toolExecutionNotifications?: Array<{ level: string; message: { text: string } }>;
  }>;
  results: Array<{
    ruleId: string;
    ruleIndex: number;
    level: string;
    message: { text: string };
    locations: Array<{
      physicalLocation: {
        artifactLocation: { uri: string; uriBaseId?: string };
        region: { startLine: number };
      };
    }>;
    properties?: { guidance: unknown };
  }>;
}

/** Assert conformance, say what failed when it does not, and return the one run. */
function sarifRun(text: string): SarifRun {
  const log = JSON.parse(text) as { runs: SarifRun[] };
  const ok = validateSarif(log);
  expect(
    ok
      ? []
      : (validateSarif.errors ?? []).map((e) => `${e.instancePath} ${e.message ?? ""}`),
  ).toEqual([]);
  expect(log.runs).toHaveLength(1);
  const run = log.runs[0];
  if (run === undefined) throw new Error("no run");
  return run;
}

describe("renderCheck sarif", () => {
  it("emits one valid run from manni-graph, rooted where the pages are labelled", () => {
    const run = sarifRun(renderCheck(report([language]), "sarif"));
    expect(run.tool.driver.name).toBe("manni-graph");
    expect(run.originalUriBaseIds.SRCROOT?.uri).toBe("file:///repo/docs/");
    expect(run.invocations).toEqual([{ executionSuccessful: true }]);
  });

  it("locates each blamed page at line 1 and carries the guidance", () => {
    const run = sarifRun(renderCheck(report([language, collision]), "sarif"));
    expect(run.results.map((r) => [r.ruleId, r.level, r.locations.map((l) => l.physicalLocation)])).toEqual([
      [
        "manni:graph/Document-language",
        "error",
        [{ artifactLocation: { uri: "l10n-invalid/install.md", uriBaseId: "SRCROOT" }, region: { startLine: 1 } }],
      ],
      [
        "manni:graph/shacl",
        "warning",
        [
          { artifactLocation: { uri: "docs/a.md", uriBaseId: "SRCROOT" }, region: { startLine: 1 } },
          { artifactLocation: { uri: "docs/b.md", uriBaseId: "SRCROOT" }, region: { startLine: 1 } },
        ],
      ],
    ]);
    const [first] = run.results;
    expect(first?.message.text).toBe(
      [
        "Set `lang` to a language tag such as `de` or `pt-BR`, not a language name.",
        "manni:graph-shapes:1.1.1 Document-language: The language the page is written in. Search, filters and per-language indexes group pages by it.",
        "Guide: https://hawkeyexl.github.io/manni/graph/fix/",
      ].join("\n"),
    );
    expect(first?.properties).toEqual({ guidance: LANGUAGE });
    expect(run.results[1]?.properties).toBeUndefined();
  });

  it("describes each rule from its shape", () => {
    const run = sarifRun(renderCheck(report([language, collision]), "sarif"));
    expect(run.tool.driver.rules).toEqual([
      {
        id: "manni:graph/Document-language",
        name: "DocumentLanguage",
        shortDescription: { text: "The Document-language shape." },
        fullDescription: { text: LANGUAGE.description },
        helpUri: LANGUAGE.guide,
      },
      {
        id: "manni:graph/shacl",
        name: "Shacl",
        shortDescription: { text: "A SHACL constraint in the shapes in effect." },
      },
    ]);
    expect(run.results.map((r) => r.ruleIndex)).toEqual([0, 1]);
  });

  it("leaves page-less findings out of results and counts them in a note", () => {
    const pageless = finding({ docs: [], focusNode: "questions" });
    const run = sarifRun(renderCheck(report([language, pageless, { ...pageless }]), "sarif"));
    expect(run.results).toHaveLength(1);
    expect(run.invocations[0]?.toolExecutionNotifications).toEqual([
      { level: "note", message: { text: "2 findings name no page. Run manni graph check to see them." } },
    ]);
  });

  it("says finding in the singular for one page-less finding", () => {
    const run = sarifRun(renderCheck(report([finding({ docs: [] })]), "sarif"));
    expect(run.invocations[0]?.toolExecutionNotifications?.[0]?.message.text).toBe(
      "1 finding names no page. Run manni graph check to see them.",
    );
  });
});
