import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderFill, runFill } from "../../../src/kg/commands/fill.js";
import { MockProvider } from "@hawkeyexl/inference";

function setup(files: Record<string, string>, config = ""): string {
  const dir = mkdtempSync(join(tmpdir(), "dockg-fill-"));
  writeFileSync(
    join(dir, "manni.config.yaml"),
    `kg:\n  version: 1\n  inputs: ["*.md"]\n${config.replace(/^(?=.)/gm, "  ")}`,
  );
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

const PROPOSAL = {
  label: "Query Syntax",
  "alt-labels": ["query language"],
  "related-concepts": ["Search Operators"],
  concepts: ["search"],
  // Above the 0.7 default gate so these fields are written (ADR 01015).
  confidence: {
    label: 0.95,
    "alt-labels": 0.9,
    "related-concepts": 0.85,
    concepts: 0.9,
  },
};

/** Restrict fill to the four SKOS fields the pre-confidence tests assumed. */
const SKOS_FIELDS =
  "fill:\n  fields: [label, alt-labels, related-concepts, concepts]\n";

/** A mock response for `json`, with high confidence auto-added for every
 *  value field so it clears the confidence gate (ADR 01015). */
function conf(json: Record<string, unknown>): {
  json: Record<string, unknown>;
} {
  const confidence: Record<string, number> = {};
  for (const k of Object.keys(json)) confidence[k] = 0.95;
  return { json: { ...json, confidence } };
}

describe("runFill", () => {
  it("writes proposed fields into frontmatter", async () => {
    const dir = setup({ "a.md": "---\ntitle: Query Syntax\n---\n\n# Q\n" });
    const provider = new MockProvider([{ json: PROPOSAL }]);
    const report = await runFill({ cwd: dir, providerInstance: provider });
    expect(report.exitCode).toBe(0);
    expect(report.results[0]).toMatchObject({ status: "filled" });
    const written = readFileSync(join(dir, "a.md"), "utf8");
    expect(written).toContain("label: Query Syntax");
    expect(written).toContain("related-concepts: [ Search Operators ]");
    expect(written.endsWith("# Q\n")).toBe(true);
  });

  it("--dry-run reports but does not write", async () => {
    const original = "---\ntitle: T\n---\n\n# Q\n";
    const dir = setup({ "a.md": original });
    const provider = new MockProvider([{ json: PROPOSAL }]);
    const report = await runFill({
      cwd: dir,
      providerInstance: provider,
      dryRun: true,
    });
    expect(report.results[0]).toMatchObject({ status: "proposed" });
    expect(readFileSync(join(dir, "a.md"), "utf8")).toBe(original);
  });

  it("skips docs whose requested fields are all present", async () => {
    const dir = setup(
      {
        "a.md":
          "---\nkg:\n  label: X\n  alt-labels: [y]\n  related-concepts: [z]\n  concepts: [s]\n---\n",
      },
      SKOS_FIELDS,
    );
    const provider = new MockProvider([{ json: PROPOSAL }]);
    const report = await runFill({ cwd: dir, providerInstance: provider });
    expect(report.results[0]).toMatchObject({ status: "complete" });
    expect(provider.requests).toHaveLength(0);
  });

  it("caches proposals: identical content never re-asks the provider", async () => {
    const dir = setup({ "a.md": "---\ntitle: T\n---\n\n# Q\n" });
    const provider = new MockProvider([{ json: PROPOSAL }]);
    await runFill({ cwd: dir, providerInstance: provider, dryRun: true });
    await runFill({ cwd: dir, providerInstance: provider, dryRun: true });
    expect(provider.requests).toHaveLength(1);
  });

  it("stops proposing when the cost budget is exhausted", async () => {
    const dir = setup({
      "a.md": "---\ntitle: A\n---\n",
      "b.md": "---\ntitle: B\n---\n",
    });
    // huge usage so the first call exceeds any budget; model name must be
    // priced in the cost table for the budget to accrue
    const provider = new MockProvider(
      [
        {
          json: PROPOSAL,
          usage: { inputTokens: 10_000_000, outputTokens: 1_000_000 },
        },
      ],
      "claude-sonnet-4-5",
    );
    const report = await runFill({
      cwd: dir,
      providerInstance: provider,
      dryRun: true,
      maxCost: 0.01,
      noCache: true,
    });
    expect(report.results.map((r) => r.status)).toEqual([
      "proposed",
      "skipped-budget",
    ]);
    expect(provider.requests).toHaveLength(1);
  });

  it("says so when the cost cap cannot be applied to the model", async () => {
    // The bug this pins: pricingFor returns undefined for any model outside the
    // six in the price table, costOfUsage then returns 0, and `costUsd >= cap`
    // never fires. The cap defaults to 5 USD, so the silent case was the common
    // one — every claude-cli model, every local model, every model newer than
    // the table. A run reported "$0.0000" whether it was free or unmeasured.
    const dir = setup({
      "a.md": "---\ntitle: A\n---\n",
      "b.md": "---\ntitle: B\n---\n",
    });
    const provider = new MockProvider(
      [
        {
          json: PROPOSAL,
          usage: { inputTokens: 10_000_000, outputTokens: 1_000_000 },
        },
      ],
      "some-unpriced-model",
    );
    const report = await runFill({
      cwd: dir,
      providerInstance: provider,
      dryRun: true,
      maxCost: 0.01,
      noCache: true,
    });

    expect(report.budget).toBe("unpriceable");
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]).toContain("cannot be enforced");
    expect(report.warnings[0]).toContain("some-unpriced-model");

    // Unchanged and deliberate: dockg cannot total an unpriceable run, so it
    // cannot stop one either. Both documents are still processed — the fix is
    // that the report no longer implies a cap was in force.
    expect(report.results.map((r) => r.status)).toEqual([
      "proposed",
      "proposed",
    ]);
    expect(renderFill(report, "pretty")).toContain("LLM cost: unpriceable");
    expect(renderFill(report, "pretty")).not.toContain("$0.0000");
  });

  it("enforces the cap when the model is priced", async () => {
    const dir = setup({ "a.md": "---\ntitle: A\n---\n" });
    const provider = new MockProvider([{ json: PROPOSAL }], "gpt-4o-mini");
    const report = await runFill({
      cwd: dir,
      providerInstance: provider,
      dryRun: true,
      maxCost: 5,
      noCache: true,
    });
    expect(report.budget).toBe("enforced");
    expect(report.warnings).toEqual([]);
    expect(renderFill(report, "pretty")).toContain("LLM cost: $");
  });

  it("reports no budget when the cap is switched off on a priced model", async () => {
    const dir = setup(
      { "a.md": "---\ntitle: A\n---\n" },
      "fill:\n  maxCostUsd: null\n",
    );
    const provider = new MockProvider([{ json: PROPOSAL }], "gpt-4o-mini");
    const report = await runFill({
      cwd: dir,
      providerInstance: provider,
      dryRun: true,
      noCache: true,
    });
    expect(report.budget).toBe("off");
    expect(report.warnings).toEqual([]);
    // Priced, so the total means something and is worth printing.
    expect(renderFill(report, "pretty")).toContain("LLM cost: $");
  });

  it("still says unpriceable when no cap was set, without warning", async () => {
    // `budget` answers two questions that are not the same: can the cap be
    // applied, and is `costUsd` measurable at all. Keying the render on the cap
    // let an uncapped run against an unpriced model print a confident
    // "$0.0000" — the very output ADR 01027 exists to remove.
    const dir = setup(
      { "a.md": "---\ntitle: A\n---\n" },
      "fill:\n  maxCostUsd: null\n",
    );
    const provider = new MockProvider([{ json: PROPOSAL }], "unpriced-too");
    const report = await runFill({
      cwd: dir,
      providerInstance: provider,
      dryRun: true,
      noCache: true,
    });
    expect(report.budget).toBe("unpriceable");
    // No cap was asked for, so there is nothing to warn about.
    expect(report.warnings).toEqual([]);
    expect(renderFill(report, "pretty")).not.toContain("$0.0000");
  });

  it("reports a local provider as free, and does not warn about a cap", async () => {
    const dir = setup({ "a.md": "---\ntitle: A\n---\n" });
    const provider = new MockProvider(
      [{ json: PROPOSAL }],
      "granite-4.1-3b-q2",
    );
    // The provider name is what makes it free; llama-cpp cannot spend, so the
    // default 5 USD cap has nothing to enforce and must not warn.
    Object.defineProperty(provider, "provider", { value: () => "llama-cpp" });
    const report = await runFill({
      cwd: dir,
      providerInstance: provider,
      dryRun: true,
      noCache: true,
    });
    expect(report.budget).toBe("free");
    expect(report.warnings).toEqual([]);
    expect(renderFill(report, "pretty")).toContain("LLM cost: none");
  });

  it("reports schema-invalid proposals as errors with exit 1", async () => {
    const dir = setup({ "a.md": "---\ntitle: T\n---\n" });
    // Both attempts fail: the mock cycles its single scripted response.
    const provider = new MockProvider([{ json: { label: 42 } }]);
    const report = await runFill({
      cwd: dir,
      providerInstance: provider,
      noCache: true,
    });
    expect(report.results[0]).toMatchObject({ status: "error" });
    expect(report.exitCode).toBe(1);
  });

  it("retries once when the first proposal is schema-invalid", async () => {
    // fill used to abort a document on a single malformed response. One bad
    // completion is not worth losing the work over, so the shared inference
    // layer retries once before recording an error.
    const dir = setup({ "a.md": "---\ntitle: T\n---\n" });
    const provider = new MockProvider([
      { json: { label: 42 } },
      { json: PROPOSAL },
    ]);
    const report = await runFill({
      cwd: dir,
      providerInstance: provider,
      noCache: true,
    });
    expect(report.results[0]).toMatchObject({ status: "filled" });
    expect(report.exitCode).toBe(0);
    expect(readFileSync(join(dir, "a.md"), "utf8")).toContain(
      "label: Query Syntax",
    );
  });

  it("retries a transient provider error before giving up", async () => {
    const dir = setup({ "a.md": "---\ntitle: T\n---\n" });
    const provider = new MockProvider([
      { error: "503 upstream unavailable" },
      { json: PROPOSAL },
    ]);
    const report = await runFill({
      cwd: dir,
      providerInstance: provider,
      noCache: true,
    });
    expect(report.results[0]).toMatchObject({ status: "filled" });
    expect(report.exitCode).toBe(0);
  });

  it("writes kg.provenance naming the model and filled fields, in the same write", async () => {
    const dir = setup({ "a.md": "---\ntitle: T\n---\n\n# T\n" });
    const provider = new MockProvider([{ json: PROPOSAL }], "test-model");
    const report = await runFill({ cwd: dir, providerInstance: provider });
    expect(report.results[0]).toMatchObject({ status: "filled" });
    const written = readFileSync(join(dir, "a.md"), "utf8");
    expect(written).toContain("provenance:");
    expect(written).toContain("generated-by: test-model");
    expect(written).toMatch(
      /fields: \[ alt-labels, concepts, label, related-concepts \]/,
    );
    expect(written.endsWith("# T\n")).toBe(true); // body still byte-preserved
    // provenance is metadata, not a reported filled field
    expect(report.results[0]?.fields).not.toContain("provenance");
  });

  it("keeps per-model provenance entries so a second model never claims the first's fields", async () => {
    const dir = setup(
      { "a.md": "---\ntitle: T\n---\n" },
      "fill:\n  fields: [label]\n",
    );
    await runFill({
      cwd: dir,
      providerInstance: new MockProvider([conf({ label: "X" })], "m1"),
    });
    // second run with a broader field set fills concepts too — different model
    const { writeFileSync: write } = await import("node:fs");
    write(
      join(dir, "manni.config.yaml"),
      'kg:\n  version: 1\n  inputs: ["*.md"]\n  fill:\n    fields: [label, concepts]\n',
    );
    await runFill({
      cwd: dir,
      providerInstance: new MockProvider([conf({ concepts: ["s"] })], "m2"),
    });
    const written = readFileSync(join(dir, "a.md"), "utf8");
    // one entry per model, each attributing only its own fields
    expect(written).toMatch(/generated-by: m1[\s\S]*?fields: \[ label \]/);
    expect(written).toMatch(/generated-by: m2[\s\S]*?fields: \[ concepts \]/);
  });

  it("moves a field's attribution when --force re-fills it with another model", async () => {
    const dir = setup(
      { "a.md": "---\ntitle: T\n---\n" },
      "fill:\n  fields: [label]\n",
    );
    await runFill({
      cwd: dir,
      providerInstance: new MockProvider([conf({ label: "X" })], "m1"),
    });
    await runFill({
      cwd: dir,
      force: true,
      providerInstance: new MockProvider([conf({ label: "Y" })], "m2"),
    });
    const written = readFileSync(join(dir, "a.md"), "utf8");
    expect(written).toContain("label: Y");
    expect(written).toMatch(/generated-by: m2[\s\S]*?fields: \[ label \]/);
    expect(written).not.toContain("m1"); // m1's emptied entry is dropped
  });

  it("skips provenance write-back when writeProvenance is false", async () => {
    const dir = setup(
      { "a.md": "---\ntitle: T\n---\n" },
      "fill:\n  writeProvenance: false\n",
    );
    const provider = new MockProvider([{ json: PROPOSAL }]);
    await runFill({ cwd: dir, providerInstance: provider });
    expect(readFileSync(join(dir, "a.md"), "utf8")).not.toContain("provenance");
  });

  it("does not treat an existing provenance entry as a fillable field", async () => {
    const dir = setup(
      {
        "a.md":
          "---\nkg:\n  label: X\n  alt-labels: [y]\n  related-concepts: [z]\n  concepts: [s]\n  provenance:\n    - generated-by: old\n      fields: [label]\n---\n",
      },
      SKOS_FIELDS,
    );
    const provider = new MockProvider([{ json: PROPOSAL }]);
    const report = await runFill({ cwd: dir, providerInstance: provider });
    expect(report.results[0]).toMatchObject({ status: "complete" });
    expect(provider.requests).toHaveLength(0);
  });

  it("refuses a doc whose provenance is the dropped single-object form", async () => {
    // `provenance` is overwritten wholesale, and docmeta:kg made it array-only
    // (ADR 01023) — so filling over the legacy shape would silently delete
    // another model's outstanding review record. Refuse, don't overwrite.
    const legacy =
      "---\ntitle: T\nkg:\n  provenance:\n    generated-by: old-model\n    fields: [label]\n---\n";
    const dir = setup({ "a.md": legacy, "b.md": "---\ntitle: OK\n---\n" });
    const provider = new MockProvider([{ json: PROPOSAL }, { json: PROPOSAL }]);
    const report = await runFill({ cwd: dir, providerInstance: provider });

    const a = report.results.find((r) => r.path === "a.md");
    expect(a).toMatchObject({ status: "error" });
    expect(a?.error).toMatch(/single-object/);
    // Untouched: the old attribution is still there to migrate by hand.
    expect(readFileSync(join(dir, "a.md"), "utf8")).toBe(legacy);
    // One bad doc does not abort the run.
    expect(report.results.find((r) => r.path === "b.md")?.status).toBe(
      "filled",
    );
  });

  it("reports TOML-frontmatter docs as per-doc errors without corrupting them", async () => {
    const toml = '+++\ntitle = "Hugo"\n+++\n\n# Hugo doc\n';
    const dir = setup({ "a.md": toml, "b.md": "---\ntitle: OK\n---\n" });
    const provider = new MockProvider([{ json: PROPOSAL }]);
    const report = await runFill({ cwd: dir, providerInstance: provider });
    const a = report.results.find((r) => r.path === "a.md");
    expect(a).toMatchObject({ status: "error" });
    expect(a?.error).toMatch(/YAML frontmatter/);
    expect(readFileSync(join(dir, "a.md"), "utf8")).toBe(toml); // untouched
    // the rest of the run continued
    expect(report.results.find((r) => r.path === "b.md")).toMatchObject({
      status: "filled",
    });
    expect(report.exitCode).toBe(1);
  });

  it("contains per-doc frontmatter errors instead of aborting the run", async () => {
    const dir = setup({
      "a.md": "---\ntitle: unterminated\n", // no closing fence
      "b.md": "---\nkg: not-a-map\n---\n",
      "c.md": "---\ntitle: fine\n---\n",
    });
    const provider = new MockProvider([{ json: PROPOSAL }]);
    const report = await runFill({ cwd: dir, providerInstance: provider });
    const statuses = Object.fromEntries(
      report.results.map((r) => [r.path, r.status]),
    );
    expect(statuses["a.md"]).toBe("error");
    expect(statuses["b.md"]).toBe("error");
    expect(statuses["c.md"]).toBe("filled");
  });

  it("needs no provider credentials when every doc is complete", async () => {
    const dir = setup(
      { "a.md": "---\nkg:\n  label: X\n---\n" },
      "fill:\n  provider: anthropic\n  fields: [label]\n",
    );
    delete process.env["ANTHROPIC_API_KEY"];
    // no providerInstance: the factory would throw if constructed eagerly
    const report = await runFill({ cwd: dir });
    expect(report.results[0]).toMatchObject({ status: "complete" });
  });

  it("re-asks the provider when a cached proposal is schema-invalid", async () => {
    const dir = setup({ "a.md": "---\ntitle: T\n---\n" });
    const good = new MockProvider([{ json: PROPOSAL }]);
    await runFill({ cwd: dir, providerInstance: good, dryRun: true });
    // corrupt the cache entry on disk
    const cacheDir = join(dir, ".manni", "kg", "cache");
    const { readdirSync, writeFileSync: write } = await import("node:fs");
    const entry = readdirSync(cacheDir)[0]!;
    write(join(cacheDir, entry), JSON.stringify({ label: 42 }));
    const second = new MockProvider([{ json: PROPOSAL }]);
    const report = await runFill({
      cwd: dir,
      providerInstance: second,
      dryRun: true,
    });
    expect(second.requests).toHaveLength(1); // cache invalid -> re-asked
    expect(report.results[0]).toMatchObject({
      status: "proposed",
      cached: false,
    });
  });

  it("never writes relation fields without a label", async () => {
    const dir = setup({ "a.md": "---\ntitle: T\n---\n" });
    const provider = new MockProvider([
      conf({ "alt-labels": ["x"], "related-concepts": ["y"], concepts: ["s"] }),
    ]);
    const report = await runFill({ cwd: dir, providerInstance: provider });
    // alt-labels/related require label (0.1 dependentRequired) — dropped
    expect(report.results[0]?.fields).toEqual(["concepts"]);
    const written = readFileSync(join(dir, "a.md"), "utf8");
    expect(written).not.toContain("alt-labels");
    expect(written).toContain("concepts: [ s ]");
  });

  it("rejects proposals with duplicate array entries (uniqueItems)", async () => {
    const dir = setup({ "a.md": "---\ntitle: T\n---\n" });
    const provider = new MockProvider([{ json: { concepts: ["s", "s"] } }]);
    const report = await runFill({
      cwd: dir,
      providerInstance: provider,
      noCache: true,
    });
    expect(report.results[0]).toMatchObject({ status: "error" });
  });

  it("respects config fill.fields (asks only for missing, allowed fields)", async () => {
    const dir = setup(
      { "a.md": "---\nkg:\n  label: Kept\n---\n" },
      "fill:\n  fields: [label, concepts]\n",
    );
    const provider = new MockProvider([conf({ concepts: ["search"] })]);
    const report = await runFill({ cwd: dir, providerInstance: provider });
    expect(report.results[0]).toMatchObject({
      status: "filled",
      fields: ["concepts"],
    });
    const written = readFileSync(join(dir, "a.md"), "utf8");
    expect(written).toContain("label: Kept");
    // provider was only asked for the missing field
    expect(provider.requests[0]!.user).toContain("concepts");
    expect(provider.requests[0]!.user).not.toContain("label,");
  });
});

