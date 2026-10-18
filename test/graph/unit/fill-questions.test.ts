/**
 * `graph fill`'s question pass (proposal 0086): re-pin, pair, re-pair and
 * draft. Each case runs over its own fixture under
 * `test/graph/fixtures/questions/fill-*`, copied to a temp directory because
 * fill writes. The model is the inference library's `MockProvider`.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { MockProvider } from "@hawkeyexl/inference";
import { renderFill, runFill } from "../../../src/graph/commands/fill.js";
import { bodyOf } from "../../../src/graph/commands/questions.js";
import { hashLines, parseLines, pinOfLines } from "../../../src/shared/pin.js";
import { noOfflineModel } from "../../../src/shared/providers.js";
import { resetWarnings } from "../../../src/shared/warn.js";
import { GraphError } from "../../../src/graph/types.js";
import { LOCAL_MODEL, localModelEnv } from "../../helpers/local-model.js";

const FIXTURES = resolve(__dirname, "..", "fixtures", "questions");
const dirs: string[] = [];

function work(fixture: string): string {
  const dir = mkdtempSync(join(tmpdir(), `manni-graph-${fixture}-`));
  cpSync(join(FIXTURES, fixture), dir, { recursive: true });
  dirs.push(dir);
  return dir;
}

/** One edit to a copied fixture's config. */
function editConfig(dir: string, from: string, to: string): void {
  const config = join(dir, "manni.config.yaml");
  writeFileSync(config, readFileSync(config, "utf8").replace(from, to));
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  resetWarnings();
});

/** A Markdown page's `sample-questions`, parsed. */
function questionsOf(dir: string, page: string): unknown[] {
  const text = readFileSync(join(dir, page), "utf8");
  const end = text.indexOf("\n---", 4);
  const data = (parse(text.slice(4, end)) ?? {}) as Record<string, unknown>;
  const held = data["sample-questions"];
  return Array.isArray(held) ? held : [];
}

/** The answer a pin names, read back from the page as written. */
function answerText(dir: string, page: string, lines: number | string): string {
  const range = parseLines(lines);
  if (range === undefined) throw new Error(`bad lines ${String(lines)}`);
  const { body } = bodyOf(readFileSync(join(dir, page), "utf8"), "markdown");
  return body.slice(range.start - 1, range.end).join("\n");
}

const answer = (pairs: unknown[], drafts: unknown[] = []) => ({ json: { pairs, drafts } });

