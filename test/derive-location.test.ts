/**
 * `manni meta derive` and field location (proposal 0047): a managed field a
 * local manifest owns is written into the manifest, a URL manifest refuses,
 * and a field its schema prefers in external metadata with no manifest asks
 * to create one on a terminal (P1), and otherwise lands on the page with one
 * warning per collection (W1), or per homeless set (W2).
 *
 * Each case copies a fixture from `test/fixtures/location/` into a temp
 * repository and commits it, so `created` has a date and CODEOWNERS answers
 * `owner`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cpSync, existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { runDerive, type DeriveRun } from "../src/meta/commands/derive.js";
import { runValidate } from "../src/meta/commands/validate.js";
import { renderDerive } from "../src/meta/reporters/derive.js";
import { DocmetaError } from "../src/meta/types.js";
import { markdownExtractor } from "../src/meta/extractors/markdown.js";
import { resetWarnings } from "../src/shared/warn.js";
import { commit, makeTempRepo, removeTempRepo, writeFile } from "./helpers/temp-repo.js";

vi.setConfig({ testTimeout: 60_000 });

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(here, "fixtures", "location");
const D1 = "2026-08-20T10:00:00+00:00";

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
  for (const d of dirs.splice(0)) removeTempRepo(d);
});

function stage(name: string): string {
  const dir = makeTempRepo({ files: {} });
  dirs.push(dir);
  cpSync(join(FIXTURES, name), dir, { recursive: true });
  commit(dir, "add", { authorDate: D1 });
  return dir;
}

const read = (dir: string, rel: string): string => readFileSync(join(dir, rel), "utf8");
const pageData = (dir: string, rel: string): Record<string, unknown> =>
  markdownExtractor.extract(read(dir, rel), rel).data;
const fieldOf = (run: DeriveRun, file: string, field: string) => {
  const f = run.results.find((r) => r.file === file)?.fields.find((x) => x.field === field);
  if (f === undefined) throw new Error(`no ${field} for ${file}`);
  return f;
};

describe("derive: a managed field a local manifest owns", () => {
  it("writes it into the manifest entry, and the page keeps only its own fields", async () => {
    const dir = stage("derive-owned");
    const run = await runDerive({ inputs: [], cwd: dir });

    expect(run.summary.errors).toBe(0);
    const owner = fieldOf(run, "docs/install.md", "owner");
    expect(owner).toMatchObject({
      asserted: ["@old-team"],
      derived: ["@platform-docs"],
      status: "stale",
      written: true,
      destination: "site-meta.yaml",
      destinationLine: 2,
    });
    expect(fieldOf(run, "docs/faq.md", "owner")).toMatchObject({
      status: "unset",
      written: true,
      destination: "site-meta.yaml",
    });
    // `created` has no owner, so it stays on the page and names no destination.
    expect(fieldOf(run, "docs/install.md", "created").destination).toBeUndefined();

    expect(parseYaml(read(dir, "site-meta.yaml"))).toEqual({
      "docs/install.md": { owner: ["@platform-docs"] },
      "docs/faq.md": { owner: ["@platform-docs"] },
    });
    expect(pageData(dir, "docs/install.md")).toEqual({ title: "Install", created: "2026-08-20" });
    expect(pageData(dir, "docs/faq.md")).toEqual({ title: "FAQ", created: "2026-08-20" });

    const pretty = renderDerive(run, "pretty", { color: false });
    expect(pretty).toMatch(
      /owner +\["@old-team"\] → \["@platform-docs"\] +\(codeowners: \.github\/CODEOWNERS:1\)  → site-meta\.yaml:2/,
    );
    expect(JSON.parse(renderDerive(run, "json"))).toMatchObject({
      results: [
        { file: "docs/faq.md", fields: [{ field: "created" }, { field: "owner", destination: "site-meta.yaml" }] },
        { file: "docs/install.md" },
      ],
    });

    // The manifest's value is what the next run compares.
    const again = await runDerive({ inputs: [], cwd: dir });
    expect(again.results.flatMap((r) => r.fields.map((f) => f.status))).toEqual([
      "current",
      "current",
      "current",
      "current",
    ]);
  });

  it("names the manifest without a line under --dry-run, and writes nothing", async () => {
    const dir = stage("derive-owned");
    const before = read(dir, "site-meta.yaml");
    const run = await runDerive({ inputs: [], cwd: dir, dryRun: true });
    const owner = fieldOf(run, "docs/install.md", "owner");
    expect(owner.destination).toBe("site-meta.yaml");
    expect(owner.destinationLine).toBeUndefined();
    expect(run.results.find((r) => r.file === "docs/install.md")?.changed).toBe(true);
    expect(read(dir, "site-meta.yaml")).toBe(before);
    expect(renderDerive(run, "pretty", { color: false })).toMatch(/\(codeowners: \.github\/CODEOWNERS:1\)  → site-meta\.yaml$/m);
  });

  it("--check and validate read the manifest value and point at the manifest line", async () => {
    const dir = stage("derive-owned");
    const check = await runDerive({ inputs: ["docs/install.md"], cwd: dir, check: true });
    const finding = check.results[0]?.findings?.find((f) => f.subject === "owner");
    expect(finding).toMatchObject({ schema: "derived:stale", file: "site-meta.yaml", line: 2 });
    expect(finding?.message).toContain('owner says ["@old-team"]');

    const validated = await runValidate({ inputs: ["docs/install.md"], cwd: dir });
    const stale = validated.results[0]?.errors.find((e) => e.schema === "derived:stale" && e.subject === "owner");
    expect(stale).toMatchObject({ file: "site-meta.yaml", line: 2 });
  });

  it("validate reads the manifest value when the page's own schema fails to load", async () => {
    const dir = stage("derive-owned");
    writeFile(dir, "docs/faq.md", "---\ntitle: FAQ\n$schema: ./missing.schema.json\n---\n\n# FAQ\n");
    writeFile(
      dir,
      "site-meta.yaml",
      'docs/install.md:\n  owner: ["@old-team"]\ndocs/faq.md:\n  owner: ["@platform-docs"]\n',
    );
    commit(dir, "faq", { authorDate: D1 });
    const validated = await runValidate({ inputs: ["docs/faq.md"], cwd: dir });
    const errors = validated.results[0]?.errors ?? [];
    expect(errors[0]).toMatchObject({ schema: "(parse)", keyword: "schema" });
    // The manifest supplies the current owner, so it is not "not set".
    expect(errors.filter((e) => e.subject === "owner")).toEqual([]);
  });
});

describe("derive: a managed field a URL manifest owns", () => {
  it("refuses --fields naming it, exit 2 (M6)", async () => {
    const dir = stage("derive-owned");
    writeFile(
      dir,
      "manni.config.yaml",
      [
        "collections:",
        "  - name: site",
        '    paths: ["docs/**/*.md"]',
        "    externalMetadata:",
        "      - file: https://example.com/owners.yaml",
        "        keys: [owner]",
        "meta:",
        "  derive:",
        "    fields: [created]",
        "    sources: [git, codeowners]",
        "",
      ].join("\n"),
    );
    await expect(runDerive({ inputs: [], cwd: dir, fields: ["owner"] })).rejects.toThrow(
      new DocmetaError(
        '"owner" is owned by manifest https://example.com/owners.yaml, which is fetched and cannot be written; set it in that repository.',
      ),
    );
  });
});

