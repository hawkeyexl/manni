/**
 * The term domain registers the termbase as `meta fill`'s label source when its
 * module loads, which is what puts the labels in front of the model under the
 * `manni` bin and nowhere else.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { termLabelSource } from "../../src/shared/term-labels.js";
import "../../src/term/cli.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "..", "fixtures", "fill", "hints");

describe("the term label source", () => {
  it("is registered by the term domain's module", () => {
    expect(termLabelSource()).toBeTypeOf("function");
  });

  it("returns the termbase's labels and ids, read as term check reads them", async () => {
    const source = termLabelSource();
    if (source === undefined) throw new Error("expected a registered source");
    const terms = await source({ cwd: fixtureDir });
    expect([...terms].sort((a, b) => a.label.localeCompare(b.label))).toEqual([
      { label: "extractor", id: "metadata-extractor" },
      { label: "schema set", id: "schema-set" },
    ]);
  });

  it("returns no terms when no config names any files", async () => {
    const source = termLabelSource();
    if (source === undefined) throw new Error("expected a registered source");
    expect(await source({ cwd: fixtureDir, noConfig: true })).toEqual([]);
  });
});
