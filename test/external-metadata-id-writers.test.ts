/**
 * meta's writers on the metadata directory (proposal 0126): `fill`, `derive`
 * and `query` put a value an `{id}` manifest owns in the page's
 * `metadata/<id>.yaml`, minting the page an id first when it has none, and
 * `relocate` creates the directory as a collection's created home (0047
 * section 3) and lists what it minted.
 *
 * The fixtures are under `test/fixtures/external-metadata-dir/`:
 *  - `writers`: `metadata/owned.yaml` puts the directory in play; `known.md`
 *    carries an id with no file yet, `fresh.md` none, and `unsafe.md` one
 *    that cannot name a file.
 *  - `created`: no `metadata/` yet. `site` declares no externalMetadata and
 *    `api` declares an empty list.
 *  - `mint-stay`: a Docusaurus page no id is minted for.
 *  - `missing-dir`: `externalMetadataDir:` names a directory that is not there.
 * Each case runs on a private copy.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { MockProvider, type InferenceProvider } from "@hawkeyexl/inference";
import { runFill } from "../src/meta/commands/fill.js";
import { runDerive } from "../src/meta/commands/derive.js";
import { runQuery } from "../src/meta/commands/query.js";
import { runRelocate } from "../src/meta/commands/relocate.js";
import { runGet } from "../src/meta/commands/get.js";
import { renderRelocate } from "../src/meta/reporters/relocate.js";
import { offerPrompt, planRelocation, relocationContext, relocationOffers } from "../src/meta/core/relocation.js";
import { resolveRunConfig } from "../src/meta/core/config.js";
import { Validator } from "../src/meta/core/validator.js";
import { schemaLoadOptions } from "../src/meta/core/schema-registry.js";
import { markdownExtractor } from "../src/meta/extractors/markdown.js";
import { resetWarnings } from "../src/shared/warn.js";
import { commit, makeTempRepo, removeTempRepo } from "./helpers/temp-repo.js";

vi.setConfig({ testTimeout: 60_000 });

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(here, "fixtures", "external-metadata-dir");
const MODEL = "claude-sonnet-4-5";

const dirs: string[] = [];
const repos: string[] = [];
let stderr: string[] = [];
beforeEach(() => {
  resetWarnings();
  stderr = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
    stderr.push(String(chunk));
    return true;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  for (const d of repos.splice(0)) removeTempRepo(d);
});

function copy(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `manni-id-writers-${name}-`));
  dirs.push(dir);
  cpSync(join(FIXTURES, name), dir, { recursive: true });
  return dir;
}

/** A copy committed to a fresh repository, for derive's sources. */
function stage(name: string): string {
  const dir = makeTempRepo({ files: {} });
  repos.push(dir);
  cpSync(join(FIXTURES, name), dir, { recursive: true });
  commit(dir, "add", { authorDate: "2026-08-20T10:00:00+00:00" });
  return dir;
}

const read = (dir: string, rel: string): string => readFileSync(join(dir, rel), "utf8");
const pageData = (dir: string, rel: string): Record<string, unknown> =>
  markdownExtractor.extract(read(dir, rel), rel).data;
const yamlOf = (dir: string, rel: string): unknown => parseYaml(read(dir, rel));
const pretty = (result: Awaited<ReturnType<typeof runRelocate>>): string =>
  renderRelocate(result, "pretty", { color: false });

/** One proposal of `reviewer` per call: derive manages `owner`, so fill never proposes it. */
function reviewers(values: string[]): InferenceProvider {
  return new MockProvider(
    values.map((v) => ({ json: { reviewer: { value: v, confidence: 0.9, reasoning: "stated" } } })),
    MODEL,
  );
}

const MINTED_FRESH = 'manni: minted id "fresh" in docs/fresh.md, for metadata/fresh.yaml.\n';
const UNSAFE =
  'docs/unsafe.md: id "Not_Safe" cannot name a file in metadata/; an id that names a manifest is lowercase letters, digits and "-", starting with a letter or digit.';