describe("derive: a field its schema prefers in external metadata, with no manifest", () => {
  const W1 =
    "manni: wrote owner to 2 pages in collection site; the schema prefers external metadata, and no manifest owns it. Run manni meta relocate to move it.\n";

  it("off a terminal: writes the page, and warns once for the collection (W1)", async () => {
    const dir = stage("derive-external");
    const run = await runDerive({ inputs: [], cwd: dir });
    expect(run.summary.errors).toBe(0);
    expect(pageData(dir, "docs/install.md")).toMatchObject({ owner: ["@platform-docs"] });
    expect(fieldOf(run, "docs/install.md", "owner").destination).toBeUndefined();
    expect(stderr.filter((l) => l.includes("external metadata"))).toEqual([W1]);
  });

  it("under --dry-run: says would write, and never asks", async () => {
    const dir = stage("derive-external");
    const confirm = vi.fn(() => Promise.resolve(true));
    await runDerive({ inputs: [], cwd: dir, dryRun: true, confirm });
    expect(confirm).not.toHaveBeenCalled();
    expect(stderr.filter((l) => l.includes("external metadata"))).toEqual([W1.replace("wrote", "would write")]);
    expect(existsSync(join(dir, "site.metadata.yaml"))).toBe(false);
  });

  it("under --check: neither asks nor warns", async () => {
    const dir = stage("derive-external");
    const confirm = vi.fn(() => Promise.resolve(true));
    await runDerive({ inputs: [], cwd: dir, check: true, confirm });
    expect(confirm).not.toHaveBeenCalled();
    expect(stderr.filter((l) => l.includes("external metadata"))).toEqual([]);
  });

  it("on a terminal, yes: creates the manifest, then writes the value there (P1)", async () => {
    const dir = stage("derive-external");
    const notices: string[] = [];
    const questions: string[] = [];
    const run = await runDerive({
      inputs: [],
      cwd: dir,
      onNotice: (m) => notices.push(m),
      confirm: (q) => {
        questions.push(q);
        return Promise.resolve(true);
      },
    });
    expect(notices).toContain(
      "collection site has no manifest for owner, which the schema prefers in external metadata.",
    );
    expect(questions).toEqual(["Create site.metadata.yaml and add it to manni.config.yaml? "]);
    expect(run.summary.errors).toBe(0);
    expect(parseYaml(read(dir, "site.metadata.yaml"))).toEqual({
      "docs/faq.md": { owner: ["@platform-docs"] },
      "docs/install.md": { owner: ["@platform-docs"] },
    });
    expect(parseYaml(read(dir, "manni.config.yaml"))).toMatchObject({
      collections: [
        { name: "site", externalMetadata: [{ file: "./site.metadata.yaml", keys: ["owner"] }] },
      ],
    });
    expect(pageData(dir, "docs/install.md")).toEqual({ title: "Install", created: "2026-08-20" });
    expect(fieldOf(run, "docs/install.md", "owner").destination).toBe("site.metadata.yaml");
    expect(stderr.filter((l) => l.includes("external metadata"))).toEqual([]);
  });

  it("on a terminal, no: writes the page, and warns (W1)", async () => {
    const dir = stage("derive-external");
    await runDerive({ inputs: [], cwd: dir, confirm: () => Promise.resolve(false) });
    expect(pageData(dir, "docs/faq.md")).toMatchObject({ owner: ["@platform-docs"] });
    expect(existsSync(join(dir, "site.metadata.yaml"))).toBe(false);
    expect(stderr.filter((l) => l.includes("external metadata"))).toEqual([W1]);
  });

  it("a page in none of several collections: writes the page, and warns (W2)", async () => {
    const dir = stage("derive-homeless");
    const confirm = vi.fn(() => Promise.resolve(true));
    await runDerive({ inputs: ["notes/stray.md"], cwd: dir, confirm });
    expect(confirm).not.toHaveBeenCalled();
    expect(pageData(dir, "notes/stray.md")).toMatchObject({ owner: ["@platform-docs"] });
    expect(stderr.filter((l) => l.includes("external metadata"))).toEqual([
      "manni: wrote owner to 1 page that is in none of the 2 collections; the schema prefers external metadata, and only a collection has a manifest.\n",
    ]);
  });
});

