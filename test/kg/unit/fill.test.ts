import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { defined } from "../helpers/defined.js";
import { parse } from "yaml";
import { renderFill, runFill } from "../../../src/kg/commands/fill.js";
import { resetWarnings } from "../../../src/shared/warn.js";
import { MockProvider } from "@hawkeyexl/inference";

function setup(files: Record<string, string>, config = ""): string {
  const dir = mkdtempSync(join(tmpdir(), "manni-kg-fill-"));
  writeFileSync(
    join(dir, "manni.config.yaml"),
    `collections:\n  - name: c\n    paths: ["*.md"]\nkg:\n${config.replace(/^(?=.)/gm, "  ")}`,
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

/** A written page's frontmatter, parsed — `meta-provenance` is a page-level key. */
function pageData(dir: string, name = "a.md"): Record<string, unknown> {
  const text = readFileSync(join(dir, name), "utf8");
  const end = text.indexOf("\n---", 4);
  return (parse(text.slice(4, end)) ?? {}) as Record<string, unknown>;
}

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

  it("stops proposing when the turn budget is exhausted", async () => {
    // Turns, not dollars (proposal 0051 §3): one inference call is one turn,
    // countable for every model, where a price was known for six of them.
    const dir = setup({
      "a.md": "---\ntitle: A\n---\n",
      "b.md": "---\ntitle: B\n---\n",
    });
    const provider = new MockProvider([{ json: PROPOSAL }], "any-model");
    const report = await runFill({
      cwd: dir,
      providerInstance: provider,
      dryRun: true,
      maxTurns: 1,
      noCache: true,
    });
    expect(report.results.map((r) => r.status)).toEqual([
      "proposed",
      "skipped",
    ]);
    expect(report.results[1]?.reason).toBe("turn budget");
    expect(provider.requests).toHaveLength(1);
    expect(report.turnsUsed).toBe(1);
    expect(report.maxTurns).toBe(1);
    expect(renderFill(report, "pretty")).toContain("skipped   b.md (turn budget)");
  });

  it("reads fill.maxTurns from config when no flag is given", async () => {
    const dir = setup(
      {
        "a.md": "---\ntitle: A\n---\n",
        "b.md": "---\ntitle: B\n---\n",
      },
      "fill:\n  maxTurns: 1\n",
    );
    const provider = new MockProvider([{ json: PROPOSAL }], "any-model");
    const report = await runFill({
      cwd: dir,
      providerInstance: provider,
      dryRun: true,
      noCache: true,
    });
    expect(report.results.map((r) => r.status)).toEqual([
      "proposed",
      "skipped",
    ]);
  });

  it("is unbounded by default, and spends no turn on a cached page", async () => {
    const dir = setup({
      "a.md": "---\ntitle: A\n---\n",
      "b.md": "---\ntitle: B\n---\n",
    });
    const first = new MockProvider([{ json: PROPOSAL }], "any-model");
    const warm = await runFill({
      cwd: dir,
      providerInstance: first,
      dryRun: true,
    });
    expect(warm.results.map((r) => r.status)).toEqual(["proposed", "proposed"]);
    expect(warm.maxTurns).toBeNull();
    expect(warm.turnsUsed).toBe(2);

    // Both pages are cached now, so a budget of one turn stops nothing: a
    // cached proposal makes no inference call (docevals ADR 01019).
    const second = new MockProvider([{ json: PROPOSAL }], "any-model");
    const report = await runFill({
      cwd: dir,
      providerInstance: second,
      dryRun: true,
      maxTurns: 1,
    });
    expect(report.results.map((r) => r.status)).toEqual([
      "proposed",
      "proposed",
    ]);
    expect(report.turnsUsed).toBe(0);
    expect(second.requests).toHaveLength(0);
  });

  it("reports no cost line at all", async () => {
    // The dollar cap is gone with kg ADR 01027's subject matter: a total that
    // read as "$0.0000" for every model outside the library's price table.
    const dir = setup({ "a.md": "---\ntitle: A\n---\n" });
    const provider = new MockProvider([{ json: PROPOSAL }], "any-model");
    const report = await runFill({
      cwd: dir,
      providerInstance: provider,
      dryRun: true,
      noCache: true,
    });
    const pretty = renderFill(report, "pretty");
    expect(pretty).not.toContain("LLM cost");
    expect(pretty).not.toContain("$0.0000");
    expect(report).not.toHaveProperty("costUsd");
    expect(report).not.toHaveProperty("budget");
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

  it("writes page-level meta-provenance naming the model and pointers, in the same write", async () => {
    const dir = setup({ "a.md": "---\ntitle: T\n---\n\n# T\n" });
    const provider = new MockProvider([{ json: PROPOSAL }], "test-model");
    const report = await runFill({ cwd: dir, providerInstance: provider });
    expect(report.results[0]).toMatchObject({ status: "filled" });
    const data = pageData(dir);
    // Top level, not under `kg` — the `kg` block has no `provenance` any more.
    expect(data["kg"]).not.toHaveProperty("provenance");
    expect(data["meta-provenance"]).toEqual([
      {
        "generated-by": "test-model",
        fields: [
          "/kg/alt-labels",
          "/kg/concepts",
          "/kg/label",
          "/kg/related-concepts",
        ],
        confidence: {
          "/kg/alt-labels": 0.9,
          "/kg/concepts": 0.9,
          "/kg/label": 0.95,
          "/kg/related-concepts": 0.85,
        },
      },
    ]);
    const written = readFileSync(join(dir, "a.md"), "utf8");
    expect(written.endsWith("# T\n")).toBe(true); // body still byte-preserved
    // meta-provenance is a page record, not a reported filled field
    expect(report.results[0]?.fields).not.toContain("provenance");
    expect(report.results[0]?.fields).not.toContain("meta-provenance");
  });

  it("merges a second run into the same entry rather than duplicating it", async () => {
    const dir = setup(
      { "a.md": "---\ntitle: T\n---\n" },
      "fill:\n  fields: [label]\n",
    );
    await runFill({
      cwd: dir,
      providerInstance: new MockProvider([conf({ label: "X" })], "m1"),
    });
    // second run with a broader field set fills concepts too — same model
    const { writeFileSync: write } = await import("node:fs");
    write(
      join(dir, "manni.config.yaml"),
      'collections:\n  - name: c\n    paths: ["*.md"]\nkg:\n  fill:\n    fields: [label, concepts]\n',
    );
    await runFill({
      cwd: dir,
      providerInstance: new MockProvider([conf({ concepts: ["s"] })], "m1"),
    });
    expect(pageData(dir)["meta-provenance"]).toEqual([
      {
        "generated-by": "m1",
        fields: ["/kg/label", "/kg/concepts"],
        confidence: { "/kg/label": 0.95, "/kg/concepts": 0.95 },
      },
    ]);
  });

  it("keeps per-model entries so a second model never claims the first's fields", async () => {
    const dir = setup(
      { "a.md": "---\ntitle: T\n---\n" },
      "fill:\n  fields: [label]\n",
    );
    await runFill({
      cwd: dir,
      providerInstance: new MockProvider([conf({ label: "X" })], "m1"),
    });
    const { writeFileSync: write } = await import("node:fs");
    write(
      join(dir, "manni.config.yaml"),
      'collections:\n  - name: c\n    paths: ["*.md"]\nkg:\n  fill:\n    fields: [label, concepts]\n',
    );
    await runFill({
      cwd: dir,
      providerInstance: new MockProvider([conf({ concepts: ["s"] })], "m2"),
    });
    expect(pageData(dir)["meta-provenance"]).toEqual([
      {
        "generated-by": "m1",
        fields: ["/kg/label"],
        confidence: { "/kg/label": 0.95 },
      },
      {
        "generated-by": "m2",
        fields: ["/kg/concepts"],
        confidence: { "/kg/concepts": 0.95 },
      },
    ]);
  });

  it("preserves an entry another tool wrote for another model", async () => {
    // `meta-provenance` is the whole family's record: docevals names evals in
    // it, meta names its own pointers. A kg fill must not evict either.
    const dir = setup(
      {
        "a.md":
          "---\ntitle: T\nmeta-provenance:\n  - generated-by: other-model\n    fields: [/intent]\n    evals: [install-works]\n    confidence:\n      /intent: 0.8\n---\n",
      },
      "fill:\n  fields: [label]\n",
    );
    await runFill({
      cwd: dir,
      providerInstance: new MockProvider([conf({ label: "X" })], "m1"),
    });
    expect(pageData(dir)["meta-provenance"]).toEqual([
      {
        "generated-by": "other-model",
        fields: ["/intent"],
        evals: ["install-works"],
        confidence: { "/intent": 0.8 },
      },
      {
        "generated-by": "m1",
        fields: ["/kg/label"],
        confidence: { "/kg/label": 0.95 },
      },
    ]);
  });

  it("leaves the first model's pointer in place when --force re-fills it", async () => {
    // meta's merge touches only the running model's entry (proposal 0046, "The
    // merge"). kg's own record used to strip the overwritten field from every
    // other entry; that rule was kg's and does not survive the move. Both
    // entries now name /kg/label, and a reviewer deletes the stale one.
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
    expect(readFileSync(join(dir, "a.md"), "utf8")).toContain("label: Y");
    expect(pageData(dir)["meta-provenance"]).toEqual([
      {
        "generated-by": "m1",
        fields: ["/kg/label"],
        confidence: { "/kg/label": 0.95 },
      },
      {
        "generated-by": "m2",
        fields: ["/kg/label"],
        confidence: { "/kg/label": 0.95 },
      },
    ]);
  });

  it("skips the meta-provenance write-back when writeProvenance is false", async () => {
    const dir = setup(
      { "a.md": "---\ntitle: T\n---\n" },
      "fill:\n  writeProvenance: false\n",
    );
    const provider = new MockProvider([{ json: PROPOSAL }]);
    await runFill({ cwd: dir, providerInstance: provider });
    expect(readFileSync(join(dir, "a.md"), "utf8")).not.toContain(
      "meta-provenance",
    );
  });

  it("refuses a doc that still carries kg.provenance", async () => {
    // Proposal 0046 closed the `kg` block on fifteen properties and dropped
    // `provenance` from it. Filling would leave an unreviewable record behind
    // that nothing reads and `manni kg validate` rejects — name the migration.
    const legacy =
      "---\ntitle: T\nkg:\n  provenance:\n    - generated-by: old-model\n      fields: [label]\n---\n";
    const dir = setup({ "a.md": legacy, "b.md": "---\ntitle: OK\n---\n" });
    const provider = new MockProvider([{ json: PROPOSAL }, { json: PROPOSAL }]);
    const report = await runFill({ cwd: dir, providerInstance: provider });

    const a = report.results.find((r) => r.path === "a.md");
    expect(a).toMatchObject({ status: "error" });
    expect(a?.error).toMatch(/meta-provenance/);
    // Untouched: the old attribution is still there to migrate by hand.
    expect(readFileSync(join(dir, "a.md"), "utf8")).toBe(legacy);
    // One bad doc does not abort the run.
    expect(report.results.find((r) => r.path === "b.md")?.status).toBe(
      "filled",
    );
    expect(report.exitCode).toBe(1);
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
      "provider: anthropic\nfill:\n  fields: [label]\n",
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
    const entry = defined(readdirSync(cacheDir)[0]);
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
    expect(provider.requests[0]?.user).toContain("concepts");
    expect(provider.requests[0]?.user).not.toContain("label,");
  });

  it("--fields overrides config fill.fields, as meta fill's does", async () => {
    const dir = setup(
      { "a.md": "---\ntitle: T\n---\n" },
      "fill:\n  fields: [label]\n",
    );
    const provider = new MockProvider([conf({ concepts: ["search"] })]);
    const report = await runFill({
      cwd: dir,
      providerInstance: provider,
      fields: ["concepts"],
    });
    expect(report.results[0]).toMatchObject({
      status: "filled",
      fields: ["concepts"],
    });
    expect(provider.requests[0]?.user).toContain("concepts");
  });
});

describe("runFill provider selection (proposal 0051 §3)", () => {
  it("says what --local replaced, once, before it fills", async () => {
    const dir = setup(
      { "a.md": "---\ntitle: T\n---\n" },
      "provider: anthropic\n",
    );
    const written: string[] = [];
    resetWarnings();
    const spy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        written.push(String(chunk));
        return true;
      });
    try {
      const provider = new MockProvider([{ json: PROPOSAL }]);
      const report = await runFill({
        cwd: dir,
        providerInstance: provider,
        local: true,
        dryRun: true,
        noCache: true,
      });
      expect(report.exitCode).toBe(0);
      expect(written).toEqual([
        'manni: --local: using llama-cpp instead of "anthropic" from kg.provider.\n',
      ]);
    } finally {
      spy.mockRestore();
      resetWarnings();
    }
  });

  it("refuses --local beside a hosted --provider before reading a file", async () => {
    const dir = setup({ "a.md": "---\ntitle: T\n---\n" });
    await expect(
      runFill({
        cwd: dir,
        providerInstance: new MockProvider([{ json: PROPOSAL }]),
        local: true,
        provider: "anthropic",
      }),
    ).rejects.toThrow(
      "--local and --provider anthropic contradict each other: --local runs inference on " +
        "this machine with llama-cpp. Drop one of them.",
    );
  });

  it("refuses an unknown --provider even with a provider injected", async () => {
    const dir = setup({ "a.md": "---\ntitle: T\n---\n" });
    await expect(
      runFill({
        cwd: dir,
        providerInstance: new MockProvider([{ json: PROPOSAL }]),
        provider: "gemini",
      }),
    ).rejects.toThrow(
      'Unknown provider "gemini". Available: anthropic, openai, claude-cli, llama-cpp, auto.',
    );
  });

  it("refuses a model with no provider to own it", async () => {
    const dir = setup({ "a.md": "---\ntitle: T\n---\n" });
    await expect(
      runFill({
        cwd: dir,
        providerInstance: new MockProvider([{ json: PROPOSAL }]),
        model: "some-model",
      }),
    ).rejects.toThrow(
      'Model "some-model" was given without a provider: a model name does not say which ' +
        "provider owns it. Set --provider or kg.provider to one of anthropic, openai, " +
        "claude-cli, llama-cpp, or drop the model to take the detected provider's default.",
    );
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
    const r = defined(report.results[0]);
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

  it("records per-pointer confidence in meta-provenance", async () => {
    const dir = setup({ "a.md": "---\ntitle: T\n---\n" }, SKOS_FIELDS);
    const provider = new MockProvider(
      [{ json: { label: "Config", confidence: { label: 0.91 } } }],
      "m1",
    );
    await runFill({ cwd: dir, providerInstance: provider });
    expect(pageData(dir)["meta-provenance"]).toEqual([
      {
        "generated-by": "m1",
        fields: ["/kg/label"],
        confidence: { "/kg/label": 0.91 },
      },
    ]);
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
    const r = defined(report.results[0]);
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

  it("--confidence overrides the configured fill.confidenceThreshold", async () => {
    // The names meta, docevals and tracevals all use (proposal 0051 §3): the
    // flag is `--confidence` and the key is `fill.confidenceThreshold`.
    const dir = setup(
      { "a.md": "---\ntitle: T\n---\n" },
      `${SKOS_FIELDS}  confidenceThreshold: 0.5\n`,
    );
    const provider = new MockProvider([
      { json: { label: "Config", confidence: { label: 0.8 } } },
    ]);
    // Raise the bar above 0.8: the field is now dropped.
    const report = await runFill({
      cwd: dir,
      providerInstance: provider,
      confidence: 0.9,
    });
    expect(report.results[0]?.status).toBe("nothing-proposed");
    expect(readFileSync(join(dir, "a.md"), "utf8")).not.toContain("label");
  });

  it("fill.confidenceThreshold gates on its own when no flag is given", async () => {
    const dir = setup(
      { "a.md": "---\ntitle: T\n---\n" },
      `${SKOS_FIELDS}  confidenceThreshold: 0.9\n`,
    );
    const provider = new MockProvider([
      { json: { label: "Config", confidence: { label: 0.8 } } },
    ]);
    const report = await runFill({ cwd: dir, providerInstance: provider });
    expect(report.results[0]?.status).toBe("nothing-proposed");
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
      "fill:\n  fields: [not-applicable-to]\n  confidenceThreshold: 0\n",
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
  // Confidence gate disabled here (confidenceThreshold 0) so these tests exercise the
  // structural SHACL guardrail in isolation; the bare proposals carry no scores.
  const HIERARCHY_CONFIG =
    "fill:\n  fields: [label, broader, related-concepts]\n  confidenceThreshold: 0\n";

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
    expect(result?.rejected).toContain("broader");
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
    expect(second?.rejected).toContain("broader");
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
    expect(result?.rejected).toContain("label");
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
      paths: ["b.md"],
      providerInstance: provider,
    });
    const result = report.results.find((r) => r.path === "b.md");
    expect(result?.rejected).toContain("broader");
    expect(readFileSync(join(dir, "b.md"), "utf8")).not.toContain("broader");
  });

  it("fill.validateGraph: false writes the cycle anyway", async () => {
    const dir = setup(
      {
        "a.md":
          "---\ntitle: A\nkg:\n  label: Alpha\n  broader: [Beta]\n---\n\n# A\n",
        "b.md": "---\ntitle: B\n---\n\n# B\n",
      },
      "fill:\n  fields: [label, broader, related-concepts]\n  validateGraph: false\n  confidenceThreshold: 0\n",
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
      defined(report.results.find((r) => r.path === "b.md")).rejected,
    ).toBeUndefined();
  });
});
