/**
 * One real `term fill --crawl` run, `npm run test:term:real`. The mock stands
 * in for the model everywhere else, so this is where the prompts and schemas
 * meet a provider that answers for itself.
 *
 * The provider is whatever resolves: `TERM_REAL_PROVIDER` and
 * `TERM_REAL_MODEL` name one, else `auto` detects it, ending at the local
 * model. Excluded from `npm test`, which never reaches a network or weights.
 */
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runFill } from "../../../src/term/commands/fill.js";

const FIXTURE = resolve(__dirname, "..", "..", "fixtures", "term", "fill", "basic");
const work = mkdtempSync(join(tmpdir(), "manni-term-fill-real-"));
cpSync(FIXTURE, work, { recursive: true });

afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

describe("term fill --crawl, with a real model", () => {
  it("answers in the schema the prompts ask for", async () => {
    const provider = process.env["TERM_REAL_PROVIDER"];
    const model = process.env["TERM_REAL_MODEL"];
    const report = await runFill({
      cwd: work,
      inputs: [],
      crawl: true,
      noCache: true,
      dryRun: true,
      // Low enough that a small local model's candidates get through to be checked.
      confidence: 0.1,
      ...(provider === undefined ? {} : { provider }),
      ...(model === undefined ? {} : { model }),
    });
    expect(report.summary.turns).toBeGreaterThan(0);
    for (const entry of report.entries) {
      expect(["create", "fill", "skip", "exists"]).toContain(entry.action);
      if (entry.definition.status === "drafted") {
        expect(entry.definition.confidence).toBeGreaterThanOrEqual(0.1);
        expect(entry.definition.model).toMatch(/\//);
      }
    }
    // Retry and Errors are named by metadata, so a model drafts them.
    expect(report.entries.some((e) => e.source === "metadata" && e.definition.status === "drafted")).toBe(true);
  });
});
