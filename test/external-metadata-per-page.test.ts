/**
 * A manifest per page (proposal 0058, as amended by the approved plan).
 *
 * `externalMetadata[].file` may hold one placeholder, `{page}`, which resolves
 * per page to the page's path relative to the config file's directory,
 * without its extension. Two halves are under test here:
 *
 *  - the grammar, refused at config parse with exit 2, one fixture per
 *    refusal under `test/fixtures/per-page/`;
 *  - the reading: a placeholder entry resolves, reads and indexes a manifest
 *    for exactly the run's pages that belong to its collection. A missing one
 *    reads as empty; every other failure, a page above the config, two pages
 *    sharing one manifest, and a manifest keyed to another page, refuse.
 *
 * A `file` without the placeholder is every other external-metadata suite's
 * business, and none of them changes.
 */
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parseCollections, type CollectionConfig } from "../src/shared/collections.js";
import { memberOf } from "../src/meta/core/collections.js";
import {
  loadExternalMetadata,
  mergeExternalMetadata,
  type ExternalMetadataIndex,
} from "../src/meta/core/external-metadata.js";
import { runValidate } from "../src/meta/commands/validate.js";
import { runGet } from "../src/meta/commands/get.js";
import { runQuery } from "../src/meta/commands/query.js";
import { runInferSchema } from "../src/meta/commands/schemas.js";
import { DocmetaError, type ExtractedMetadata } from "../src/meta/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(here, "fixtures", "per-page");
const SOURCE = "manni.config.yaml";

/** The message a promise rejected with. Fails if it resolved. */
async function rejection(run: Promise<unknown>): Promise<Error> {
  try {
    await run;
  } catch (err) {
    if (err instanceof Error) return err;
    throw err;
  }
  throw new Error("expected a rejection, but the call resolved");
}

/** The message `parseCollections` refused with. Fails if it did not refuse. */
function refusal(raw: unknown): string {
  try {
    parseCollections(raw, SOURCE, (m) => new DocmetaError(m));
  } catch (err) {
    if (err instanceof Error) return err.message;
    throw err;
  }
  throw new Error("expected parseCollections to throw, but it returned");
}

function collections(externalMetadata: unknown[], paths = ["docs/**/*.md"]): CollectionConfig[] {
  return parseCollections(
    [{ name: "site", paths, externalMetadata }],
    SOURCE,
    (m) => new DocmetaError(m),
  );
}

function doc(data: Record<string, unknown> = {}): ExtractedMetadata {
  return { data, present: true, format: "markdown", lineFor: () => undefined };
}

describe("per-page manifests: the grammar, refused at parse (exit 2)", () => {
  // Each fixture is a config and nothing else: the refusal fires while the
  // config is read, before any path is walked.
  const cases: [fixture: string, message: string][] = [
    [
      "unknown-token",
      'manni.config.yaml: collections[0].externalMetadata[0].file uses "{collection}", which is not a placeholder. The only placeholder is {page}.',
    ],
    [
      "stray-brace",
      'manni.config.yaml: collections[0].externalMetadata[0].file contains "{" outside a {page} placeholder. Remove it, or write {page}.',
    ],
    [
      "page-twice",
      "manni.config.yaml: collections[0].externalMetadata[0].file uses {page} twice. One manifest names one page.",
    ],
    [
      "field-join",
      'manni.config.yaml: collections[0].externalMetadata[0].file uses {page}, and join is "id". A per-page manifest is found by path, so it cannot be keyed by a field. Remove {page}, or remove join.',
    ],
    [
      "url",
      "manni.config.yaml: collections[0].externalMetadata[0].file uses {page} in a URL. A placeholder names a file this run can write, and a URL is not one.",
    ],
    [
      "absolute",
      "manni.config.yaml: collections[0].externalMetadata[0].file uses {page} in an absolute path, so every manifest would sit outside the repository. Make it relative to the config file.",
    ],
    [
      "two-entries-one-pattern",
      "manni.config.yaml: collections[0].externalMetadata[1].file resolves to the same manifest as externalMetadata[0].file for every page. Give each entry its own file name.",
    ],
  ];
  for (const [fixture, message] of cases) {
    it(fixture, async () => {
      const err = await rejection(runValidate({ cwd: resolve(fixtures, fixture), inputs: [] }));
      expect(err).toBeInstanceOf(DocmetaError);
      expect(err.message).toBe(message);
    });
  }

  it("names a closing brace outside a token too", () => {
    expect(refusal([{ name: "site", paths: ["docs"], externalMetadata: [{ file: "a}b.yaml", keys: ["x"] }] }])).toBe(
      'manni.config.yaml: collections[0].externalMetadata[0].file contains "}" outside a {page} placeholder. Remove it, or write {page}.',
    );
  });

  it("refuses a Windows drive path as absolute", () => {
    expect(
      refusal([
        { name: "site", paths: ["docs"], externalMetadata: [{ file: "C:\\srv\\{page}.yaml", keys: ["x"] }] },
      ]),
    ).toBe(
      "manni.config.yaml: collections[0].externalMetadata[0].file uses {page} in an absolute path, so every manifest would sit outside the repository. Make it relative to the config file.",
    );
  });

  it("names the colliding entries, whichever collection they are in", () => {
    expect(
      refusal([
        { name: "a", paths: ["a"], externalMetadata: [{ file: "a.yaml", keys: ["x"] }] },
        {
          name: "b",
          paths: ["b"],
          externalMetadata: [
            { file: "meta\\{page}.yaml", keys: ["x"] },
            { file: "concrete.yaml", keys: ["y"] },
            { file: "./meta/{page}.yaml", keys: ["z"] },
          ],
        },
      ]),
    ).toBe(
      "manni.config.yaml: collections[1].externalMetadata[2].file resolves to the same manifest as externalMetadata[0].file for every page. Give each entry its own file name.",
    );
  });

  it("accepts an explicit join: path, which is the default spelled out", () => {
    const [site] = collections([{ file: "{page}.citations.yaml", keys: ["citations"], join: "path" }]);
    expect(site?.externalMetadata).toEqual([
      { file: "{page}.citations.yaml", keys: ["citations"], join: "path" },
    ]);
  });

  it("keeps two concrete entries naming one file legal, as today", () => {
    const [site] = collections([
      { file: "./meta.yaml", keys: ["a"] },
      { file: "meta.yaml", keys: ["b"] },
    ]);
    expect(site?.externalMetadata.map((m) => m.file)).toEqual(["./meta.yaml", "meta.yaml"]);
  });

  it("keeps two placeholder entries with different patterns legal", () => {
    const [site] = collections([
      { file: "{page}.citations.yaml", keys: ["citations"] },
      { file: "{page}.owner.yaml", keys: ["owner"] },
    ]);
    expect(site?.externalMetadata).toHaveLength(2);
  });
});

