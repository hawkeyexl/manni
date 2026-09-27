/**
 * A manifest with no `keys` (proposal 0068) owns every top-level field the
 * page's resolved schema set marks `x-manni-location: external`, less the
 * keys another manifest of the collection names, less its own join field.
 *
 * `test/fixtures/implied-keys/site` declares `{page}.citations.yaml` with
 * `keys: [citations]` beside a keyless `{page}.meta.yaml`. Its default schema
 * marks `owner` and `citations` external and `title` page. The glossary
 * override marks `definition` external and leaves `owner` unmarked, so a
 * glossary page's manifest owns a different set.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { runValidate } from "../src/meta/commands/validate.js";
import { runGet } from "../src/meta/commands/get.js";
import { runRelocate } from "../src/meta/commands/relocate.js";
import { runDerive } from "../src/meta/commands/derive.js";
import { runCheck } from "../src/cite/commands/check.js";
import { noGit } from "../src/cite/core/git.js";
import { markdownExtractor } from "../src/meta/extractors/markdown.js";
import { parseCollections } from "../src/shared/collections.js";
import { DocmetaError, type ValidationResult } from "../src/meta/types.js";
import { resetWarnings } from "../src/shared/warn.js";
import { commit, makeTempRepo, removeTempRepo } from "./helpers/temp-repo.js";

vi.setConfig({ testTimeout: 60_000 });

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(here, "fixtures", "implied-keys");
const SITE = join(FIXTURES, "site");

const TWO_KEYLESS =
  "manni.config.yaml: collections[0].externalMetadata: entries 1 and 2 both omit keys; at most one manifest may own the external-marked fields";

const temps: string[] = [];
const repos: string[] = [];
beforeEach(() => {
  resetWarnings();
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
  for (const d of repos.splice(0)) removeTempRepo(d);
});

function copy(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `manni-implied-${name}-`));
  temps.push(dir);
  cpSync(join(FIXTURES, name), dir, { recursive: true });
  return dir;
}

const read = (dir: string, rel: string): string => readFileSync(join(dir, rel), "utf8");
const errorsOf = (results: ValidationResult[], file: string): ValidationResult["errors"] =>
  results.find((r) => r.file === file)?.errors ?? [];
const owned = (results: ValidationResult[], file: string): ValidationResult["errors"] =>
  errorsOf(results, file).filter((e) => e.schema === "external:owned");

describe("config: keys is optional (0068)", () => {
  it("parses a manifest with no keys", () => {
    const [site] = parseCollections(
      [{ name: "site", paths: ["docs/**"], externalMetadata: [{ file: "{page}.meta.yaml" }] }],
      "manni.config.yaml",
      (m) => new Error(m),
    );
    expect(site?.externalMetadata).toEqual([{ file: "{page}.meta.yaml" }]);
  });

  it("still refuses an empty keys list", () => {
    expect(() =>
      parseCollections(
        [{ name: "site", paths: ["docs/**"], externalMetadata: [{ file: "m.yaml", keys: [] }] }],
        "manni.config.yaml",
        (m) => new Error(m),
      ),
    ).toThrow("manni.config.yaml: collections[0].externalMetadata[0].keys must be a non-empty list of key names.");
  });

  it("refuses two manifests that both omit keys, exit 2", async () => {
    const run = runValidate({ inputs: [], cwd: join(FIXTURES, "two-keyless") });
    await expect(run).rejects.toBeInstanceOf(DocmetaError);
    await expect(run).rejects.toThrow(TWO_KEYLESS);
    expect(() =>
      parseCollections(
        [
          {
            name: "site",
            paths: ["docs/**"],
            externalMetadata: [
              { file: "{page}.citations.yaml", keys: ["citations"] },
              { file: "{page}.meta.yaml" },
              { file: "./site-meta.yaml" },
            ],
          },
        ],
        "manni.config.yaml",
        (m) => new Error(m),
      ),
    ).toThrow(new Error(TWO_KEYLESS));
  });
});

describe("validate: the keyless manifest owns the marked fields", () => {
  it("refuses an entry setting a field the page's schemas do not mark external, exit 2", async () => {
    // `status` is unmarked, so nothing owns it, and an entry carrying it is
    // the refusal an explicit manifest gives for a key it does not own.
    const run = runValidate({ inputs: ["docs/guide.md"], cwd: SITE });
    await expect(run).rejects.toBeInstanceOf(DocmetaError);
    await expect(run).rejects.toThrow(
      `Manifest docs/guide.meta.yaml:1: "docs/guide.md" sets "status", which this manifest does not own, because the page's schemas do not mark it x-manni-location: external. Mark it external in the page's schemas, or remove it from the entry.`,
    );
  });

  it("merges the marked field", async () => {
    const dir = copy("site");
    writeFileSync(join(dir, "docs/guide.meta.yaml"), "docs/guide.md:\n  owner: platform\n");
    const { results } = await runValidate({ inputs: ["docs/guide.md"], cwd: dir });
    // `owner` is required, so the page passes only because the manifest's
    // value was merged.
    expect(results).toEqual([
      expect.objectContaining({ file: "docs/guide.md", ok: true, errors: [] }),
    ]);
    const got = await runGet({ inputs: ["docs/guide.md"], fields: ["owner", "citations"], cwd: dir, derived: false });
    expect(got[0]?.values).toEqual({ owner: "platform", citations: [{ id: "one" }] });
  });

  it("files external:owned when the page carries a field the manifest owns, exit 1", async () => {
    const { results } = await runValidate({ inputs: ["docs/carries.md"], cwd: SITE });
    expect(results[0]?.ok).toBe(false);
    expect(owned(results, "docs/carries.md")).toEqual([
      {
        schema: "external:owned",
        keyword: "external",
        subject: "owner",
        instancePath: "/owner",
        message: '"owner" is owned by manifest {page}.meta.yaml (collection site); remove it from the document',
        line: 3,
      },
      // Written keys win: citations is marked external, and the citations
      // manifest names it, so that manifest owns it and the keyless one does not.
      {
        schema: "external:owned",
        keyword: "external",
        subject: "citations",
        instancePath: "/citations",
        message: '"citations" is owned by manifest {page}.citations.yaml (collection site); remove it from the document',
        line: 4,
      },
    ]);
  });

  it("gives an override's pages the fields their own set marks", async () => {
    const { results } = await runValidate({ inputs: ["docs/glossary/term.md"], cwd: SITE });
    // `definition` is required and comes from the manifest. `owner` is
    // unmarked under the glossary set, so the page may carry it.
    expect(results).toEqual([
      expect.objectContaining({ file: "docs/glossary/term.md", ok: true, errors: [] }),
    ]);
  });

  it("refuses an entry setting a field another manifest names, exit 2", async () => {
    const dir = copy("site");
    writeFileSync(join(dir, "docs/guide.meta.yaml"), "docs/guide.md:\n  citations: []\n");
    const run = runValidate({ inputs: ["docs/guide.md"], cwd: dir });
    await expect(run).rejects.toBeInstanceOf(DocmetaError);
    await expect(run).rejects.toThrow(
      'Manifest docs/guide.meta.yaml:1: "docs/guide.md" sets "citations", which another manifest of this collection names in its "keys". Move it to that manifest, or remove it from the entry.',
    );
  });

  it("refuses an entry setting the field its manifest joins on, exit 2", async () => {
    const dir = copy("join");
    writeFileSync(join(dir, "site-meta.yaml"), "install:\n  slug: install\n");
    const run = runValidate({ inputs: [], cwd: dir });
    await expect(run).rejects.toBeInstanceOf(DocmetaError);
    await expect(run).rejects.toThrow(
      'Manifest site-meta.yaml:1: "install" sets "slug", the field this manifest joins on, which the page carries. Remove it from the entry.',
    );
  });

  it("never owns the field the manifest joins on", async () => {
    const { results } = await runValidate({ inputs: [], cwd: join(FIXTURES, "join") });
    // `slug` is marked external and the page carries it, which is how the
    // page names its entry. `owner` is required and comes from the manifest.
    expect(results).toEqual([
      expect.objectContaining({ file: "docs/install.md", ok: true, errors: [] }),
    ]);
  });
});

describe("the writers follow the marks", () => {
  it("relocate moves a marked field into the keyless manifest and leaves the config alone", async () => {
    const dir = copy("site");
    const config = read(dir, "manni.config.yaml");
    const result = await runRelocate({ inputs: ["docs/carries.md"], cwd: dir });
    expect(result.files).toEqual([
      {
        file: "docs/carries.md",
        moved: [
          { key: "owner", to: "manifest", manifest: "docs/carries.meta.yaml", line: 2, reason: "preferred" },
          { key: "citations", to: "manifest", manifest: "docs/carries.citations.yaml", line: 2, reason: "preferred" },
        ],
        stayed: [],
        beyond: false,
      },
    ]);
    expect(parseYaml(read(dir, "docs/carries.meta.yaml"))).toEqual({ "docs/carries.md": { owner: "platform" } });
    expect(read(dir, "manni.config.yaml")).toBe(config);
    const { results } = await runValidate({ inputs: ["docs/carries.md"], cwd: dir });
    expect(results[0]).toMatchObject({ ok: true, errors: [] });
  });

  it("derive stamps a managed field into the keyless manifest", async () => {
    const dir = makeTempRepo({ files: {} });
    repos.push(dir);
    cpSync(join(FIXTURES, "derive"), dir, { recursive: true });
    commit(dir, "add", { authorDate: "2026-08-20T10:00:00+00:00" });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const run = await runDerive({ inputs: [], cwd: dir });
    const field = run.results[0]?.fields.find((f) => f.field === "created");
    expect(field).toMatchObject({ written: true, destination: "docs/install.meta.yaml" });
    expect(parseYaml(read(dir, "docs/install.meta.yaml"))).toEqual({
      "docs/install.md": { created: "2026-08-20" },
    });
    expect(markdownExtractor.extract(read(dir, "docs/install.md"), "docs/install.md").data).toEqual({
      title: "Install",
    });
  });

  it("cite reads a page's citations from the keyless manifest", async () => {
    const run = await runCheck({ cwd: join(FIXTURES, "cite"), inputs: [], gitClient: noGit(), env: {} });
    const page = run.pages.find((p) => p.file === "docs/limits.md");
    expect(page?.citations[0]?.origin).toEqual({
      kind: "manifest",
      file: "docs/limits.citations.yaml",
      line: 4,
      index: 0,
    });
  });

  it("cite reads a keyless manifest that also holds another external field", async () => {
    // Ownership is judged over the page with the manifest's values in place,
    // so `owner`, which stewardship marks external, is the manifest's too.
    const run = await runCheck({ cwd: join(FIXTURES, "cite-other"), inputs: [], gitClient: noGit(), env: {} });
    const page = run.pages.find((p) => p.file === "docs/limits.md");
    expect(page?.citations[0]?.citation.id).toBe("fetch-timeout");
    expect(page?.citations[0]?.origin.kind).toBe("manifest");
  });
});