describe("graph fill drafts questions", () => {
  it("drafts up to perPage, gated, with the quote pinned and never written", async () => {
    const dir = work("fill-draft");
    const provider = new MockProvider(
      [
        answer(
          [],
          [
            { question: "Can I pause an upload?", quote: "Pause it from the menu.", confidence: 0.99 },
            { question: "How large may an upload be?", quote: "Open the upload list", confidence: 0.98 },
            { question: "Open the upload list and choose retry?", quote: "Open the upload list and choose retry.", confidence: 0.97 },
            { question: "How often does the client try again?", quote: "The client tries three more times", confidence: 0.9 },
            { question: "Where do I resend a failed upload?", quote: "choose   retry", confidence: 0.8 },
            { question: "Does a retry wait?", quote: "waiting longer each time", confidence: 0.3 },
          ],
        ),
      ],
      "mock-model",
    );
    const report = await runFill({ cwd: dir, paths: ["docs/retry.md"], providerInstance: provider, noCache: true });

    expect(report.exitCode).toBe(0);
    expect(provider.requests).toHaveLength(1);
    const [result] = report.results;
    expect(result).toMatchObject({ path: "docs/retry.md", status: "filled", fields: ["sample-questions"] });
    expect(result?.questions).toEqual([
      { action: "dropped", question: "Can I pause an upload?", reason: "answer not on page" },
      { action: "dropped", question: "How large may an upload be?", reason: "duplicate of docs/limits.md" },
      {
        action: "dropped",
        question: "Open the upload list and choose retry?",
        reason: "copies its answer (6 of 6 word pairs)",
      },
      { action: "drafted", question: "How often does the client try again?", confidence: 0.9, lines: "8" },
      { action: "drafted", question: "Where do I resend a failed upload?", confidence: 0.8, lines: "4" },
      {
        action: "dropped",
        question: "Does a retry wait?",
        confidence: 0.3,
        reason: "low confidence, not written",
      },
    ]);

    const written = questionsOf(dir, "docs/retry.md");
    expect(written).toEqual([
      {
        question: "How often does the client try again?",
        answers: [{ lines: 8, integrity: hashLines("The client tries three more times, waiting longer each time.") }],
        "generated-by": "mock/mock-model",
        confidence: 0.9,
        reviewed: false,
      },
      {
        question: "Where do I resend a failed upload?",
        answers: [{ lines: 4, integrity: hashLines("Open the upload list and choose retry.") }],
        "generated-by": "mock/mock-model",
        confidence: 0.8,
        reviewed: false,
      },
    ]);
    // The quote is never written.
    expect(readFileSync(join(dir, "docs/retry.md"), "utf8")).not.toContain("choose   retry");
  });

  it("names the page's concepts in the prompt", async () => {
    const dir = work("fill-draft");
    const provider = new MockProvider([answer([])]);
    await runFill({ cwd: dir, paths: ["docs/retry.md"], providerInstance: provider, noCache: true, dryRun: true });
    const [request] = provider.requests;
    expect(request?.user).toContain("- Upload retry (also: resend)");
    expect(request?.user).toContain("Draft 3 new questions");
  });

  it("writes no generated-by or confidence when writeProvenance is off, and still marks the draft", async () => {
    const dir = work("fill-draft");
    editConfig(dir, "  fill:\n", "  fill:\n    writeProvenance: false\n");
    const provider = new MockProvider([
      answer([], [{ question: "How often does the client try again?", quote: "The client tries three more times", confidence: 0.9 }]),
    ]);
    await runFill({ cwd: dir, paths: ["docs/retry.md"], providerInstance: provider, noCache: true });
    expect(questionsOf(dir, "docs/retry.md")).toEqual([
      {
        question: "How often does the client try again?",
        answers: [{ lines: 8, integrity: hashLines("The client tries three more times, waiting longer each time.") }],
        reviewed: false,
      },
    ]);
  });

  it("splits a long body at --chunk-chars and keeps the most confident drafts", async () => {
    const dir = work("fill-draft");
    const provider = new MockProvider([
      answer([], [{ question: "Where do I resend a failed upload?", quote: "choose retry", confidence: 0.75 }]),
      answer([], [{ question: "How often does the client try again?", quote: "The client tries three more times", confidence: 0.9 }]),
    ]);
    const report = await runFill({
      cwd: dir,
      paths: ["docs/retry.md"],
      providerInstance: provider,
      noCache: true,
      dryRun: true,
      chunkChars: 70,
    });
    expect(provider.requests.length).toBeGreaterThan(1);
    expect(report.results[0]?.status).toBe("proposed");
    // Pooled across chunks: most confident first, and a repeat is a duplicate.
    const drafted = report.results[0]?.questions?.filter((q) => q.action === "drafted");
    expect(drafted?.map((q) => q.question)).toEqual([
      "How often does the client try again?",
      "Where do I resend a failed upload?",
    ]);
  });

  it("dry run writes nothing and reports proposed", async () => {
    const dir = work("fill-draft");
    const before = readFileSync(join(dir, "docs/retry.md"), "utf8");
    const provider = new MockProvider([
      answer([], [{ question: "How often does the client try again?", quote: "The client tries three more times", confidence: 0.9 }]),
    ]);
    const report = await runFill({ cwd: dir, paths: ["docs/retry.md"], providerInstance: provider, noCache: true, dryRun: true });
    expect(report.results[0]).toMatchObject({ status: "proposed", fields: ["sample-questions"] });
    expect(readFileSync(join(dir, "docs/retry.md"), "utf8")).toBe(before);
  });

  it("stops at the turn budget and says so", async () => {
    const dir = work("fill-draft");
    const provider = new MockProvider([answer([])]);
    const report = await runFill({
      cwd: dir,
      paths: ["docs/retry.md", "docs/limits.md"],
      providerInstance: provider,
      noCache: true,
      dryRun: true,
      maxTurns: 1,
    });
    expect(report.turnsUsed).toBe(1);
    expect(report.results.find((r) => r.path === "docs/retry.md")).toMatchObject({
      status: "skipped",
      reason: "turn budget",
    });
  });
});

