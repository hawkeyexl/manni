/**
 * Verdicts are tied to the text they judged, per page (proposal 0090,
 * decision 7). Every result carries the integrity of the page content the run
 * read, so a later reader can tell whether the page still has those bytes.
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runEvals } from "../../../src/docevals/core/engine.js";
import { render } from "../../../src/docevals/reporters/index.js";

const ROOT = resolve(import.meta.dirname, "../fixtures/integrity");

const sha256Of = (file: string): string =>
  `sha256-${createHash("sha256").update(readFileSync(resolve(ROOT, file))).digest("hex")}`;

describe("a result's integrity", () => {
  it("is the sha256 of its page's content, in the JSON report", async () => {
    const report = await runEvals({ cwd: ROOT, generate: false, deterministicOnly: true });
    const json = JSON.parse(render(report, "json")) as {
      evalResults: { file: string; integrity?: string }[];
    };
    const results = json.evalResults;
    expect(results.map((r) => r.file).sort()).toEqual([
      "docs/one.md",
      "docs/one.md",
      "docs/two.md",
      "docs/two.md",
    ]);
    for (const r of results) {
      expect(r.integrity).toMatch(/^sha256-[0-9a-f]{64}$/);
      expect(r.integrity).toBe(sha256Of(r.file));
    }
    const one = new Set(results.filter((r) => r.file === "docs/one.md").map((r) => r.integrity));
    const two = new Set(results.filter((r) => r.file === "docs/two.md").map((r) => r.integrity));
    expect(one.size).toBe(1);
    expect(two.size).toBe(1);
    expect([...one][0]).not.toBe([...two][0]);
  });
});
