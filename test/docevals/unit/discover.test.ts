import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { nestUnderDocevals } from "../helpers/config.js";
import { parseConfig } from "../../../src/docevals/core/config.js";
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

  it("keeps a CRLF page's line endings in the body", () => {
    // `target: raw` reads the file as written, so `target: body` has to read
    // the same bytes past the fence, or a regex eval sees two different pages.
    expect(
      stripFrontmatterBlock("---\r\ntitle: x\r\n---\r\n# Heading\r\n\r\nBody\r\n"),
    ).toBe("# Heading\r\n\r\nBody\r\n");
  });

  it("keeps an LF page's body as written", () => {
    expect(stripFrontmatterBlock("---\ntitle: x\n---\n# Heading\n\nBody\n")).toBe(
      "# Heading\n\nBody\n",
    );
  });

  it("gives a CRLF page a body that is a suffix of its content", () => {
    const content = "﻿---\r\ntitle: x\r\n---\r\nOne\r\nTwo";
    const body = stripFrontmatterBlock(content);
    expect(body).toBe("One\r\nTwo");
    expect(content.endsWith(body)).toBe(true);
  });

  it("returns content unchanged for an unclosed fence", () => {
    const s = "---\ntitle: x\nBody without close";
    expect(stripFrontmatterBlock(s)).toBe(s);
  });
});

describe("discoverPages", () => {
  const config = parseConfig(
    'collections:\n  - name: pages\n    paths: ["test/docevals/fixtures/pages/**/*.{md,mdx}"]\n' +
      nestUnderDocevals(""),
    resolve(ROOT, "manni.config.yaml"),
  );

  it("finds the fixture pages with relative forward-slash paths", () => {
    const pages = discoverPages(config, {}, ROOT);
    expect(pages.length).toBeGreaterThanOrEqual(13);
    const files = pages.map((p) => p.file);
    expect(files).toContain("test/docevals/fixtures/pages/docs/get-started/installation.mdx");
    for (const f of files) expect(f).not.toContain("\\");
  });

  it("extracts frontmatter data and strips it from body", () => {
    const pages = discoverPages(config, {}, ROOT);
    const install = pages.find((p) => p.file.endsWith("installation.mdx"));
    if (install === undefined) throw new Error("installation.mdx was not discovered");
    expect(install.frontmatter.data.title).toBe("Installation");
    expect(install.frontmatter.present).toBe(true);
    expect(install.body).not.toContain("last-reviewed:");
    expect(install.body).toContain("Doc Detective");
  });

  it("throws DocevalsError when nothing matches", () => {
    expect(() => discoverPages(config, { paths: ["no/such/dir/**/*.md"] }, ROOT)).toThrow(
      DocevalsError,
    );
  });

  // `docevals run` over pages it cannot read checks nothing, so it is exit 2
  // (ADR 01041). The family reads the code as "no page resolves any evals".
  it("throws a nothing-resolved DocevalsError when every match is a page it does not read", () => {
    let thrown: unknown;
    try {
      discoverPages(config, { paths: ["test/family/fixtures/only-html/Content"] }, ROOT);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(DocevalsError);
    expect(thrown).toMatchObject({ code: "nothing-resolved", message: expect.stringMatching(/^No documentation pages found/) });
  });

  // A strategy record's `evals:` belong to `manni test tasks`, in tracevals'
  // vocabulary, so docevals reading one as page evals would refuse its graders.
  it("skips audience, persona and journey records, which are not pages", () => {
    const pages = discoverPages(
      config,
      { paths: ["test/docevals/fixtures/strategy-records/*.md"] },
      ROOT,
    );
    expect(pages.map((p) => p.file)).toEqual(["test/docevals/fixtures/strategy-records/page.md"]);
  });
});