describe("runFill confidence gate (ADR 01015)", () => {
  it("writes high-confidence fields and reports low-confidence ones without writing", async () => {
    const dir = setup({ "a.md": "---\ntitle: T\n---\n\n# T\n" }, SKOS_FIELDS);
    const provider = new MockProvider([
      {
        json: {
          label: "Config",
          concepts: ["search"],
          confidence: { label: 0.95, concepts: 0.3 },
          reasoning: { concepts: "only tangentially about search" },
        },
      },
    ]);
    const report = await runFill({ cwd: dir, providerInstance: provider });
    // Normal operation: low-confidence drops do not fail the run.
    expect(report.exitCode).toBe(0);
    const r = report.results[0]!;
    expect(r.status).toBe("filled");
    expect(r.fields).toEqual(["label"]);
    expect(r.lowConfidence).toEqual([
      {
        field: "concepts",
        confidence: 0.3,
        reasoning: "only tangentially about search",
      },
    ]);
    const written = readFileSync(join(dir, "a.md"), "utf8");
    expect(written).toContain("label: Config");
    expect(written).not.toContain("concepts");
  });

  it("records per-field confidence in kg.provenance", async () => {
    const dir = setup({ "a.md": "---\ntitle: T\n---\n" }, SKOS_FIELDS);
    const provider = new MockProvider(
      [{ json: { label: "Config", confidence: { label: 0.91 } } }],
      "m1",
    );
    await runFill({ cwd: dir, providerInstance: provider });
    const written = readFileSync(join(dir, "a.md"), "utf8");
    expect(written).toMatch(/generated-by: m1/);
    expect(written).toMatch(/confidence:[\s\S]*?label: 0\.91/);
  });

  it("a malformed score costs that field, not the whole proposal", async () => {
    // ADR 01034. Reproduced against llama3.2:1b at temperature 0, which
    // deterministically returned a string for one score — and dockg threw away
    // a perfectly good `concepts` array over it, reporting `error`. The values
    // are the contract; the self-reported scores ride alongside.
    const dir = setup({ "a.md": "---\ntitle: T\n---\n\n# T\n" }, SKOS_FIELDS);
    const provider = new MockProvider([
      {
        json: {
          label: "Config",
          concepts: ["search"],
          confidence: { label: "high", concepts: 0.95 },
        },
      },
    ]);
    const report = await runFill({ cwd: dir, providerInstance: provider });

    expect(report.exitCode).toBe(0);
    const r = report.results[0]!;
    expect(r.status).toBe("filled");
    // `label` goes unscored, so the gate drops it exactly as it would an
    // absent score. `concepts` is unaffected by its neighbour.
    expect(r.fields).toEqual(["concepts"]);
    expect(r.lowConfidence?.map((l) => l.field)).toEqual(["label"]);
  });

  it("treats an out-of-range score as unscored, not as certainty", async () => {
    // A percentage where a fraction was asked for. GBNF cannot express
    // `minimum`/`maximum`, so no grammar stops it and 90 would otherwise clear
    // every threshold — the model's mistake read as maximum confidence.
    const dir = setup({ "a.md": "---\ntitle: T\n---\n\n# T\n" }, SKOS_FIELDS);
    const provider = new MockProvider([
      { json: { label: "Config", confidence: { label: 90.5 } } },
    ]);
    const report = await runFill({ cwd: dir, providerInstance: provider });

    expect(report.results[0]?.status).toBe("nothing-proposed");
    expect(report.results[0]?.lowConfidence?.[0]).toMatchObject({
      field: "label",
      confidence: 0,
    });
  });

  it("a field with no confidence score is never written", async () => {
    const dir = setup({ "a.md": "---\ntitle: T\n---\n" }, SKOS_FIELDS);
    // label proposed but unscored — the model must score to write.
    const provider = new MockProvider([{ json: { label: "Config" } }]);
    const report = await runFill({ cwd: dir, providerInstance: provider });
    expect(report.results[0]?.status).toBe("nothing-proposed");
    expect(report.results[0]?.lowConfidence?.[0]?.field).toBe("label");
  });

  it("--min-confidence overrides the config threshold", async () => {
    const dir = setup({ "a.md": "---\ntitle: T\n---\n" }, SKOS_FIELDS);
    const provider = new MockProvider([
      { json: { label: "Config", confidence: { label: 0.8 } } },
    ]);
    // Raise the bar above 0.8: the field is now dropped.
    const report = await runFill({
      cwd: dir,
      providerInstance: provider,
      minConfidence: 0.9,
    });
    expect(report.results[0]?.status).toBe("nothing-proposed");
    expect(readFileSync(join(dir, "a.md"), "utf8")).not.toContain("label");
  });

  it("fills an iiRDS field (type) at high confidence", async () => {
    const dir = setup(
      { "a.md": "---\ntitle: Install Guide\n---\n\n# Install\n" },
      "fill:\n  fields: [type]\n",
    );
    const provider = new MockProvider([
      { json: { type: "task", confidence: { type: 0.9 } } },
    ]);
    const report = await runFill({ cwd: dir, providerInstance: provider });
    expect(report.results[0]?.status).toBe("filled");
    expect(readFileSync(join(dir, "a.md"), "utf8")).toContain("type: task");
  });

  it("the guardrail rejects a variant proposed as both applicable and not-applicable", async () => {
    const dir = setup(
      { "a.md": "---\ntitle: T\nkg:\n  applies-to: [SP-X1]\n---\n\n# T\n" },
      "fill:\n  fields: [not-applicable-to]\n  minConfidence: 0\n",
    );
    // The model (over)proposes excluding the same variant the doc applies to.
    const provider = new MockProvider([
      { json: { "not-applicable-to": ["SP-X1"] } },
    ]);
    const report = await runFill({ cwd: dir, providerInstance: provider });
    expect(report.results[0]?.rejected).toContain("not-applicable-to");
    expect(readFileSync(join(dir, "a.md"), "utf8")).not.toContain(
      "not-applicable-to",
    );
  });
});

