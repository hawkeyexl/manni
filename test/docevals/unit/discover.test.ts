import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { parseDocevalsConfig } from "../helpers/config.js";
import { discoverPages, stripFrontmatterBlock } from "../../../src/docevals/core/discover.js";
import { DocevalsError } from "../../../src/docevals/types.js";

const ROOT = resolve(import.meta.dirname, "../../..");

describe("stripFrontmatterBlock", () => {
  it("removes a YAML block", () => {
    expect(stripFrontmatterBlock("---\ntitle: x\n---\nBody here")).toBe("Body here");
  });

  it("removes a TOML block", () => {
    expect(stripFrontmatterBlock("+++\ntitle = 'x'\n+++\nBody")).toBe("Body");
  });

  it("returns content unchanged without a fence", () => {
    expect(stripFrontmatterBlock("# Heading\nBody")).toBe("# Heading\nBody");
  });

  it("returns content unchanged for an unclosed fence", () => {
    const s = "---\ntitle: x\nBody without close";
    expect(stripFrontmatterBlock(s)).toBe(s);
  });
});

describe("discoverPages", () => {
  const config = parseDocevalsConfig(
    'version: 1\nfiles:\n  include: ["test/docevals/fixtures/pages/**/*.{md,mdx}"]\n',
    resolve(ROOT, "manni.config.yaml"),
  );

  it("finds the fixture pages with relative forward-slash paths", () => {
    const pages = discoverPages(config, [], ROOT);
    expect(pages.length).toBeGreaterThanOrEqual(13);
    const files = pages.map((p) => p.file);
    expect(files).toContain("test/docevals/fixtures/pages/docs/get-started/installation.mdx");
    for (const f of files) expect(f).not.toContain("\\");
  });

  it("extracts frontmatter data and strips it from body", () => {
    const pages = discoverPages(config, [], ROOT);
    const install = pages.find((p) => p.file.endsWith("installation.mdx"))!;
    expect(install.frontmatter.data.title).toBe("Installation");
    expect(install.frontmatter.present).toBe(true);
    expect(install.body).not.toContain("last-reviewed:");
    expect(install.body).toContain("Doc Detective");
  });

  it("throws DocevalsError when nothing matches", () => {
    expect(() => discoverPages(config, ["no/such/dir/**/*.md"], ROOT)).toThrow(
      DocevalsError,
    );
  });
});
