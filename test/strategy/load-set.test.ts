/**
 * A record carries its merged metadata, so another domain reads a persona's
 * fields through this loader rather than a second one (proposal 0111).
 */
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveStrategyRun } from "../../src/strategy/core/config.js";
import { loadStrategySet } from "../../src/strategy/index.js";

const FIXTURE = resolve(import.meta.dirname, "../docevals/fixtures/personas");

describe("loadStrategySet", () => {
  it("hands each record its merged metadata", async () => {
    const run = await resolveStrategyRun({ cwd: FIXTURE, inputs: [], collection: ["strategy"] });
    const set = await loadStrategySet({ run });
    const theo = set.records.find((r) => r.id === "theo");
    expect(theo?.data["goals"]).toEqual(["Fix the one failing field and confirm it locally."]);
    expect(theo?.data["team-context"]).toBe("Ships features on a product team and touches the docs rarely.");
  });
});