describe("fill", () => {
  const fill = (dir: string, file: string) =>
    runFill({ cache: false, concurrency: 1, cwd: dir, inputs: [file], inferenceProvider: reviewers(["ada"]) });

  it("writes a page's value to the file its id names, creating it", async () => {
    const dir = copy("writers");
    await fill(dir, "docs/known.md");
    expect(yamlOf(dir, "metadata/known.yaml")).toEqual({ known: { reviewer: "ada" } });
    // The page keeps its id, and fill's own record of what it proposed.
    expect(Object.keys(pageData(dir, "docs/known.md"))).toEqual(["title", "id", "meta-provenance"]);
    expect(stderr.filter((l) => l.includes("minted"))).toEqual([]);
  });

  it("mints an id into a page with none, and says so once", async () => {
    const dir = copy("writers");
    await fill(dir, "docs/fresh.md");
    expect(pageData(dir, "docs/fresh.md")).toMatchObject({ title: "Fresh", id: "fresh" });
    expect(pageData(dir, "docs/fresh.md")).not.toHaveProperty("reviewer");
    expect(yamlOf(dir, "metadata/fresh.yaml")).toEqual({ fresh: { reviewer: "ada" } });
    expect(stderr.filter((l) => l.includes("minted"))).toEqual([MINTED_FRESH]);
  });

  it("refuses a page whose id cannot name a file", async () => {
    const dir = copy("writers");
    await expect(fill(dir, "docs/unsafe.md")).rejects.toThrow(UNSAFE);
    expect(existsSync(join(dir, "metadata/Not_Safe.yaml"))).toBe(false);
  });

  it("offers the directory as a collection's created home, and on yes writes there (P1)", async () => {
    const dir = copy("writers");
    rmSync(join(dir, "metadata"), { recursive: true });
    const notices: string[] = [];
    const questions: string[] = [];
    await runFill({
      cache: false,
      concurrency: 1,
      cwd: dir,
      inputs: ["docs/fresh.md"],
      inferenceProvider: reviewers(["ada"]),
      onNotice: (m) => notices.push(m),
      confirm: (question) => {
        questions.push(question);
        return Promise.resolve(true);
      },
    });
    expect(notices).toContain(
      "collection site has no manifest for reviewer, which the schema prefers in external metadata.",
    );
    expect(questions).toEqual(["Create metadata/<id>.yaml? "]);
    expect(yamlOf(dir, "metadata/fresh.yaml")).toEqual({ fresh: { reviewer: "ada" } });
    expect(pageData(dir, "docs/fresh.md")).toMatchObject({ id: "fresh" });
    // No config edit declares it: the collection reads it once it holds a manifest.
    expect(read(dir, "manni.config.yaml")).toBe(read(join(FIXTURES, "writers"), "manni.config.yaml"));
  });

  it("off a terminal, with no directory yet, writes the page and warns (W1)", async () => {
    const dir = copy("writers");
    rmSync(join(dir, "metadata"), { recursive: true });
    await fill(dir, "docs/fresh.md");
    expect(pageData(dir, "docs/fresh.md")).toMatchObject({ reviewer: "ada" });
    expect(pageData(dir, "docs/fresh.md")).not.toHaveProperty("id");
    expect(stderr.filter((l) => l.includes("external metadata"))).toEqual([
      "manni: wrote reviewer to 1 page in collection site; the schema prefers external metadata, and no manifest owns it. Run manni meta relocate to move it.\n",
    ]);
  });
});

describe("derive", () => {
  it("writes each page's field to its id's file, minting the id a page lacks", async () => {
    const dir = stage("writers");
    const run = await runDerive({ inputs: ["docs/known.md", "docs/fresh.md"], cwd: dir });
    expect(run.summary.errors).toBe(0);
    expect(yamlOf(dir, "metadata/known.yaml")).toEqual({ known: { owner: ["@platform-docs"] } });
    expect(yamlOf(dir, "metadata/fresh.yaml")).toEqual({ fresh: { owner: ["@platform-docs"] } });
    expect(read(dir, "docs/fresh.md")).toBe("---\ntitle: Fresh\nid: fresh\n---\n\n# Fresh\n");
    expect(stderr.filter((l) => l.includes("minted"))).toEqual([MINTED_FRESH]);
  });

  it("refuses a page whose id cannot name a file", async () => {
    const dir = stage("writers");
    const run = await runDerive({ inputs: ["docs/unsafe.md"], cwd: dir }).catch((err: unknown) => err);
    expect(run).toBeInstanceOf(Error);
    expect(String(run)).toContain(UNSAFE);
  });
});

