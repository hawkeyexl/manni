/**
 * `graph check`'s `cited` row (proposal 0090, PR 4), and the parity of the
 * Node seams with `createRetriever`'s defaults over one artifact.
 *
 * Every reviewed question is asked through `graph retrieve` over the chunk
 * artifact beside the graph, in its own language. It is cited when the
 * bundle cites a node that answers it.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { integrityOf } from "../../../src/meta/index.js";
import { runBuild } from "../../../src/graph/commands/build.js";
import { runCheck, renderCheck } from "../../../src/graph/commands/check.js";
import { runPublish } from "../../../src/graph/commands/publish.js";
import { askSampleQuestions, exportSampleQuestions, type CiteSeam } from "../../../src/graph/commands/questions.js";
import { openArtifact, retrieveIn } from "../../../src/graph/commands/retrieve.js";
import { loadRunConfig } from "../../../src/graph/core/config.js";
import { loadGraph } from "../../../src/graph/core/load.js";
import { createRetriever, type PassageBundle, type RetrieverFetch } from "../../../src/graph/runtime/index.js";
import { makeTempRepo, removeTempRepo } from "../../helpers/temp-repo.js";

const FIXTURE = join(import.meta.dirname, "..", "fixtures", "cited");
const DOC = "urn:manni:graph:doc/docs";

function fixtureFiles(): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) walk(abs);
      else out[relative(FIXTURE, abs).split("\\").join("/")] = readFileSync(abs, "utf8");
    }
  };
  walk(FIXTURE);
  return out;
}

/** An evals report, shaped as `manni docevals run -f json` writes one, that fails the audit page. */
function evals(dir: string): string {
  const result = (file: string, outcome: string) => ({
    evalName: "answers",
    suite: "quality",
    type: "assertion",
    grader: "command",
    file,
    outcome,
    integrity: integrityOf(readFileSync(join(dir, file))),
  });
  return JSON.stringify({
    pages: 4,
    evalResults: [result("docs/en/audit.md", "fail"), result("docs/en/rotate.md", "pass")],
    suites: [],
    usage: { totalTokens: 0, cachedEvals: 0, judgedEvals: 0 },
    generated: [],
    exitCode: 1,
    problems: [],
  });
}

/** A copy of the fixture outside git, with its evals report, and `edit` applied to its config. */
function fixture(edit?: (yaml: string) => string): string {
  const dir = makeTempRepo({ files: fixtureFiles(), init: false });
  writeFileSync(join(dir, "evals.json"), evals(dir), "utf8");
  if (edit) {
    const path = join(dir, "manni.config.yaml");
    writeFileSync(path, edit(readFileSync(path, "utf8")), "utf8");
  }
  return dir;
}

/** The finding messages of a report, without the found-in-top ones this fixture also has. */
const cited = (report: { findings: { severity: string; message: string }[] }): string[] =>
  report.findings
    .filter((f) => /cited|cites|chunk artifact/.test(f.message))
    .map((f) => `${f.severity}: ${f.message}`);

const fileFetch: RetrieverFetch = (url) => {
  try {
    const text = readFileSync(url, "utf8");
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(text) });
  } catch {
    return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve("") });
  }
};

let dir: string;
beforeAll(async () => {
  dir = fixture();
  await runPublish({ cwd: dir });
}, 60_000);
afterAll(() => {
  removeTempRepo(dir);
});

