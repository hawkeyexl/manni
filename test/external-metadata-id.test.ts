/**
 * Reading the metadata directory (proposal 0126): each page's
 * `metadata/<id>.yaml`, found by its `id`, loaded whole and shared by every
 * collection that reads it.
 *
 * The fixtures are under `test/fixtures/external-metadata-dir/`:
 *  - `two-collections`: guides and api read one `metadata/`, and
 *    `docs/both/` is in both. `no-id.md` carries no id.
 *  - `unsafe-id`: an id that cannot name a file, and one held encrypted.
 *  - `duplicate-id`: a page in each of two collections carries id intro.
 *  - `orphan`: `metadata/old-page.yaml` names an id no page carries.
 *  - `explicit`: an explicit `{id}` entry in a directory of its own.
 *  - `two-directories`: `metadata/` and an explicit `api-meta/`, a page in
 *    each carrying id index, and an orphan in one whose id the other's page
 *    carries.
 *  - `missing-dir`: `externalMetadataDir:` names a directory that is not there.
 *  - `manifest` and `unrelated` (chunk A's): the default directory holding a
 *    manifest, and holding only a YAML file that is not one.
 *
 * The config grammar and where the directory is are
 * `test/shared/external-metadata-dir.test.ts`'s business.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cpSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCollections, type CollectionConfig } from "../src/shared/collections.js";
import { applyMetadataDirectory } from "../src/shared/external-metadata-dir.js";
import { idManifestValues, loadExternalMetadata } from "../src/meta/core/external-metadata.js";
import { metaPageView } from "../src/meta/core/page-view.js";
import { markdownExtractor } from "../src/meta/extractors/markdown.js";
import { runValidate } from "../src/meta/commands/validate.js";
import { runGet } from "../src/meta/commands/get.js";
import { RESERVED_RULES } from "../src/meta/reporters/rule-id.js";
import { EXTERNAL_UNSAFE_ID_SCHEMA } from "../src/meta/index.js";
import { DocmetaError, type ValidationResult } from "../src/meta/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(here, "fixtures", "external-metadata-dir");
const at = (name: string): string => join(FIXTURES, name);

const temps: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A throwaway copy of a fixture, for the cases that move or edit a page. */
function copyOf(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `manni-id-${name}-`));
  temps.push(dir);
  cpSync(at(name), dir, { recursive: true });
  return dir;
}

async function rejection(run: Promise<unknown>): Promise<Error> {
  try {
    await run;
  } catch (err) {
    if (err instanceof Error) return err;
    throw err;
  }
  throw new Error("expected a rejection, but the call resolved");
}

/** Each file's value of `field`, as `get` reads it. */
async function valuesOf(cwd: string, field: string, inputs: string[] = []): Promise<Record<string, unknown>> {
  const results = await runGet({ cwd, inputs, fields: [field] });
  return Object.fromEntries(results.map((r) => [r.file, r.values[field]]));
}

const findings = (results: ValidationResult[], file: string, schema: string): ValidationResult["errors"] =>
  (results.find((r) => r.file === file)?.errors ?? []).filter((e) => e.schema === schema);

/** One collection reading `dir` the way discovery would hand it over. */
function readsDir(dir: string, raw: unknown[] = [{ name: "site", paths: ["docs/*.md"] }]): CollectionConfig[] {
  const toError = (m: string): Error => new DocmetaError(m);
  return applyMetadataDirectory(parseCollections(raw, "manni.config.yaml", toError), {}, {
    source: "manni.config.yaml",
    configDir: dir,
    toError,
    env: {},
  });
}

