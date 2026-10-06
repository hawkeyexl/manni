import { describe, expect, it } from "vitest";
import { mapConcurrent } from "../../src/shared/concurrency.js";

describe("mapConcurrent", () => {
  it("returns results in input order, whatever finishes first", async () => {
    const delays = [30, 0, 15, 5];
    const out = await mapConcurrent(delays, 4, async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
      return ms;
    });
    expect(out).toEqual(delays);
  });

  it("never runs more than the limit at once", async () => {
    let running = 0;
    let peak = 0;
    await mapConcurrent([...Array(12).keys()], 3, async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
    });
    expect(peak).toBe(3);
  });
});