describe("graph check, the cited row", () => {
  it("counts the reviewed questions graph retrieve cites, and the ones withheld", async () => {
    const report = await runCheck({ cwd: dir });
    expect(report.questions?.cited).toBe(2);
    expect(report.questions?.withheld).toBe(1);
    expect(report.questions?.found.reviewed.of).toBe(4);
    expect(renderCheck(report, "pretty").split("\n")).toContain(
      "  cited    2 of 4 reviewed by graph retrieve (50%), 1 withheld",
    );
    const json = JSON.parse(renderCheck(report, "json")) as { questions: Record<string, unknown> };
    expect(json.questions).toMatchObject({ cited: 2, withheld: 1 });
  });

  it("names what graph retrieve cites first, and what the floor left out", async () => {
    const report = await runCheck({ cwd: dir });
    expect(cited(report)).toEqual([
      'warning: "How do I audit the logs?" is not cited by graph retrieve, because graph.retrieve.withhold left out docs/en/audit.md as failing.',
      expect.stringMatching(
        /^warning: "Which command rotates the encryption key\?" is not cited by graph retrieve, which cites docs\/en\/rotate\.md( § .+)? first\.$/,
      ),
    ]);
    expect(report.exitCode).toBe(0);
  });

  it("fails under citedThreshold, and passes at or over it", async () => {
    const strict = fixture((y) => y.replace("  retrieve:\n", "  check:\n    questions:\n      citedThreshold: 75\n  retrieve:\n"));
    try {
      await runPublish({ cwd: strict });
      const report = await runCheck({ cwd: strict });
      expect(report.exitCode).toBe(1);
      expect(cited(report)).toContain(
        "error: 2 of 4 reviewed questions are cited by graph retrieve (50%), under the 75% that graph.check.questions.citedThreshold asks for.",
      );
    } finally {
      removeTempRepo(strict);
    }
    const lenient = fixture((y) => y.replace("  retrieve:\n", "  check:\n    questions:\n      citedThreshold: 50\n  retrieve:\n"));
    try {
      await runPublish({ cwd: lenient });
      expect((await runCheck({ cwd: lenient })).exitCode).toBe(0);
    } finally {
      removeTempRepo(lenient);
    }
  });

  it("does not run without a chunk artifact, and says so in a notice", async () => {
    const bare = fixture((y) => y.replace("  retrieve:\n", "  check:\n    questions:\n      citedThreshold: 100\n  retrieve:\n"));
    try {
      await runBuild({ cwd: bare });
      const report = await runCheck({ cwd: bare });
      expect(cited(report)).toEqual(["notice: the cited row did not run: no chunk artifact; run manni graph publish."]);
      expect(report.questions?.cited).toBeUndefined();
      expect(report.exitCode).toBe(0);
      expect(renderCheck(report, "pretty")).not.toContain("  cited    ");
    } finally {
      removeTempRepo(bare);
    }
  });

  it("does not run over an artifact from another graph", async () => {
    const stale = fixture();
    try {
      await runPublish({ cwd: stale });
      writeFileSync(join(stale, "docs/en/install.md"), `${readFileSync(join(stale, "docs/en/install.md"), "utf8")}\nMore.\n`);
      await runBuild({ cwd: stale });
      expect(cited(await runCheck({ cwd: stale }))).toEqual([
        "notice: the cited row did not run: .manni/graph/chunks.json was built from another graph; run manni graph publish.",
      ]);
    } finally {
      removeTempRepo(stale);
    }
  });

  it("fails a question cited outside its language", async () => {
    const config = loadRunConfig({}, dir);
    const de = `${DOC}/de/rotieren.md`;
    const leak: CiteSeam = {
      retrieve: (question) =>
        Promise.resolve({
          question,
          language: "en",
          context: [],
          citations: [{ iri: de, sourceUrl: "docs/de/rotieren.md" }],
          pages: {},
          trace: { entry: { candidates: [] }, hops: [], exclusions: [], resolutions: [], withheld: [], filtered: [] },
          truncated: false,
        } satisfies PassageBundle),
      withheld: new Map(),
    };
    const { findings, summary } = await askSampleQuestions(
      loadGraph(join(dir, ".manni/graph/graph.ttl")),
      config.check.questions,
      dir,
      join(dir, ".manni/graph"),
      { source: {}, cwd: dir },
      [],
      dir,
      () => Promise.resolve(leak),
    );
    expect(findings.map((f) => `${f.severity}: ${f.message}`)).toContain(
      'error: "How do I rotate the encryption key?" asks in en, and graph retrieve cites docs/de/rotieren.md, which is de.',
    );
    expect(summary?.cited).toBe(1);
  });
});

describe("parity", () => {
  it("cites the same passages for every golden question through the Node seams and createRetriever", async () => {
    const config = loadRunConfig({}, dir);
    const { lines } = await exportSampleQuestions(
      loadGraph(join(dir, ".manni/graph/graph.ttl")),
      dir,
      { source: {}, cwd: dir },
      config.questionFiles,
      config.configDir,
    );
    const golden = lines.map((l) => JSON.parse(l) as { question: string; language: string });
    expect(golden.length).toBe(4);
    const artifact = openArtifact({ cwd: dir });
    const script = await createRetriever({
      manifest: join(dir, ".manni/graph/chunks.json").split("\\").join("/"),
      fetch: fileFetch,
    });
    for (const q of golden) {
      const node = await retrieveIn(artifact, { question: q.question, lang: q.language });
      const browser = await script.retrieve(q.question, { lang: q.language });
      expect(browser.citations.map((c) => c.iri), q.question).toEqual(node.citations.map((c) => c.iri));
    }
  });
});