describe("a page reads metadata/<id>.yaml by its id (0126)", () => {
  it("merges each page's values, whichever collection it is in", async () => {
    // api is not the collection that read the directory first, and loses nothing.
    expect(await valuesOf(at("two-collections"), "personas")).toEqual({
      "docs/api/auth.md": ["devin"],
      "docs/both/overview.md": ["sara"],
      "docs/guides/no-id.md": undefined,
      "docs/guides/start.md": ["maya"],
    });
    expect((await valuesOf(at("two-collections"), "journeys"))["docs/api/auth.md"]).toEqual(["d1"]);
  });

  it("validates clean, a page in both collections reading its file once", async () => {
    const { results } = await runValidate({ cwd: at("two-collections"), inputs: [] });
    for (const file of ["docs/both/overview.md", "docs/guides/start.md", "docs/api/auth.md", "docs/guides/no-id.md"]) {
      expect(findings(results, file, "external:duplicate")).toEqual([]);
      expect(findings(results, file, "external:owned")).toEqual([]);
      expect(findings(results, file, EXTERNAL_UNSAFE_ID_SCHEMA)).toEqual([]);
    }
  });

  it("keeps a page's values when it is renamed, since its id is unchanged", async () => {
    const dir = copyOf("two-collections");
    renameSync(join(dir, "docs/guides/start.md"), join(dir, "docs/guides/begin.md"));
    const values = await valuesOf(dir, "personas");
    expect(values["docs/guides/begin.md"]).toEqual(["maya"]);
    expect(Object.hasOwn(values, "docs/guides/start.md")).toBe(false);
  });

  it("keeps a page's values when it is edited", async () => {
    const dir = copyOf("two-collections");
    const path = join(dir, "docs/api/auth.md");
    writeFileSync(path, readFileSync(path, "utf8").replace("title: Auth", "title: Signing requests"));
    expect((await valuesOf(dir, "personas"))["docs/api/auth.md"]).toEqual(["devin"]);
  });

  it("locates a value in its own file", async () => {
    const view = await metaPageView({ cwd: at("two-collections"), configPath: join(at("two-collections"), "manni.config.yaml") });
    const label = "docs/api/auth.md";
    const extracted = markdownExtractor.extract(readFileSync(join(at("two-collections"), label), "utf8"), label);
    const merged = await view.merge(label, extracted);
    // A value only the directory supplies, as graph's page view reads it.
    expect(merged.extracted.data["journeys"]).toEqual(["d1"]);
    expect(merged.locate("/journeys")).toEqual({ file: "metadata/api-auth.yaml", line: 3 });
  });

  it("refuses a page in two collections whose manifests both own one key", async () => {
    // Two collections reading one directory are one manifest; the refusal stays for two.
    const dir = copyOf("two-collections");
    const config = readFileSync(join(dir, "manni.config.yaml"), "utf8").replace(
      'paths: ["docs/api/*.md", "docs/both/*.md"]',
      'paths: ["docs/api/*.md", "docs/both/*.md"]\n    externalMetadata:\n      - file: "api.yaml"\n        keys: [personas]',
    );
    writeFileSync(join(dir, "manni.config.yaml"), config);
    writeFileSync(join(dir, "api.yaml"), "docs/both/overview.md:\n  personas: [theo]\n");
    const err = await rejection(runValidate({ cwd: dir, inputs: ["docs/both/overview.md"] }));
    expect(err.message).toBe(
      'docs/both/overview.md: "personas" is owned by manifests in two of its collections, api (api.yaml) and guides (metadata/{id}.yaml); a key has one manifest per file. Narrow one collection\'s paths or exclude.',
    );
  });
});

describe("an id that cannot name a file (0126)", () => {
  it("reads nothing, and files external:unsafe-id/external with its line", async () => {
    const { results } = await runValidate({ cwd: at("unsafe-id"), inputs: [] });
    expect(findings(results, "docs/upper.md", EXTERNAL_UNSAFE_ID_SCHEMA)).toEqual([
      {
        schema: EXTERNAL_UNSAFE_ID_SCHEMA,
        keyword: "external",
        subject: "Getting_Started",
        instancePath: "/id",
        message:
          'id "Getting_Started" cannot name a file in metadata/; an id that names a manifest is lowercase letters, digits and "-", starting with a letter or digit.',
        line: 4,
      },
    ]);
    const [encrypted] = findings(results, "docs/encrypted.md", EXTERNAL_UNSAFE_ID_SCHEMA);
    expect(encrypted?.message).toBe("id is encrypted, so it cannot name a file in metadata/; store it plain.");
    expect(encrypted?.instancePath).toBe("/id");
    expect(findings(results, "docs/plain.md", EXTERNAL_UNSAFE_ID_SCHEMA)).toEqual([]);
    expect(results.find((r) => r.file === "docs/upper.md")?.ok).toBe(false);
  });

  it("is a reserved rule", () => {
    expect(EXTERNAL_UNSAFE_ID_SCHEMA).toBe("external:unsafe-id");
    expect(RESERVED_RULES["external:unsafe-id/external"]).toBe(
      "The page's id cannot name a file in the metadata directory, so its external metadata is not read.",
    );
  });

  it("gives a page with no id nothing, and no finding", async () => {
    const { results } = await runValidate({ cwd: at("two-collections"), inputs: ["docs/guides/no-id.md"] });
    expect(findings(results, "docs/guides/no-id.md", EXTERNAL_UNSAFE_ID_SCHEMA)).toEqual([]);
    expect((await valuesOf(at("two-collections"), "personas", ["docs/guides/no-id.md"]))["docs/guides/no-id.md"]).toBe(
      undefined,
    );
  });
});