describe("runFill graph guardrail (fill.validateGraph)", () => {
  // Confidence gate disabled here (minConfidence 0) so these tests exercise the
  // structural SHACL guardrail in isolation; the bare proposals carry no scores.
  const HIERARCHY_CONFIG =
    "fill:\n  fields: [label, broader, related-concepts]\n  minConfidence: 0\n";

  it("rejects a broader proposal that would create a cycle", async () => {
    const dir = setup(
      {
        // Human-set hierarchy: Alpha is below Beta.
        "a.md":
          "---\ntitle: A\nkg:\n  label: Alpha\n  broader: [Beta]\n---\n\n# A\n",
        "b.md": "---\ntitle: B\n---\n\n# B\n",
      },
      HIERARCHY_CONFIG,
    );
    // Model proposes the inverse for b.md — a two-node cycle.
    const provider = new MockProvider([
      { json: { label: "Beta", broader: ["Alpha"] } },
    ]);
    const report = await runFill({ cwd: dir, providerInstance: provider });
    expect(report.exitCode).toBe(0);
    const result = report.results.find((r) => r.path === "b.md");
    expect(result).toMatchObject({ status: "filled", fields: ["label"] });
    expect(result!.rejected).toContain("broader");
    const written = readFileSync(join(dir, "b.md"), "utf8");
    expect(written).toContain("label: Beta");
    expect(written).not.toContain("broader");
  });

  it("accumulates accepted proposals so two docs cannot jointly form a cycle", async () => {
    const dir = setup(
      {
        "c.md": "---\ntitle: C\n---\n\n# C\n",
        "d.md": "---\ntitle: D\n---\n\n# D\n",
      },
      HIERARCHY_CONFIG,
    );
    const provider = new MockProvider([
      { json: { label: "C", broader: ["D"] } },
      { json: { label: "D", broader: ["C"] } },
    ]);
    const report = await runFill({ cwd: dir, providerInstance: provider });
    const first = report.results.find((r) => r.path === "c.md");
    const second = report.results.find((r) => r.path === "d.md");
    expect(first).toMatchObject({ fields: ["label", "broader"] });
    expect(second!.rejected).toContain("broader");
    expect(readFileSync(join(dir, "d.md"), "utf8")).not.toContain("broader");
  });

  it("rejects a label that collides with an existing concept spelling", async () => {
    const dir = setup(
      {
        "a.md": "---\ntitle: A\ntags: [Setup]\n---\n\n# A\n",
        "b.md": "---\ntitle: B\n---\n\n# B\n",
      },
      HIERARCHY_CONFIG,
    );
    // Same slug, different spelling — would put two prefLabels on one concept.
    const provider = new MockProvider([{ json: { label: "setup" } }]);
    const original = readFileSync(join(dir, "b.md"), "utf8");
    const report = await runFill({ cwd: dir, providerInstance: provider });
    const result = report.results.find((r) => r.path === "b.md");
    expect(result!.rejected).toContain("label");
    expect(result).toMatchObject({ status: "nothing-proposed" });
    expect(readFileSync(join(dir, "b.md"), "utf8")).toBe(original);
  });

  it("accepts a label that reuses the existing spelling exactly", async () => {
    const dir = setup(
      {
        "a.md": "---\ntitle: A\ntags: [Setup]\n---\n\n# A\n",
        "b.md": "---\ntitle: B\n---\n\n# B\n",
      },
      HIERARCHY_CONFIG,
    );
    const provider = new MockProvider([{ json: { label: "Setup" } }]);
    const report = await runFill({ cwd: dir, providerInstance: provider });
    expect(report.results.find((r) => r.path === "b.md")).toMatchObject({
      status: "filled",
      fields: ["label"],
    });
  });

  it("guards against the whole corpus even when filling a subset glob", async () => {
    const dir = setup(
      {
        "a.md":
          "---\ntitle: A\nkg:\n  label: Alpha\n  broader: [Beta]\n---\n\n# A\n",
        "b.md": "---\ntitle: B\n---\n\n# B\n",
      },
      HIERARCHY_CONFIG,
    );
    const provider = new MockProvider([
      { json: { label: "Beta", broader: ["Alpha"] } },
    ]);
    // Only b.md is in scope — the cycle partner a.md is not — but the
    // guard must still see a.md's hierarchy.
    const report = await runFill({
      cwd: dir,
      globs: ["b.md"],
      providerInstance: provider,
    });
    const result = report.results.find((r) => r.path === "b.md");
    expect(result!.rejected).toContain("broader");
    expect(readFileSync(join(dir, "b.md"), "utf8")).not.toContain("broader");
  });

  it("fill.validateGraph: false writes the cycle anyway", async () => {
    const dir = setup(
      {
        "a.md":
          "---\ntitle: A\nkg:\n  label: Alpha\n  broader: [Beta]\n---\n\n# A\n",
        "b.md": "---\ntitle: B\n---\n\n# B\n",
      },
      "fill:\n  fields: [label, broader, related-concepts]\n  validateGraph: false\n  minConfidence: 0\n",
    );
    const provider = new MockProvider([
      { json: { label: "Beta", broader: ["Alpha"] } },
    ]);
    const report = await runFill({ cwd: dir, providerInstance: provider });
    expect(report.results.find((r) => r.path === "b.md")).toMatchObject({
      status: "filled",
      fields: ["label", "broader"],
    });
    expect(readFileSync(join(dir, "b.md"), "utf8")).toContain("broader");
  });

  it("noValidateGraph option overrides config", async () => {
    const dir = setup(
      {
        "a.md":
          "---\ntitle: A\nkg:\n  label: Alpha\n  broader: [Beta]\n---\n\n# A\n",
        "b.md": "---\ntitle: B\n---\n\n# B\n",
      },
      HIERARCHY_CONFIG,
    );
    const provider = new MockProvider([
      { json: { label: "Beta", broader: ["Alpha"] } },
    ]);
    const report = await runFill({
      cwd: dir,
      providerInstance: provider,
      noValidateGraph: true,
    });
    expect(readFileSync(join(dir, "b.md"), "utf8")).toContain("broader");
    expect(
      report.results.find((r) => r.path === "b.md")!.rejected,
    ).toBeUndefined();
  });
});