describe("graph fill pairs and re-pins questions", () => {
  it("re-pins and mints with no model, and pairs a person's question unreviewed", async () => {
    const dir = work("fill-pair");
    const provider = new MockProvider([
      answer([{ index: 1, quote: "Open the upload list and choose retry.", confidence: 0.85 }]),
    ]);
    const report = await runFill({ cwd: dir, providerInstance: provider, noCache: true });
    expect(report.exitCode).toBe(0);
    // Only the unpaired question is asked about.
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]?.user).toContain("1. How do I retry a failed upload?");
    expect(provider.requests[0]?.user).toContain("Draft no new questions.");
    expect(report.results[0]?.questions).toEqual([
      { action: "re-pinned", question: "How many times does the client retry?", lines: "8" },
      { action: "re-pinned", question: "How do I resume a paused upload?", from: "9", lines: "12" },
      { action: "paired", question: "How do I retry a failed upload?", confidence: 0.85, lines: "4" },
    ]);
    const [paired, minted, moved] = questionsOf(dir, "docs/retry.md") as Record<string, unknown>[];
    // The question text and its standing are untouched; the pin is a draft.
    expect(paired).toEqual({
      question: "How do I retry a failed upload?",
      answers: [{ lines: 4, integrity: hashLines("Open the upload list and choose retry."), reviewed: false }],
    });
    expect(minted).toEqual({
      question: "How many times does the client retry?",
      answers: [{ lines: 8, integrity: hashLines("The client tries three more times, waiting longer each time.") }],
    });
    expect(moved?.answers).toEqual([
      { lines: 12, integrity: hashLines("Choose resume to continue a paused upload where it stopped.") },
    ]);
    expect(answerText(dir, "docs/retry.md", 12)).toBe("Choose resume to continue a paused upload where it stopped.");
  });

  it("keeps a question it cannot pair, and says why", async () => {
    const dir = work("fill-pair");
    const before = questionsOf(dir, "docs/retry.md")[0];
    for (const [pairs, reason] of [
      [[], "no passage answers it"],
      [[{ index: 1, quote: "Retry from the command line.", confidence: 0.9 }], "answer not on page"],
      [[{ index: 1, quote: "choose retry", confidence: 0.2 }], "low confidence, not written"],
    ] as const) {
      const report = await runFill({
        cwd: dir,
        providerInstance: new MockProvider([answer([...pairs])]),
        noCache: true,
        dryRun: true,
      });
      expect(report.results[0]?.questions?.at(-1)).toMatchObject({ action: "not-paired", reason });
    }
    expect(questionsOf(dir, "docs/retry.md")[0]).toEqual(before);
  });

  it("re-pairs a changed answer, writing the new pin unreviewed", async () => {
    const dir = work("fill-repair");
    const provider = new MockProvider([answer([{ index: 1, quote: "two gigabytes each", confidence: 0.9 }])]);
    const report = await runFill({ cwd: dir, providerInstance: provider, noCache: true });
    expect(report.results[0]?.questions).toEqual([
      { action: "re-paired", question: "How large may an upload be?", confidence: 0.9, lines: "4" },
    ]);
    expect(questionsOf(dir, "docs/upload.md")).toEqual([
      {
        question: "How large may an upload be?",
        answers: [{ lines: 4, integrity: hashLines("Uploads may be two gigabytes each."), reviewed: false }],
      },
    ]);
  });

  it("costs a complete page no turn", async () => {
    const dir = work("fill-pair");
    await runFill({ cwd: dir, providerInstance: new MockProvider([answer([{ index: 1, quote: "choose retry", confidence: 0.9 }])]), noCache: true });
    const provider = new MockProvider([answer([])]);
    const report = await runFill({ cwd: dir, providerInstance: provider, noCache: true });
    expect(provider.requests).toHaveLength(0);
    expect(report.results[0]).toMatchObject({ status: "complete" });
  });

  it("re-pins a golden-set file's answers, and drafts nothing there", async () => {
    const dir = work("fill-file");
    const provider = new MockProvider([answer([])]);
    const report = await runFill({ cwd: dir, paths: ["docs/rotate.md"], providerInstance: provider, noCache: true });
    expect(provider.requests).toHaveLength(0);
    expect(report.results.map((r) => [r.path, r.status])).toEqual([
      ["docs/rotate.md", "complete"],
      ["questions.yaml", "filled"],
    ]);
    const question = "After rotating the key, how do I check nothing broke?";
    expect(report.results[1]?.questions).toEqual([
      { action: "re-pinned", question, file: "docs/rotate.md", from: "4", lines: "6" },
      { action: "re-pinned", question, file: "docs/validate.md", lines: "4" },
    ]);
    const file = parse(readFileSync(join(dir, "questions.yaml"), "utf8")) as Array<{ answers: unknown[] }>;
    expect(file[0]?.answers).toEqual([
      { file: "docs/rotate.md", lines: 6, integrity: hashLines("Run manni key rotate to write a new key.") },
      { file: "docs/validate.md", lines: 4, integrity: hashLines("Run manni meta validate to check every page.") },
    ]);
    // The comment above the list survives the edit.
    expect(readFileSync(join(dir, "questions.yaml"), "utf8")).toContain("# One question across two pages.");
  });

  it("pins an HTML page against the text as written, metadata included", async () => {
    const dir = work("fill-html");
    const provider = new MockProvider([
      answer([], [{ question: "How often does the client try again?", quote: "The client tries three more times", confidence: 0.9 }]),
    ]);
    const report = await runFill({ cwd: dir, providerInstance: provider, noCache: true });
    expect(report.exitCode).toBe(0);
    const html = readFileSync(join(dir, "docs/guide.html"), "utf8");
    expect(html).toContain('name="sample-questions"');
    const { body } = bodyOf(html, "html");
    const lines = report.results[0]?.questions?.[0]?.lines;
    const range = lines === undefined ? undefined : parseLines(lines);
    expect(range).toBeDefined();
    if (range === undefined) return;
    // The answer's line moved down with the new <meta>, and the pin moved with it.
    expect(body[range.start - 1]).toContain("The client tries three more times");
    expect(html).toContain(String(pinOfLines(body, range)));
  });
});

