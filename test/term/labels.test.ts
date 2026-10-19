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

  it("carries each term's names, relations, definition and place, and leaves out what it lacks", async () => {
    const terms = await termLabels({ cwd: join(here, "..", "fixtures", "term", "concept-scheme") });
    const byId = new Map(terms.map((t) => [t.id, t]));
    expect(byId.get("pluggable-auth-layer")).toEqual({
      label: "Pluggable auth layer",
      id: "pluggable-auth-layer",
      altLabels: ["PAL"],
      definition: "The seam an authentication provider plugs into.",
      file: expect.stringMatching(/[\\/]docs[\\/]glossary[\\/]pluggable-auth-layer\.md$/) as string,
      line: 1,
    });
    expect(byId.get("retry")).toMatchObject({ broader: ["Resilience"], line: 1 });
    expect(byId.get("retry")).not.toHaveProperty("narrower");
  });

  it("returns no terms when no config names any files", async () => {
    expect(await termLabels({ cwd: fixtureDir, noConfig: true })).toEqual([]);
  });
});
