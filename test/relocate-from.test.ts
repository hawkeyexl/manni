/**
 * `manni meta relocate --from` (proposal 0126): empty a manifest into where
 * the config, without it, says each key lives. A collection left with no
 * entries reads the metadata directory, so its values move there, minting
 * the ids they need; a manifest left declaring nothing is removed from the
 * config, and a file left with no entries is deleted.
 *
 * The fixture is `test/fixtures/external-metadata-dir/relocate-from/`:
 * collection `site` keeps `citations` in `{page}.citations.yaml` and the rest
 * in `{page}.meta.yaml`; `guide.md` carries an id, and `metadata/guide.yaml`
 * already holds its reviewer, equal to the sidecar's; `fresh.md` carries no
 * id, and its sidecar holds a comment. Collection `notes` has `clash.md`,
 * whose reviewer differs from its sidecar's. `legacy.yaml` is declared
 * nowhere. Each case runs on a private copy.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { relocateFailed, runRelocate } from "../src/meta/commands/relocate.js";
import { runValidate } from "../src/meta/commands/validate.js";
import { runGet } from "../src/meta/commands/get.js";
import { renderRelocate } from "../src/meta/reporters/relocate.js";
import { resetWarnings } from "../src/shared/warn.js";
import { spawnText } from "./helpers/spawn.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const FIXTURE = resolve(here, "fixtures", "external-metadata-dir", "relocate-from");
const BOTH = ["{page}.meta.yaml", "{page}.citations.yaml"];

const dirs: string[] = [];
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
});

function copy(from = FIXTURE): string {
  const dir = mkdtempSync(join(tmpdir(), "manni-relocate-from-"));
  dirs.push(dir);
  cpSync(from, dir, { recursive: true });
  return dir;
}

const read = (dir: string, rel: string): string => readFileSync(join(dir, rel), "utf8");
const yamlOf = (dir: string, rel: string): unknown => parseYaml(read(dir, rel));
const pretty = (result: Awaited<ReturnType<typeof runRelocate>>): string =>
  renderRelocate(result, "pretty", { color: false });

describe("relocate --from: into the metadata directory", () => {
  it("empties both sidecars of a collection into metadata/<id>.yaml, minting the id a page lacks", async () => {
    const dir = copy();
    const result = await runRelocate({ inputs: [], cwd: dir, from: BOTH, collections: ["site"] });
    expect(pretty(result)).toBe(
      [
        "Removed collections[site].externalMetadata[0] ({page}.citations.yaml) and [1] ({page}.meta.yaml); collection site reads metadata/.",
        "docs/site/fresh.md",
        "    id         ← minted fresh",
        "    personas   → metadata/fresh.yaml:2  (from docs/site/fresh.meta.yaml)",
        "docs/site/guide.md",
        "    personas   → metadata/guide.yaml:3  (from docs/site/guide.meta.yaml)",
        "    reviewer   → metadata/guide.yaml:2  (from docs/site/guide.meta.yaml)",
        "    citations  → metadata/guide.yaml:5  (from docs/site/guide.citations.yaml)",
        "2 files, 4 values moved to 2 manifests, 1 id minted, 2 emptied manifests deleted",
      ].join("\n"),
    );
    expect(relocateFailed(result)).toBe(false);
    expect(yamlOf(dir, "metadata/guide.yaml")).toEqual({
      guide: { reviewer: "ada", citations: ["https://example.com/guide"], personas: ["maya"] },
    });
    expect(yamlOf(dir, "metadata/fresh.yaml")).toEqual({ fresh: { personas: ["devin"] } });
    expect(read(dir, "docs/site/fresh.md")).toBe("---\ntitle: Fresh\nid: fresh\n---\n\n# Fresh\n");
    expect(existsSync(join(dir, "docs/site/guide.meta.yaml"))).toBe(false);
    expect(existsSync(join(dir, "docs/site/guide.citations.yaml"))).toBe(false);
    // A sidecar holding a comment is kept, emptied, and the run says so.
    expect(read(dir, "docs/site/fresh.meta.yaml")).toBe("# Who fresh.md is for.\n");
    expect(stderr).toContain(
      "manni: docs/site/fresh.meta.yaml holds comments relocate does not carry; it is kept, emptied of entries.\n",
    );
    // site has no externalMetadata: left, so it reads metadata/; notes is untouched.
    const config = yamlOf(dir, "manni.config.yaml") as { collections: Record<string, unknown>[] };
    expect(config.collections[0]).toEqual({ name: "site", paths: ["docs/site/*.md"] });
    expect(config.collections[1]).toEqual({
      name: "notes",
      paths: ["docs/notes/*.md"],
      externalMetadata: [{ file: "{page}.meta.yaml" }],
    });
    expect(read(dir, "manni.config.yaml")).toContain("# Proposal 0126: relocate --from empties");
    expect(read(dir, "docs/notes/clash.meta.yaml")).toBe(read(FIXTURE, "docs/notes/clash.meta.yaml"));

    // Nothing left in two places: no external:owned, and nothing orphaned.
    const { results } = await runValidate({ cwd: dir, inputs: [], collections: ["site"] });
    expect(results.flatMap((r) => r.errors)).toEqual([]);
    const got = await runGet({ cwd: dir, inputs: ["docs/site/guide.md"], fields: ["personas", "reviewer", "citations"] });
    expect(got[0]?.values).toEqual({
      personas: ["maya"],
      reviewer: "ada",
      citations: ["https://example.com/guide"],
    });
    expect(pretty(await runRelocate({ inputs: [], cwd: dir, collections: ["site"] }))).toBe("0 files, nothing to move");
  });

  it("says what it would remove, create, mint and delete under --dry-run, and writes nothing", async () => {
    const dir = copy();
    rmSync(join(dir, "metadata"), { recursive: true });
    const config = read(dir, "manni.config.yaml");
    const result = await runRelocate({ inputs: [], cwd: dir, from: BOTH, collections: ["site"], dryRun: true });
    expect(pretty(result)).toBe(
      [
        "Would remove collections[site].externalMetadata[0] ({page}.citations.yaml) and [1] ({page}.meta.yaml); collection site would read metadata/.",
        "Would create metadata/; it would own what each page's schemas mark external, one <id>.yaml per page.",
        "docs/site/fresh.md",
        "    id         ← minted fresh",
        "    personas   → metadata/fresh.yaml  (from docs/site/fresh.meta.yaml)",
        "docs/site/guide.md",
        "    personas   → metadata/guide.yaml  (from docs/site/guide.meta.yaml)",
        "    reviewer   → metadata/guide.yaml  (from docs/site/guide.meta.yaml)",
        "    citations  → metadata/guide.yaml  (from docs/site/guide.citations.yaml)",
        "2 files, 4 values would move to 2 manifests, 1 id would be minted, 2 emptied manifests would be deleted",
      ].join("\n"),
    );
    expect(existsSync(join(dir, "metadata"))).toBe(false);
    expect(existsSync(join(dir, "docs/site/guide.meta.yaml"))).toBe(true);
    expect(read(dir, "manni.config.yaml")).toBe(config);
    expect(read(dir, "docs/site/fresh.md")).toBe(read(FIXTURE, "docs/site/fresh.md"));
  });

  it("empties the manifest for a page --exclude leaves out of the run too, since nothing reads it after", async () => {
    const dir = copy();
    const result = await runRelocate({
      inputs: [],
      cwd: dir,
      from: BOTH,
      collections: ["site"],
      exclude: ["docs/site/fresh.md"],
    });
    expect(result.files.map((f) => [f.file, f.beyond, f.minted])).toEqual([
      ["docs/site/guide.md", false, undefined],
      ["docs/site/fresh.md", true, "fresh"],
    ]);
    expect(yamlOf(dir, "metadata/fresh.yaml")).toEqual({ fresh: { personas: ["devin"] } });
    expect(relocateFailed(result)).toBe(false);
  });

  it("reports moves between manifests, the removed entries and the deleted files in JSON", async () => {
    const dir = copy();
    const result = await runRelocate({ inputs: [], cwd: dir, from: BOTH, collections: ["site"] });
    const json = JSON.parse(renderRelocate(result, "json")) as {
      manifests: { file: string; undeclared: boolean; reads?: string }[];
      files: { file: string; minted?: string; moved: Record<string, unknown>[] }[];
      deleted?: string[];
      summary: Record<string, unknown>;
    };
    // `reads` names the directory a collection left with no entries reads, on each removed entry.
    expect(json.manifests.map((m) => [m.file, m.undeclared, m.reads])).toEqual([
      ["{page}.citations.yaml", true, "metadata/"],
      ["{page}.meta.yaml", true, "metadata/"],
      ["metadata/{id}.yaml", false, undefined],
    ]);
    expect(json.files.find((f) => f.file === "docs/site/fresh.md")).toEqual({
      file: "docs/site/fresh.md",
      minted: "fresh",
      moved: [
        {
          key: "personas",
          to: "manifest",
          manifest: "metadata/fresh.yaml",
          line: 2,
          reason: "preferred",
          from: "docs/site/fresh.meta.yaml",
        },
      ],
      stayed: [],
    });
    expect(json.deleted).toEqual(["docs/site/guide.citations.yaml", "docs/site/guide.meta.yaml"]);
    expect(json.summary).toEqual({ files: 2, moved: 4, stayed: 0, manifestsCreated: 0, minted: 1, deleted: 2 });
  });
});

describe("relocate --from: what stays", () => {
  it("keeps a manifest declared and on disk while a value in it differs, and exits 1", async () => {
    const dir = copy();
    const result = await runRelocate({ inputs: [], cwd: dir, from: ["{page}.meta.yaml"] });
    expect(pretty(result)).toBe(
      [
        "Removed collections[site].externalMetadata[1] ({page}.meta.yaml).",
        "docs/notes/clash.md",
        "    reviewer  stays: the page and docs/notes/clash.meta.yaml hold different values",
        "docs/site/fresh.md",
        "    personas  ← docs/site/fresh.meta.yaml",
        "docs/site/guide.md",
        "    personas  ← docs/site/guide.meta.yaml",
        "    reviewer  ← docs/site/guide.meta.yaml",
        "3 files, 3 values moved into pages, 1 emptied manifest deleted, 1 stayed",
      ].join("\n"),
    );
    expect(relocateFailed(result)).toBe(true);
    // site keeps an entry, so it reads no directory, and the JSON names none.
    const json = JSON.parse(renderRelocate(result, "json")) as { manifests: Record<string, unknown>[] };
    expect(json.manifests.filter((m) => "reads" in m)).toEqual([]);
    // notes keeps its entry, and clash's sidecar keeps every value.
    const config = yamlOf(dir, "manni.config.yaml") as { collections: Record<string, unknown>[] };
    expect(config.collections[1]).toMatchObject({ externalMetadata: [{ file: "{page}.meta.yaml" }] });
    expect(read(dir, "docs/notes/clash.meta.yaml")).toBe(read(FIXTURE, "docs/notes/clash.meta.yaml"));
    // site keeps its citations manifest, so the rest of guide's values land in the page.
    expect(config.collections[0]).toMatchObject({
      externalMetadata: [{ file: "{page}.citations.yaml", keys: ["citations"] }],
    });
    expect(read(dir, "docs/site/guide.md")).toBe(
      "---\ntitle: Guide\nid: guide\npersonas:\n  - maya\nreviewer: ada\n---\n\n# Guide\n",
    );
    expect(existsSync(join(dir, "docs/site/guide.meta.yaml"))).toBe(false);
  });

  it("keeps a manifest whose value differs from the one already in metadata/", async () => {
    const dir = copy();
    writeFileSync(join(dir, "metadata/guide.yaml"), "guide:\n  reviewer: zed\n");
    const result = await runRelocate({ inputs: [], cwd: dir, from: BOTH, collections: ["site"] });
    expect(result.files.find((f) => f.file === "docs/site/guide.md")?.stayed).toEqual([
      expect.objectContaining({
        key: "reviewer",
        reason: "values-differ",
        detail: "docs/site/guide.meta.yaml and metadata/guide.yaml hold different values",
      }),
    ]);
    expect(relocateFailed(result)).toBe(true);
    expect(read(dir, "metadata/guide.yaml")).toBe("guide:\n  reviewer: zed\n");
    expect(read(dir, "docs/site/guide.meta.yaml")).toContain("reviewer: ada");
    const config = yamlOf(dir, "manni.config.yaml") as { collections: { externalMetadata?: unknown }[] };
    expect(config.collections[0]?.externalMetadata).toEqual([{ file: "{page}.meta.yaml" }]);
  });
});

// A collection's manifests never share a key, so the second holder is legacy.yaml, which
// holds guide.md's reviewer as guide.meta.yaml does.
describe("relocate --from: two manifests holding one key for a page", () => {
  it("drops the second, equal copy, so both are emptied and deleted, and validate is clean", async () => {
    const dir = copy();
    const result = await runRelocate({ inputs: [], cwd: dir, from: ["legacy.yaml", ...BOTH], collections: ["site"] });
    expect(relocateFailed(result)).toBe(false);
    expect(result.files.flatMap((f) => f.stayed)).toEqual([]);
    expect(yamlOf(dir, "metadata/guide.yaml")).toEqual({
      guide: { reviewer: "ada", citations: ["https://example.com/guide"], personas: ["maya"] },
    });
    expect(existsSync(join(dir, "legacy.yaml"))).toBe(false);
    expect(existsSync(join(dir, "docs/site/guide.meta.yaml"))).toBe(false);
    const config = yamlOf(dir, "manni.config.yaml") as { collections: Record<string, unknown>[] };
    expect(config.collections[0]).toEqual({ name: "site", paths: ["docs/site/*.md"] });
    const { results } = await runValidate({ cwd: dir, inputs: [], collections: ["site"] });
    expect(results.flatMap((r) => r.errors)).toEqual([]);
  });

  it("keeps both on disk, and the manifest declared, while the values differ, and exits 1", async () => {
    const dir = copy();
    writeFileSync(join(dir, "legacy.yaml"), "docs/site/guide.md:\n  reviewer: zed\n");
    const result = await runRelocate({ inputs: [], cwd: dir, from: [...BOTH, "legacy.yaml"], collections: ["site"] });
    expect(result.files.find((f) => f.file === "docs/site/guide.md")?.stayed).toEqual([
      expect.objectContaining({
        key: "reviewer",
        reason: "values-differ",
        detail: "legacy.yaml and docs/site/guide.meta.yaml hold different values",
      }),
    ]);
    expect(relocateFailed(result)).toBe(true);
    // Nothing is lost: each keeps its reviewer, and metadata/ is untouched.
    expect(yamlOf(dir, "docs/site/guide.meta.yaml")).toMatchObject({ "docs/site/guide.md": { reviewer: "ada" } });
    expect(read(dir, "legacy.yaml")).toBe("docs/site/guide.md:\n  reviewer: zed\n");
    expect(read(dir, "metadata/guide.yaml")).toBe(read(FIXTURE, "metadata/guide.yaml"));
    const config = yamlOf(dir, "manni.config.yaml") as { collections: { externalMetadata?: unknown }[] };
    expect(config.collections[0]?.externalMetadata).toEqual([{ file: "{page}.meta.yaml" }]);
  });
});

// `relocate-from-repo-shape/`: a config shaped like this repository's, with a
// folded scalar, padded flow mappings, a long line and comments beside the
// collections. guide.meta.yaml holds a comment inside an `evals:` list item.
describe("relocate --from: a config and sidecars shaped like this repository's", () => {
  const SHAPED = resolve(here, "fixtures", "external-metadata-dir", "relocate-from-repo-shape");
  /** Site's externalMetadata: lines, which the run removes and nothing else. */
  const ENTRIES = [
    "    externalMetadata:",
    '      - file: "{page}.citations.yaml"',
    "        keys: [citations]",
    "      # No `keys`: this manifest owns every other external field.",
    '      - file: "{page}.meta.yaml"',
    "",
  ].join("\n");

  it("removes only site's entries from the config, and leaves every other byte as it was", async () => {
    const dir = copy(SHAPED);
    const before = read(dir, "manni.config.yaml");
    expect(before).toContain(ENTRIES);
    const result = await runRelocate({ inputs: [], cwd: dir, from: BOTH, collections: ["site"] });
    expect(relocateFailed(result)).toBe(false);
    expect(read(dir, "manni.config.yaml")).toBe(before.replace(ENTRIES, ""));
    const { results } = await runValidate({ cwd: dir, inputs: [], collections: ["site"] });
    expect(results.flatMap((r) => r.errors)).toEqual([]);
  });

  it("keeps a sidecar whose comment sits inside a list item, says so, and does not count it deleted", async () => {
    const dir = copy(SHAPED);
    const dry = await runRelocate({ inputs: [], cwd: dir, from: BOTH, collections: ["site"], dryRun: true });
    expect(dry.deleted).toEqual(["docs/site/guide.citations.yaml", "docs/site/plain.meta.yaml"]);
    const result = await runRelocate({ inputs: [], cwd: dir, from: BOTH, collections: ["site"] });
    expect(result.deleted).toEqual(dry.deleted);
    expect(existsSync(join(dir, "docs/site/guide.meta.yaml"))).toBe(true);
    expect(existsSync(join(dir, "docs/site/plain.meta.yaml"))).toBe(false);
    expect(stderr).toContain(
      "manni: docs/site/guide.meta.yaml holds comments relocate does not carry; it is kept, emptied of entries.\n",
    );
    expect(yamlOf(dir, "metadata/guide.yaml")).toEqual({
      guide: { evals: [{ id: "has-title", expect: "title" }], reviewer: "ada", citations: ["https://example.com/guide"] },
    });
  });
});

