/**
 * Section order against the built-in templates, on real pages (issue #202).
 *
 * Each fixture under `test/lint/fixtures/order/` routes by its own `type`, so
 * this runs the same path a user's `manni lint structure` does. The unit tests
 * in `match.test.ts` pin the mechanism; these pin what a reader sees.
 */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runLint } from "../../../src/lint/commands/lint.js";
import { defined } from "../helpers.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "..", "fixtures", "order");

async function lint(name: string): Promise<[string, string, number][]> {
  const run = await runLint({ inputs: [join(fixtures, name)], cwd: fixtures, noConfig: true });
  const result = defined(run.results[0], `result for ${name}`);
  return result.findings.map((f) => [f.type, f.message, f.position.start.line]);
}

describe("section order on the built-in templates", () => {
  // `Use cases` is present but after "How it works". The trailing catch-all
  // is where "How it works" belongs, and `use-cases` no longer coerces onto it.
  it("reports a concept section that sits before Use cases", async () => {
    expect(await lint("concept-out-of-order.md")).toEqual([
      ["section_order", 'Section "How it works" must come after "Use cases"', 9],
    ]);
  });

  // The task slot no longer swallows See also to make room for the extra
  // section, so the report is the extra section alone.
  it("reports a section after See also as unexpected, not See also as missing", async () => {
    expect(await lint("how-to-trailing-extra.md")).toEqual([
      [
        "unexpected_section",
        'Unexpected section "Troubleshooting". The template describes no section here, so move its content into a section it does describe, or remove it.',
        19,
      ],
    ]);
  });

  // See also is present, so it keeps its section. The task slot before it is
  // empty, and the section after it belongs there.
  it("reports the task section placed after See also", async () => {
    expect(await lint("how-to-see-also-early.md")).toEqual([
      ["section_order", 'Section "Install" must come before "See also"', 15],
    ]);
  });
});
