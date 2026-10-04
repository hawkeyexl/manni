/**
 * graph's document set is the family's (proposal 0051 §1, copying 0048 §1):
 * `[paths...]`, `--collection`, `--exclude`, `-c` and `--no-config`. The
 * refusals are 0048 §1's sentences, word for word, and every one of them is an
 * operational error (exit 2) rather than a silent walk of every markdown file
 * beneath the working directory.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  defaultConfig,
  loadConfig,
  parseConfig,
} from "../../../src/graph/core/config.js";
import { resolveDocumentSet } from "../../../src/graph/core/discover.js";
import { STDIN_REQUIRES_AS } from "../../../src/shared/cli-options.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "..", "fixtures");
const collections = join(fixtures, "collections");

function configFor(dir: string) {
  return loadConfig(join(dir, "manni.config.yaml"), dir);
}

describe("graph document set: collections", () => {
  it("reads every declared collection when nothing is named", () => {
    const config = configFor(collections);
    expect(resolveDocumentSet(config, {}, "build", collections)).toEqual([
      "blog/post.md",
      "guides/draft.md",
      "guides/intro.md",
    ]);
  });

  it("selects a subset with --collection", () => {
    const config = configFor(collections);
    expect(
      resolveDocumentSet(config, { collection: ["guides"] }, "build", collections),
    ).toEqual(["guides/draft.md", "guides/intro.md"]);
  });

  it("narrows with --exclude, one glob per occurrence", () => {
    const config = configFor(collections);
    expect(
      resolveDocumentSet(
        config,
        { exclude: ["**/draft.md", "**/post.md"] },
        "build",
        collections,
      ),
    ).toEqual(["guides/intro.md"]);
  });

  it("takes positional paths beside no config at all", () => {
    const config = defaultConfig(collections);
    expect(
      resolveDocumentSet(config, { paths: ["guides"] }, "build", collections),
    ).toEqual(["guides/draft.md", "guides/intro.md"]);
  });

  it("reads only what graph can parse out of a directory", () => {
    // A positional path may be a directory now, and a directory holds more
    // than documents. A graph node's IRI is the part of the output a consumer
    // stores, so an image must not get one.
    const dir = mkdtempSync(join(tmpdir(), "manni-graph-mixed-"));
    writeFileSync(join(dir, "a.md"), "# A\n");
    writeFileSync(join(dir, "b.mdx"), "# B\n");
    writeFileSync(join(dir, "c.markdown"), "# C\n");
    writeFileSync(join(dir, "logo.png"), "not-really-a-png");
    writeFileSync(join(dir, "data.csv"), "x,y\n1,2\n");
    const config = defaultConfig(dir);
    // `.markdown` is markdown, and graph reads it, so the default walk keeps it.
    expect(resolveDocumentSet(config, { paths: ["."] }, "build", dir)).toEqual([
      "a.md",
      "b.mdx",
      "c.markdown",
    ]);
  });
});

