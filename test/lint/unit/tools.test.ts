/**
 * `runTools` command core. Two things are under test: the job/tool/config
 * bookkeeping `commands/tools.ts` already carried, and the presentation
 * decision this chunk adds - filtering each format's `kinds` down to the nine
 * a template rule can actually ask about (`BLOCK_KIND_NODE` in
 * `core/template.ts`), since a reader of this table is asking "can my rule
 * run against this format", and a rule can never name `listItem`, `tableRow`,
 * `tableCell`, or `definitionItem`.
 */
import { describe, expect, it } from "vitest";
import { runTools, BUILT_IN_DEFAULTS } from "../../../src/lint/commands/tools.js";
import { BLOCK_KIND_NODE } from "../../../src/lint/core/template.js";
import { defined } from "../helpers.js";

const REPORTABLE = new Set(Object.values(BLOCK_KIND_NODE));

describe("runTools", () => {
  it("reports the structure job on built-in defaults when there is no config", async () => {
    const [entry] = await runTools({ noConfig: true });
    expect(entry).toMatchObject({
      job: "structure",
      tool: "manni",
      configured: false,
      available: true,
      config: BUILT_IN_DEFAULTS,
    });
    expect(typeof entry?.version).toBe("string");
  });

  it("lists every registered format, markdown included", async () => {
    const [entry] = await runTools({ noConfig: true });
    const names = entry?.formats.map((f) => f.name) ?? [];
    expect(names).toContain("markdown");
    expect(names.length).toBeGreaterThan(1);
  });

  // The declaration a parser makes for its own kinds - what the pruner in
  // `validator.ts` reads - is untouched; only what this table *displays* is
  // filtered. rst is the parser most worth pinning here: it is the one that
  // declares every structural kind there is.
  it("filters a format's displayed kinds to the nine a template rule can name", async () => {
    const [entry] = await runTools({ noConfig: true });
    const rst = defined(entry?.formats.find((f) => f.name === "rst"), "rst format");
    for (const kind of rst.kinds) {
      expect(REPORTABLE.has(kind)).toBe(true);
    }
    expect(rst.kinds).not.toContain("listItem");
    expect(rst.kinds).not.toContain("tableRow");
    expect(rst.kinds).not.toContain("tableCell");
    expect(rst.kinds).not.toContain("definitionItem");
    // Still carries the reportable kinds rst actually emits.
    expect(rst.kinds).toContain("paragraph");
    expect(rst.kinds).toContain("table");
    expect(rst.kinds).toContain("definitionList");
  });

  it("keeps every kind for a format that emits only reportable ones", async () => {
    const [entry] = await runTools({ noConfig: true });
    const markdown = entry?.formats.find((f) => f.name === "markdown");
    expect(markdown?.kinds).toEqual(
      markdown?.kinds.filter((k) => REPORTABLE.has(k)),
    );
    expect(markdown?.kinds.length).toBeGreaterThan(0);
  });
});
