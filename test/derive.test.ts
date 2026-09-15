/**
 * `runDerive` — the command core behind `manni meta derive`.
 *
 * Every case stages `test/fixtures/derive/corpus/` into a temp repository and
 * commits it with pinned dates, so the facts the run derives are the commits'
 * rather than the machine's. The corpus manages three fields (`created`,
 * `last-updated`, `owner`); `docs/faq.md` is committed current and
 * `docs/install.md` is committed with one stale stamp and two unset fields.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cpSync, mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { deriveFailed, runDerive, type DeriveRun } from "../src/meta/commands/derive.js";
import { runGet } from "../src/meta/commands/get.js";
import { runValidate } from "../src/meta/commands/validate.js";
import { runQuery } from "../src/meta/commands/query.js";
import { renderDerive } from "../src/meta/reporters/derive.js";
import { DocmetaError } from "../src/meta/types.js";
import { markdownExtractor } from "../src/meta/extractors/markdown.js";
import { hashLines } from "../src/shared/pin.js";
import { STDIN_LINES_MARKER } from "../src/shared/run.js";
import { parse as parseYaml } from "yaml";
import {
  commit,
  git,
  makeTempRepo,
  removeTempRepo,
  writeFile,
} from "./helpers/temp-repo.js";

// Every case here spawns git, the built bin, or a fake CLI, and a Windows
// runner under load takes longer than vitest's 5 s default for a single
// spawn chain. The whole file gets the budget the bin-spawning suites use.
vi.setConfig({ testTimeout: 60_000 });

const here = dirname(fileURLToPath(import.meta.url));
const CORPUS = resolve(here, "fixtures", "derive", "corpus");

const D1 = "2026-08-20T10:00:00+00:00";
const D2 = "2026-09-01T10:00:00+00:00";
const D3 = "2026-09-05T10:00:00+00:00";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) removeTempRepo(d);
});

/**
 * The corpus as two commits: every file at D1, with `docs/install.md`
 * one paragraph shorter, then the paragraph added at D2. So `install.md`'s
 * `last-updated: 2026-08-20` stamp is stale (git says 2026-09-01), its
 * `created` and `owner` are unset, and `faq.md` is current throughout.
 */
function stageCorpus(): { dir: string; first: string; second: string } {
  const dir = makeTempRepo({ files: {} });
  dirs.push(dir);
  cpSync(CORPUS, dir, { recursive: true });
  const final = readFileSync(join(CORPUS, "docs", "install.md"), "utf8");
  writeFile(dir, "docs/install.md", final.replace("\nThen restart.\n", ""));
  const first = commit(dir, "add docs", { authorDate: D1 });
  writeFile(dir, "docs/install.md", final);
  const second = commit(dir, "expand install", { authorDate: D2 });
  return { dir, first, second };
}

const short = (sha: string): string => sha.slice(0, 7);

function fieldsOf(run: DeriveRun, file: string) {
  const result = run.results.find((r) => r.file === file);
  if (!result) throw new Error(`no result for ${file}`);
  return result;
}

const extract = (dir: string, rel: string) =>
  markdownExtractor.extract(readFileSync(join(dir, rel), "utf8"), rel).data;

