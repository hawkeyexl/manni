/**
 * `runFill` over `test/fixtures/term/fill/basic`, with the inference library's
 * MockProvider standing in for a model. Each test works in a copy, because
 * fill writes pages.
 *
 * A stub page carries no definition, which `manni:terminology:1.1.0` still
 * requires, so these assert on file content rather than validating pages.
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { MockProvider, type MockResponse } from "@hawkeyexl/inference";
import { parse as parseYaml } from "yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runFill, type FillOptions } from "../../src/term/commands/fill.js";
import { renderFillPretty } from "../../src/term/reporters/fill.js";

const FIXTURE = resolve(__dirname, "..", "fixtures", "term", "fill", "basic");

let work: string;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "manni-term-fill-"));
  cpSync(FIXTURE, work, { recursive: true });
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

function frontmatter(rel: string): Record<string, unknown> {
  const text = readFileSync(join(work, rel), "utf8");
  const block = /^---\n([\s\S]*?)\n---/.exec(text.replace(/\r\n/g, "\n"))?.[1] ?? "";
  return parseYaml(block) as Record<string, unknown>;
}

function definition(text: string, confidence: number): MockResponse {
  return { json: { definition: text, confidence } };
}

function fill(opts: Partial<FillOptions> = {}, responses?: MockResponse[]): ReturnType<typeof runFill> {
  return runFill({
    cwd: work,
    inputs: [],
    noCache: true,
    ...(responses === undefined ? {} : { providerInstance: new MockProvider(responses, "mock-model") }),
    ...opts,
  });
}

describe("term fill, offline", () => {
  it("creates a page per concept pages name, carrying what the pages say", async () => {
    const report = await fill({ offline: true });
    // References first, in walk order (payments.md names Retries), then the edges.
    expect(report.entries.map((e) => [e.action, e.file, e.label, e.definition.status])).toEqual([
      ["create", "docs/glossary/retry.md", "Retry", "missing"],
      ["create", "docs/glossary/errors.md", "Errors", "missing"],
      ["create", "docs/glossary/backoff.md", "Backoff", "carried"],
    ]);
    expect(report.summary).toEqual({ created: 3, filled: 0, skipped: 0, withoutDefinition: 2, turns: 0 });
    // A block's own label is its page naming itself, so retries.md's block is no source.
    expect(report.entries[0]?.from).toEqual(["docs/api/payments.md:5", "docs/api/retries.md:5"]);

    expect(frontmatter("docs/glossary/retry.md")).toEqual({
      title: "Retry",
      type: "term",
      id: "retry",
      language: "en",
      label: "Retry",
      "alt-labels": ["Retries"],
      broader: ["Errors"],
      "related-terms": ["Backoff"],
    });
    expect(frontmatter("docs/glossary/backoff.md")["definition"]).toBe("Waiting longer between each retry.");
    // Jitter has no definition, and nothing offline can write one.
    expect(frontmatter("docs/glossary/jitter.md")["definition"]).toBeUndefined();
  });

  it("writes nothing under --dry-run, and says what it would do", async () => {
    const report = await fill({ offline: true, dryRun: true });
    expect(existsSync(join(work, "docs/glossary/retry.md"))).toBe(false);
    const text = renderFillPretty(report);
    expect(text.split("\n")[0]).toBe("would create docs/glossary/retry.md     Retry     stub, no definition");
    expect(text.split("\n").at(-1)).toBe("3 terms would be created, 0 would be filled, 2 left without a definition");
  });

  it("never replaces a file that is there", async () => {
    writeFileSync(join(work, "docs/glossary/errors.md"), "hand-written\n");
    const report = await fill({ offline: true });
    expect(report.entries.find((e) => e.label === "Errors")?.action).toBe("exists");
    expect(readFileSync(join(work, "docs/glossary/errors.md"), "utf8")).toBe("hand-written\n");
  });

  it("takes -o over the detected directory, and its own format from the pages", async () => {
    await fill({ offline: true, out: "terms" });
    expect(existsSync(join(work, "terms/retry.md"))).toBe(true);
  });

  it("refuses when no directory can be found", async () => {
    rmSync(join(work, "docs/glossary"), { recursive: true });
    await expect(fill({ offline: true })).rejects.toThrow("new term pages need a directory; pass -o or set term.fill.out.");
  });

  it("refuses --crawl with --offline", async () => {
    await expect(fill({ offline: true, crawl: true })).rejects.toThrow(
      "--crawl asks a model to find terms, so it cannot run with --offline.",
    );
  });
});

describe("term fill, with a model", () => {
  it("drafts each missing definition and records it in meta-provenance", async () => {
    const report = await fill({}, [
      definition("Sending a failed request again.", 0.86),
      definition("Something went wrong.", 0.41),
      definition("Random variation added to a delay.", 0.91),
    ]);
    expect(report.entries.map((e) => [e.action, e.label, e.definition.status, e.definition.confidence])).toEqual([
      ["create", "Retry", "drafted", 0.86],
      ["create", "Errors", "below-threshold", 0.41],
      ["create", "Backoff", "carried", undefined],
      ["fill", "Jitter", "drafted", 0.91],
    ]);
    expect(report.entries[0]?.definition.model).toBe("mock/mock-model");
    expect(report.summary).toEqual({ created: 3, filled: 1, skipped: 0, withoutDefinition: 1, turns: 3 });

    const retry = frontmatter("docs/glossary/retry.md");
    expect(retry["definition"]).toBe("Sending a failed request again.");
    expect(retry["meta-provenance"]).toEqual([
      { "generated-by": "mock-model", fields: ["/definition"], confidence: { "/definition": 0.86 } },
    ]);
    // Below the threshold: a stub, and nothing recorded.
    expect(frontmatter("docs/glossary/errors.md")["definition"]).toBeUndefined();
    expect(frontmatter("docs/glossary/errors.md")["meta-provenance"]).toBeUndefined();
    // A carried definition is a person's, not a model's.
    expect(frontmatter("docs/glossary/backoff.md")["meta-provenance"]).toBeUndefined();

    const jitter = frontmatter("docs/glossary/jitter.md");
    expect(jitter["definition"]).toBe("Random variation added to a delay.");
    expect(jitter["title"]).toBe("Jitter");
    expect(jitter["meta-provenance"]).toEqual([
      { "generated-by": "mock-model", fields: ["/definition"], confidence: { "/definition": 0.91 } },
    ]);
  });

  it("skips an existing entry whose draft is under the threshold", async () => {
    const report = await fill({ confidence: 0.95 }, [
      definition("A.", 0.96),
      definition("B.", 0.96),
      definition("Random variation.", 0.5),
    ]);
    const jitter = report.entries.find((e) => e.label === "Jitter");
    expect(jitter).toMatchObject({ action: "skip", definition: { status: "below-threshold", confidence: 0.5 } });
    expect(renderFillPretty(report)).toContain("skipped docs/glossary/jitter.md    Jitter    confidence 0.50 is under 0.95");
    expect(frontmatter("docs/glossary/jitter.md")["definition"]).toBeUndefined();
  });

  it("leaves what the turn budget did not reach, saying why", async () => {
    const report = await fill({ maxTurns: 1 }, [definition("Sending a failed request again.", 0.9)]);
    expect(report.entries.map((e) => [e.action, e.label, e.reason])).toEqual([
      ["create", "Retry", undefined],
      ["skip", "Errors", "turn budget"],
      ["create", "Backoff", undefined],
      ["skip", "Jitter", "turn budget"],
    ]);
    expect(report.summary.turns).toBe(1);
    expect(existsSync(join(work, "docs/glossary/errors.md"))).toBe(false);
  });

  it("skips an entry that is not a term page", async () => {
    writeFileSync(join(work, "terms.yaml"), "quorum:\n  label: Quorum\n");
    writeFileSync(
      join(work, "manni.config.yaml"),
      'collections:\n  - name: pages\n    paths: ["docs/**/*.md"]\nterm:\n  manifests: [terms.yaml]\n',
    );
    const report = await fill({}, [definition("A.", 0.9), definition("B.", 0.9), definition("C.", 0.9)]);
    expect(report.entries.find((e) => e.label === "Quorum")).toMatchObject({ action: "skip", reason: "not a term page" });
  });
});