describe("per-page manifests: reading", () => {
  const sibling = resolve(fixtures, "sibling");
  const siblingCollections = collections([{ file: "{page}.citations.yaml", keys: ["owner", "jira"] }]);
  const pagesOf = (root: string, labels: string[]): string[] => labels.map((l) => resolve(root, l));

  const loadSibling = (labels: string[]): Promise<ExternalMetadataIndex | null> =>
    loadExternalMetadata(siblingCollections, {
      configDir: sibling,
      base: sibling,
      pages: pagesOf(sibling, labels),
    });

  it("reads each page's own manifest, and names that file and line on every value", async () => {
    const index = await loadSibling(["docs/cited.md", "docs/uncited.md"]);
    const cited = index?.byPath.get(resolve(sibling, "docs/cited.md"));
    expect(cited?.get("owner")).toEqual({
      value: "maya",
      collection: "site",
      file: "docs/cited.citations.yaml",
      line: 2,
    });
    expect(cited?.get("jira")?.line).toBe(3);
    expect(index?.entries).toEqual([
      {
        collection: "site",
        join: "path",
        abs: resolve(sibling, "docs/cited.md"),
        spelled: "docs/cited.md",
        file: "docs/cited.citations.yaml",
        line: 1,
      },
    ]);
  });

  it("reads a page with no manifest as empty: no values, no entries, no error", async () => {
    const index = await loadSibling(["docs/uncited.md"]);
    expect(index).not.toBeNull();
    expect(index?.byPath.size).toBe(0);
    expect(index?.entries).toEqual([]);
  });

  it("records the pattern as written as the owner of each key", async () => {
    const index = await loadSibling(["docs/cited.md"]);
    expect(index?.owners.get("owner")).toEqual([
      { collection: "site", file: "{page}.citations.yaml" },
    ]);
  });

  it("reads nothing without pages: a placeholder entry is not loaded eagerly", async () => {
    // The copied-manifest fixture would refuse were its file read.
    const copied = resolve(fixtures, "copied-manifest");
    const index = await loadExternalMetadata(
      collections([{ file: "{page}.citations.yaml", keys: ["owner"] }]),
      { configDir: copied, base: copied },
    );
    expect(index?.byPath.size).toBe(0);
    expect(index?.entries).toEqual([]);
  });

  it("consults no manifest for a page outside the collection", async () => {
    // notes/README.citations.yaml holds an entry for another page, which
    // would refuse were it read.
    const index = await loadSibling(["notes/README.md"]);
    expect(index?.byPath.size).toBe(0);
  });

  it("reports the manifest relative to the run's base", async () => {
    const index = await loadExternalMetadata(siblingCollections, {
      configDir: sibling,
      base: resolve(sibling, "docs"),
      pages: pagesOf(sibling, ["docs/cited.md"]),
    });
    expect(index?.byPath.get(resolve(sibling, "docs/cited.md"))?.get("owner")?.file).toBe(
      "cited.citations.yaml",
    );
  });

  it("locates a merged value in the page's own manifest", async () => {
    const index = await loadSibling(["docs/cited.md"]);
    const label = "docs/cited.md";
    const merged = mergeExternalMetadata(
      label,
      doc({ title: "Cited" }),
      index,
      memberOf(siblingCollections, sibling, sibling, label),
      sibling,
    );
    expect(merged.extracted.data).toMatchObject({ owner: "maya", jira: "PLAT-7" });
    expect(merged.locate("/jira")).toEqual({ file: "docs/cited.citations.yaml", line: 3 });
  });

  it("resolves a mirrored layout under its prefix", async () => {
    const mirrored = resolve(fixtures, "mirrored");
    const index = await loadExternalMetadata(
      collections([{ file: "./meta/{page}.citations.yaml", keys: ["owner"] }]),
      { configDir: mirrored, base: mirrored, pages: pagesOf(mirrored, ["docs/guide/page.md"]) },
    );
    expect(index?.byPath.get(resolve(mirrored, "docs/guide/page.md"))?.get("owner")).toEqual({
      value: "devin",
      collection: "site",
      file: "meta/docs/guide/page.citations.yaml",
      line: 2,
    });
  });

  it("merges through get, end to end, from the fixture's own config", async () => {
    const results = await runGet({ cwd: sibling, inputs: [], fields: ["jira"] });
    expect(results.map((r) => [r.file, r.values.jira])).toEqual([
      ["docs/cited.md", "PLAT-7"],
      ["docs/uncited.md", undefined],
    ]);
  });

  it("projects a per-page value as a query column", async () => {
    const r = await runQuery({
      cwd: sibling,
      inputs: [],
      sql: "SELECT _path, jira FROM docs ORDER BY _path",
      dryRun: true,
    });
    expect(r.rows).toEqual([
      { _path: "docs/cited.md", jira: "PLAT-7" },
      { _path: "docs/uncited.md", jira: null },
    ]);
  });

  it("counts a per-page value in an inferred schema's coverage", async () => {
    const r = await runInferSchema({ cwd: sibling, inputs: [] });
    expect(r.keys.find((k) => k.key === "jira")?.present).toBe(1);
  });

  it("keeps the refusal for a manifest that exists but cannot be read", async () => {
    const root = resolve(fixtures, "unreadable-manifest");
    const err = await rejection(runValidate({ cwd: root, inputs: [] }));
    expect(err).toBeInstanceOf(DocmetaError);
    expect(err.message).toMatch(
      /^Manifest docs\/page\.citations\.yaml could not be read: EISDIR: illegal operation on a directory/,
    );
  });
});