describe("runDerive", () => {
  it("writes the stale and unset fields, and a second run is all current", async () => {
    const { dir, first, second } = stageCorpus();

    const run = await runDerive({ inputs: [], cwd: dir });
    expect(run.dryRun).toBe(false);
    expect(run.check).toBe(false);
    expect(run.sources).toEqual({
      git: { available: true },
      codeowners: { available: true },
    });
    expect(run.results.map((r) => r.file)).toEqual(["docs/faq.md", "docs/install.md"]);

    const faq = fieldsOf(run, "docs/faq.md");
    expect(faq.changed).toBe(false);
    expect(faq.fields.map((f) => f.status)).toEqual(["current", "current", "current"]);
    expect(faq.fields.every((f) => !f.written)).toBe(true);

    const install = fieldsOf(run, "docs/install.md");
    expect(install.format).toBe("markdown");
    expect(install.changed).toBe(true);
    expect(install.fields).toEqual([
      {
        field: "created",
        derived: "2026-08-20",
        source: "git",
        evidence: `added in ${short(first)} (2026-08-20)`,
        status: "unset",
        written: true,
      },
      {
        field: "last-updated",
        asserted: "2026-08-20",
        derived: "2026-09-01",
        source: "git",
        evidence: `body changed in ${short(second)} (2026-09-01)`,
        status: "stale",
        written: true,
      },
      {
        field: "owner",
        derived: ["@platform-docs"],
        source: "codeowners",
        evidence: ".github/CODEOWNERS:2",
        status: "unset",
        written: true,
      },
    ]);
    expect(run.summary).toEqual({
      files: 2,
      changed: 1,
      written: 3,
      stale: 1,
      unset: 2,
      unknown: 0,
      errors: 0,
    });

    // The document now carries the derived values; the body is untouched.
    const data = extract(dir, "docs/install.md");
    expect(data).toMatchObject({
      title: "Install",
      created: "2026-08-20",
      "last-updated": "2026-09-01",
      owner: ["@platform-docs"],
    });
    expect(readFileSync(join(dir, "docs", "install.md"), "utf8")).toContain(
      "Then restart.",
    );

    const again = await runDerive({ inputs: [], cwd: dir });
    expect(again.summary).toEqual({
      files: 2,
      changed: 0,
      written: 0,
      stale: 0,
      unset: 0,
      unknown: 0,
      errors: 0,
    });
    expect(
      again.results.flatMap((r) => r.fields.map((f) => f.status)),
    ).toEqual(Array<string>(6).fill("current"));
  });

  it("--dry-run reports what would change and writes nothing", async () => {
    const { dir } = stageCorpus();
    const before = readFileSync(join(dir, "docs", "install.md"), "utf8");

    const run = await runDerive({ inputs: [], cwd: dir, dryRun: true });
    expect(run.dryRun).toBe(true);
    const install = fieldsOf(run, "docs/install.md");
    expect(install.changed).toBe(true);
    expect(install.fields.map((f) => f.status)).toEqual(["unset", "stale", "unset"]);
    expect(install.fields.every((f) => !f.written)).toBe(true);
    expect(run.summary).toMatchObject({ changed: 1, written: 0, stale: 1, unset: 2 });
    expect(readFileSync(join(dir, "docs", "install.md"), "utf8")).toBe(before);
    expect(git(dir, ["status", "--porcelain"])).toBe("");
  });

  it("--check implies dry-run and files one finding per stale or unset field", async () => {
    const { dir, second } = stageCorpus();
    const run = await runDerive({ inputs: [], cwd: dir, check: true });
    expect(run.check).toBe(true);
    expect(run.dryRun).toBe(true);
    expect(git(dir, ["status", "--porcelain"])).toBe("");

    expect(fieldsOf(run, "docs/faq.md").findings).toEqual([]);
    const findings = fieldsOf(run, "docs/install.md").findings;
    expect(findings).toHaveLength(3);
    const stale = findings?.find((f) => f.instancePath === "/last-updated");
    expect(stale).toMatchObject({
      schema: "derived:stale",
      keyword: "derived",
      subject: "last-updated",
      line: 3,
    });
    expect(stale?.message).toContain(
      `last-updated says 2026-08-20; git says 2026-09-01 (body changed in ${short(second)} (2026-09-01))`,
    );
    // An unset key has no line of its own; the extractor answers with the
    // block's first line, so the annotation still lands on the frontmatter.
    expect(findings?.find((f) => f.instancePath === "/owner")).toMatchObject({ line: 1 });
  });

  it("--fields limits the run to the named fields", async () => {
    const { dir } = stageCorpus();
    const run = await runDerive({ inputs: [], cwd: dir, fields: ["last-updated"] });
    const install = fieldsOf(run, "docs/install.md");
    expect(install.fields.map((f) => f.field)).toEqual(["last-updated"]);
    expect(install.fields[0]?.written).toBe(true);
    const data = extract(dir, "docs/install.md");
    expect(data["last-updated"]).toBe("2026-09-01");
    expect(data).not.toHaveProperty("created");
    expect(data).not.toHaveProperty("owner");
    expect(run.sources).toEqual({ git: { available: true } });
  });

  it("--sources codeowners derives only owner; the git fields are unknown", async () => {
    const { dir } = stageCorpus();
    const run = await runDerive({ inputs: [], cwd: dir, sources: ["codeowners"] });
    expect(run.sources).toEqual({ codeowners: { available: true } });
    const install = fieldsOf(run, "docs/install.md");
    expect(install.fields.map((f) => [f.field, f.status, f.written])).toEqual([
      ["created", "unknown", false],
      ["last-updated", "unknown", false],
      ["owner", "unset", true],
    ]);
    expect(run.summary).toMatchObject({ written: 1, unknown: 4, stale: 0, unset: 1 });
    const data = extract(dir, "docs/install.md");
    expect(data["last-updated"]).toBe("2026-08-20");
    expect(data.owner).toEqual(["@platform-docs"]);
  });

  it("does not count a frontmatter-only edit as a body change", async () => {
    const { dir } = stageCorpus();
    const faq = readFileSync(join(dir, "docs", "faq.md"), "utf8");
    writeFile(dir, "docs/faq.md", faq.replace("title: FAQ\n", "title: FAQ\ntags: [x]\n"));
    commit(dir, "retag", { authorDate: D3 });

    const run = await runDerive({ inputs: ["docs/faq.md"], cwd: dir });
    const result = fieldsOf(run, "docs/faq.md");
    expect(result.changed).toBe(false);
    expect(result.fields.find((f) => f.field === "last-updated")).toMatchObject({
      asserted: "2026-08-20",
      derived: "2026-08-20",
      status: "current",
    });
  });

  it("dates an uncommitted body change with the injected clock", async () => {
    const { dir } = stageCorpus();
    const faq = readFileSync(join(dir, "docs", "faq.md"), "utf8");
    writeFile(dir, "docs/faq.md", `${faq}\nA new paragraph.\n`);

    const run = await runDerive({
      inputs: ["docs/faq.md"],
      cwd: dir,
      now: () => new Date(2030, 0, 15, 12, 0, 0),
    });
    expect(fieldsOf(run, "docs/faq.md").fields.find((f) => f.field === "last-updated")).toEqual({
      field: "last-updated",
      asserted: "2026-08-20",
      derived: "2030-01-15",
      source: "git",
      evidence: "uncommitted body change",
      status: "stale",
      written: true,
    });
    expect(extract(dir, "docs/faq.md")["last-updated"]).toBe("2030-01-15");
  });

  it("dates it with the injected clock in get, validate and query too", async () => {
    // The seam `derive` has, on the three read paths that also derive, so a
    // test of any of them controls the date an uncommitted body gets.
    const { dir } = stageCorpus();
    const faq = readFileSync(join(dir, "docs", "faq.md"), "utf8");
    writeFile(dir, "docs/faq.md", `${faq}\nA new paragraph.\n`);
    const now = (): Date => new Date(2030, 0, 15, 12, 0, 0);

    const got = await runGet({ fields: ["last-updated"], inputs: ["docs/faq.md"], cwd: dir, now });
    expect(got[0]?.derived?.["last-updated"]?.value).toBe("2030-01-15");

    const { results } = await runValidate({ inputs: ["docs/faq.md"], cwd: dir, now });
    expect(results[0]?.errors.map((e) => e.message)).toContainEqual(
      expect.stringContaining("git says 2030-01-15"),
    );

    const run = await runQuery({
      sql: 'SELECT "last-updated" AS d FROM derived',
      inputs: ["docs/faq.md"],
      cwd: dir,
      now,
    });
    expect(run.rows).toEqual([{ d: "2030-01-15" }]);
  });

  it("refuses stdin: there is no history behind it", async () => {
    const { dir } = stageCorpus();
    await expect(
      runDerive({ inputs: ["-"], as: "markdown", cwd: dir }),
    ).rejects.toThrow(new DocmetaError("cannot derive <stdin>: no history behind it"));
  });

  it("refuses a field that is not derivable, naming the seven that are", async () => {
    const { dir } = stageCorpus();
    await expect(
      runDerive({ inputs: [], cwd: dir, fields: ["stakeholders"] }),
    ).rejects.toThrow(
      new DocmetaError(
        '"stakeholders" is not derivable; derivable fields are created, last-updated, authors, owner, reviewed-by, last-reviewed, provenance, or any key with an entry in derive.commands',
      ),
    );
  });

  it("refuses --fields naming a key a collection's manifest owns, as loadConfig does", async () => {
    const { dir } = stageCorpus();
    // The manifest is never loaded here; the config's `keys` list is the
    // whole claim, so a trivial file is enough.
    writeFile(dir, "owners.yaml", "{}\n");
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
        "  - name: faq",
        '    paths: ["docs/faq.md"]',
        "meta:",
        "  schemas:",
        "    - ./permissive.schema.json",
        "  derive:",
        "    fields: [created, last-updated]",
        "",
      ].join("\n"),
    );
    const owned = new DocmetaError(
      '"owner" is owned by manifest https://example.com/owners.yaml, which is fetched and cannot be written; set it in that repository.',
    );
    await expect(
      runDerive({ inputs: [], cwd: dir, fields: ["owner"] }),
    ).rejects.toThrow(owned);
    // Every declared collection's claim counts, not only the selected ones:
    // narrowing the run to a collection with no manifest does not free the key.
    await expect(
      runDerive({ inputs: [], cwd: dir, fields: ["owner"], collections: ["faq"] }),
    ).rejects.toThrow(owned);
    // A field nobody else owns still runs.
    const run = await runDerive({ inputs: [], cwd: dir, fields: ["last-updated"] });
    expect(fieldsOf(run, "docs/install.md").fields.map((f) => f.field)).toEqual([
      "last-updated",
    ]);
  });

  it("refuses a source it does not know, naming the four", async () => {
    const { dir } = stageCorpus();
    await expect(
      runDerive({ inputs: [], cwd: dir, sources: ["svn"] }),
    ).rejects.toThrow(
      new DocmetaError('"svn" is not a source; sources are git, codeowners, github, gitlab, command'),
    );
  });

  it("has nothing to derive with no config and no --fields", async () => {
    const { dir } = stageCorpus();
    await expect(
      runDerive({ inputs: ["docs/install.md"], cwd: dir, noConfig: true }),
    ).rejects.toThrow(
      new DocmetaError(
        "nothing to derive: set derive.fields in manni.config.yaml or pass --fields",
      ),
    );
  });

  it("is an operational error with no inputs and no collections", async () => {
    const { dir } = stageCorpus();
    const empty = new DocmetaError(
      "No files to derive. Pass paths/globs, or declare a collection under `collections:` in manni.config.yaml.",
    );
    await expect(
      runDerive({ inputs: [], cwd: dir, noConfig: true, fields: ["owner"] }),
    ).rejects.toThrow(empty);
    // A config file that declares no collection has nothing to fall back on
    // either.
    writeFile(
      dir,
      "manni.config.yaml",
      ["meta:", "  derive:", "    fields: [owner]", ""].join("\n"),
    );
    await expect(runDerive({ inputs: [], cwd: dir })).rejects.toThrow(empty);
  });

  it("--collection narrows a bare run to the named collections; none covers every one", async () => {
    const { dir } = stageCorpus();
    writeFile(
      dir,
      "manni.config.yaml",
      [
        "collections:",
        "  - name: install",
        '    paths: ["docs/install.md"]',
        "  - name: faq",
        '    paths: ["docs/faq.md"]',
        "meta:",
        "  schemas:",
        "    - ./permissive.schema.json",
        "  derive:",
        "    fields: [created, last-updated, owner]",
        "",
      ].join("\n"),
    );
    const narrowed = await runDerive({
      inputs: [],
      cwd: dir,
      collections: ["faq"],
      dryRun: true,
    });
    expect(narrowed.results.map((r) => r.file)).toEqual(["docs/faq.md"]);

    const every = await runDerive({ inputs: [], cwd: dir, dryRun: true });
    expect(every.results.map((r) => r.file).sort()).toEqual([
      "docs/faq.md",
      "docs/install.md",
    ]);
  });

  it("refuses --collection beside a path", async () => {
    const { dir } = stageCorpus();
    await expect(
      runDerive({ inputs: ["docs/install.md"], cwd: dir, collections: ["site"] }),
    ).rejects.toThrow(
      new DocmetaError(
        "--collection selects a configured collection; it cannot be combined with paths.",
      ),
    );
  });

  it("refuses a shallow clone with the fix and the derive hint", async () => {
    const { dir } = stageCorpus();
    const parent = realpathSync(mkdtempSync(join(tmpdir(), "docmeta-derive-shallow-")));
    dirs.push(parent);
    git(parent, ["clone", "-q", "--depth", "1", pathToFileURL(dir).href, "clone"]);
    const clone = join(parent, "clone");

    await expect(runDerive({ inputs: [], cwd: clone })).rejects.toThrow(
      new DocmetaError(
        `git source unavailable: this checkout is shallow; use actions/checkout with fetch-depth: 0 (${clone}); narrow --sources or --fields`,
      ),
    );
  });

  it("reports a document it cannot parse as that file's error, not the run's", async () => {
    const { dir } = stageCorpus();
    writeFile(dir, "docs/broken.md", "---\ntitle: [unclosed\n---\n\nbody\n");
    const run = await runDerive({ inputs: [], cwd: dir });
    const broken = fieldsOf(run, "docs/broken.md");
    expect(broken.error).toBeDefined();
    expect(broken.changed).toBe(false);
    expect(broken.fields).toEqual([]);
    expect(run.summary.errors).toBe(1);
    // The other two files were still derived.
    expect(fieldsOf(run, "docs/install.md").changed).toBe(true);
  });
});

