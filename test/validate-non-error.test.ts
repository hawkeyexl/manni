import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runValidate } from "../src/meta/commands/validate.js";
import { markdownExtractor } from "../src/meta/extractors/markdown.js";

/**
 * An extractor that throws a plain string is a bug in that extractor. The
 * string is still the only explanation the user gets for the failure, so it
 * has to reach the report intact rather than as "undefined".
 */
describe("a non-Error thrown through a real path", () => {
  let dir: string | undefined;

  afterEach(() => {
    vi.restoreAllMocks();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("reports the thrown value as the parse error, not undefined", async () => {
    // The registry builds its lookups once, at load, so a format added later
    // is never found. The stub replaces the markdown extractor's own
    // `extract` instead, and the run goes through the real registry and the
    // real catch in `validate`.
    const notAnError: unknown = "the extractor's own words";
    vi.spyOn(markdownExtractor, "extract").mockImplementation(() => {
      throw notAnError;
    });
    dir = mkdtempSync(join(tmpdir(), "manni-non-error-"));
    writeFileSync(join(dir, "page.md"), "---\ntitle: A\n---\n", "utf8");
    const { results } = await runValidate({ inputs: ["page.md"], cwd: dir, noConfig: true });
    expect(results[0]?.errors[0]?.message).toBe("the extractor's own words");
  });
});
