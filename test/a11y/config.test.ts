/**
 * The `a11y:` key of `manni.config.yaml`: found beside `meta:` through the
 * shared family loader, skipped when the file has no such key, and every
 * malformed value an `A11yError` that names the file and the key. Trees are
 * built at runtime because discovery stops at a `.git` boundary.
 */
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadA11yConfig, parseA11yConfig } from "../../src/a11y/core/config.js";
import { A11yError } from "../../src/a11y/types.js";
import { makeTempRepo, removeTempRepo } from "../helpers/temp-repo.js";

const FILE = "manni.config.yaml";

describe("parseA11yConfig", () => {
  it("returns every key of a full section", () => {
    expect(
      parseA11yConfig(
        {
          urls: ["https://docs.example.com/"],
          crawl: false,
          maxPages: 25,
          tags: ["wcag2a", "wcag2aa"],
          severity: "error",
          timeout: 45000,
        },
        FILE,
      ),
    ).toEqual({
      urls: ["https://docs.example.com/"],
      crawl: false,
      maxPages: 25,
      tags: ["wcag2a", "wcag2aa"],
      severity: "error",
      timeout: 45000,
    });
  });

  it("reads an empty section as {}", () => {
    expect(parseA11yConfig(null, FILE)).toEqual({});
    expect(parseA11yConfig(undefined, FILE)).toEqual({});
    expect(parseA11yConfig({}, FILE)).toEqual({});
  });

  it("allows an empty urls list", () => {
    expect(parseA11yConfig({ urls: [] }, FILE)).toEqual({ urls: [] });
  });

  it("rejects a section that is not a mapping", () => {
    expect(() => parseA11yConfig(["https://x.example/"], FILE)).toThrow(A11yError);
    expect(() => parseA11yConfig("https://x.example/", FILE)).toThrow(/manni\.config\.yaml: `a11y:` must be a mapping/);
  });

  it("rejects an unknown key, naming the file, the key and the supported ones", () => {
    expect(() => parseA11yConfig({ url: ["https://x.example/"] }, FILE)).toThrow(
      /^manni\.config\.yaml: `a11y:` has unknown key "url"\. Supported keys: urls, crawl, maxPages, tags, severity, timeout\.$/,
    );
  });

  it.each([
    [{ urls: "https://x.example/" }, /"a11y\.urls" must be a list of strings/],
    [{ urls: ["https://x.example/", 3] }, /"a11y\.urls" must be a list of strings/],
    [{ urls: [""] }, /"a11y\.urls\[0\]" must be an http\(s\) URL/],
    [{ urls: ["ftp://x.example/"] }, /"a11y\.urls\[0\]" must be an http\(s\) URL/],
    [{ urls: ["https://ok.example/", "docs.example.com"] }, /"a11y\.urls\[1\]" must be an http\(s\) URL/],
    [{ crawl: "yes" }, /"a11y\.crawl" must be a boolean/],
    [{ maxPages: 0 }, /"a11y\.maxPages" must be an integer >= 1/],
    [{ maxPages: 1.5 }, /"a11y\.maxPages" must be an integer >= 1/],
    [{ maxPages: "10" }, /"a11y\.maxPages" must be an integer >= 1/],
    [{ tags: "wcag2a" }, /"a11y\.tags" must be a list of strings/],
    [{ severity: "high" }, /"a11y\.severity" must be one of notice, warning, error/],
    // axe's own word is not a family value; the floor is set on the family scale.
    [{ severity: "serious" }, /"a11y\.severity" must be one of notice, warning, error/],
    [{ severity: 2 }, /"a11y\.severity" must be one of notice, warning, error/],
    [{ timeout: 0 }, /"a11y\.timeout" must be an integer >= 1/],
    [{ timeout: -5 }, /"a11y\.timeout" must be an integer >= 1/],
  ])("rejects %j", (value, pattern) => {
    expect(() => parseA11yConfig(value, FILE)).toThrow(A11yError);
    expect(() => parseA11yConfig(value, FILE)).toThrow(pattern);
    expect(() => parseA11yConfig(value, FILE)).toThrow(/^manni\.config\.yaml: /);
  });
});