describe("term fill --crawl", () => {
  const drafts = [definition("A.", 0.9), definition("B.", 0.9), definition("C.", 0.9)];

  it("creates a page for a term the model finds on enough pages", async () => {
    const report = await fill({ crawl: true }, [
      ...drafts,
      // docs/api/payments.md, then docs/api/retries.md: the walk's order.
      {
        json: {
          terms: [
            { label: "idempotency key", "alt-labels": ["Idempotency token"], definition: "A value naming one request.", confidence: 0.88 },
            { label: "Charge", "alt-labels": [], definition: "Money moving.", confidence: 0.95 },
          ],
        },
      },
      {
        json: {
          terms: [
            { label: "Idempotency key", "alt-labels": [], definition: "Weaker.", confidence: 0.7 },
            { label: "Retry", "alt-labels": [], definition: "Known already.", confidence: 0.99 },
          ],
        },
      },
    ]);
    const crawled = report.entries.filter((e) => e.source === "crawl");
    expect(crawled.map((e) => [e.action, e.file, e.label])).toEqual([
      // Spelled as it is first found: payments.md's keyword.
      ["create", "docs/glossary/idempotency-key.md", "Idempotency key"],
    ]);
    expect(crawled[0]?.definition).toEqual({ status: "drafted", confidence: 0.88, model: "mock/mock-model" });
    expect(crawled[0]?.from).toEqual(["docs/api/payments.md:6", "docs/api/retries.md:6"]);
    expect(report.summary.turns).toBe(5);
    const page = frontmatter("docs/glossary/idempotency-key.md");
    expect(page["definition"]).toBe("A value naming one request.");
    expect(page["alt-labels"]).toEqual(["Idempotency token"]);
    expect(page["meta-provenance"]).toEqual([
      {
        "generated-by": "mock-model",
        fields: ["/label", "/alt-labels", "/definition"],
        confidence: { "/label": 0.88, "/alt-labels": 0.88, "/definition": 0.88 },
      },
    ]);
  });

  it("follows term.fill.crawl.minPages", async () => {
    writeFileSync(
      join(work, "manni.config.yaml"),
      'collections:\n  - name: pages\n    paths: ["docs/**/*.md"]\nterm:\n  fill:\n    crawl:\n      minPages: 1\n',
    );
    const report = await fill({ crawl: true }, [
      ...drafts,
      { json: { terms: [{ label: "Charge", "alt-labels": [], definition: "Money moving.", confidence: 0.95 }] } },
      { json: { terms: [] } },
    ]);
    const labels = report.entries.filter((e) => e.source === "crawl").map((e) => e.label);
    // The keywords are on two pages too, so a draft decides them.
    expect(labels).toContain("Charge");
  });

  it("drafts a definition for a keyword on enough pages", async () => {
    const report = await fill({ crawl: true }, [
      ...drafts,
      { json: { terms: [] } },
      { json: { terms: [] } },
      definition("A value naming one request.", 0.8),
    ]);
    const crawled = report.entries.filter((e) => e.source === "crawl");
    expect(crawled.map((e) => [e.action, e.label, e.definition.status])).toEqual([
      ["create", "Idempotency key", "drafted"],
    ]);
    expect(crawled[0]?.from).toEqual(["docs/api/payments.md:6", "docs/api/retries.md:6"]);
  });

  it("reports a candidate under the threshold as skipped", async () => {
    const low = { label: "Idempotency key", "alt-labels": [], definition: "Unsure.", confidence: 0.3 };
    const report = await fill({ crawl: true }, [...drafts, { json: { terms: [low] } }, { json: { terms: [low] } }]);
    const crawled = report.entries.filter((e) => e.source === "crawl");
    expect(crawled.map((e) => [e.action, e.definition.status])).toEqual([["skip", "below-threshold"]]);
    expect(existsSync(join(work, "docs/glossary/idempotency-key.md"))).toBe(false);
  });
});