describe("graph fill renders its questions", () => {
  it("prints one line per question under its page", async () => {
    const dir = work("fill-pair");
    const report = await runFill({
      cwd: dir,
      providerInstance: new MockProvider([answer([{ index: 1, quote: "choose retry", confidence: 0.77 }])]),
      noCache: true,
      dryRun: true,
    });
    expect(renderFill(report, "pretty").split("\n")).toEqual([
      "proposed  docs/retry.md (sample-questions) — dry run, not written",
      '            re-pinned  "How many times does the client retry?"  lines 8',
      '            re-pinned  "How do I resume a paused upload?"  lines 9 to 12',
      '            paired     "How do I retry a failed upload?"  lines 4 (0.77)',
    ]);
    const json = JSON.parse(renderFill(report, "json")) as { results: { questions: unknown[] }[] };
    expect(json.results[0]?.questions[2]).toEqual({
      action: "paired",
      question: "How do I retry a failed upload?",
      confidence: 0.77,
      lines: "4",
    });
  });
});

describe("graph fill --offline", () => {
  it("refuses a hosted --provider beside --offline", async () => {
    const dir = work("fill-draft");
    await expect(runFill({ cwd: dir, offline: true, provider: "anthropic" })).rejects.toThrow(GraphError);
    await expect(runFill({ cwd: dir, offline: true, provider: "anthropic" })).rejects.toThrow(
      "--offline and --provider anthropic contradict each other",
    );
  });

  it("with no local model, re-pins, skips what needs a model, warns once and exits 0", async () => {
    const env = localModelEnv(false);
    vi.stubEnv("INFERENCE_RUNTIME_DIR", env.env.INFERENCE_RUNTIME_DIR);
    vi.stubEnv("INFERENCE_MODELS_DIR", env.env.INFERENCE_MODELS_DIR);
    try {
      const dir = work("fill-pair");
      const provider = new MockProvider([answer([])]);
      const report = await runFill({ cwd: dir, offline: true, providerInstance: provider, noCache: true });
      expect(provider.requests).toHaveLength(0);
      expect(report.exitCode).toBe(0);
      expect(report.results[0]).toMatchObject({ status: "filled", reason: "offline" });
      expect(report.results[0]?.questions?.map((q) => q.action)).toEqual(["re-pinned", "re-pinned"]);
      expect(report.warnings).toEqual([
        noOfflineModel("only answer pins were updated, and nothing was drafted or proposed"),
      ]);

      const draft = work("fill-draft");
      const skipped = await runFill({ cwd: draft, paths: ["docs/retry.md"], offline: true, noCache: true });
      expect(skipped.exitCode).toBe(0);
      expect(renderFill(skipped, "pretty")).toBe("skipped   docs/retry.md (offline)");
    } finally {
      env.cleanup();
    }
  });

  it("takes graph.fill.offline from config, and the flag wins over it", async () => {
    const env = localModelEnv(false);
    vi.stubEnv("INFERENCE_RUNTIME_DIR", env.env.INFERENCE_RUNTIME_DIR);
    vi.stubEnv("INFERENCE_MODELS_DIR", env.env.INFERENCE_MODELS_DIR);
    try {
      const dir = work("fill-draft");
      editConfig(dir, "  fill:\n", "  fill:\n    offline: true\n");
      const offline = await runFill({ cwd: dir, paths: ["docs/retry.md"], noCache: true, dryRun: true });
      expect(offline.results[0]).toMatchObject({ status: "skipped", reason: "offline" });
      const provider = new MockProvider([answer([])]);
      const online = await runFill({
        cwd: dir,
        paths: ["docs/retry.md"],
        offline: false,
        providerInstance: provider,
        noCache: true,
        dryRun: true,
      });
      expect(provider.requests).toHaveLength(1);
      expect(online.results[0]?.reason).toBeUndefined();
    } finally {
      env.cleanup();
    }
  });

  it("with a downloaded local model, drafts as --local does, and says what it set aside", async () => {
    const env = localModelEnv(true);
    vi.stubEnv("INFERENCE_RUNTIME_DIR", env.env.INFERENCE_RUNTIME_DIR);
    vi.stubEnv("INFERENCE_MODELS_DIR", env.env.INFERENCE_MODELS_DIR);
    const written: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
      written.push(String(chunk));
      return true;
    });
    try {
      const dir = work("fill-draft");
      editConfig(dir, "  out: graph.ttl\n", "  out: graph.ttl\n  provider: anthropic\n");
      const provider = new MockProvider([
        answer([], [{ question: "How often does the client try again?", quote: "The client tries three more times", confidence: 0.9 }]),
      ]);
      const report = await runFill({
        cwd: dir,
        paths: ["docs/retry.md"],
        offline: true,
        model: LOCAL_MODEL,
        providerInstance: provider,
        noCache: true,
        dryRun: true,
      });
      expect(provider.requests).toHaveLength(1);
      expect(report.results[0]).toMatchObject({ status: "proposed" });
      expect(report.warnings).toEqual([]);
      expect(written).toContain('manni: --offline: using llama-cpp instead of "anthropic" from graph.provider.\n');
    } finally {
      spy.mockRestore();
      env.cleanup();
    }
  });
});