describe("loadA11yConfig", () => {
  let repo: string | undefined;

  afterEach(() => {
    removeTempRepo(repo);
    repo = undefined;
  });

  it("finds a11y: beside meta: in the family file", async () => {
    repo = makeTempRepo({
      files: {
        [FILE]:
          "meta:\n  paths: [docs]\na11y:\n  urls: [https://docs.example.com/]\n  severity: error\n",
      },
    });
    const loaded = await loadA11yConfig(repo);
    expect(loaded).toEqual({
      config: { urls: ["https://docs.example.com/"], severity: "error" },
      source: FILE,
      collections: [],
    });
  });

  it("passes the family file's collections through, url included", async () => {
    repo = makeTempRepo({
      files: {
        [FILE]:
          "collections:\n" +
          "  - name: guides\n" +
          "    paths: [docs/guides]\n" +
          "    url: https://docs.example.com/guides/\n" +
          "  - name: blog\n" +
          "    paths: [docs/blog]\n" +
          "a11y:\n  severity: error\n",
      },
    });
    const loaded = await loadA11yConfig(repo);
    expect(loaded.config).toEqual({ severity: "error" });
    expect(loaded.source).toBe(FILE);
    expect(loaded.collections).toEqual([
      {
        name: "guides",
        paths: ["docs/guides"],
        exclude: [],
        externalMetadata: [],
        url: "https://docs.example.com/guides/",
      },
      { name: "blog", paths: ["docs/blog"], exclude: [], externalMetadata: [] },
    ]);
  });

  // Discovery stops at a family file that declares the documents but gives
  // a11y no options of its own; walking past it would lose the collections
  // whose `url` is the seed (proposal 0041).
  it("finds a file with collections: and no a11y: section", async () => {
    repo = makeTempRepo({
      files: {
        [FILE]:
          "collections:\n  - name: guides\n    paths: [docs]\n    url: https://docs.example.com/\n",
      },
    });
    const loaded = await loadA11yConfig(repo);
    expect(loaded.config).toEqual({});
    expect(loaded.source).toBe(FILE);
    expect(loaded.collections.map((c) => c.url)).toEqual(["https://docs.example.com/"]);
  });

  it("walks up from a subdirectory and names the file relative to cwd", async () => {
    repo = makeTempRepo({
      files: {
        [FILE]: "a11y:\n  maxPages: 5\n",
        "docs/guide/.keep": "",
      },
    });
    const loaded = await loadA11yConfig(join(repo, "docs", "guide"));
    expect(loaded.config).toEqual({ maxPages: 5 });
    expect(loaded.source).toBe(`../../${FILE}`);
  });

  it("skips a family file that has no a11y: key", async () => {
    repo = makeTempRepo({ files: { [FILE]: "meta:\n  paths: [docs]\n" } });
    expect(await loadA11yConfig(repo)).toEqual({ config: {}, source: null, collections: [] });
  });

  it("returns an empty config when no file exists", async () => {
    repo = makeTempRepo({ files: { "README.md": "" } });
    expect(await loadA11yConfig(repo)).toEqual({ config: {}, source: null, collections: [] });
  });

  it("reads an empty a11y: section as {} and still reports the file", async () => {
    repo = makeTempRepo({ files: { [FILE]: "meta:\n  paths: [docs]\na11y:\n" } });
    expect(await loadA11yConfig(repo)).toEqual({ config: {}, source: FILE, collections: [] });
  });

  it.each([
    ["an unknown key", "a11y:\n  pages: 10\n", /manni\.config\.yaml: `a11y:` has unknown key "pages"/],
    ["a wrong type", "a11y:\n  crawl: sometimes\n", /manni\.config\.yaml: "a11y\.crawl" must be a boolean/],
    ["maxPages 0", "a11y:\n  maxPages: 0\n", /manni\.config\.yaml: "a11y\.maxPages" must be an integer >= 1/],
    ["a non-http url", "a11y:\n  urls: [ftp://docs.example.com/]\n", /manni\.config\.yaml: "a11y\.urls\[0\]" must be an http\(s\) URL/],
    ["an axe impact as the severity", "a11y:\n  severity: serious\n", /manni\.config\.yaml: "a11y\.severity" must be one of notice, warning, error/],
  ])("rejects %s, naming the file", async (_what, yaml, pattern) => {
    repo = makeTempRepo({ files: { [FILE]: yaml } });
    await expect(loadA11yConfig(repo)).rejects.toThrow(A11yError);
    await expect(loadA11yConfig(repo)).rejects.toThrow(pattern);
  });

  it("reads an explicit path, unwrapping a11y: when present", async () => {
    repo = makeTempRepo({
      files: {
        [FILE]: "a11y:\n  maxPages: 1\n",
        "ci/a11y.yaml": "a11y:\n  urls: [https://ci.example.com/]\n",
      },
    });
    const loaded = await loadA11yConfig(repo, "ci/a11y.yaml");
    expect(loaded).toEqual({
      config: { urls: ["https://ci.example.com/"] },
      source: "ci/a11y.yaml",
      collections: [],
    });
  });

  it("reads an explicit path whose whole document is the section", async () => {
    repo = makeTempRepo({
      files: { "ci/a11y.yaml": "urls: [https://ci.example.com/]\ntimeout: 1000\n" },
    });
    const loaded = await loadA11yConfig(repo, "ci/a11y.yaml");
    expect(loaded.config).toEqual({ urls: ["https://ci.example.com/"], timeout: 1000 });
  });

  it("errors when the explicit path does not exist", async () => {
    repo = makeTempRepo({ files: { "README.md": "" } });
    await expect(loadA11yConfig(repo, "missing.yaml")).rejects.toThrow(
      new A11yError('Config file not found: "missing.yaml".'),
    );
  });

  it("reports invalid YAML as an A11yError naming the file", async () => {
    repo = makeTempRepo({ files: { [FILE]: "a11y:\n  urls: [https://x.example/\n" } });
    await expect(loadA11yConfig(repo)).rejects.toThrow(A11yError);
    await expect(loadA11yConfig(repo)).rejects.toThrow(/manni\.config\.yaml: invalid YAML/);
  });
});
