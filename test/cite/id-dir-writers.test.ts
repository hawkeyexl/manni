/**
 * cite's writers over the metadata directory (proposal 0126). The fixture is
 * `test/fixtures/external-metadata-dir/cite-writers`:
 *  - `docs/limits.md` carries `id: limits`, so its citations live in
 *    `metadata/limits.yaml`, which holds one already;
 *  - `docs/fresh.md` carries no id, so `add` mints it one;
 *  - `docs/docusaurus.md` is read as a Docusaurus doc, whose `id` is the doc
 *    id, so none is minted and its citations stay in the page;
 *  - `docs/unsafe.md` carries an id that cannot name a file.
 * Each case runs on a private copy, with sources indexed by a walk.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { runAdd } from "../../src/cite/commands/add.js";
import { runCheck } from "../../src/cite/commands/check.js";
import { runRemove } from "../../src/cite/commands/remove.js";
import { runUpdate } from "../../src/cite/commands/update.js";
import { noGit } from "../../src/cite/core/git.js";
import type { AddOptions, CheckRun } from "../../src/cite/types.js";
import { runValidate } from "../../src/meta/commands/validate.js";
import { resetWarnings } from "../../src/shared/warn.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, "..", "fixtures", "external-metadata-dir", "cite-writers");

const temps: string[] = [];
let stderr: string[];
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
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function copyOf(fixture = FIXTURE): string {
  const dir = mkdtempSync(join(tmpdir(), "manni-cite-id-writers-"));
  temps.push(dir);
  cpSync(fixture, dir, { recursive: true });
  return dir;
}

const read = (dir: string, rel: string): string => readFileSync(join(dir, rel), "utf8");
type Manifest = Record<string, { citations?: { id?: string; claim?: { lines?: unknown } }[] }>;
const manifestOf = (dir: string, rel: string): Manifest => parseYaml(read(dir, rel)) as Manifest;
const idsIn = (dir: string, rel: string, entry: string): (string | undefined)[] =>
  (manifestOf(dir, rel)[entry]?.citations ?? []).map((c) => c.id);

const add = (cwd: string, over: Partial<AddOptions> & Pick<AddOptions, "page">) =>
  runAdd({ cwd, src: "src/limits.ts:2", commitSha: false, gitClient: noGit(), env: {}, ...over });
const check = (cwd: string, inputs: string[] = []): Promise<CheckRun> =>
  runCheck({ cwd, inputs, gitClient: noGit(), env: {} });

const MINTED = 'manni: minted id "fresh" in docs/fresh.md, for metadata/fresh.yaml.\n';

describe("cite add on the metadata directory", () => {
  it("appends to the file the page's id names", async () => {
    const cwd = copyOf();
    const result = await add(cwd, { page: "docs/limits.md", pageLines: { start: 9, end: 9 }, src: "src/limits.ts:3", id: "retries" });
    expect(result.placed).toBe("manifest");
    expect(result.manifest?.file).toBe("metadata/limits.yaml");
    expect(idsIn(cwd, "metadata/limits.yaml", "limits")).toEqual(["fetch-timeout", "retries"]);
    expect(read(cwd, "docs/limits.md")).toBe(read(FIXTURE, "docs/limits.md"));
    expect(existsSync(join(cwd, "metadata", "{id}.yaml"))).toBe(false);
    expect(stderr.filter((l) => l.includes("minted"))).toEqual([]);
  });

  it("mints an id into a page with none, writes its file, and says so once", async () => {
    const cwd = copyOf();
    const result = await add(cwd, { page: "docs/fresh.md", pageLines: { start: 6, end: 6 }, id: "fetch-timeout" });
    expect(result.placed).toBe("manifest");
    expect(result.manifest?.file).toBe("metadata/fresh.yaml");
    expect(read(cwd, "docs/fresh.md")).toBe(
      "---\ntitle: Fresh\nid: fresh\n---\n# Fresh\n\nThe fetch timeout is 10 seconds.\n\nIt retries three times.\n",
    );
    expect(idsIn(cwd, "metadata/fresh.yaml", "fresh")).toEqual(["fetch-timeout"]);
    expect(stderr.filter((l) => l.includes("minted"))).toEqual([MINTED]);
    const run = await check(cwd);
    expect(run.pages.find((p) => p.file === "docs/fresh.md")?.citations[0]?.origin).toMatchObject({
      kind: "manifest",
      file: "metadata/fresh.yaml",
    });
    expect(run.summary.failed).toBe(0);
  });

  it("moves the citations an id-less page already carries into its new file", async () => {
    const cwd = copyOf();
    // Written to the frontmatter while no config says otherwise.
    await add(cwd, { page: "docs/fresh.md", pageLines: { start: 6, end: 6 }, id: "fetch-timeout", noConfig: true });
    expect(read(cwd, "docs/fresh.md")).toContain("citations:");
    const at = read(cwd, "docs/fresh.md").split("\n").indexOf("It retries three times.") + 1;
    await add(cwd, { page: "docs/fresh.md", pageLines: { start: at, end: at }, src: "src/limits.ts:3", id: "retries" });
    expect(idsIn(cwd, "metadata/fresh.yaml", "fresh")).toEqual(["fetch-timeout", "retries"]);
    expect(read(cwd, "docs/fresh.md")).toBe(
      "---\ntitle: Fresh\nid: fresh\n---\n# Fresh\n\nThe fetch timeout is 10 seconds.\n\nIt retries three times.\n",
    );
    const run = await check(cwd, ["docs/fresh.md"]);
    expect(run.pages[0]?.citations.map((c) => [c.citation.id, c.claim?.status])).toEqual([
      ["fetch-timeout", "current"],
      ["retries", "current"],
    ]);
  });

  it("leaves the citation in the page, and says why, when no id can be minted", async () => {
    const cwd = copyOf();
    const result = await add(cwd, { page: "docs/docusaurus.md", pageLines: { start: 6, end: 6 }, id: "fetch-timeout" });
    expect(result.placed).toBe("frontmatter");
    expect(read(cwd, "docs/docusaurus.md")).toContain("citations:");
    expect(existsSync(join(cwd, "metadata", "docusaurus.yaml"))).toBe(false);
    expect(stderr.filter((l) => l.includes("no id could be minted"))).toEqual([
      "manni: docs/docusaurus.md: no id could be minted (docusaurus:docs:3.10 gives id a meaning of its own; set one by hand), so citations stays in the page.\n",
    ]);
  });

  it("refuses a page whose id cannot name a file, and writes nothing", async () => {
    const cwd = copyOf();
    await expect(add(cwd, { page: "docs/unsafe.md", pageLines: { start: 7, end: 7 } })).rejects.toThrow(
      'docs/unsafe.md: id "Not_Safe" cannot name a file in metadata/; an id that names a manifest is lowercase letters, digits and "-", starting with a letter or digit.',
    );
    expect(read(cwd, "docs/unsafe.md")).toBe(read(FIXTURE, "docs/unsafe.md"));
    expect(existsSync(join(cwd, "metadata", "Not_Safe.yaml"))).toBe(false);
  });
});

describe("cite add, update and remove: a round trip in metadata/<id>.yaml", () => {
  it("updates the file's pins, then removes them, deleting the emptied file", async () => {
    const cwd = copyOf();
    await add(cwd, { page: "docs/limits.md", pageLines: { start: 9, end: 9 }, src: "src/limits.ts:3", id: "retries" });

    // A line above both claims moves them, and update follows.
    const page = read(cwd, "docs/limits.md").replace("# Limits\n", "# Limits\n\nA new opening line.\n");
    writeFileSync(join(cwd, "docs/limits.md"), page);
    const updated = await runUpdate({ cwd, inputs: [], gitClient: noGit(), env: {} });
    expect(updated.manifests?.map((m) => [m.file, m.written])).toEqual([["metadata/limits.yaml", true]]);
    expect(manifestOf(cwd, "metadata/limits.yaml").limits?.citations?.map((c) => c.claim?.lines)).toEqual([5, 7]);
    expect((await check(cwd)).summary.failed).toBe(0);

    const removed = await runRemove({ cwd, inputs: ["docs/limits.md"], only: ["fetch-timeout", "retries"], gitClient: noGit(), env: {} });
    expect(removed.removed).toBe(2);
    expect(existsSync(join(cwd, "metadata", "limits.yaml"))).toBe(false);
    expect(read(cwd, "docs/limits.md")).toBe(page);
    expect((await check(cwd)).summary.failed).toBe(0);
  });

  it("keeps the file while it holds a citation", async () => {
    const cwd = copyOf();
    await add(cwd, { page: "docs/limits.md", pageLines: { start: 9, end: 9 }, src: "src/limits.ts:3", id: "retries" });
    await runRemove({ cwd, inputs: ["docs/limits.md"], only: ["fetch-timeout"], gitClient: noGit(), env: {} });
    expect(idsIn(cwd, "metadata/limits.yaml", "limits")).toEqual(["retries"]);
  });
});

describe("cite add moves every value the directory owns with the id it mints", () => {
  it("takes the page's personas into the new file beside its citations", async () => {
    const cwd = copyOf(join(here, "..", "fixtures", "external-metadata-dir", "mint-moves"));
    await add(cwd, { page: "docs/guide.md", pageLines: { start: 7, end: 7 }, id: "fetch-timeout" });
    const entry = manifestOf(cwd, "metadata/guide.yaml").guide as Record<string, unknown> | undefined;
    expect(entry?.["personas"]).toEqual(["maya", "devin"]);
    expect(idsIn(cwd, "metadata/guide.yaml", "guide")).toEqual(["fetch-timeout"]);
    expect(read(cwd, "docs/guide.md")).toBe("---\ntitle: Guide\nid: guide\n---\n# Guide\n\nThe fetch timeout is 10 seconds.\n");
    const { results } = await runValidate({ cwd, inputs: [] });
    expect(results.find((r) => r.file === "docs/guide.md")?.errors).toEqual([]);
    expect((await check(cwd)).summary.failed).toBe(0);
  });
});
