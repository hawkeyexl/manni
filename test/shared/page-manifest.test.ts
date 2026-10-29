/**
 * The `{page}` placeholder (proposal 0058 § 1): one token in
 * `externalMetadata[].file`, resolved per page to that page's path relative to
 * the config file's directory, without its extension, with forward slashes.
 *
 * Everything here is string and path arithmetic. No file is read.
 */
import { describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ToolError } from "../../src/shared/errors.js";
import {
  ID_PLACEHOLDER,
  PAGE_PLACEHOLDER,
  findPageManifests,
  hasIdPlaceholder,
  hasPagePlaceholder,
  idManifestPath,
  isSafeManifestId,
  listIdManifests,
  normalizeManifestPattern,
  pageManifestPath,
  strayManifestGlob,
} from "../../src/shared/page-manifest.js";

/** Directories `readdirSync` refuses, to the error code it refuses them with. */
const { refused } = vi.hoisted(() => ({ refused: new Map<string, string>() }));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const readdirSync = (...args: unknown[]): unknown => {
    const code = refused.get(String(args[0]));
    if (code !== undefined) throw Object.assign(new Error(`${code}: scandir '${String(args[0])}'`), { code });
    return (actual.readdirSync as (...a: unknown[]) => unknown)(...args);
  };
  return { ...actual, readdirSync };
});

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

  // The prefix and suffix are the config author's literal text, and a
  // directory name may hold glob syntax. Read raw, `(v2)` is an extglob group
  // and `meta (v2)/**` matches nothing, so a stray there would go unreported.
  it("matches a prefix holding glob syntax literally", () => {
    const dir = mkdtempSync(join(tmpdir(), "manni-page-glob-"));
    try {
      mkdirSync(join(dir, "meta (v2)", "docs"), { recursive: true });
      writeFileSync(join(dir, "meta (v2)", "docs", "a.citations.yaml"), "docs/a.md:\n  citations: []\n");
      const found = findPageManifests("./meta (v2)/{page}.citations.yaml", dir, () => true);
      expect(found.map((f) => f.entries.map((e) => e.spelled))).toEqual([["docs/a.md"]]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // The orphan check passes the manifests the loader already read, so the
  // walk does not parse them a second time.
  it("does not read a manifest it is told to skip", () => {
    const dir = mkdtempSync(join(tmpdir(), "manni-page-skip-"));
    try {
      mkdirSync(join(dir, "docs"), { recursive: true });
      writeFileSync(join(dir, "docs", "a.citations.yaml"), "docs/a.md:\n  citations: []\n");
      writeFileSync(join(dir, "docs", "b.citations.yaml"), "docs/b.md:\n  citations: []\n");
      const skip = new Set([resolve(dir, "docs", "a.citations.yaml")]);
      const found = findPageManifests("{page}.citations.yaml", dir, () => true, skip);
      expect(found.map((f) => f.entries.map((e) => e.spelled))).toEqual([["docs/b.md"]]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("ID_PLACEHOLDER and hasIdPlaceholder (0126)", () => {
  it("is the token {id}", () => {
    expect(ID_PLACEHOLDER).toBe("{id}");
  });

  it("answers whether a file names one manifest per id", () => {
    expect(hasIdPlaceholder("metadata/{id}.yaml")).toBe(true);
    expect(hasIdPlaceholder("{page}.meta.yaml")).toBe(false);
    expect(hasIdPlaceholder("./site.metadata.yaml")).toBe(false);
  });
});

describe("isSafeManifestId (0126)", () => {
  it.each(["getting-started", "a", "0126", "meta-set-up-external-metadata", "con1", "lpt10"])(
    "accepts %s",
    (id) => {
      expect(isSafeManifestId(id)).toBe(true);
    },
  );

  it.each([
    ["empty", ""],
    ["uppercase", "Getting-Started"],
    ["an underscore", "getting_started"],
    ["a dot", "notes.citations"],
    ["a leading dash", "-draft"],
    ["a slash", "docs/page"],
    ["a space", "two words"],
    ["a device name", "con"],
    ["a numbered device name", "com7"],
    ["a printer port", "lpt1"],
    ["a zero-numbered serial port", "com0"],
    ["a zero-numbered printer port", "lpt0"],
    ["nul", "nul"],
  ])("refuses %s", (_label, id) => {
    expect(isSafeManifestId(id)).toBe(false);
  });
});

describe("idManifestPath (0126)", () => {
  it("substitutes the id into a pattern relative to the config directory", () => {
    expect(idManifestPath("./metadata/{id}.yaml", configDir, "getting-started")).toEqual({
      abs: resolve(configDir, "metadata/getting-started.yaml"),
      rel: "metadata/getting-started.yaml",
    });
    expect(idManifestPath("metadata\\{id}.citations.yaml", configDir, "x")).toEqual({
      abs: resolve(configDir, "metadata/x.citations.yaml"),
      rel: "metadata/x.citations.yaml",
    });
  });

  it("resolves a pattern above the config directory, as another checkout is", () => {
    expect(idManifestPath("../docs-meta/{id}.yaml", configDir, "x")).toEqual({
      abs: resolve(configDir, "../docs-meta/x.yaml"),
      rel: "../docs-meta/x.yaml",
    });
  });

  it("keeps an absolute pattern absolute", () => {
    const abs = resolve("/srv/meta/{id}.yaml");
    expect(idManifestPath(abs, configDir, "x").abs).toBe(resolve("/srv/meta/x.yaml"));
  });
});

describe("listIdManifests (0126)", () => {
  it("is empty when the directory is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "manni-id-missing-"));
    try {
      expect(listIdManifests("metadata/{id}.yaml", dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("lists the files the pattern names by a safe id, sorted, and nothing else", () => {
    const dir = mkdtempSync(join(tmpdir(), "manni-id-list-"));
    try {
      const meta = join(dir, "metadata");
      mkdirSync(join(meta, "nested.yaml"), { recursive: true });
      for (const name of [
        "zeta.yaml",
        "alpha.yaml",
        "Upper.yaml",
        "under_score.yaml",
        "notes.citations.yaml",
        "readme.md",
      ]) {
        writeFileSync(join(meta, name), "x: 1\n");
      }
      expect(listIdManifests("metadata/{id}.yaml", dir)).toEqual([
        { abs: resolve(meta, "alpha.yaml"), id: "alpha" },
        { abs: resolve(meta, "zeta.yaml"), id: "zeta" },
      ]);
      // The same directory under another suffix names other files.
      expect(listIdManifests("./metadata/{id}.citations.yaml", dir)).toEqual([
        { abs: resolve(meta, "notes.citations.yaml"), id: "notes" },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads the config directory itself for a pattern with no directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "manni-id-flat-"));
    try {
      writeFileSync(join(dir, "page.meta.yaml"), "x: 1\n");
      expect(listIdManifests("{id}.meta.yaml", dir)).toEqual([{ abs: resolve(dir, "page.meta.yaml"), id: "page" }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // A ToolError is what the bin runner prints as one line and exit 2.
  it("refuses a directory it cannot list, naming it from the run's base", () => {
    refused.set(resolve(configDir, "site", "metadata"), "EACCES");
    try {
      const list = (): unknown => listIdManifests("metadata/{id}.yaml", resolve(configDir, "site"), configDir);
      expect(list).toThrow(ToolError);
      expect(list).toThrow("site/metadata: the metadata directory cannot be read (EACCES).");
    } finally {
      refused.clear();
    }
  });
});