describe("renderDerive", () => {
  it("prints each change with its evidence, current files, and a summary", async () => {
    const { dir, first, second } = stageCorpus();
    const run = await runDerive({ inputs: [], cwd: dir });
    const text = renderDerive(run, "pretty", { color: false });
    expect(text).toContain("docs/faq.md  current");
    expect(text).toContain("docs/install.md\n");
    expect(text).toContain(
      `created       (unset) → 2026-08-20`,
    );
    expect(text).toContain(`(git: added in ${short(first)} (2026-08-20))`);
    expect(text).toContain(`last-updated  2026-08-20 → 2026-09-01`);
    expect(text).toContain(`(git: body changed in ${short(second)} (2026-09-01))`);
    expect(text).toContain(`owner         (unset) → ["@platform-docs"]`);
    expect(text).toContain("(codeowners: .github/CODEOWNERS:2)");
    expect(text.trimEnd().endsWith("2 files, 1 changed, 3 fields written")).toBe(true);
    expect(text).not.toMatch(/\x1b\[/);
  });

  it("says so in the dry-run footer", async () => {
    const { dir } = stageCorpus();
    const run = await runDerive({ inputs: ["docs/install.md"], cwd: dir, dryRun: true });
    const text = renderDerive(run, "pretty", { color: false });
    expect(text.trimEnd().endsWith("1 file, 1 would change, 3 fields — dry run, nothing written")).toBe(true);
  });

  it("colors when asked and not otherwise", async () => {
    const { dir } = stageCorpus();
    const run = await runDerive({ inputs: [], cwd: dir, dryRun: true });
    expect(renderDerive(run, "pretty", { color: true })).toMatch(/\x1b\[/);
    expect(renderDerive(run, "pretty")).not.toMatch(/\x1b\[/);
  });

  it("json is the run itself", async () => {
    const { dir } = stageCorpus();
    const run = await runDerive({ inputs: [], cwd: dir, dryRun: true });
    expect(JSON.parse(renderDerive(run, "json"))).toEqual(JSON.parse(JSON.stringify(run)));
  });

  it("refuses a findings format without --check", async () => {
    const { dir } = stageCorpus();
    const run = await runDerive({ inputs: [], cwd: dir, dryRun: true });
    expect(() => renderDerive(run, "sarif")).toThrow(
      new DocmetaError("sarif is a findings format, which only --check produces"),
    );
    expect(() => renderDerive(run, "github")).toThrow(DocmetaError);
    expect(() => renderDerive(run, "junit")).toThrow(DocmetaError);
  });

  it("renders --check through the validation reporters", async () => {
    const { dir, second } = stageCorpus();
    const run = await runDerive({ inputs: [], cwd: dir, check: true });

    const github = renderDerive(run, "github");
    expect(github).toContain(
      `::error file=docs/install.md,line=3::[derived:stale] /last-updated last-updated says 2026-08-20; git says 2026-09-01 (body changed in ${short(second)} (2026-09-01)) — run manni meta derive`,
    );
    expect(github).toContain(
      '::error file=docs/install.md,line=1::[derived:stale] /owner owner is not set; codeowners says ["@platform-docs"] (.github/CODEOWNERS:2) — run manni meta derive',
    );

    const pretty = renderDerive(run, "pretty", { color: false });
    expect(pretty).toContain("✓ docs/faq.md");
    expect(pretty).toContain("✗ docs/install.md");
    expect(pretty).toContain("2 files checked, 1 passed, 1 failed, 3 errors");

    const json = JSON.parse(renderDerive(run, "json")) as {
      summary: { files: number; failed: number; errors: number };
      results: { file: string; ok: boolean }[];
    };
    expect(json.summary).toMatchObject({ files: 2, failed: 1, errors: 3 });
    expect(json.results.map((r) => r.ok)).toEqual([true, false]);

    expect(run.frame).toEqual({ cwd: dir, base: dir, runBase: dir });
    expect(renderDerive(run, "sarif", { frame: run.frame })).toContain(
      '"ruleId": "derived:stale/derived"',
    );
    const junit = renderDerive(run, "junit", { frame: run.frame });
    expect(junit).toContain('type="derived:stale/derived"');
    expect(junit).toContain('classname="manni.derive"');
  });
});

/**
 * The `command` source (proposal 0042). `test/fixtures/derive/command/`
 * manages one command-derived field, `verified-against`, from a command
 * that reads `version.json` beside the config; the document asserts
 * `1.4.1` and the file says `1.4.2`. `sources` names `command` alone, so
 * no commit history is staged: the tree is copied and the run reads it.
 */
describe("runDerive with a command source", () => {
  const COMMAND = resolve(here, "fixtures", "derive", "command");
  const ARGV = "node -p require('./version.json').version";

  function stageCommand(): string {
    const dir = makeTempRepo({ files: {} });
    dirs.push(dir);
    cpSync(COMMAND, dir, { recursive: true });
    return dir;
  }

  /** The fixture's config with the command replaced. */
  function configWith(run: string): string {
    return [
      "collections:",
      "  - name: site",
      "    paths:",
      '      - "docs/**/*.md"',
      "meta:",
      "  schemas:",
      "    - ./permissive.schema.json",
      "  derive:",
      "    fields: [verified-against]",
      "    sources: [command]",
      "    commands:",
      "      verified-against:",
      `        run: ${run}`,
      "",
    ].join("\n");
  }

  it("stamps the command's value, and a second run finds it current", async () => {
    const dir = stageCommand();
    const run = await runDerive({ inputs: [], cwd: dir });
    expect(run.sources).toEqual({ command: { available: true } });
    const install = fieldsOf(run, "docs/install.md");
    expect(install.changed).toBe(true);
    expect(install.fields).toEqual([
      {
        field: "verified-against",
        asserted: "1.4.1",
        derived: "1.4.2",
        source: "command",
        evidence: ARGV,
        status: "stale",
        written: true,
      },
    ]);
    expect(extract(dir, "docs/install.md")["verified-against"]).toBe("1.4.2");
    expect(run.summary).toMatchObject({ files: 1, changed: 1, written: 1, stale: 1 });

    const again = await runDerive({ inputs: [], cwd: dir });
    expect(fieldsOf(again, "docs/install.md").fields[0]?.status).toBe("current");
    expect(again.summary).toMatchObject({ changed: 0, written: 0, stale: 0 });
  });

  it("--dry-run shows the change and writes nothing", async () => {
    const dir = stageCommand();
    const before = readFileSync(join(dir, "docs", "install.md"), "utf8");
    const run = await runDerive({ inputs: [], cwd: dir, dryRun: true });
    const text = renderDerive(run, "pretty", { color: false });
    expect(text).toMatch(/verified-against\s+1\.4\.1 → 1\.4\.2/);
    expect(text).toContain("dry run, nothing written");
    expect(readFileSync(join(dir, "docs", "install.md"), "utf8")).toBe(before);
  });

  it("--sources git leaves a command field unknown, and runs no command", async () => {
    const dir = stageCommand();
    const run = await runDerive({ inputs: [], cwd: dir, sources: ["git"] });
    expect(run.sources).toEqual({});
    const install = fieldsOf(run, "docs/install.md");
    expect(install.changed).toBe(false);
    expect(install.fields[0]).toMatchObject({
      field: "verified-against",
      status: "unknown",
      derived: null,
    });
    expect(extract(dir, "docs/install.md")["verified-against"]).toBe("1.4.1");
  });

  it("a command that exits non-zero is the run's error, exit 2", async () => {
    const dir = stageCommand();
    writeFile(
      dir,
      "manni.config.yaml",
      configWith(`["node", "-e", "console.error('no version here'); process.exit(3)"]`),
    );
    const failure = runDerive({ inputs: [], cwd: dir });
    await expect(failure).rejects.toBeInstanceOf(DocmetaError);
    await expect(failure).rejects.toThrow(/^command source unavailable: /);
    await expect(failure).rejects.toThrow("narrow --sources or --fields");
    expect(extract(dir, "docs/install.md")["verified-against"]).toBe("1.4.1");
  });

  it("a program that is not on PATH is the run's error, exit 2", async () => {
    const dir = stageCommand();
    writeFile(dir, "manni.config.yaml", configWith(`["manni-no-such-program-0042"]`));
    const failure = runDerive({ inputs: [], cwd: dir });
    await expect(failure).rejects.toBeInstanceOf(DocmetaError);
    await expect(failure).rejects.toThrow(/^command source unavailable: /);
    await expect(failure).rejects.toThrow("manni-no-such-program-0042");
  });
});

/**
 * `provenance` through `runDerive` (proposal 0046). `test/fixtures/derive/provenance/`
 * is one page, `docs/limits.md`, whose body starts at file line 4; the tests
 * commit it as a person wrote it and then play the agent, the person and the
 * squash against it in a temp repository.
 */
describe("runDerive: provenance (0046)", () => {
  const PROVENANCE = resolve(here, "fixtures", "derive", "provenance");
  const LIMITS = "docs/limits.md";
  const FABLE = "claude-fable-5";
  const SONNET = "claude-sonnet-5";
  const HUMAN = [
    "The limit is 100 requests a minute.",
    "Bursts of 20 are allowed.",
    "A 429 response carries Retry-After.",
  ];
  const AGENT = [
    "The limit is 120 requests a minute.",
    "Bursts of 30 are allowed.",
    "A 429 response names the wait in Retry-After.",
  ];
  const PIN = hashLines(AGENT.join("\n"));

  function stageProvenance(): string {
    const dir = makeTempRepo({ files: {} });
    dirs.push(dir);
    cpSync(PROVENANCE, dir, { recursive: true });
    commit(dir, "add docs", { authorDate: D1 });
    return dir;
  }
  const read = (dir: string, rel = LIMITS): string => readFileSync(join(dir, rel), "utf8");
  /** The agent's rewrite of file lines 9-11, left uncommitted. */
  const agentEdit = (dir: string): void => {
    writeFile(dir, LIMITS, read(dir).replace(HUMAN.join("\n"), AGENT.join("\n")));
  };
  /** The agent's edit stamped and committed together, as the hook leaves it. */
  async function agentCommit(dir: string): Promise<string> {
    agentEdit(dir);
    await runDerive({ inputs: [], cwd: dir, generatedBy: FABLE, env: {} });
    return commit(dir, "docs: rewrite the limits", { authorDate: D2 });
  }
  const provenanceOf = (run: DeriveRun, file = LIMITS) => {
    const field = fieldsOf(run, file).fields.find((f) => f.field === "provenance");
    if (!field) throw new Error(`no provenance for ${file}`);
    return field;
  };

  it("stamps the uncommitted lines --generated-by names, and a second run is current", async () => {
    const dir = stageProvenance();
    agentEdit(dir);

    const run = await runDerive({ inputs: [], cwd: dir, generatedBy: FABLE, env: {} });
    const result = fieldsOf(run, LIMITS);
    expect(result.changed).toBe(true);
    expect(result.fields).toEqual([
      {
        field: "provenance",
        derived: [{ "generated-by": FABLE, lines: "6-8", integrity: PIN }],
        source: "git",
        evidence: "uncommitted",
        status: "unset",
        written: true,
        ranges: [
          { lines: "9-11", "generated-by": FABLE, integrity: PIN, status: "unset", evidence: "uncommitted", written: true },
        ],
      },
    ]);
    expect(run.summary).toEqual({
      files: 1,
      changed: 1,
      written: 1,
      stale: 0,
      unset: 1,
      unknown: 0,
      errors: 0,
      ranges: 1,
    });
    expect(extract(dir, LIMITS).provenance).toEqual([
      { "generated-by": FABLE, lines: "6-8", integrity: PIN },
    ]);

    const text = renderDerive(run, "pretty", { color: false });
    expect(text).toContain(
      `docs/limits.md\n    provenance  lines 9-11: (unset) → ${FABLE}  (git: uncommitted)`,
    );
    expect(text.trimEnd().endsWith("1 file, 1 changed, 1 range written")).toBe(true);
    const json = JSON.parse(renderDerive(run, "json")) as DeriveRun;
    expect(json.results[0]?.fields[0]?.ranges?.[0]).toEqual({
      lines: "9-11",
      "generated-by": FABLE,
      integrity: PIN,
      status: "unset",
      evidence: "uncommitted",
      written: true,
    });

    // The stamp now reads as current: the edit and its stamp can be committed.
    const again = await runDerive({ inputs: [], cwd: dir, generatedBy: FABLE, env: {} });
    expect(fieldsOf(again, LIMITS).changed).toBe(false);
    expect(provenanceOf(again)).toMatchObject({
      status: "current",
      written: false,
      ranges: [{ lines: "13-15", status: "current", evidence: "pin", written: false }],
    });
  });

  it("reads MANNI_GENERATED_BY when --generated-by is not given, and an empty one is unset", async () => {
    const dir = stageProvenance();
    agentEdit(dir);

    const unset = await runDerive({ inputs: [], cwd: dir, env: { MANNI_GENERATED_BY: "" } });
    expect(provenanceOf(unset)).toMatchObject({ status: "current", derived: [], ranges: [] });
    expect(extract(dir, LIMITS)).not.toHaveProperty("provenance");

    await runDerive({ inputs: [], cwd: dir, env: { MANNI_GENERATED_BY: FABLE } });
    expect(extract(dir, LIMITS).provenance).toEqual([
      { "generated-by": FABLE, lines: "6-8", integrity: PIN },
    ]);
  });

  it("lets an empty --generated-by win over the variable, and trims both", async () => {
    const dir = stageProvenance();
    agentEdit(dir);
    const dry = { inputs: [] as string[], cwd: dir, dryRun: true };

    // Given, even empty or blank, the option wins, and empty is unset.
    for (const generatedBy of ["", "  "]) {
      const run = await runDerive({ ...dry, generatedBy, env: { MANNI_GENERATED_BY: FABLE } });
      expect(provenanceOf(run)).toMatchObject({ status: "current", derived: [], ranges: [] });
    }
    const blankEnv = await runDerive({ ...dry, env: { MANNI_GENERATED_BY: " " } });
    expect(provenanceOf(blankEnv)).toMatchObject({ status: "current", derived: [] });

    const padded = await runDerive({ ...dry, env: { MANNI_GENERATED_BY: ` ${FABLE} ` } });
    expect(provenanceOf(padded).derived).toEqual([{ "generated-by": FABLE, lines: "6-8", integrity: PIN }]);

    // A trailer naming the same machine agrees with a padded option.
    const sha = commit(dir, "docs: rewrite the limits", { authorDate: D2, trailers: [`Generated-by: ${FABLE}`] });
    const ranged = await runDerive({ inputs: [`${LIMITS}:9-11`], cwd: dir, generatedBy: `${FABLE} `, env: {} });
    expect(provenanceOf(ranged).ranges).toEqual([
      { lines: "9-11", "generated-by": FABLE, integrity: PIN, status: "unset", evidence: `blame ${short(sha)}`, written: true },
    ]);
  });

  it("calls a record unset when every range is unset", async () => {
    const dir = stageProvenance();
    writeFile(dir, LIMITS, read(dir).replace("title: Rate limits\n", "title: Rate limits\nprovenance: []\n"));
    commit(dir, "empty record", { authorDate: D2 });
    agentEdit(dir);

    const run = await runDerive({ inputs: [], cwd: dir, generatedBy: FABLE, env: {}, dryRun: true });
    // The added key moves the body a line down: file lines 10-12.
    expect(provenanceOf(run)).toMatchObject({ status: "unset", ranges: [{ lines: "10-12", status: "unset" }] });
    expect(run.summary).toMatchObject({ stale: 0, unset: 1 });
  });

  it("attributes every range named for one page, merging ranges that touch", async () => {
    const dir = stageProvenance();
    // File line 7 and 9-10 are apart: line 8, a blank line, is not theirs.
    const apart = await runDerive({ inputs: [`${LIMITS}:7`, `${LIMITS}:9-10`], cwd: dir, generatedBy: FABLE, env: {} });
    expect(deriveFailed(apart)).toBe(false);
    expect(extract(dir, LIMITS).provenance).toEqual([
      { "generated-by": FABLE, lines: 4, integrity: hashLines("Requests are limited per token.") },
      { "generated-by": FABLE, lines: "6-7", integrity: hashLines(HUMAN.slice(0, 2).join("\n")) },
    ]);

    const other = stageProvenance();
    await runDerive({ inputs: [`${LIMITS}:10-11`, `${LIMITS}:9-10`], cwd: other, generatedBy: FABLE, env: {} });
    expect(extract(other, LIMITS).provenance).toEqual([
      { "generated-by": FABLE, lines: "6-8", integrity: hashLines(HUMAN.join("\n")) },
    ]);
  });

  it("refuses a range that does not name one file the run reads, and attributes nothing", async () => {
    const dir = stageProvenance();
    agentEdit(dir);
    const page = read(dir);
    const refuse = (target: string, opts: Partial<Parameters<typeof runDerive>[0]> = {}) =>
      expect(
        runDerive({ inputs: [target], cwd: dir, generatedBy: FABLE, env: {}, ...opts }),
      ).rejects.toThrow(new DocmetaError(`${target} does not name one file that derive reads; a range names lines of one file.`));

    await refuse("docs:7");
    await refuse("docs/*.md:9");
    // A walk that --ext narrows to no file at all still names the range.
    await refuse("docs:9", { exts: [".html"] });
    expect(read(dir)).toBe(page);

    // A file typed by name is never filtered, so --exclude leaves it in the run.
    const named = await runDerive({ inputs: [`${LIMITS}:9`], cwd: dir, generatedBy: FABLE, env: {}, exclude: [LIMITS] });
    expect(provenanceOf(named).ranges?.map((r) => r.lines)).toEqual(["9"]);
  });

  it("removes the manifest's provenance when nothing is left to attribute, as on the page", async () => {
    const dir = stageProvenance();
    const configPath = "manifest.config.yaml";
    const header = "# Provenance for pages that keep their record out of the page.\n";
    agentEdit(dir);
    await runDerive({ inputs: [], cwd: dir, configPath, sources: ["git"], generatedBy: FABLE, env: {} });
    expect(parseYaml(read(dir, "private/provenance.yaml"))).toHaveProperty(["docs/limits.md", "provenance"]);
    commit(dir, "docs: rewrite the limits", { authorDate: D2 });

    // A person rewrites the agent's lines, uncommitted, with no machine named.
    writeFile(dir, LIMITS, read(dir).replace(AGENT.join("\n"), "Limits are listed per plan."));
    const run = await runDerive({ inputs: [], cwd: dir, configPath, sources: ["git"], env: {} });
    expect(provenanceOf(run)).toMatchObject({ status: "stale", derived: [], written: true });
    expect(read(dir, "private/provenance.yaml")).toBe(header);

    const again = await runDerive({ inputs: [], cwd: dir, configPath, sources: ["git"], check: true, env: {} });
    expect(provenanceOf(again).status).toBe("current");
    expect(deriveFailed(again)).toBe(false);
  });

  it("says so when --generated-by finds no uncommitted body lines", async () => {
    const dir = stageProvenance();
    const notices: string[] = [];
    await runDerive({ inputs: [], cwd: dir, generatedBy: FABLE, env: {}, onNotice: (m) => notices.push(m) });
    expect(notices).toContain(
      "docs/limits.md: no uncommitted body lines; --generated-by attributes only what is not yet committed.",
    );
  });

  it("files a changed finding for a person's edit inside the range, and derive re-derives it", async () => {
    const dir = stageProvenance();
    await agentCommit(dir);
    const clean = await runDerive({ inputs: [], cwd: dir, check: true, env: {} });
    expect(fieldsOf(clean, LIMITS).findings).toEqual([]);

    writeFile(dir, LIMITS, read(dir).replace("Bursts of 30 are allowed.", "Bursts of 25 are allowed."));
    const check = await runDerive({ inputs: [], cwd: dir, check: true, env: {} });
    expect(fieldsOf(check, LIMITS).findings).toEqual([
      {
        schema: "derived:stale",
        keyword: "derived",
        subject: `provenance ${PIN}`,
        instancePath: "/provenance",
        message: `provenance lines 13-15 changed since ${FABLE} wrote them — run manni meta derive`,
        line: 13,
      },
    ]);
    expect(renderDerive(check, "github")).toContain(
      `::error file=docs/limits.md,line=13::[derived:stale] /provenance provenance lines 13-15 changed since ${FABLE} wrote them — run manni meta derive`,
    );
    expect(deriveFailed(check)).toBe(true);

    const run = await runDerive({ inputs: [], cwd: dir, env: {} });
    const field = provenanceOf(run);
    expect(field.status).toBe("stale");
    expect(field.ranges).toEqual([
      { lines: "13-15", "generated-by": FABLE, integrity: PIN, status: "changed", evidence: "pin", written: true },
    ]);
    // Lines 13 and 15 still come from the agent's commit, whose blob carried the stamp.
    expect(extract(dir, LIMITS).provenance).toEqual([
      { "generated-by": FABLE, lines: 6, integrity: hashLines(AGENT[0] ?? "") },
      { "generated-by": FABLE, lines: 8, integrity: hashLines(AGENT[2] ?? "") },
    ]);
    expect(renderDerive(run, "pretty", { color: false })).toContain(
      `provenance  lines 13-15: ${FABLE} → re-derived  (git: pin)`,
    );
  });

  it("rewrites lines for a moved pin, with no finding", async () => {
    const dir = stageProvenance();
    await agentCommit(dir);
    writeFile(
      dir,
      LIMITS,
      read(dir).replace("Requests are limited per token.\n", "Requests are limited per token.\n\nTokens are issued per project.\n"),
    );
    const check = await runDerive({ inputs: [], cwd: dir, check: true, env: {} });
    expect(fieldsOf(check, LIMITS).findings).toEqual([]);
    // No finding, so --check passes: exit 0, as validate is clean.
    expect(deriveFailed(check)).toBe(false);

    const run = await runDerive({ inputs: [], cwd: dir, env: {} });
    expect(deriveFailed(run)).toBe(false);
    expect(provenanceOf(run).ranges).toEqual([
      {
        lines: "15-17",
        "generated-by": FABLE,
        integrity: PIN,
        status: "moved",
        evidence: "pin",
        from: { lines: "13-15", "generated-by": FABLE },
        written: true,
      },
    ]);
    expect(extract(dir, LIMITS).provenance).toEqual([
      { "generated-by": FABLE, lines: "8-10", integrity: PIN },
    ]);
    expect(renderDerive(run, "pretty", { color: false })).toContain(
      "provenance  lines 15-17: moved from 13-15  (git: pin)",
    );
  });

  it("re-attributes a stamp the evidence contradicts", async () => {
    const dir = stageProvenance();
    agentEdit(dir);
    const sha = commit(dir, "docs: rewrite the limits", { authorDate: D2, trailers: [`Generated-by: ${SONNET}`] });
    // A person claims the lines for another machine, by hand.
    writeFile(
      dir,
      LIMITS,
      read(dir).replace(
        "title: Rate limits\n",
        `title: Rate limits\nprovenance:\n  - generated-by: ${FABLE}\n    lines: 6-8\n    integrity: ${PIN}\n`,
      ),
    );
    const check = await runDerive({ inputs: [], cwd: dir, check: true, env: {} });
    expect(fieldsOf(check, LIMITS).findings?.map((f) => f.message)).toEqual([
      `provenance lines 13-15 say ${FABLE}; blame says ${SONNET} (${short(sha)}) — run manni meta derive`,
    ]);

    const run = await runDerive({ inputs: [], cwd: dir, env: {} });
    expect(provenanceOf(run).ranges).toEqual([
      {
        lines: "13-15",
        "generated-by": SONNET,
        integrity: PIN,
        status: "stale",
        evidence: `blame ${short(sha)}`,
        from: { lines: "13-15", "generated-by": FABLE },
        written: true,
      },
    ]);
    expect(extract(dir, LIMITS).provenance).toEqual([
      { "generated-by": SONNET, lines: "6-8", integrity: PIN },
    ]);
    expect(renderDerive(run, "pretty", { color: false })).toContain(
      `provenance  lines 13-15: ${FABLE} → ${SONNET}  (git: blame ${short(sha)})`,
    );
  });

  it("writes into the manifest that owns provenance, and leaves the page alone", async () => {
    const dir = stageProvenance();
    agentEdit(dir);
    const page = read(dir);
    const configPath = "manifest.config.yaml";

    const dry = await runDerive({ inputs: [], cwd: dir, configPath, generatedBy: FABLE, env: {}, dryRun: true });
    expect(provenanceOf(dry)).toMatchObject({ manifest: "private/provenance.yaml", status: "unset", written: false });
    expect(read(dir, "private/provenance.yaml")).toBe("# Provenance for pages that keep their record out of the page.\n");

    const run = await runDerive({ inputs: [], cwd: dir, configPath, generatedBy: FABLE, env: {} });
    expect(fieldsOf(run, LIMITS).changed).toBe(true);
    expect(provenanceOf(run)).toMatchObject({ manifest: "private/provenance.yaml", status: "unset", written: true });
    expect(read(dir)).toBe(page);
    const manifest = read(dir, "private/provenance.yaml");
    expect(manifest.startsWith("# Provenance for pages that keep their record out of the page.\n")).toBe(true);
    expect(parseYaml(manifest)).toEqual({
      "docs/limits.md": { provenance: [{ "generated-by": FABLE, lines: "6-8", integrity: PIN }] },
    });
    expect(renderDerive(run, "pretty", { color: false })).toContain(
      `private/provenance.yaml (for docs/limits.md)\n    provenance  lines 9-11: (unset) → ${FABLE}  (git: uncommitted)`,
    );

    // Current from the manifest; and after a commit, rule 2 reads it back from there.
    const again = await runDerive({ inputs: [], cwd: dir, configPath, generatedBy: FABLE, env: {} });
    expect(provenanceOf(again).status).toBe("current");
    commit(dir, "docs: rewrite the limits", { authorDate: D2 });
    const committed = await runDerive({ inputs: [], cwd: dir, configPath, check: true, env: {} });
    expect(fieldsOf(committed, LIMITS).findings).toEqual([]);
    expect(provenanceOf(committed)).toMatchObject({ status: "current" });
  });

  it("refuses to stamp provenance into a page whose metadata is part of its body, as that file's error", async () => {
    const dir = stageProvenance();
    const html = read(dir, "docs/page.html");
    writeFile(dir, "docs/page.html", html.replace("100 requests", "120 requests"));

    const run = await runDerive({ inputs: ["docs/page.html"], cwd: dir, generatedBy: FABLE, env: {} });
    expect(fieldsOf(run, "docs/page.html").error).toBe(
      'provenance cannot be stamped into the page: in the "html" format the metadata is part of the body it pins. Keep provenance in an externalMetadata manifest.',
    );
    expect(run.summary.errors).toBe(1);
    expect(read(dir, "docs/page.html")).toBe(html.replace("100 requests", "120 requests"));

    // A manifest pin over the same page works: the manifest is not part of it.
    const manifested = await runDerive({
      inputs: [],
      cwd: dir,
      configPath: "manifest.config.yaml",
      generatedBy: FABLE,
      env: {},
    });
    expect(fieldsOf(manifested, "docs/page.html").error).toBeUndefined();
    expect(provenanceOf(manifested, "docs/page.html")).toMatchObject({ status: "unset", written: true });
  });

  it("attributes a named range, committed or not", async () => {
    const dir = stageProvenance();
    agentEdit(dir);
    const sha = commit(dir, "docs: rewrite the limits", { authorDate: D2 });

    const run = await runDerive({ inputs: [`${LIMITS}:9-11`], cwd: dir, generatedBy: FABLE, env: {} });
    expect(run.results.map((r) => r.file)).toEqual([LIMITS]);
    expect(provenanceOf(run).ranges).toEqual([
      { lines: "9-11", "generated-by": FABLE, integrity: PIN, status: "unset", evidence: `blame ${short(sha)}`, written: true },
    ]);
    expect(extract(dir, LIMITS).provenance).toEqual([
      { "generated-by": FABLE, lines: "6-8", integrity: PIN },
    ]);
  });

  it("refuses each misuse of a range or --generated-by in 0046's words, exit 2", async () => {
    const dir = stageProvenance();
    const refuse = (message: string, opts: Partial<Parameters<typeof runDerive>[0]>) =>
      expect(runDerive({ inputs: [], cwd: dir, env: {}, ...opts })).rejects.toThrow(new DocmetaError(message));

    await refuse(
      "docs/limits.md:9-11 names lines, which only --generated-by uses. Pass --generated-by, or drop the range.",
      { inputs: [`${LIMITS}:9-11`] },
    );
    await refuse(
      "--generated-by attributes provenance, which is not in --fields. Add provenance, or drop --generated-by.",
      { generatedBy: FABLE, fields: ["last-updated"] },
    );
    await refuse("docs/limits.md:11-9 ends before it starts.", { inputs: [`${LIMITS}:11-9`], generatedBy: FABLE });
    await refuse("docs/limits.md has no lines 9-99: the file ends at line 13.", {
      inputs: [`${LIMITS}:9-99`],
      generatedBy: FABLE,
    });
    await refuse(
      "docs/limits.md:2-5 reaches into the frontmatter; provenance pins body lines, which start at line 4.",
      { inputs: [`${LIMITS}:2-5`], generatedBy: FABLE },
    );
    await refuse("cannot derive <stdin>: no history behind it", { inputs: [`${STDIN_LINES_MARKER}:3`], generatedBy: FABLE });

    agentEdit(dir);
    const sha = commit(dir, "docs: rewrite the limits", { authorDate: D2, trailers: [`Generated-by: ${SONNET}`] });
    await refuse(
      `docs/limits.md:9-11: blame attributes these lines to ${SONNET} (${short(sha)}); --generated-by cannot overrule a recorded machine.`,
      { inputs: [`${LIMITS}:9-11`], generatedBy: FABLE },
    );
    expect(extract(dir, LIMITS)).not.toHaveProperty("provenance");
  });
});
