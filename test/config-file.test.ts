/**
 * The family config file, shared by every tool under the `manni` umbrella.
 *
 * One file, `manni.config.yaml`, with one top-level key per tool. A tool reads
 * its own key and leaves its siblings alone. Two older spellings are still
 * discovered, each with a warning: the pre-rename family name
 * (`moose.config.yaml`) and each tool's own pre-family name
 * (`docmeta.config.yaml` for the metadata tool), whose whole document *is*
 * the tool's section.
 *
 * Trees are built at runtime: a `.git` **directory** marks the walk boundary,
 * and that cannot be committed as a fixture.
 */
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  findConfigFile,
  readConfigFile,
  type ConfigFileOptions,
} from "../src/shared/config-file.js";
import { resetWarnings } from "../src/shared/warn.js";

const META: ConfigFileOptions = {
  section: "meta",
  legacyNames: ["docmeta.config.yaml", "docmeta.config.yml"],
  toError: (message) => new Error(message),
};

describe("family config discovery", () => {
  let tmp: string | undefined;
  let stderr: string[];

  beforeEach(() => {
    stderr = [];
    resetWarnings();
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderr.push(String(chunk));
      return true;
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (tmp) await rm(tmp, { recursive: true, force: true });
    tmp = undefined;
  });

  async function tree(spec: Record<string, string>): Promise<string> {
    tmp = await realpath(await mkdtemp(join(tmpdir(), "manni-cfg-")));
    await mkdir(join(tmp, ".git"));
    for (const [rel, content] of Object.entries(spec)) {
      const p = join(tmp, rel);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, content, "utf8");
    }
    return tmp;
  }

  it("reads the tool's section from manni.config.yaml", async () => {
    const root = await tree({
      "manni.config.yaml": "meta:\n  paths: [docs]\ndocevals:\n  version: 1\n",
    });
    const found = await findConfigFile(root, META);
    expect(found?.kind).toBe("manni");
    expect(found?.wrapped).toBe(true);
    expect(found?.value).toEqual({ paths: ["docs"] });
    expect(found?.path).toBe(join(root, "manni.config.yaml"));
    expect(stderr).toEqual([]);
  });

  it("prefers .yaml over .yml", async () => {
    const root = await tree({
      "manni.config.yaml": "meta:\n  paths: [a]\n",
      "manni.config.yml": "meta:\n  paths: [b]\n",
    });
    expect((await findConfigFile(root, META))?.value).toEqual({ paths: ["a"] });
  });

  it("a family file without the tool's key is not the tool's config", async () => {
    const root = await tree({ "manni.config.yaml": "docevals:\n  version: 1\n" });
    expect(await findConfigFile(root, META)).toBeNull();
    expect(stderr).toEqual([]);
  });

  it("falls through to a legacy per-tool file beside a family file that lacks the key", async () => {
    const root = await tree({
      "manni.config.yaml": "docevals:\n  version: 1\n",
      "docmeta.config.yaml": "paths: [legacy]\n",
    });
    const found = await findConfigFile(root, META);
    expect(found?.kind).toBe("legacy");
    expect(found?.wrapped).toBe(false);
    expect(found?.value).toEqual({ paths: ["legacy"] });
  });

  it("a family file with collections: and no section is still the tool's config", async () => {
    const root = await tree({
      "manni.config.yaml":
        "collections:\n  - name: guides\n    paths: [docs/guides]\n",
    });
    const found = await findConfigFile(root, META);
    expect(found?.kind).toBe("manni");
    expect(found?.wrapped).toBe(true);
    expect(found?.value).toBeNull();
    expect(found?.collections).toEqual([
      {
        name: "guides",
        paths: ["docs/guides"],
        exclude: [],
        externalMetadata: [],
      },
    ]);
    expect(stderr).toEqual([]);
  });

  it("a family file with both hands over the section and the collections", async () => {
    const root = await tree({
      "manni.config.yaml":
        "collections:\n  - name: guides\n    paths: [docs/guides]\n    url: https://example.com/guides/\nmeta:\n  allowEmpty: true\n",
    });
    const found = await findConfigFile(root, META);
    expect(found?.value).toEqual({ allowEmpty: true });
    expect(found?.collections.map((c) => c.url)).toEqual([
      "https://example.com/guides/",
    ]);
  });

  it("a family file with neither the key nor collections: falls through and up the tree", async () => {
    const root = await tree({
      "manni.config.yaml": "meta:\n  allowEmpty: true\n",
      "docs/manni.config.yaml": "docevals:\n  version: 1\n",
      "docs/api/.keep": "",
    });
    const found = await findConfigFile(join(root, "docs", "api"), META);
    expect(found?.dir).toBe(root);
    expect(found?.value).toEqual({ allowEmpty: true });
    expect(found?.collections).toEqual([]);
  });

  it("a malformed collections: entry is reported through the tool's factory", async () => {
    class MyError extends Error {}
    const root = await tree({
      "manni.config.yaml": "collections:\n  - name: guides\n",
    });
    await expect(
      findConfigFile(root, { ...META, toError: (m) => new MyError(m) }),
    ).rejects.toThrow(
      "manni.config.yaml: collections[0].paths must be a non-empty list of files, directories or globs.",
    );
  });

  it("a legacy per-tool file carries no collections", async () => {
    const root = await tree({ "docmeta.config.yaml": "paths: [old]\n" });
    const found = await findConfigFile(root, META);
    expect(found?.kind).toBe("legacy");
    expect(found?.collections).toEqual([]);
  });

  it("a family file with the key beats a legacy file in the same directory", async () => {
    const root = await tree({
      "manni.config.yaml": "meta:\n  paths: [new]\n",
      "docmeta.config.yaml": "paths: [old]\n",
    });
    expect((await findConfigFile(root, META))?.value).toEqual({ paths: ["new"] });
    expect(stderr).toEqual([]);
  });

  it("reads moose.config.yaml and warns once to rename it", async () => {
    const root = await tree({ "moose.config.yaml": "meta:\n  paths: [m]\n" });
    const found = await findConfigFile(root, META);
    expect(found?.kind).toBe("moose");
    expect(found?.value).toEqual({ paths: ["m"] });
    await findConfigFile(root, META);
    expect(stderr).toHaveLength(1);
    expect(stderr[0]).toMatch(/^manni: "moose\.config\.yaml" .*"manni\.config\.yaml"/);
  });

  it("reads a legacy file and warns once, naming the section to move to", async () => {
    const root = await tree({ "docmeta.config.yaml": "paths: [old]\n" });
    await findConfigFile(root, META);
    await findConfigFile(root, META);
    expect(stderr).toHaveLength(1);
    expect(stderr[0]).toContain('"docmeta.config.yaml" is a deprecated config file name');
    expect(stderr[0]).toContain("`meta:`");
    expect(stderr[0]).toContain('"manni.config.yaml"');
    expect(stderr[0]).toContain(
      "and its paths, exclude and sidecars keys to a top-level collections: list, where sidecars becomes externalMetadata.",
    );
  });

  it("orders manni, then moose, then legacy within one directory", async () => {
    const root = await tree({
      "moose.config.yaml": "meta:\n  paths: [moose]\n",
      "docmeta.config.yaml": "paths: [legacy]\n",
    });
    expect((await findConfigFile(root, META))?.value).toEqual({ paths: ["moose"] });
  });

  it("walks up to the git boundary, nearest directory first", async () => {
    const root = await tree({
      "manni.config.yaml": "meta:\n  paths: [root]\n",
      "docs/manni.config.yaml": "meta:\n  paths: [docs]\n",
      "docs/api/.keep": "",
    });
    const found = await findConfigFile(join(root, "docs", "api"), META);
    expect(found?.dir).toBe(join(root, "docs"));
    expect(found?.source).toBe("../manni.config.yaml");
  });

  it("returns null when nothing exists", async () => {
    const root = await tree({ "README.md": "" });
    expect(await findConfigFile(root, META)).toBeNull();
  });

  it("a discovered file that is not valid YAML is an error, not a fall-through", async () => {
    const root = await tree({
      "manni.config.yaml": "meta: [unterminated\n",
      "docmeta.config.yaml": "paths: [legacy]\n",
    });
    await expect(findConfigFile(root, META)).rejects.toThrow(/manni\.config\.yaml: invalid YAML/);
  });

  it("a discovered file whose top level is not a mapping is an error", async () => {
    const root = await tree({ "manni.config.yaml": "- just\n- a list\n" });
    await expect(findConfigFile(root, META)).rejects.toThrow(/top level must be a mapping/);
  });

  it("the error comes from the tool's own factory", async () => {
    class MyError extends Error {}
    const root = await tree({ "manni.config.yaml": "meta: [oops\n" });
    await expect(
      findConfigFile(root, { ...META, toError: (m) => new MyError(m) }),
    ).rejects.toBeInstanceOf(MyError);
  });

  describe("an explicit path", () => {
    it("unwraps the section when the file has it, whatever it is named", async () => {
      const root = await tree({ "anything.yaml": "meta:\n  paths: [x]\n" });
      const read = await readConfigFile("anything.yaml", root, META);
      expect(read.kind).toBe("explicit");
      expect(read.wrapped).toBe(true);
      expect(read.value).toEqual({ paths: ["x"] });
    });

    it("takes the whole document when the section is absent", async () => {
      const root = await tree({ "docmeta.config.yaml": "paths: [x]\n" });
      const read = await readConfigFile("docmeta.config.yaml", root, META);
      expect(read.wrapped).toBe(false);
      expect(read.value).toEqual({ paths: ["x"] });
    });

    it("hands over an empty section for a collections-only document", async () => {
      const root = await tree({
        "anything.yaml":
          "collections:\n  - name: guides\n    paths: [docs/guides]\n",
      });
      const read = await readConfigFile("anything.yaml", root, META);
      expect(read.wrapped).toBe(true);
      expect(read.value).toBeNull();
      expect(read.collections.map((c) => c.name)).toEqual(["guides"]);
    });

    it("unwraps the section and parses collections beside it", async () => {
      const root = await tree({
        "anything.yaml":
          "collections:\n  - name: guides\n    paths: [docs/guides]\nmeta:\n  allowEmpty: true\n",
      });
      const read = await readConfigFile("anything.yaml", root, META);
      expect(read.wrapped).toBe(true);
      expect(read.value).toEqual({ allowEmpty: true });
      expect(read.collections.map((c) => c.name)).toEqual(["guides"]);
    });

    it("takes the whole document, and no collections, for a legacy shape", async () => {
      const root = await tree({ "docmeta.config.yaml": "paths: [x]\n" });
      const read = await readConfigFile("docmeta.config.yaml", root, META);
      expect(read.collections).toEqual([]);
    });

    it("never warns, even for a deprecated name", async () => {
      const root = await tree({ "docmeta.config.yaml": "paths: [x]\n" });
      await readConfigFile("docmeta.config.yaml", root, META);
      expect(stderr).toEqual([]);
    });

    it("reports a missing file by the spelling the user typed", async () => {
      const root = await tree({});
      await expect(readConfigFile("nope.yaml", root, META)).rejects.toThrow(
        'Config file not found: "nope.yaml".',
      );
    });
  });
});
