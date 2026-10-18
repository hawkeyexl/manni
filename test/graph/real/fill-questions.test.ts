/**
 * One real `graph fill --fields sample-questions` run (proposal 0086),
 * `npm run test:graph:real`. The mock stands in for the model everywhere
 * else, so this is where the question prompt and schema meet a model that
 * answers for itself.
 *
 * The model is the local one by default, through `--local`, so the run sends
 * nothing off the machine. `GRAPH_REAL_PROVIDER` and `GRAPH_REAL_MODEL` name
 * another. Excluded from `npm test`, which never reaches a network or weights.
 *
 * Every assertion is about shape and mechanism: what a small model drafts is
 * not this test's business, only that what comes back is gated and pinned.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runFill } from "../../../src/graph/commands/fill.js";
import { bodyOf } from "../../../src/graph/commands/questions.js";
import { parseLines } from "../../../src/shared/pin.js";

const FIXTURE = resolve(__dirname, "..", "fixtures", "questions", "fill-draft");
const work = mkdtempSync(join(tmpdir(), "manni-graph-fill-questions-real-"));
cpSync(FIXTURE, work, { recursive: true });

afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

describe("graph fill --fields sample-questions, with a real model", () => {
  it("drafts in the schema the prompt asks for, and pins only what the page holds", async () => {
    const provider = process.env["GRAPH_REAL_PROVIDER"];
    const model = process.env["GRAPH_REAL_MODEL"];
    const report = await runFill({
      cwd: work,
      paths: ["docs/retry.md"],
      fields: ["sample-questions"],
      noCache: true,
      dryRun: true,
      // Low enough that a small local model's drafts reach the other gates.
      confidence: 0.1,
      ...(provider === undefined ? { local: true } : { provider }),
      ...(model === undefined ? {} : { model }),
    });

    expect(report.exitCode, JSON.stringify(report.results)).toBe(0);
    expect(report.turnsUsed).toBeGreaterThan(0);
    const [result] = report.results;
    expect(["proposed", "nothing-proposed"]).toContain(result?.status);
    const { body } = bodyOf(readFileSync(join(work, "docs", "retry.md"), "utf8"), "markdown");
    for (const q of result?.questions ?? []) {
      expect(["drafted", "dropped"]).toContain(q.action);
      if (q.action !== "drafted") continue;
      // A drafted question's pin names lines that exist on the page.
      const lines = q.lines === undefined ? undefined : parseLines(q.lines);
      expect(lines).toBeDefined();
      expect(lines?.end ?? 0).toBeLessThanOrEqual(body.length);
      expect(q.confidence ?? 0).toBeGreaterThanOrEqual(0.1);
    }
  });
});
