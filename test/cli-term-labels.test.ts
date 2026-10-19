/**
 * `manni meta fill` offers the termbase's labels however the bin is invoked.
 *
 * The umbrella mounts only the domain argv names, so `manni meta fill` never
 * loads the term domain's CLI module. The source is registered by the umbrella
 * itself, and loads the term domain only when `fill` asks it for labels.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildProgramFor } from "../src/cli.js";
import { termLabelSource } from "../src/shared/term-labels.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures", "fill", "hints");

describe("the term label source under the umbrella", () => {
  it("is registered when the umbrella loads, and answers with only meta mounted", async () => {
    // Importing src/cli.ts registers the source. Mounting only meta proves the
    // source does not depend on the term domain being mounted.
    await buildProgramFor(["meta", "fill"]);
    const source = termLabelSource();
    if (source === undefined) throw new Error("expected a registered source");
    const terms = await source({ cwd: fixtureDir });
    expect(
      [...terms]
        .map(({ label, id }) => ({ label, id }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    ).toEqual([
      { label: "extractor", id: "metadata-extractor" },
      { label: "schema set", id: "schema-set" },
    ]);
  });
});