describe("derive: manifest edits follow the page write", () => {
  it("a file whose page write fails leaves no entry in the manifest", async () => {
    const dir = stage("derive-owned");
    writeFile(dir, "manni.config.yaml", read(dir, "manni.config.yaml").replace('"docs/**/*.md"', '"docs/**"'));
    writeFile(dir, "docs/guide.rst", "Guide\n=====\n\nBody.\n");
    commit(dir, "guide", { authorDate: D1 });
    const run = await runDerive({ inputs: [], cwd: dir });
    expect(run.results.find((r) => r.file === "docs/guide.rst")?.error).toContain("no fenced front matter block");
    expect(parseYaml(read(dir, "site-meta.yaml"))).toEqual({
      "docs/install.md": { owner: ["@platform-docs"] },
      "docs/faq.md": { owner: ["@platform-docs"] },
    });
  });

  it("a run that aborts on a later file still saves the entries of the pages it wrote", async () => {
    const dir = stage("derive-owned");
    writeFile(
      dir,
      "secret.schema.json",
      JSON.stringify({ type: "object", properties: { created: { type: "string", "x-manni-encrypt": true } } }),
    );
    writeFile(dir, "docs/zz.md", "---\ntitle: Z\n$schema: ./secret.schema.json\n---\n\n# Z\n");
    commit(dir, "zz", { authorDate: D1 });
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "MANNI_ENCRYPTION_KEY"));
    await expect(runDerive({ inputs: [], cwd: dir, env })).rejects.toThrow(/encrypt/i);
    expect(pageData(dir, "docs/install.md")).toMatchObject({ created: "2026-08-20" });
    expect(parseYaml(read(dir, "site-meta.yaml"))).toEqual({
      "docs/install.md": { owner: ["@platform-docs"] },
      "docs/faq.md": { owner: ["@platform-docs"] },
    });
  });
});

describe("derive: schema notices", () => {
  it("says each once per file under --dry-run", async () => {
    const dir = stage("derive-owned");
    writeFile(
      dir,
      "manni.config.yaml",
      read(dir, "manni.config.yaml").replace(/^meta:\n/m, "meta:\n  schemaTrust:\n    documentRefs: none\n"),
    );
    writeFile(dir, "docs/faq.md", "---\ntitle: FAQ\n$schema: ./other.schema.json\n---\n\n# FAQ\n");
    commit(dir, "trust", { authorDate: D1 });
    const notices: string[] = [];
    await runDerive({ inputs: [], cwd: dir, dryRun: true, onNotice: (m) => notices.push(m) });
    expect(notices.filter((m) => m.includes("is ignored"))).toEqual([expect.stringContaining("docs/faq.md:")]);
  });
});