describe("two pages reading one directory with one id (0126)", () => {
  it("files external:duplicate/external on each, though metadata/intro.yaml does not exist", async () => {
    const { results } = await runValidate({ cwd: at("duplicate-id"), inputs: [] });
    expect(findings(results, "docs/a/intro.md", "external:duplicate").map((e) => e.message)).toEqual([
      '2 documents carry id "intro"; metadata/intro.yaml cannot tell them apart (docs/b/intro.md)',
    ]);
    expect(findings(results, "docs/b/intro.md", "external:duplicate").map((e) => e.message)).toEqual([
      '2 documents carry id "intro"; metadata/intro.yaml cannot tell them apart (docs/a/intro.md)',
    ]);
    expect(findings(results, "docs/a/other.md", "external:duplicate")).toEqual([]);
  });
});

describe("two directories whose pages share an id (0126)", () => {
  it("are two manifests: no duplicate, each page reading its own", async () => {
    // Both collections named, so the orphan below is not judged.
    const { results } = await runValidate({ cwd: at("two-directories"), inputs: [], collections: ["site", "api"] });
    for (const file of ["docs/site/index.md", "docs/api/index.md"]) {
      expect(findings(results, file, "external:duplicate")).toEqual([]);
    }
    expect(await valuesOf(at("two-directories"), "personas", ["docs/site/index.md", "docs/api/index.md"])).toEqual({
      "docs/site/index.md": ["maya"],
      "docs/api/index.md": ["devin"],
    });
  });

  it("still reports an orphan in one that a page of the other carries the id of", async () => {
    const err = await rejection(runValidate({ cwd: at("two-directories"), inputs: [] }));
    expect(err.message).toBe(
      'Manifest metadata/auth.yaml:1 names id "auth", which no loaded document carries. Fix the entry, or remove the file.',
    );
  });

  it("hands a writer the entry one manifest holds for an id", async () => {
    const dir = at("two-directories");
    // The fixture's collections, as discovery hands them over.
    const collections = applyMetadataDirectory(
      parseCollections(
        [
          { name: "site", paths: ["docs/site/*.md"] },
          { name: "api", paths: ["docs/api/*.md"], externalMetadata: [{ file: "api-meta/{id}.yaml" }] },
        ],
        "manni.config.yaml",
        (m) => new DocmetaError(m),
      ),
      {},
      { source: "manni.config.yaml", configDir: dir, toError: (m) => new DocmetaError(m), env: {} },
    );
    const index = await loadExternalMetadata(collections, { configDir: dir, base: dir });
    expect(idManifestValues(index, { pattern: "api-meta/{id}.yaml", id: "index" })?.get("personas")?.value).toEqual([
      "devin",
    ]);
    const entry = index?.entries.find((e) => e.file === "metadata/index.yaml");
    if (entry === undefined) throw new Error("expected metadata/index.yaml's entry");
    expect(idManifestValues(index, entry)?.get("personas")?.value).toEqual(["maya"]);
    expect(idManifestValues(index, { pattern: "metadata/{id}.yaml", id: "nope" })).toBeUndefined();
  });

  it("finds an id's entry for a caller whose paths start from another base", async () => {
    const dir = at("two-directories");
    const index = await loadExternalMetadata(readsDir(dir, [{ name: "site", paths: ["docs/site/*.md"] }]), {
      configDir: dir,
      base: resolve(dir, "docs"),
    });
    const personas = (pattern: string): unknown =>
      idManifestValues(index, { pattern, id: "index" })?.get("personas")?.value;
    // The index reports `../metadata/{id}.yaml`; this caller names it absolute, native separators and all.
    expect(personas(join(dir, "metadata", "{id}.yaml"))).toEqual(["maya"]);
    expect(personas("../metadata/{id}.yaml")).toEqual(["maya"]);
  });
});

