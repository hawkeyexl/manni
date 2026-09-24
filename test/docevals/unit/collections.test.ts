/**
 * docevals reads its document set from the family `collections:` list
 * (proposal 0041). `docevals.files` is refused by name; positional paths are
 * cwd-relative and a collection's `paths:` resolve from the config file's
 * directory; `--collection` selects, and composes with neither paths nor a
 * missing config.
 */
import { describe, it, expect } from "vitest";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadConfig, parseConfig } from "../../../src/docevals/core/config.js";
import { discoverPages } from "../../../src/docevals/core/discover.js";
import { runList } from "../../../src/docevals/commands/list.js";
import { runRun } from "../../../src/docevals/commands/run.js";
import { runFill } from "../../../src/docevals/commands/fill.js";
import { runGenerate } from "../../../src/docevals/commands/generate.js";
import { runPromote } from "../../../src/docevals/commands/promote.js";
import { DocevalsError } from "../../../src/docevals/types.js";

const FIXTURES = resolve(import.meta.dirname, "../fixtures");
const COLLECTIONS = join(FIXTURES, "collections");
const FILES_KEY = join(FIXTURES, "files-key");

const FILES_REFUSAL = (source: string): string =>
  `${source}: "files" is no longer a docevals key. Document sets are declared once for every tool, under a top-level collections: list. See https://hawkeyexl.github.io/manni/meta/reference/configuration/#collections`;

const WITH_PATHS =
  "--collection selects a configured collection; it cannot be combined with paths.";
const NEEDS_CONFIG = "--collection needs a config file to select from.";
const noFiles = (verb: string): string =>
  `No files to ${verb}. Pass paths/globs, or declare a collection under \`collections:\` in manni.config.yaml.`;

/** A directory outside any git work tree and any config file. */
function emptyDir(): string {
  return mkdtempSync(join(tmpdir(), "manni-docevals-collections-"));
}

async function filesOf(
  cwd: string,
  paths: string[],
  opts: Parameters<typeof runList>[1] = {},
): Promise<string[]> {
  const run = await runList(paths, { cwd, ...opts });
  return run.plans.map((p) => p.page.file);
}

describe("docevals.files is no longer a key", () => {
  it("is refused by name when parsed", () => {
    expect(() =>
      parseConfig(
        'docevals:\n  files:\n    include: ["docs/**"]\n',
        "some/manni.config.yaml",
      ),
    ).toThrow(FILES_REFUSAL("some/manni.config.yaml"));
  });

  it("names the discovered file as cite does", () => {
    let error: unknown;
    try {
      loadConfig(undefined, FILES_KEY);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(DocevalsError);
    expect((error as Error).message).toBe(FILES_REFUSAL("manni.config.yaml"));
  });
});

describe("the document set", () => {
  it("is the union of every collection's paths when no paths are given", async () => {
    expect(await filesOf(COLLECTIONS, [])).toEqual(["blog/post.md", "docs/guide.md"]);
  });

  it("resolves a collection's paths from the config directory, not cwd", async () => {
    expect(await filesOf(join(COLLECTIONS, "docs"), [])).toEqual([
      "../blog/post.md",
      "guide.md",
    ]);
  });

  it("narrows to the collections --collection names", async () => {
    expect(await filesOf(COLLECTIONS, [], { collection: ["blog"] })).toEqual(["blog/post.md"]);
  });

  it("takes positional files, directories and globs, relative to cwd", async () => {
    expect(await filesOf(COLLECTIONS, ["outside/other.md"])).toEqual(["outside/other.md"]);
    expect(await filesOf(COLLECTIONS, ["docs"])).toEqual(["docs/drafts/wip.md", "docs/guide.md"]);
    expect(await filesOf(COLLECTIONS, ["*/*.md"])).toEqual([
      "blog/post.md",
      "docs/guide.md",
      "outside/other.md",
    ]);
  });

  it("applies a collection's exclude only to the collection, never to a typed path", async () => {
    expect(await filesOf(COLLECTIONS, [])).not.toContain("docs/drafts/wip.md");
    expect(await filesOf(COLLECTIONS, ["docs/drafts/wip.md"])).toEqual(["docs/drafts/wip.md"]);
  });

  it("applies --exclude to paths and collections alike", async () => {
    expect(await filesOf(COLLECTIONS, [], { exclude: ["blog/**"] })).toEqual(["docs/guide.md"]);
    expect(await filesOf(COLLECTIONS, ["docs"], { exclude: ["**/drafts/**"] })).toEqual([
      "docs/guide.md",
    ]);
  });

  it("never reads node_modules, the family-wide exclusion", async () => {
    const dir = emptyDir();
    cpSync(COLLECTIONS, dir, { recursive: true });
    mkdirSync(join(dir, "docs", "node_modules", "pkg"), { recursive: true });
    writeFileSync(
      join(dir, "docs", "node_modules", "pkg", "readme.md"),
      "---\ntitle: Vendored\nlast-reviewed: 2026-01-01\n---\n\n# Vendored\n",
    );
    expect(await filesOf(dir, [])).toEqual(["blog/post.md", "docs/guide.md"]);
    expect(await filesOf(dir, ["docs"])).toEqual(["docs/drafts/wip.md", "docs/guide.md"]);
  });

  it("with --no-config reads only the typed paths", async () => {
    expect(await filesOf(COLLECTIONS, ["blog"], { noConfig: true })).toEqual(["blog/post.md"]);
  });
});

describe("usage errors", () => {
  it("refuses --collection beside paths", async () => {
    await expect(
      runList(["docs"], { cwd: COLLECTIONS, collection: ["guides"] }),
    ).rejects.toThrow(WITH_PATHS);
  });

  it("refuses --collection with no config file", async () => {
    await expect(
      runList([], { cwd: emptyDir(), collection: ["guides"] }),
    ).rejects.toThrow(NEEDS_CONFIG);
  });

  it("refuses --collection under --no-config", async () => {
    await expect(
      runList([], { cwd: COLLECTIONS, noConfig: true, collection: ["guides"] }),
    ).rejects.toThrow(NEEDS_CONFIG);
  });

  it("reports an unknown collection with the shared message", async () => {
    await expect(runList([], { cwd: COLLECTIONS, collection: ["nope"] })).rejects.toThrow(
      'no collection named "nope" in manni.config.yaml. Configured: guides, blog.',
    );
  });

  it("reports the engine's own call the same way as the command's", () => {
    const config = loadConfig(undefined, COLLECTIONS);
    expect(() => discoverPages(config, { paths: ["docs"], collection: ["guides"] }, COLLECTIONS)).toThrow(
      WITH_PATHS,
    );
  });
});

describe("no paths and no collections", () => {
  it("list", async () => {
    await expect(runList([], { cwd: emptyDir() })).rejects.toThrow(noFiles("list"));
  });

  it("list, under --no-config beside a config that declares collections", async () => {
    await expect(runList([], { cwd: COLLECTIONS, noConfig: true })).rejects.toThrow(
      noFiles("list"),
    );
  });

  it("run", async () => {
    await expect(runRun([], { cwd: emptyDir(), deterministicOnly: true })).rejects.toThrow(
      noFiles("evaluate"),
    );
  });

  it("fill", async () => {
    await expect(runFill([], { cwd: emptyDir() })).rejects.toThrow(noFiles("fill"));
  });

  it("generate", async () => {
    await expect(runGenerate([], { cwd: emptyDir() })).rejects.toThrow(noFiles("read"));
  });

  it("promote", async () => {
    await expect(runPromote([], { cwd: emptyDir() })).rejects.toThrow(noFiles("read"));
  });
});