describe("query", () => {
  const q = (dir: string, sql: string) => runQuery({ cwd: dir, inputs: [], sql });

  // Staged, since the config's derive section reads CODEOWNERS through git.
  it("SET writes the file the page's id names", async () => {
    const dir = stage("writers");
    const run = await q(dir, "UPDATE docs SET reviewer = 'web' WHERE _path = 'docs/known.md'");
    expect(run.changes).toMatchObject([{ file: "docs/known.md", key: "reviewer", manifest: "metadata/known.yaml" }]);
    expect(yamlOf(dir, "metadata/known.yaml")).toEqual({ known: { reviewer: "web" } });
  });

  it("SET mints an id into a page with none", async () => {
    const dir = stage("writers");
    await q(dir, "UPDATE docs SET reviewer = 'web' WHERE _path = 'docs/fresh.md'");
    expect(read(dir, "docs/fresh.md")).toBe("---\ntitle: Fresh\nid: fresh\n---\n\n# Fresh\n");
    expect(yamlOf(dir, "metadata/fresh.yaml")).toEqual({ fresh: { reviewer: "web" } });
    expect(stderr.filter((l) => l.includes("minted"))).toEqual([MINTED_FRESH]);
  });

  it("SET refuses a page whose id cannot name a file", async () => {
    const dir = stage("writers");
    await expect(q(dir, "UPDATE docs SET reviewer = 'web' WHERE _path = 'docs/unsafe.md'")).rejects.toThrow(UNSAFE);
  });

  it("SET _path moves a page whose values live in its id's file, which stays", async () => {
    const dir = stage("writers");
    const before = read(dir, "metadata/owned.yaml");
    await q(dir, "UPDATE docs SET _path = 'docs/renamed.md' WHERE _path = 'docs/owned.md'");
    expect(existsSync(join(dir, "docs/renamed.md"))).toBe(true);
    expect(read(dir, "metadata/owned.yaml")).toBe(before);
    const [got] = await runGet({ cwd: dir, inputs: ["docs/renamed.md"], fields: ["owner"] });
    expect(got?.values["owner"]).toEqual(["@platform-docs"]);
  });

  it("leaves a value in the page, and says why, when no id can be minted", async () => {
    const dir = copy("mint-stay");
    await q(dir, "UPDATE docs SET visibility = 'internal' WHERE _path = 'docs/docusaurus.md'");
    expect(read(dir, "docs/docusaurus.md")).toContain("visibility: internal\n");
    expect(existsSync(join(dir, "metadata/docusaurus.yaml"))).toBe(false);
    expect(stderr.filter((l) => l.includes("no id could be minted"))).toEqual([
      "manni: docs/docusaurus.md: no id could be minted (docusaurus:docs:3.10 gives id a meaning of its own; set one by hand), so visibility stays in the page.\n",
    ]);
  });
});