describe("relocate --from: an undeclared file", () => {
  it("is read with a path join, emptied into the manifest that owns each key, and deleted", async () => {
    const dir = copy();
    const result = await runRelocate({ inputs: [], cwd: dir, from: ["legacy.yaml"], collections: ["site"] });
    expect(pretty(result)).toBe(
      [
        "docs/site/guide.md",
        "    reviewer  → docs/site/guide.meta.yaml:3  (from legacy.yaml)",
        "1 file, 1 value moved to 1 manifest, 1 emptied manifest deleted",
      ].join("\n"),
    );
    expect(existsSync(join(dir, "legacy.yaml"))).toBe(false);
    expect(read(dir, "docs/site/guide.meta.yaml")).toBe(read(FIXTURE, "docs/site/guide.meta.yaml"));
    expect(read(dir, "manni.config.yaml")).toBe(read(FIXTURE, "manni.config.yaml"));
  });

  it("is kept with a value that differs where its key lives, while the rest move, and exits 1", async () => {
    const dir = copy();
    writeFileSync(join(dir, "legacy.yaml"), "docs/site/guide.md:\n  reviewer: zed\ndocs/site/fresh.md:\n  reviewer: eve\n");
    const result = await runRelocate({ inputs: [], cwd: dir, from: ["legacy.yaml"], collections: ["site"] });
    expect(pretty(result)).toBe(
      [
        "docs/site/fresh.md",
        "    reviewer  → docs/site/fresh.meta.yaml:4  (from legacy.yaml)",
        "docs/site/guide.md",
        "    reviewer  stays: legacy.yaml and docs/site/guide.meta.yaml hold different values",
        "2 files, 1 value moved to 1 manifest, 1 stayed",
      ].join("\n"),
    );
    expect(relocateFailed(result)).toBe(true);
    expect(yamlOf(dir, "legacy.yaml")).toEqual({ "docs/site/guide.md": { reviewer: "zed" } });
    expect(yamlOf(dir, "docs/site/fresh.meta.yaml")).toEqual({
      "docs/site/fresh.md": { personas: ["devin"], reviewer: "eve" },
    });
    expect(read(dir, "docs/site/guide.meta.yaml")).toBe(read(FIXTURE, "docs/site/guide.meta.yaml"));
  });
});

