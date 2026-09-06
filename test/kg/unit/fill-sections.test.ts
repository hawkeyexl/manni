/**
 * `manni kg fill` proposing per-section metadata (ADR 01032).
 *
 * The interesting cases are the refusals. Section metadata is explicit-only
 * (ADR 01013), so writing a block against a heading that does not exist would
 * mint a `dockg:brokenSectionRef` — a finding `stats` reports and `fill` must
 * never manufacture.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderFill, runFill } from "../../../src/kg/commands/fill.js";
import { runValidate } from "../../../src/kg/commands/validate.js";
import { runBuild } from "../../../src/kg/commands/build.js";
import { runCheck } from "../../../src/kg/commands/check.js";
import { MockProvider } from "@hawkeyexl/inference";

const PAGE = [
  "---",
  "title: Widget SDK",
  "---",
  "",
  "# Widget SDK",
  "",
  "Intro prose.",
  "",
  "## Install the SDK",
  "",
  "Installation steps.",
  "",
  "## Troubleshoot a failed install",
  "",
  "What to do when it breaks.",
  "",
].join("\n");

function setup(fields = "[type]"): string {
  const dir = mkdtempSync(join(tmpdir(), "dockg-fillsec-"));
  writeFileSync(
    join(dir, "manni.config.yaml"),
    `kg:\n  version: 1\n  inputs: ["*.md"]\n  fill:\n    fields: ${fields}\n`,
  );
  writeFileSync(join(dir, "a.md"), PAGE);
  return dir;
}

/** A proposal with a document type and per-section types. */
function proposal(sections: Array<Record<string, unknown>>) {
  return {
    type: "reference",
    confidence: { type: 0.9 },
    sections,
  };
}