describe("an entry no page carries (0126)", () => {
  const ORPHAN =
    'Manifest metadata/old-page.yaml:1 names id "old-page", which no loaded document carries. Fix the entry, or remove the file.';

  it("refuses a whole-corpus run, exit 2", async () => {
    const err = await rejection(runValidate({ cwd: at("orphan"), inputs: [] }));
    expect(err).toBeInstanceOf(DocmetaError);
    expect(err.message).toBe(ORPHAN);
  });

  it("is not checked on a run narrowed by paths or --collection", async () => {
    await expect(runValidate({ cwd: at("orphan"), inputs: ["docs/page.md"] })).resolves.toBeDefined();
    await expect(runValidate({ cwd: at("orphan"), inputs: [], collections: ["site"] })).resolves.toBeDefined();
  });
});

describe("an explicit {id} entry (0126)", () => {
  it("reads its own directory, and a page with no file there reads nothing", async () => {
    expect(await valuesOf(at("explicit"), "personas")).toEqual({
      "docs/auth.md": ["devin"],
      "docs/new.md": undefined,
    });
  });

  it("reads a directory that does not exist as empty, never refused", async () => {
    const results = await runGet({
      cwd: at("explicit"),
      configPath: join(at("explicit"), "manni.missing.yaml"),
      inputs: [],
      fields: ["personas"],
    });
    expect(results.map((r) => r.values["personas"])).toEqual([undefined, undefined]);
  });
});

describe("a directory someone named that is missing (0126)", () => {
  it("refuses with the key's line, exit 2", async () => {
    const err = await rejection(runValidate({ cwd: at("missing-dir"), inputs: [] }));
    expect(err).toBeInstanceOf(DocmetaError);
    expect(err.message).toBe(
      "externalMetadataDir: nope-meta does not exist. Create it, or check out the repository it names.",
    );
  });

  it("refuses with the environment's line when it names one", async () => {
    vi.stubEnv("MANNI_EXTERNAL_METADATA_DIR", "elsewhere");
    const err = await rejection(runGet({ cwd: at("missing-dir"), inputs: [], fields: ["personas"] }));
    expect(err.message).toBe(
      "MANNI_EXTERNAL_METADATA_DIR: elsewhere does not exist. Create it, or check out the repository it names.",
    );
  });

  it("reads as empty under missingDirectory: empty, for the writer that creates it", async () => {
    const toError = (m: string): Error => new DocmetaError(m);
    const dir = at("missing-dir");
    const collections = applyMetadataDirectory(
      parseCollections([{ name: "site", paths: ["docs/*.md"] }], "manni.config.yaml", toError),
      { externalMetadataDir: "nope-meta" },
      { source: "manni.config.yaml", configDir: dir, toError, env: {} },
    );
    await expect(loadExternalMetadata(collections, { configDir: dir, base: dir })).rejects.toThrow(DocmetaError);
    const index = await loadExternalMetadata(collections, { configDir: dir, base: dir, missingDirectory: "empty" });
    expect(index?.entries).toEqual([]);
  });
});

describe("the default directory (0126)", () => {
  it("is read once it holds a manifest", async () => {
    const dir = at("manifest");
    const index = await loadExternalMetadata(readsDir(dir), { configDir: dir, base: dir });
    expect(index?.entries.map((e) => [e.join, e.spelled, e.file])).toEqual([
      ["id", "getting-started", "metadata/getting-started.yaml"],
    ]);
  });

  it("is not read while it holds no manifest", async () => {
    const dir = at("unrelated");
    expect(await loadExternalMetadata(readsDir(dir), { configDir: dir, base: dir })).toBeNull();
  });
});
