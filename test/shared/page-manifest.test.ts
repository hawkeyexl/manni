/**
 * The `{page}` placeholder (proposal 0058 § 1): one token in
 * `externalMetadata[].file`, resolved per page to that page's path relative to
 * the config file's directory, without its extension, with forward slashes.
 *
 * Everything here is string and path arithmetic. No file is read.
 */
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import {
  PAGE_PLACEHOLDER,
  hasPagePlaceholder,
  normalizeManifestPattern,
  pageManifestPath,
  strayManifestGlob,
} from "../../src/shared/page-manifest.js";

const configDir = resolve("/repo");

describe("PAGE_PLACEHOLDER and hasPagePlaceholder", () => {
  it("is the one token, {page}", () => {
    expect(PAGE_PLACEHOLDER).toBe("{page}");
  });

  it("answers whether a file names one manifest per page", () => {
    expect(hasPagePlaceholder("{page}.citations.yaml")).toBe(true);
    expect(hasPagePlaceholder("./meta/{page}.citations.yaml")).toBe(true);
    expect(hasPagePlaceholder("./site.metadata.yaml")).toBe(false);
    expect(hasPagePlaceholder("https://example.test/meta.yaml")).toBe(false);
  });
});

describe("normalizeManifestPattern", () => {
  it("strips one leading ./", () => {
    expect(normalizeManifestPattern("./{page}.yaml")).toBe("{page}.yaml");
    expect(normalizeManifestPattern("././{page}.yaml")).toBe("./{page}.yaml");
    expect(normalizeManifestPattern("{page}.yaml")).toBe("{page}.yaml");
  });

  it("writes Windows backslashes as forward slashes, before stripping ./", () => {
    expect(normalizeManifestPattern(".\\meta\\{page}.citations.yaml")).toBe(
      "meta/{page}.citations.yaml",
    );
  });

  it("does not fold case, resolve, or collapse ..", () => {
    expect(normalizeManifestPattern("Meta/{page}.yaml")).toBe("Meta/{page}.yaml");
    expect(normalizeManifestPattern("./a/../{page}.yaml")).toBe("a/../{page}.yaml");
  });
});

describe("pageManifestPath", () => {
  it("puts a sibling manifest beside the page, extension dropped", () => {
    const page = resolve(configDir, "docs/src/content/docs/cite/index.mdx");
    expect(pageManifestPath("{page}.citations.yaml", configDir, page)).toEqual({
      abs: resolve(configDir, "docs/src/content/docs/cite/index.citations.yaml"),
      rel: "docs/src/content/docs/cite/index.citations.yaml",
    });
  });

  it("mirrors the tree under a prefix, whatever the ./ spelling", () => {
    const page = resolve(configDir, "docs/cite/index.mdx");
    const expected = {
      abs: resolve(configDir, "meta/docs/cite/index.citations.yaml"),
      rel: "meta/docs/cite/index.citations.yaml",
    };
    expect(pageManifestPath("./meta/{page}.citations.yaml", configDir, page)).toEqual(expected);
    expect(pageManifestPath("meta/{page}.citations.yaml", configDir, page)).toEqual(expected);
    expect(pageManifestPath(".\\meta\\{page}.citations.yaml", configDir, page)).toEqual(expected);
  });

  it("keeps a page with no extension whole", () => {
    const page = resolve(configDir, "docs/README");
    expect(pageManifestPath("{page}.citations.yaml", configDir, page)).toEqual({
      abs: resolve(configDir, "docs/README.citations.yaml"),
      rel: "docs/README.citations.yaml",
    });
  });

  it("drops only the last extension", () => {
    const page = resolve(configDir, "docs/v1.2/setup.test.md");
    expect(pageManifestPath("{page}.yaml", configDir, page)).toMatchObject({
      rel: "docs/v1.2/setup.test.yaml",
    });
  });

  it("writes the page's own separators as forward slashes", () => {
    // A Windows walk hands the page over with backslashes; the manifest is the
    // same file on every platform.
    const page = `${configDir}/docs\\guide.md`;
    const result = pageManifestPath("{page}.citations.yaml", configDir, page);
    expect(result).toMatchObject({ rel: "docs/guide.citations.yaml" });
  });

  it("does not fold case", () => {
    const page = resolve(configDir, "Docs/Index.md");
    expect(pageManifestPath("{page}.yaml", configDir, page)).toMatchObject({
      rel: "Docs/Index.yaml",
    });
  });

  it("reports a page above the config directory as outside, by its relative path", () => {
    const page = resolve(configDir, "../site/install.md");
    expect(pageManifestPath("./meta/{page}.citations.yaml", configDir, page)).toEqual({
      outside: true,
      pageRel: "../site/install.md",
    });
  });
});

describe("strayManifestGlob", () => {
  it("replaces {page} with **/*, keeping the prefix and suffix", () => {
    expect(strayManifestGlob("{page}.citations.yaml")).toBe("**/*.citations.yaml");
    expect(strayManifestGlob("./meta/{page}.citations.yaml")).toBe("meta/**/*.citations.yaml");
    expect(strayManifestGlob(".\\meta\\{page}.citations.yaml")).toBe("meta/**/*.citations.yaml");
  });
});