describe("relocate --from: usage errors", () => {
  it.each([
    [{ from: ["metadata/{id}.yaml"] }, "--from metadata/{id}.yaml is where values would move to; name the manifest to empty."],
    [{ from: ["./metadata/{id}.yaml"] }, "--from ./metadata/{id}.yaml is where values would move to; name the manifest to empty."],
    [
      { from: ["https://example.com/meta.yaml"] },
      "--from https://example.com/meta.yaml is fetched and cannot be emptied; move its values in that repository.",
    ],
    [{ from: ["nope.yaml"] }, "--from nope.yaml is not declared and does not exist."],
    [{ from: ["{page}.nope.yaml"] }, "--from {page}.nope.yaml is not declared and does not exist."],
    [
      { from: ["{page}.meta.yaml"], inputs: ["docs/site/"] },
      "--from empties a manifest for every page at once, so it takes no paths and no --fields.",
    ],
    [
      { from: ["{page}.meta.yaml"], fields: ["personas"] },
      "--from empties a manifest for every page at once, so it takes no paths and no --fields.",
    ],
    [
      { from: ["{page}.meta.yaml"], noConfig: true },
      "relocate writes collections: and externalMetadata: to the config file, and --no-config rules one out.",
    ],
  ])("refuses %j", async (opts, message) => {
    const dir = copy();
    await expect(runRelocate({ inputs: [], cwd: dir, ...opts })).rejects.toThrow(message);
  });
});