describe("per-page manifests: runtime refusals (exit 2)", () => {
  it("refuses a page above the config directory", async () => {
    const project = resolve(fixtures, "above-config", "project");
    const err = await rejection(runValidate({ cwd: project, inputs: ["../site/install.md"] }));
    expect(err).toBeInstanceOf(DocmetaError);
    expect(err.message).toBe(
      `manni.config.yaml: collections[0].externalMetadata[0].file resolves outside manni.config.yaml's directory for "../site/install.md". A {page} manifest stays under the config file.`,
    );
  });

  it("refuses two pages resolving one manifest", async () => {
    const root = resolve(fixtures, "two-pages-one-file");
    const err = await rejection(runValidate({ cwd: root, inputs: [] }));
    expect(err).toBeInstanceOf(DocmetaError);
    expect(err.message).toBe(
      "docs/install.md and docs/install.mdx both resolve {page} to docs/install.citations.yaml. A {page} manifest names one page, so rename one of them.",
    );
  });

  it("refuses a manifest holding an entry for another page", async () => {
    const root = resolve(fixtures, "copied-manifest");
    const err = await rejection(runValidate({ cwd: root, inputs: [] }));
    expect(err).toBeInstanceOf(DocmetaError);
    expect(err.message).toBe(
      'Manifest docs/index.citations.yaml:1 names "docs/other.md", but {page} resolved this file for "docs/index.md". A per-page manifest holds one entry, for its own page.',
    );
  });

  it("refuses a copied manifest even when the page it names is not in the run", async () => {
    const root = resolve(fixtures, "copied-manifest");
    const err = await rejection(
      loadExternalMetadata(collections([{ file: "{page}.citations.yaml", keys: ["owner"] }]), {
        configDir: root,
        base: root,
        pages: [resolve(root, "docs/index.md")],
      }),
    );
    expect(err.message).toBe(
      'Manifest docs/index.citations.yaml:1 names "docs/other.md", but {page} resolved this file for "docs/index.md". A per-page manifest holds one entry, for its own page.',
    );
  });
});
