/**
 * The three worked example template files under `examples/lint/`, each
 * demonstrating the v2 grammar (proposal 0061) against a real-world docset's
 * shape: this repository's own docs (path-routed, no `type:`), a
 * Fern-shaped MDX docset, and a Hugo-Markdown-shaped one.
 *
 * The fixtures are synthetic pages the templates' own shapes describe, never
 * vendored text - Doc Detective's docs are AGPL-3.0 and nginx's are BSD-2, and
 * nothing here is copied or paraphrased from either. Only the *shape* (the
 * heading tree, the content kinds) mirrors what those docsets look like.
 *
 * Every template gets a clean fixture, so a template with no fixture is not
 * left unchecked. At least one fixture per file also carries a specific
 * defect, and its findings are pinned exactly - message and all - because the
 * message is the interface a reader acts on, not just the count.
 */
import { readFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parserForExtension } from "../../../src/lint/parsers/index.js";
import { validateDocument } from "../../../src/lint/core/validator.js";
import { loadResolvedTemplate } from "../../../src/lint/core/template-registry.js";
import type { Template } from "../../../src/lint/core/template.js";
import type { DocumentTree, Finding } from "../../../src/lint/types.js";
import { defined } from "../helpers.js";

const here = dirname(fileURLToPath(import.meta.url));
const examplesDir = join(here, "..", "..", "..", "examples", "lint");
const fixturesDir = join(here, "..", "fixtures", "examples");

const file = (name: string): string => join(examplesDir, name);
const fixture = (dir: string, name: string): string => join(fixturesDir, dir, name);

/** Every template this suite exercises, one entry per `(file, name)` pair. */
const TEMPLATES = [
  { file: "manni-docs.yaml", name: "page" },
  { file: "manni-docs.yaml", name: "get-started" },
  { file: "manni-docs.yaml", name: "cli-reference" },
  { file: "manni-docs.yaml", name: "overview" },
  { file: "doc-detective.yaml", name: "action" },
  { file: "doc-detective.yaml", name: "schema-reference" },
  { file: "doc-detective.yaml", name: "how-to" },
  { file: "nginx.yaml", name: "fragment" },
  { file: "nginx.yaml", name: "how-to" },
  { file: "nginx.yaml", name: "release-notes" },
] as const;

/** Parse a fixture with the parser its own extension selects. */
function parseFixture(path: string): DocumentTree {
  const parser = defined(
    parserForExtension(extname(path)),
    `parser for extension of "${path}"`,
  );
  return parser.parse(readFileSync(path, "utf8"), path);
}

/** A finding, reduced to what a defect fixture pins: never the exact position. */
function projected(findings: Finding[]): { type: string; heading: string | null; message: string }[] {
  return findings.map((f) => ({ type: f.type, heading: f.heading, message: f.message }));
}