describe("relocate: the metadata directory as a collection's created home", () => {
  it("creates it for a collection with no externalMetadata:, and a manifest of its own for one with []", async () => {
    const dir = copy("created");
    const result = await runRelocate({ inputs: [], cwd: dir });
    expect(pretty(result)).toBe(
      [
        "Created metadata/; it owns what each page's schemas mark external, one <id>.yaml per page.",
        "Created api.metadata.yaml; collections[api].externalMetadata[0] owns owner.",
        "docs/api/auth.md",
        "    owner    → api.metadata.yaml:2",
        "docs/site/guide.md",
        "    id       ← minted guide",
        "    owner    → metadata/guide.yaml:2",
        "docs/site/tagged.md",
        "    owner    → metadata/tagged.yaml:2",
        "3 files, 3 values moved to 3 manifests, 1 id minted",
      ].join("\n"),
    );
    expect(yamlOf(dir, "metadata/guide.yaml")).toEqual({ guide: { owner: ["platform"] } });
    expect(yamlOf(dir, "metadata/tagged.yaml")).toEqual({ tagged: { owner: ["support"] } });
    expect(read(dir, "docs/site/guide.md")).toBe("---\ntitle: Guide\nid: guide\n---\n\n# Guide\n");
    // Only api's manifest is declared; site reads the directory with no edit.
    expect(yamlOf(dir, "manni.config.yaml")).toMatchObject({
      collections: [
        { name: "site", paths: ["docs/site/*.md"] },
        { name: "api", externalMetadata: [{ file: "./api.metadata.yaml", keys: ["owner"] }] },
      ],
    });
    expect(pretty(await runRelocate({ inputs: [], cwd: dir }))).toBe("0 files, nothing to move");
  });

  it("names the minted ids in JSON", async () => {
    const dir = copy("created");
    const result = await runRelocate({ inputs: ["docs/site/"], cwd: dir });
    const json = JSON.parse(renderRelocate(result, "json")) as {
      manifests: { file: string; created: boolean }[];
      files: { file: string; minted?: string }[];
      summary: { minted?: number };
    };
    expect(json.manifests).toEqual([expect.objectContaining({ file: "metadata/{id}.yaml", created: true })]);
    expect(json.files.map((f) => [f.file, f.minted])).toEqual([
      ["docs/site/guide.md", "guide"],
      ["docs/site/tagged.md", undefined],
    ]);
    expect(json.summary.minted).toBe(1);
  });

  it("says what it would create and mint under --dry-run, and writes nothing", async () => {
    const dir = copy("created");
    const result = await runRelocate({ inputs: ["docs/site/"], cwd: dir, dryRun: true });
    expect(pretty(result)).toBe(
      [
        "Would create metadata/; it would own what each page's schemas mark external, one <id>.yaml per page.",
        "docs/site/guide.md",
        "    id       ← minted guide",
        "    owner    → metadata/guide.yaml",
        "docs/site/tagged.md",
        "    owner    → metadata/tagged.yaml",
        "2 files, 2 values would move to 2 manifests, 1 id would be minted",
      ].join("\n"),
    );
    expect(existsSync(join(dir, "metadata"))).toBe(false);
    expect(read(dir, "docs/site/guide.md")).toContain("owner: [platform]");
  });

  it("moves the values of every page with an id that reads the directory it creates", async () => {
    const dir = copy("created");
    const result = await runRelocate({ inputs: ["docs/site/guide.md"], cwd: dir, fields: ["owner"] });
    expect(result.files.map((f) => [f.file, f.beyond])).toEqual([
      ["docs/site/guide.md", false],
      ["docs/site/tagged.md", true],
    ]);
    expect(yamlOf(dir, "metadata/tagged.yaml")).toEqual({ tagged: { owner: ["support"] } });
  });

  it("words the writers' offer by the file each page gets", async () => {
    const dir = copy("created");
    const run = await resolveRunConfig({ cwd: dir, inputs: ["docs/site/guide.md"] });
    const ctx = relocationContext(run, {
      cwd: dir,
      targets: ["docs/site/guide.md"],
      validator: new Validator(schemaLoadOptions({ root: dir, fileBase: dir })),
    });
    const plan = await planRelocation(ctx, { files: ["docs/site/guide.md"], fields: ["owner"] });
    const [offer] = relocationOffers(plan);
    expect(offer === undefined ? undefined : offerPrompt(offer, "write")).toEqual({
      notice: "collection site has no manifest for owner, which the schema prefers in external metadata.",
      question: "Create metadata/<id>.yaml and move them out of 2 pages? ",
    });
  });

  it("creates a directory the key names that is not there, and refuses one under --dry-run", async () => {
    const dir = copy("missing-dir");
    await expect(runRelocate({ inputs: [], cwd: dir, dryRun: true })).rejects.toThrow(
      "externalMetadataDir: nope-meta does not exist. Create it, or check out the repository it names.",
    );
    const result = await runRelocate({ inputs: [], cwd: dir });
    expect(pretty(result).split("\n")[0]).toBe(
      "Created nope-meta/; it owns what each page's schemas mark external, one <id>.yaml per page.",
    );
    expect(statSync(join(dir, "nope-meta")).isDirectory()).toBe(true);
  });
});
