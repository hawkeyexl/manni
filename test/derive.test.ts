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
import { runDerive, type DeriveRun } from "../src/meta/commands/derive.js";
import { renderDerive } from "../src/meta/reporters/derive.js";
import { DocmetaError } from "../src/meta/types.js";
import { markdownExtractor } from "../src/meta/extractors/markdown.js";
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

  it("refuses stdin: there is no history behind it", async () => {
    const { dir } = stageCorpus();
    await expect(
      runDerive({ inputs: ["-"], as: "markdown", cwd: dir }),
    ).rejects.toThrow(new DocmetaError("cannot derive <stdin>: no history behind it"));
  });

  it("refuses a field that is not derivable, naming the six that are", async () => {
    const { dir } = stageCorpus();
    await expect(
      runDerive({ inputs: [], cwd: dir, fields: ["stakeholders"] }),
    ).rejects.toThrow(
      new DocmetaError(
        '"stakeholders" is not derivable; derivable fields are created, last-updated, authors, owner, reviewed-by, last-reviewed, or any key with an entry in derive.commands',
      ),
    );
  });

  it("refuses --fields naming a key a sidecar owns, as the config parser does", async () => {
    const { dir } = stageCorpus();
    // The manifest is never loaded here; the config's `keys` list is the
    // whole claim, so a trivial file is enough.
    writeFile(dir, "owners.yaml", "{}\n");
    writeFile(
      dir,
      "manni.config.yaml",
      [
        "meta:",
        "  paths:",
        '    - "docs/**/*.md"',
        "  schemas:",
        "    - ./permissive.schema.json",
        "  sidecars:",
        "    - file: ./owners.yaml",
        "      keys: [owner]",
        "  derive:",
        "    fields: [created, last-updated]",
        "",
      ].join("\n"),
    );
    await expect(
      runDerive({ inputs: [], cwd: dir, fields: ["owner"] }),
    ).rejects.toThrow(
      new DocmetaError(
        '"owner" is owned by sidecar ./owners.yaml; a managed field has one authority, and a sidecar key already has one.',
      ),
    );
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

  it("is an operational error with no inputs and no config paths", async () => {
    const { dir } = stageCorpus();
    await expect(
      runDerive({ inputs: [], cwd: dir, noConfig: true, fields: ["owner"] }),
    ).rejects.toThrow(DocmetaError);
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
 * The `command` source (proposal 0041). `test/fixtures/derive/command/`
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
      "meta:",
      "  paths:",
      '    - "docs/**/*.md"',
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
    writeFile(dir, "manni.config.yaml", configWith(`["manni-no-such-program-0041"]`));
    const failure = runDerive({ inputs: [], cwd: dir });
    await expect(failure).rejects.toBeInstanceOf(DocmetaError);
    await expect(failure).rejects.toThrow(/^command source unavailable: /);
    await expect(failure).rejects.toThrow("manni-no-such-program-0041");
  });
});
