/**
 * The built-in TGDP templates, checked against the published templates they
 * were derived from.
 *
 * "Publicly vetted" is a claim, and this is what makes it falsifiable. Each
 * built-in is linted against The Good Docs Project's own `template_<slug>.md`,
 * vendored under `test/lint/fixtures/tgdp/` at the pinned release. If upstream's
 * template does not pass ours, ours is wrong — the upstream file is the
 * authority, not the fixture we wish we had.
 *
 * The suite is driven by the manifest, so a built-in cannot be registered
 * without acquiring this test, and cannot acquire it without a vendored source.
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { markdownParser } from "../../../src/lint/parsers/markdown.js";
import { validateDocument } from "../../../src/lint/core/validator.js";
import { listBuiltins, loadTemplate } from "../../../src/lint/core/template-registry.js";
import manifest from "../../../templates/lint/tgdp/manifest.json" with { type: "json" };
import { at } from "../helpers.js";

const here = dirname(fileURLToPath(import.meta.url));
const vendored = join(here, "..", "fixtures", "tgdp");

/** `how-to/template_how-to.md` -> `template_how-to.md`. */
const basename = (source: string) => {
  const segments = source.split("/");
  return at(segments, segments.length - 1, `last segment of "${source}"`);
};

describe("TGDP built-ins", () => {
  it("registers every manifest entry", () => {
    const ids = listBuiltins().map((b) => b.id);
    expect(ids).toEqual(manifest.templates.map((t) => t.id));
  });

  it("serves a doctype from every entry", () => {
    for (const builtin of listBuiltins()) {
      expect(builtin.types.length).toBeGreaterThan(0);
    }
  });

  it("does not let two built-ins claim the same doctype", () => {
    const seen = new Map<string, string>();
    for (const builtin of listBuiltins()) {
      for (const type of builtin.types) {
        expect(seen.has(type), `${type} claimed by ${seen.get(type) ?? "nobody"} and ${builtin.id}`).toBe(
          false,
        );
        seen.set(type, builtin.id);
      }
    }
  });
});

describe.each(manifest.templates)("$id", (entry) => {
  it(`lints ${basename(entry.source)} clean`, async () => {
    const source = join(vendored, basename(entry.source));
    const content = await readFile(source, "utf8");
    const tree = markdownParser.parse(content, source);
    const template = await loadTemplate(entry.id);

    const findings = validateDocument(tree, template);
    const rendered = findings.map(
      (f) => `${f.position.start.line}: [${f.type}] ${f.message}`,
    );

    // `tgdp:reference:1.6` used to be the exception here. The reference
    // doctype is table-heavy, and while the markdown parser reported only
    // paragraph, codeBlock and list, its `tables: { min: 1 }` rule was pruned
    // before matching and reported as a warning saying the rule had not run.
    // The parser reports GFM tables now, so the rule runs, upstream's own
    // table satisfies it, and the page is clean for the reason a reader would
    // expect rather than because nothing looked.
    expect(rendered).toEqual([]);
  });

  it("declares the doctypes the manifest says it serves", async () => {
    const template = await loadTemplate(entry.id);
    expect(template.types).toEqual(entry.types);
  });
});