describe("worked example templates", () => {
  let stderr: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });
  afterEach(() => {
    stderr.mockRestore();
  });

  it("loads every template in all three files through the real loader", async () => {
    const loaded: Record<string, Template> = {};
    for (const { file: fileName, name } of TEMPLATES) {
      const template = await loadResolvedTemplate(`${file(fileName)}#${name}`);
      expect(template, `${fileName}#${name}`).toBeTruthy();
      loaded[`${fileName}#${name}`] = template;
    }
    // `get-started` inherits `page`'s body requirement through `extends`,
    // rather than restating it - the one thing this assertion can check
    // without duplicating the matcher's own tests.
    expect(loaded["manni-docs.yaml#get-started"]?.contains).toEqual({
      paragraphs: { min: 1 },
    });
    expect(stderr).not.toHaveBeenCalled();
  });

  describe("examples/lint/manni-docs.yaml", () => {
    it("lints the page fallback clean", async () => {
      const template = await loadResolvedTemplate(`${file("manni-docs.yaml")}#page`);
      const tree = parseFixture(fixture("manni-docs", "page-clean.md"));
      expect(validateDocument(tree, template)).toEqual([]);
    });

    it("lints a get-started page clean", async () => {
      const template = await loadResolvedTemplate(`${file("manni-docs.yaml")}#get-started`);
      const tree = parseFixture(fixture("manni-docs", "get-started-clean.md"));
      expect(validateDocument(tree, template)).toEqual([]);
    });

    it("lints a cli-reference page clean", async () => {
      const template = await loadResolvedTemplate(`${file("manni-docs.yaml")}#cli-reference`);
      const tree = parseFixture(fixture("manni-docs", "cli-reference-clean.md"));
      expect(validateDocument(tree, template)).toEqual([]);
    });

    // The defect: `Global options` is headed "Flag" | "Description" rather
    // than "Option" | "Description".
    it("reports a Global options table with the wrong columns", async () => {
      const template = await loadResolvedTemplate(`${file("manni-docs.yaml")}#cli-reference`);
      const tree = parseFixture(fixture("manni-docs", "cli-reference-defect.md"));
      expect(projected(validateDocument(tree, template))).toEqual([
        {
          type: "tables_columns_error",
          heading: "Global options",
          message: 'Expected table columns "Option", "Description", but found "Flag", "Description"',
        },
      ]);
    });

    it("lints an overview page clean", async () => {
      const template = await loadResolvedTemplate(`${file("manni-docs.yaml")}#overview`);
      const tree = parseFixture(fixture("manni-docs", "overview-clean.mdx"));
      expect(validateDocument(tree, template)).toEqual([]);
    });
  });

  describe("examples/lint/doc-detective.yaml", () => {
    it("lints an action page clean", async () => {
      const template = await loadResolvedTemplate(`${file("doc-detective.yaml")}#action`);
      const tree = parseFixture(fixture("doc-detective", "action-clean.md"));
      expect(validateDocument(tree, template)).toEqual([]);
    });

    it("lints a schema-reference page clean", async () => {
      const template = await loadResolvedTemplate(`${file("doc-detective.yaml")}#schema-reference`);
      const tree = parseFixture(fixture("doc-detective", "schema-reference-clean.md"));
      expect(validateDocument(tree, template)).toEqual([]);
    });

    it("lints a how-to page clean", async () => {
      const template = await loadResolvedTemplate(`${file("doc-detective.yaml")}#how-to`);
      const tree = parseFixture(fixture("doc-detective", "how-to-clean.md"));
      expect(validateDocument(tree, template)).toEqual([]);
    });

    // The defect: "Step 2" has no code block, so its content does not match
    // the `paragraphs` then `codeBlocks` sequence every step must hold.
    it("reports a step with no code block", async () => {
      const template = await loadResolvedTemplate(`${file("doc-detective.yaml")}#how-to`);
      const tree = parseFixture(fixture("doc-detective", "how-to-defect.md"));
      expect(projected(validateDocument(tree, template))).toEqual([
        {
          type: "content_order_error",
          heading: "Step 2: Run the tests",
          message: "Expected paragraph then code, but found paragraph",
        },
      ]);
    });
  });

  describe("examples/lint/nginx.yaml", () => {
    it("lints a fragment clean", async () => {
      const template = await loadResolvedTemplate(`${file("nginx.yaml")}#fragment`);
      const tree = parseFixture(fixture("nginx", "fragment-clean.md"));
      expect(validateDocument(tree, template)).toEqual([]);
    });

    it("lints a how-to page clean", async () => {
      const template = await loadResolvedTemplate(`${file("nginx.yaml")}#how-to`);
      const tree = parseFixture(fixture("nginx", "how-to-clean.md"));
      expect(validateDocument(tree, template)).toEqual([]);
    });

    it("lints release notes clean", async () => {
      const template = await loadResolvedTemplate(`${file("nginx.yaml")}#release-notes`);
      const tree = parseFixture(fixture("nginx", "release-notes-clean.md"));
      expect(validateDocument(tree, template)).toEqual([]);
    });

    // The defect: 1.27.1 carries no sections at all, so the version's
    // required "What's new" cannot be found - there is nothing nearby for
    // the matcher to coerce it onto instead.
    it("reports a version missing What's new", async () => {
      const template = await loadResolvedTemplate(`${file("nginx.yaml")}#release-notes`);
      const tree = parseFixture(fixture("nginx", "release-notes-defect.md"));
      expect(projected(validateDocument(tree, template))).toEqual([
        {
          type: "missing_section",
          heading: "1.27.1",
          message: 'Missing section "What\'s new"',
        },
      ]);
    });
  });
});
