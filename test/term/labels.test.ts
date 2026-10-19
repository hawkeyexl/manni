/**
 * The termbase as `meta fill`'s label source reads it. The umbrella registers
 * it (see test/cli-term-labels.test.ts); this covers what it returns.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { termLabels } from "../../src/term/commands/labels.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "..", "fixtures", "fill", "hints");

describe("termLabels", () => {
  it("returns the termbase's labels and ids, read as term check reads them", async () => {
    const terms = await termLabels({ cwd: fixtureDir });
    expect(
      [...terms]
        .map(({ label, id }) => ({ label, id }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    ).toEqual([
      { label: "extractor", id: "metadata-extractor" },
      { label: "schema set", id: "schema-set" },
    ]);
  });

  it("returns no terms when no config names any files", async () => {
    expect(await termLabels({ cwd: fixtureDir, noConfig: true })).toEqual([]);
  });
});