describe("graph document set: the refusals", () => {
  it("refuses --collection beside paths", () => {
    const config = configFor(collections);
    expect(() =>
      resolveDocumentSet(
        config,
        { paths: ["guides"], collection: ["guides"] },
        "build",
        collections,
      ),
    ).toThrow(
      "--collection selects a configured collection; it cannot be combined with paths.",
    );
  });

  it("refuses --collection with no config file to select from", () => {
    const config = defaultConfig(collections);
    expect(() =>
      resolveDocumentSet(config, { collection: ["guides"] }, "build", collections),
    ).toThrow("--collection needs a config file to select from.");
  });

  it("refuses an undeclared collection, listing the configured ones", () => {
    const config = configFor(collections);
    expect(() =>
      resolveDocumentSet(config, { collection: ["nope"] }, "build", collections),
    ).toThrow(
      /no collection named "nope" in .*manni\.config\.yaml\. Configured: guides, blog\./,
    );
  });

  it("refuses no paths and no collections, naming the verb", () => {
    const dir = mkdtempSync(join(tmpdir(), "manni-graph-empty-"));
    const config = defaultConfig(dir);
    expect(() => resolveDocumentSet(config, {}, "build", dir)).toThrow(
      "No files to build. Pass paths/globs, or declare a collection under `collections:` in manni.config.yaml.",
    );
    expect(() => resolveDocumentSet(config, {}, "fill", dir)).toThrow(
      "No files to fill. Pass paths/globs, or declare a collection under `collections:` in manni.config.yaml.",
    );
  });

  it("refuses stdin without --as", () => {
    const config = defaultConfig(collections);
    expect(() =>
      resolveDocumentSet(config, { paths: ["-"] }, "build", collections),
    ).toThrow(STDIN_REQUIRES_AS);
  });

  it("refuses an unknown --as, listing the known formats", () => {
    const config = defaultConfig(collections);
    expect(() =>
      resolveDocumentSet(config, { paths: ["guides"], as: "rst" }, "build", collections),
    ).toThrow('Unknown format "rst". Known formats: markdown, mdx.');
  });

  it("reads `-` alongside named paths, and never falls back to collections", () => {
    const config = configFor(collections);
    expect(
      resolveDocumentSet(config, { paths: ["-"], as: "markdown" }, "build", collections),
    ).toEqual([]);
    expect(
      resolveDocumentSet(
        config,
        { paths: ["-", "guides/intro.md"], as: "markdown" },
        "build",
        collections,
      ),
    ).toEqual(["guides/intro.md"]);
  });

  it("narrows directory walks to --ext, and keeps a named file", () => {
    const config = defaultConfig(collections);
    expect(
      resolveDocumentSet(config, { paths: ["guides"], ext: [".mdx"] }, "build", collections),
    ).toEqual([]);
    expect(
      resolveDocumentSet(
        config,
        { paths: ["guides", "blog/post.md"], ext: ["mdx"] },
        "build",
        collections,
      ),
    ).toEqual(["blog/post.md"]);
  });
});

describe("graph config: the keys that moved", () => {
  const ref =
    "https://hawkeyexl.github.io/manni/meta/reference/configuration/#collections";

  it('refuses graph.inputs by name, and says where document sets went', () => {
    expect(() => parseConfig('graph:\n  inputs: ["*.md"]\n', "manni.config.yaml")).toThrow(
      `manni.config.yaml: "inputs" is no longer a graph key. Document sets are declared once for every tool, under a top-level collections: list. See ${ref}`,
    );
  });

  it("refuses graph.exclude by name", () => {
    expect(() =>
      parseConfig('graph:\n  exclude: ["**/drafts/**"]\n', "manni.config.yaml"),
    ).toThrow(
      `manni.config.yaml: "exclude" is no longer a graph key. Document sets are declared once for every tool, under a top-level collections: list. See ${ref}`,
    );
  });

  it("has no version key and no dockg.config.yaml", () => {
    // Nothing was ever published under either, so neither gets a migration
    // (0048 §4). `version:` is now an unknown key like any other.
    expect(() => parseConfig("graph:\n  version: 1\n", "manni.config.yaml")).toThrow(
      /version/,
    );
    const dir = mkdtempSync(join(tmpdir(), "manni-graph-legacy-"));
    writeFileSync(join(dir, "dockg.config.yaml"), 'baseIri: https://nope/\n');
    // Not discovered, so the run falls back to built-in defaults.
    expect(loadConfig(undefined, dir).configSource).toBeNull();
  });

  it("has no provenance.git switch; qualified stays", () => {
    expect(() =>
      parseConfig("graph:\n  provenance:\n    git: false\n", "manni.config.yaml"),
    ).toThrow(/git/);
    const config = parseConfig(
      "graph:\n  provenance:\n    qualified: false\n",
      "manni.config.yaml",
    );
    expect(config.provenance.qualified).toBe(false);
  });
});
