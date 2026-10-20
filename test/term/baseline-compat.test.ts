/**
 * A term baseline recorded before findings said what to do still holds. The
 * fixture baseline was recorded by manni 4.13.0 over the rules fixture, whose
 * findings break every rule. Each finding's message now ends with a fix, and
 * its fingerprint still reads the 4.13 text, so every entry still matches.
 */
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCheck } from "../../src/term/commands/check.js";
import { DEFAULT_TERM_BASELINE_PATH } from "../../src/term/core/config.js";

const FIXTURES = join(import.meta.dirname, "..", "fixtures", "term");

let dir: string | undefined;
afterEach(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("a 4.13 term baseline", () => {
  it("still forgives every finding it recorded, so the run passes", async () => {
    dir = await mkdtemp(join(tmpdir(), "manni-term-baseline-"));
    await cp(join(FIXTURES, "rules"), dir, { recursive: true });
    await cp(join(FIXTURES, "rules-baseline-4.13.json"), join(dir, DEFAULT_TERM_BASELINE_PATH));

    const recorded = JSON.parse(
      await readFile(join(FIXTURES, "rules-baseline-4.13.json"), "utf8"),
    ) as { entries: Record<string, string[]> };
    const fingerprints = Object.values(recorded.entries).flat().length;

    const report = await runCheck({ cwd: dir, inputs: [], baseline: true });

    // Every recorded fingerprint still matches a finding, and none is new.
    expect(report.findings).toEqual([]);
    expect(report.baseline).toMatchObject({ written: false, suppressed: fingerprints, stale: 0 });
    expect(report.summary.failed).toBe(0);
  });
});