describe("cli relocate --from (built umbrella bin)", () => {
  const bin = resolve(root, "dist", "cli.js");
  beforeAll(() => {
    if (!existsSync(bin)) execSync("npm run build", { cwd: root, stdio: "ignore" });
  }, 180000);

  const run = (args: string[], cwd: string) => {
    const r = spawnText(
      spawnSync("node", [bin, "meta", "relocate", ...args], {
        cwd,
        encoding: "utf8",
        env: { ...process.env, NO_COLOR: "1" },
      }),
    );
    return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status ?? 1 };
  };

  it("migrates with --from, repeatable, and exits 0", () => {
    const dir = copy();
    const r = run(["--from", "{page}.meta.yaml", "--from", "{page}.citations.yaml", "--collection", "site"], dir);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Removed collections[site].externalMetadata[0] ({page}.citations.yaml) and [1] ({page}.meta.yaml); collection site reads metadata/.");
    expect(r.stderr).toContain("manni: docs/site/fresh.meta.yaml holds comments relocate does not carry; it is kept, emptied of entries.");
    expect(existsSync(join(dir, "metadata/fresh.yaml"))).toBe(true);
  });

  it("exits 1 when a value stays, and 2 on a usage error", () => {
    const dir = copy();
    expect(run(["--from", "{page}.meta.yaml"], dir).status).toBe(1);
    const usage = run(["docs/", "--from", "{page}.meta.yaml"], copy());
    expect(usage.status).toBe(2);
    expect(usage.stderr).toBe(
      "manni: --from empties a manifest for every page at once, so it takes no paths and no --fields.\n",
    );
  });
});