describe("fill --sections", () => {
  it("writes per-section metadata under the matching slug", async () => {
    const dir = setup();
    const provider = new MockProvider([
      {
        json: proposal([
          {
            slug: "install-the-sdk",
            type: "task",
            confidence: { type: 0.95 },
          },
          {
            slug: "troubleshoot-a-failed-install",
            type: "troubleshooting",
            confidence: { type: 0.9 },
          },
        ]),
      },
    ]);

    const report = await runFill({
      cwd: dir,
      providerInstance: provider,
      sections: true,
      noCache: true,
    });

    expect(report.exitCode).toBe(0);
    const written = readFileSync(join(dir, "a.md"), "utf8");
    expect(written).toContain("sections:");
    expect(written).toContain("install-the-sdk:");
    expect(written).toContain("troubleshoot-a-failed-install:");
    // The document keeps its own type; sections carry theirs.
    expect(written).toMatch(/type: reference/);
    expect(written).toMatch(/type: task/);
    expect(written).toMatch(/type: troubleshooting/);
  });

  it("drops a slug that matches no heading, and says so", async () => {
    const dir = setup();
    const provider = new MockProvider([
      {
        json: proposal([
          { slug: "install-the-sdk", type: "task", confidence: { type: 0.95 } },
          // A heading that does not exist. Writing this would create a
          // dockg:brokenSectionRef in the graph.
          { slug: "renamed-heading", type: "task", confidence: { type: 0.99 } },
        ]),
      },
    ]);

    const report = await runFill({
      cwd: dir,
      providerInstance: provider,
      sections: true,
      noCache: true,
    });

    const result = report.results[0]!;
    expect(result.unknownSections).toEqual(["renamed-heading"]);
    expect(renderFill(report, "pretty")).toContain(
      "no such section: renamed-heading",
    );

    const written = readFileSync(join(dir, "a.md"), "utf8");
    expect(written).toContain("install-the-sdk:");
    expect(written).not.toContain("renamed-heading");
  });

  it("gates section fields on confidence, like document fields", async () => {
    const dir = setup();
    const provider = new MockProvider([
      {
        json: proposal([
          { slug: "install-the-sdk", type: "task", confidence: { type: 0.2 } },
        ]),
      },
    ]);

    const report = await runFill({
      cwd: dir,
      providerInstance: provider,
      sections: true,
      noCache: true,
    });

    const result = report.results[0]!;
    expect(result.lowConfidence?.map((l) => l.field)).toContain(
      "sections.install-the-sdk.type",
    );
    expect(readFileSync(join(dir, "a.md"), "utf8")).not.toContain("sections:");
  });

  it("never overwrites a section field a human set", async () => {
    const dir = setup();
    writeFileSync(
      join(dir, "a.md"),
      PAGE.replace(
        "title: Widget SDK",
        "title: Widget SDK\nkg:\n  sections:\n    install-the-sdk:\n      type: concept",
      ),
    );
    const provider = new MockProvider([
      {
        json: proposal([
          { slug: "install-the-sdk", type: "task", confidence: { type: 0.95 } },
          {
            slug: "troubleshoot-a-failed-install",
            type: "troubleshooting",
            confidence: { type: 0.95 },
          },
        ]),
      },
    ]);

    const report = await runFill({
      cwd: dir,
      providerInstance: provider,
      sections: true,
      noCache: true,
    });

    const written = readFileSync(join(dir, "a.md"), "utf8");
    // Preservation is decided at the leaf, so the human's value survives while
    // the section beside it is still filled.
    expect(written).toContain("type: concept");
    expect(written).not.toContain("type: task");
    expect(written).toContain("troubleshoot-a-failed-install:");
    expect(report.results[0]!.preserved).toContain(
      "sections.install-the-sdk.type",
    );
  });

  it("vets section proposals against the shapes, and blames the section", async () => {
    // Regression: GUARDED_FIELDS held bare names, so `sections.<slug>.applies-to`
    // matched none of them and vet() returned before simulating anything. A
    // section that applied and did not apply to the same variant was written,
    // and the next `manni kg check` exited 1 on a file fill had just produced.
    const dir = setup("[applies-to, not-applicable-to]");
    const provider = new MockProvider([
      {
        json: {
          sections: [
            {
              slug: "install-the-sdk",
              "applies-to": ["SP-X100"],
              "not-applicable-to": ["SP-X100"],
              confidence: { "applies-to": 0.95, "not-applicable-to": 0.95 },
            },
          ],
        },
      },
    ]);

    const report = await runFill({
      cwd: dir,
      providerInstance: provider,
      sections: true,
      noCache: true,
    });

    const result = report.results[0]!;
    // The negative side is dropped, and named by its SECTION — blaming the
    // bare `not-applicable-to` would drop a document-level value instead.
    expect(result.rejected).toEqual([
      "sections.install-the-sdk.not-applicable-to",
    ]);
    const written = readFileSync(join(dir, "a.md"), "utf8");
    expect(written).toContain("applies-to");
    expect(written).not.toContain("not-applicable-to");
  });

  it("writes provenance dockg validate accepts", async () => {
    // Regression: dotted section names went straight into kg.provenance, whose
    // `fields` and `confidence` keys the vendored docmeta:kg schema bounds to
    // the twelve document-level names — so every default `--sections` run wrote
    // frontmatter dockg's own validate rejected with 3 Ajv errors.
    const dir = setup();
    const provider = new MockProvider([
      {
        json: proposal([
          { slug: "install-the-sdk", type: "task", confidence: { type: 0.95 } },
        ]),
      },
    ]);

    const report = await runFill({
      cwd: dir,
      providerInstance: provider,
      sections: true,
      noCache: true,
    });

    const written = readFileSync(join(dir, "a.md"), "utf8");
    expect(written).toContain("install-the-sdk:");
    // The section value is written; only its provenance entry is omitted.
    expect(written).not.toContain("sections.install-the-sdk.type");

    const validated = await runValidate({ cwd: dir, globs: ["a.md"] });
    expect(validated.exitCode, JSON.stringify(validated.run)).toBe(0);

    // And the gap is loud rather than silent.
    expect(report.warnings.join(" ")).toContain(
      "NOT recorded in kg.provenance",
    );
  });

  it("still fills sections when the document's own fields are complete", async () => {
    // Regression: `missing.length === 0` short-circuited to `complete` before
    // any section handling, so the primary workflow — fill the corpus, then
    // enable --sections — did nothing on every already-annotated page.
    const dir = setup();
    writeFileSync(
      join(dir, "a.md"),
      PAGE.replace(
        "title: Widget SDK",
        "title: Widget SDK\nkg:\n  type: reference",
      ),
    );
    const provider = new MockProvider([
      {
        json: {
          sections: [
            {
              slug: "install-the-sdk",
              type: "task",
              confidence: { type: 0.95 },
            },
          ],
        },
      },
    ]);

    const report = await runFill({
      cwd: dir,
      providerInstance: provider,
      sections: true,
      noCache: true,
    });

    expect(report.results[0]!.status).not.toBe("complete");
    const written = readFileSync(join(dir, "a.md"), "utf8");
    expect(written).toContain("install-the-sdk:");
    // The human's document-level value is untouched.
    expect(written).toContain("type: reference");
  });

  it("offers the section fields to the provider, not just accepts them back", async () => {
    // MockProvider returns its canned JSON whatever schema it is handed, so a
    // test that only asserts on the written file proves the WRITE path and
    // says nothing about the REQUEST path. This provider answers *from* the
    // schema it was given, the way a provider under strict structured output
    // is constrained to — so a field missing from the schema cannot appear in
    // the response, and the file assertion below becomes evidence about both.
    const dir = setup();
    writeFileSync(
      join(dir, "a.md"),
      PAGE.replace(
        "title: Widget SDK",
        "title: Widget SDK\nkg:\n  type: reference",
      ),
    );

    let sectionProperties: string[] = [];
    const schemaBound = {
      provider: () => "mock",
      modelName: () => "m1",
      completeJSON: (req: { schema?: Record<string, unknown> }) => {
        const props = (req.schema?.["properties"] ?? {}) as Record<
          string,
          { items?: { properties?: Record<string, unknown> } }
        >;
        const item = props["sections"]?.items?.properties ?? {};
        sectionProperties = Object.keys(item).sort();
        // Answer only with what the schema actually offers.
        const json: Record<string, unknown> = {};
        if ("sections" in props && "type" in item) {
          json["sections"] = [
            {
              slug: "install-the-sdk",
              type: "task",
              confidence: { type: 0.95 },
            },
          ];
        }
        return Promise.resolve({ json });
      },
    };

    const report = await runFill({
      cwd: dir,
      providerInstance: schemaBound,
      sections: true,
      noCache: true,
    });

    expect(sectionProperties).toEqual([
      "confidence",
      "reasoning",
      "slug",
      "type",
    ]);
    expect(report.results[0]!.fields).toEqual([
      "sections.install-the-sdk.type",
    ]);
    expect(readFileSync(join(dir, "a.md"), "utf8")).toContain(
      "install-the-sdk:",
    );
  });

  it("writes sections dockg check accepts", async () => {
    // The end-to-end claim ADR 01032 makes, run against the real SHACL engine
    // rather than against the guard's own return value: propose, write, build,
    // check. `vet()` returning clean is not the same as `manni kg check` exiting 0.
    const dir = setup("[applies-to, not-applicable-to]");
    const provider = new MockProvider([
      {
        json: {
          sections: [
            {
              slug: "install-the-sdk",
              "applies-to": ["SP-X100"],
              confidence: { "applies-to": 0.95 },
            },
            {
              slug: "troubleshoot-a-failed-install",
              "not-applicable-to": ["SP-X100"],
              confidence: { "not-applicable-to": 0.95 },
            },
          ],
        },
      },
    ]);

    await runFill({
      cwd: dir,
      providerInstance: provider,
      sections: true,
      noCache: true,
    });

    const built = await runBuild({ cwd: dir, out: join(dir, "graph.ttl") });
    expect(built.docs).toBe(1);
    const checked = await runCheck({ cwd: dir, graph: join(dir, "graph.ttl") });
    expect(checked.exitCode, JSON.stringify(checked.findings)).toBe(0);
    expect(checked.findings).toHaveLength(0);
  });

  it("proposes nothing for sections unless asked", async () => {
    const dir = setup();
    const provider = new MockProvider([
      {
        json: proposal([
          { slug: "install-the-sdk", type: "task", confidence: { type: 0.95 } },
        ]),
      },
    ]);

    // Sections are opt-in: the schema does not offer them, and a provider that
    // volunteers them anyway is narrowed away rather than written.
    const report = await runFill({
      cwd: dir,
      providerInstance: provider,
      noCache: true,
    });

    expect(readFileSync(join(dir, "a.md"), "utf8")).not.toContain("sections:");
    expect(report.results[0]!.unknownSections).toBeUndefined();
  });
});
