/**
 * The derived channel (proposal 0040) as the existing commands see it:
 * `validate` compares each managed field with the evidence, `get --derived`
 * shows the evidence beside the asserted value, `query` gains the read-only
 * `derived` table and refuses a write to a managed key, and `fill` never
 * proposes one.
 *
 * Every repository is built at runtime from `test/fixtures/derive/commands/`
 * by `makeTempRepo` + `commit`, with author dates pinned, so the facts under
 * test are the ones the commits state.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { MockProvider } from "@hawkeyexl/inference";
import { runValidate } from "../src/meta/commands/validate.js";
import { runGet } from "../src/meta/commands/get.js";
import { runQuery } from "../src/meta/commands/query.js";
import { runFill } from "../src/meta/commands/fill.js";
import { renderGet } from "../src/meta/reporters/get.js";
import { loadSqlite } from "../src/meta/core/projection.js";
import {
  derivedColumns,
  fieldsForSql,
  mentionsDerived,
} from "../src/meta/core/derive/table.js";
import { DERIVABLE_FIELDS } from "../src/meta/core/derive/types.js";
import { DocmetaError, type ValidationResult } from "../src/meta/types.js";

/**
 * How many times one run derived. The real `deriveMetadata` is wrapped, not
 * replaced, so every case below still derives from the commits; the counter
 * is only read by the one case that pins "once per run".
 */
const derivations = vi.hoisted(() => ({ calls: 0, cache: [] as boolean[] }));

vi.mock("../src/meta/core/derive/index.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../src/meta/core/derive/index.js")>();
  return {
    ...mod,
    deriveMetadata: (...args: Parameters<typeof mod.deriveMetadata>) => {
      derivations.calls += 1;
      derivations.cache.push(args[1].cache);
      return mod.deriveMetadata(...args);
    },
  };
});
import {
  commit,
  DOC,
  git,
  makeTempRepo,
  removeTempRepo,
  writeFile,
} from "./helpers/temp-repo.js";

// Every case here spawns git, the built bin, or a fake CLI, and a Windows
// runner under load takes longer than vitest's 5 s default for a single
// spawn chain. The whole file gets the budget the bin-spawning suites use.
vi.setConfig({ testTimeout: 60_000 });

const FIXTURE = resolve(__dirname, "fixtures", "derive", "commands");

/** Every fixture file, keyed by posix-relative path. */
function fixtureFiles(): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string, prefix: string): void => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      const rel = prefix === "" ? name : `${prefix}/${name}`;
      if (statSync(abs).isDirectory()) walk(abs, rel);
      else out[rel] = readFileSync(abs, "utf8");
    }
  };
  walk(FIXTURE, "");
  return out;
}

const D_INIT = "2026-08-20T10:00:00+00:00";
const D_EDIT = "2026-09-07T10:00:00+00:00";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) removeTempRepo(d);
});

/** The fixture as a repository with one commit, dated `D_INIT`. */
function repo(files: Record<string, string> = fixtureFiles()): string {
  const dir = makeTempRepo({ files });
  dirs.push(dir);
  commit(dir, "init", { authorDate: D_INIT });
  return dir;
}

const A = fixtureFiles()["docs/a.md"] ?? "";
const A_BODY_EDIT = A.replace("Body of a.", "Body of a, revised.");
const A_FRONTMATTER_EDIT = A.replace("title: A", "title: A, retitled");

/** Edit `docs/a.md`'s body and commit it, dated `D_EDIT`; returns the sha. */
function reviseA(dir: string): string {
  writeFile(dir, "docs/a.md", A_BODY_EDIT);
  return commit(dir, "revise a", { authorDate: D_EDIT });
}

function resultFor(results: ValidationResult[], file: string): ValidationResult {
  const r = results.find((x) => x.file === file);
  if (!r) throw new Error(`no result for ${file}`);
  return r;
}

const derivedFindings = (r: ValidationResult) =>
  r.errors.filter((e) => e.schema === "derived:stale");

describe("validate compares managed fields with the evidence", () => {
  it("is clean when every managed field agrees with the evidence", async () => {
    const dir = repo();
    const { summary } = await runValidate({ inputs: [], cwd: dir });
    expect(summary.failed).toBe(0);
    expect(summary.errors).toBe(0);
  });

  it("files one derived:stale finding at the key's line after a body edit", async () => {
    const dir = repo();
    const sha = reviseA(dir);
    const { results, summary } = await runValidate({ inputs: [], cwd: dir });
    const a = resultFor(results, "docs/a.md");
    expect(a.ok).toBe(false);
    const findings = derivedFindings(a);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      schema: "derived:stale",
      keyword: "derived",
      instancePath: "/last-updated",
      subject: "last-updated",
      line: 3,
    });
    expect(findings[0]?.message).toContain("last-updated says 2026-08-20");
    expect(findings[0]?.message).toContain(
      `git says 2026-09-07 (body changed in ${sha.slice(0, 7)} (2026-09-07))`,
    );
    expect(findings[0]?.message).toContain("run manni meta derive");
    // b.md was not touched, and stays clean.
    expect(resultFor(results, "docs/b.md").ok).toBe(true);
    expect(summary.failed).toBe(1);
  });

  it("derive: false skips the comparison", async () => {
    const dir = repo();
    reviseA(dir);
    const { summary } = await runValidate({ inputs: [], cwd: dir, derive: false });
    expect(summary.failed).toBe(0);
  });

  it("does not count a frontmatter-only edit as a body change", async () => {
    const dir = repo();
    writeFile(dir, "docs/a.md", A_FRONTMATTER_EDIT);
    commit(dir, "retitle a", { authorDate: D_EDIT });
    const { summary } = await runValidate({ inputs: [], cwd: dir });
    expect(summary.failed).toBe(0);
  });

  it("judges a scoped run too, per file", async () => {
    const dir = repo();
    reviseA(dir);
    const { results, summary } = await runValidate({
      inputs: ["docs/a.md"],
      cwd: dir,
    });
    expect(results).toHaveLength(1);
    expect(summary.failed).toBe(1);
    expect(derivedFindings(resultFor(results, "docs/a.md"))).toHaveLength(1);
  });

  it("refuses a shallow clone, naming the fix and the way out", async () => {
    const origin = repo();
    reviseA(origin);
    const parent = realpathSync(mkdtempSync(join(tmpdir(), "docmeta-shallow-")));
    dirs.push(parent);
    git(parent, ["clone", "-q", "--depth", "1", pathToFileURL(origin).href, "clone"]);
    const clone = join(parent, "clone");

    const run = runValidate({ inputs: [], cwd: clone });
    await expect(run).rejects.toThrow(DocmetaError);
    await expect(run).rejects.toThrow(/fetch-depth: 0/);
    await expect(run).rejects.toThrow(/--no-derive/);
  });

  it("files an unset finding for a managed field the evidence can state", async () => {
    const dir = repo();
    // Widen CODEOWNERS so b.md, which carries no owner, now has one.
    writeFile(dir, "CODEOWNERS", "* @docs-team\n");
    commit(dir, "own everything", { authorDate: D_EDIT });
    const { results } = await runValidate({ inputs: [], cwd: dir });
    const b = resultFor(results, "docs/b.md");
    expect(b.ok).toBe(false);
    const findings = derivedFindings(b);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      schema: "derived:stale",
      keyword: "derived",
      instancePath: "/owner",
    });
    expect(findings[0]?.message).toContain("owner is not set");
    expect(findings[0]?.message).toContain('codeowners says ["@docs-team"] (CODEOWNERS:1)');
    // a.md's owner still matches the (unchanged) rule for it.
    expect(resultFor(results, "docs/a.md").ok).toBe(true);
  });

  it("gives a corpus check that names the derived table the same view", async () => {
    const files = fixtureFiles();
    files["manni.config.yaml"] = [
      "meta:",
      "  paths:",
      '    - "docs/**/*.md"',
      "  schemas:",
      "    - ./permissive.schema.json",
      "  derive:",
      "    fields: [last-updated, owner]",
      "    sources: [git, codeowners]",
      "  checks:",
      "    - name: stale-stamp",
      "      query: >-",
      "        SELECT d._path AS path, 'last-updated' AS key,",
      "               'stamp disagrees with git' AS message",
      "        FROM derived d JOIN docs USING (_path)",
      '        WHERE docs."last-updated" IS NOT d."last-updated"',
      "",
    ].join("\n");
    const dir = repo(files);
    reviseA(dir);
    const { results } = await runValidate({ inputs: [], cwd: dir });
    const a = resultFor(results, "docs/a.md");
    expect(a.errors.map((e) => e.schema).sort()).toEqual([
      "check:stale-stamp",
      "derived:stale",
    ]);
    expect(resultFor(results, "docs/b.md").ok).toBe(true);
  });

  it("derives once for the run when a managed field and a check both need the evidence", async () => {
    const files = fixtureFiles();
    files["manni.config.yaml"] = [
      "meta:",
      "  paths:",
      '    - "docs/**/*.md"',
      "  schemas:",
      "    - ./permissive.schema.json",
      "  derive:",
      "    fields: [last-updated, owner]",
      "    sources: [git, codeowners]",
      "  checks:",
      "    - name: stale-stamp",
      "      query: >-",
      "        SELECT d._path AS path, 'last-updated' AS key,",
      "               'stamp disagrees with git' AS message",
      "        FROM derived d JOIN docs USING (_path)",
      '        WHERE docs."last-updated" IS NOT d."last-updated"',
      "",
    ].join("\n");
    const dir = repo(files);
    reviseA(dir);
    derivations.calls = 0;
    const { results } = await runValidate({ inputs: [], cwd: dir });
    expect(derivations.calls).toBe(1);
    // One derivation, both readers served.
    expect(resultFor(results, "docs/a.md").errors.map((e) => e.schema).sort()).toEqual([
      "check:stale-stamp",
      "derived:stale",
    ]);
  });
});

describe("get --derived", () => {
  it("adds a derived record beside the asserted values", async () => {
    const dir = repo();
    const sha = git(dir, ["rev-parse", "HEAD"]).slice(0, 7);
    const results = await runGet({
      fields: ["last-updated", "owner", "title"],
      inputs: ["docs/a.md"],
      cwd: dir,
      derived: true,
    });
    expect(results).toHaveLength(1);
    const r = results[0];
    expect(r?.values).toEqual({
      "last-updated": "2026-08-20",
      owner: ["@docs-team"],
      title: "A",
    });
    expect(r?.derived).toEqual({
      // The stamp agrees with the commit that carries it, so the evidence
      // names the stamping commit rather than a body change.
      "last-updated": {
        value: "2026-08-20",
        source: "git",
        evidence: `stamped in ${sha}`,
      },
      owner: {
        value: ["@docs-team"],
        source: "codeowners",
        evidence: "CODEOWNERS:1",
      },
    });
    // A field that is not derivable is absent from the record, not null.
    expect(r?.derived).not.toHaveProperty("title");
  });

  it("renders the derived value and its evidence in the pretty line", async () => {
    const dir = repo();
    const sha = reviseA(dir).slice(0, 7);
    const results = await runGet({
      fields: ["last-updated", "title"],
      inputs: ["docs/a.md"],
      cwd: dir,
      derived: true,
    });
    expect(renderGet(results, ["last-updated", "title"])).toBe(
      [
        // The evidence's own `(2026-09-07)` is trimmed: the date is already the derived value on this line.
        `docs/a.md: last-updated=2026-08-20 (derived 2026-09-07, git: body changed in ${sha})`,
        "docs/a.md: title=A (not derivable)",
      ].join("\n"),
    );
  });

  it("prints (derived (none)) when the source had no answer", async () => {
    const dir = repo();
    const results = await runGet({
      fields: ["owner"],
      inputs: ["docs/b.md"],
      cwd: dir,
      derived: true,
    });
    expect(results[0]?.derived).toEqual({ owner: null });
    expect(renderGet(results, ["owner"])).toBe(
      "docs/b.md: owner=(unset) (derived (none))",
    );
  });

  it("carries no derived record without the flag", async () => {
    const dir = repo();
    const results = await runGet({
      fields: ["last-updated"],
      inputs: ["docs/a.md"],
      cwd: dir,
    });
    expect(results[0]).not.toHaveProperty("derived");
    expect(renderGet(results, ["last-updated"])).toBe(
      "docs/a.md: last-updated=2026-08-20",
    );
  });

  it("refuses stdin: there is no history behind it", async () => {
    const dir = repo();
    await expect(
      runGet({
        fields: ["last-updated"],
        inputs: ["-"],
        as: "markdown",
        stdinContent: DOC,
        cwd: dir,
        derived: true,
      }),
    ).rejects.toThrow("cannot derive <stdin>: no history behind it");
  });
});

describe("--no-cache reaches the review cache from every reader", () => {
  // The cache answers for a merged change, whose approvals never change. The
  // flag is the way past an answer recorded wrongly, so every command that
  // consults a review source has to carry it, not only `derive`.
  it("threads cache: false from validate, get and query, and defaults to true", async () => {
    const dir = repo();
    derivations.cache.length = 0;

    await runValidate({ inputs: [], cwd: dir });
    await runValidate({ inputs: [], cwd: dir, cache: false });
    expect(derivations.cache).toEqual([true, false]);

    derivations.cache.length = 0;
    await runGet({ fields: ["owner"], inputs: ["docs/a.md"], cwd: dir, derived: true });
    await runGet({
      fields: ["owner"],
      inputs: ["docs/a.md"],
      cwd: dir,
      derived: true,
      cache: false,
    });
    expect(derivations.cache).toEqual([true, false]);

    derivations.cache.length = 0;
    const sql = "SELECT _path, owner FROM derived";
    await runQuery({ sql, inputs: [], cwd: dir });
    await runQuery({ sql, inputs: [], cwd: dir, cache: false });
    expect(derivations.cache).toEqual([true, false]);
  });
});

describe("query: the derived table", () => {
  it("holds one row per file, with the evidence in _sources", async () => {
    const dir = repo();
    const sha = git(dir, ["rev-parse", "HEAD"]).slice(0, 7);
    const run = await runQuery({
      sql: 'SELECT _path, "last-updated", owner, created, "reviewed-by", _sources FROM derived ORDER BY _path',
      inputs: [],
      cwd: dir,
    });
    expect(run.rows).toHaveLength(2);
    const a = run.rows[0];
    expect(a).toMatchObject({
      _path: "docs/a.md",
      "last-updated": "2026-08-20",
      owner: '["@docs-team"]',
      created: "2026-08-20",
      "reviewed-by": null,
    });
    expect(JSON.parse(String(a?._sources))).toEqual({
      created: { source: "git", evidence: `added in ${sha} (2026-08-20)` },
      "last-updated": { source: "git", evidence: `stamped in ${sha}` },
      authors: { source: "git", evidence: expect.any(String) as string },
      owner: { source: "codeowners", evidence: "CODEOWNERS:1" },
    });
    const b = run.rows[1];
    expect(b).toMatchObject({ _path: "docs/b.md", owner: null });
    expect(JSON.parse(String(b?._sources))).not.toHaveProperty("owner");
  });

  it("joins with docs to find the stale stamps", async () => {
    const dir = repo();
    reviseA(dir);
    const run = await runQuery({
      sql: `SELECT d._path, docs."last-updated" AS said, d."last-updated" AS derived
            FROM derived d JOIN docs USING (_path)
            WHERE docs."last-updated" IS NOT d."last-updated"`,
      inputs: [],
      cwd: dir,
    });
    expect(run.rows).toEqual([
      { _path: "docs/a.md", said: "2026-08-20", derived: "2026-09-07" },
    ]);
  });

  it("refuses a write to the derived table as read-only", async () => {
    const dir = repo();
    const run = runQuery({
      sql: `UPDATE derived SET "last-updated" = '2020-01-01'`,
      inputs: [],
      cwd: dir,
    });
    await expect(run).rejects.toThrow(DocmetaError);
    await expect(run).rejects.toThrow(/read-only/);
  });

  it("refuses a write to a managed key through docs", async () => {
    const dir = repo();
    await expect(
      runQuery({
        sql: `UPDATE docs SET "last-updated" = '2026-01-01'`,
        inputs: [],
        cwd: dir,
      }),
    ).rejects.toThrow(
      '"last-updated" is managed by derive; run manni meta derive instead.',
    );
  });

  it("refuses a rename onto a managed key, and one away from it", async () => {
    const dir = repo();
    await expect(
      runQuery({
        sql: `UPDATE docs SET owner = title, title = NULL WHERE _path = 'docs/b.md'`,
        inputs: [],
        cwd: dir,
      }),
    ).rejects.toThrow('"owner" is managed by derive');
    await expect(
      runQuery({
        sql: `UPDATE docs SET updated = "last-updated", "last-updated" = NULL WHERE _path = 'docs/b.md'`,
        inputs: [],
        cwd: dir,
      }),
    ).rejects.toThrow('"last-updated" is managed by derive');
  });

  it("reads a repository with no CODEOWNERS file: owner is null, not an error", async () => {
    // Declaring no owners is a fact the table can state. Only a configured
    // path that is missing is the operator's error, below.
    const files = fixtureFiles();
    delete files.CODEOWNERS;
    const dir = repo(files);
    const run = await runQuery({
      sql: "SELECT _path, owner FROM derived",
      inputs: [],
      cwd: dir,
    });
    expect(run.rows.map((r) => r.owner)).toEqual([null, null]);
  });

  it("names the fix when a requested source cannot answer", async () => {
    const files = fixtureFiles();
    const config = files["manni.config.yaml"] ?? "";
    expect(config).toContain("sources: [git, codeowners]");
    files["manni.config.yaml"] = config.replace(
      "sources: [git, codeowners]",
      "sources: [git, codeowners]\n    codeowners: nope/CODEOWNERS",
    );
    const dir = repo(files);
    // `owner` is what needs the codeowners source; a statement reading
    // `_path` alone consults nothing and has nothing to refuse.
    const run = runQuery({ sql: "SELECT _path, owner FROM derived", inputs: [], cwd: dir });
    await expect(run).rejects.toThrow(/codeowners source unavailable/);
    await expect(run).rejects.toThrow(/narrow derive\.sources/);
    const paths = await runQuery({ sql: "SELECT _path FROM derived", inputs: [], cwd: dir });
    expect(paths.rows).toHaveLength(2);
  });

  it("never consults the evidence for a statement that does not name derived", async () => {
    // No repository, no config: git would have nothing to say, and is not asked.
    const dir = makeTempRepo({ files: { "docs/a.md": DOC }, init: false });
    dirs.push(dir);
    const run = await runQuery({
      sql: "SELECT title FROM docs",
      inputs: ["docs"],
      cwd: dir,
      noConfig: true,
    });
    expect(run.rows).toEqual([{ title: "t" }]);
  });

  it("does not build the table for a statement that only says the word", async () => {
    // Same control: no repository, so a build would fail on git. A string
    // literal is not a table reference.
    const dir = makeTempRepo({ files: { "docs/a.md": DOC }, init: false });
    dirs.push(dir);
    const run = await runQuery({
      sql: "SELECT title FROM docs WHERE title LIKE '%derived%'",
      inputs: ["docs"],
      cwd: dir,
      noConfig: true,
    });
    expect(run.rows).toEqual([]);
  });

  it("consults only the sources the named columns need", async () => {
    // No `sources:` in config, so all four are allowed — and this
    // repository has no origin remote, so neither review source can answer. A
    // statement that reads `owner` alone never asks them.
    const files = fixtureFiles();
    files["manni.config.yaml"] = (files["manni.config.yaml"] ?? "").replace(
      "    sources: [git, codeowners]\n",
      "",
    );
    expect(files["manni.config.yaml"]).not.toContain("sources:");
    const dir = repo(files);
    const run = await runQuery({
      sql: "SELECT _path, owner FROM derived ORDER BY _path",
      inputs: [],
      cwd: dir,
    });
    expect(run.rows).toEqual([
      { _path: "docs/a.md", owner: '["@docs-team"]' },
      { _path: "docs/b.md", owner: null },
    ]);
    // `*` reads every column, so every source is consulted, and the review
    // sources' silence is the run's error.
    const all = runQuery({ sql: "SELECT * FROM derived", inputs: [], cwd: dir });
    await expect(all).rejects.toThrow(/github source unavailable/);
  });

  it("never carries the derived table into a --db export", async () => {
    const dir = repo();
    const out = join(dir, "export.db");
    const run = await runQuery({
      sql: "SELECT _path FROM derived ORDER BY _path",
      inputs: [],
      cwd: dir,
      db: out,
    });
    expect(run.rows).toHaveLength(2);
    const { DatabaseSync } = await loadSqlite();
    const db = new DatabaseSync(out);
    try {
      const names = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE lower(name) IN ('derived', '_derived_rows')",
        )
        .all();
      expect(names).toEqual([]);
      // The export itself is intact.
      const docs = db.prepare("SELECT count(*) AS n FROM docs").all() as { n: number | bigint }[];
      expect(Number(docs[0]?.n)).toBe(2);
    } finally {
      db.close();
    }
  });
});

describe("the derived table's reading of a statement", () => {
  it("mentionsDerived looks for the table, not the word", () => {
    expect(mentionsDerived("SELECT * FROM derived")).toBe(true);
    expect(mentionsDerived("select _path from DERIVED d")).toBe(true);
    expect(mentionsDerived('SELECT * FROM "derived"')).toBe(true);
    expect(mentionsDerived("SELECT a._path FROM docs a JOIN derived b USING (_path)")).toBe(true);
    expect(mentionsDerived("UPDATE derived SET owner = NULL")).toBe(true);
    expect(mentionsDerived("SELECT title FROM docs WHERE title LIKE '%derived%'")).toBe(false);
    expect(mentionsDerived("SELECT 'derived' AS kind FROM docs")).toBe(false);
    expect(mentionsDerived("SELECT derived FROM docs")).toBe(false);
  });

  it("fieldsForSql names the columns the statement reads, or all of them", () => {
    const all = DERIVABLE_FIELDS;
    expect(fieldsForSql("SELECT _path, owner FROM derived", all)).toEqual(["owner"]);
    expect(
      fieldsForSql(
        'SELECT d."last-updated", created FROM derived d WHERE d."reviewed-by" IS NULL',
        all,
      ),
    ).toEqual(["created", "last-updated", "reviewed-by"]);
    expect(fieldsForSql("SELECT _path FROM derived", all)).toEqual([]);
    // `*` and `_sources` read every column.
    expect(fieldsForSql("SELECT * FROM derived", all)).toHaveLength(6);
    expect(fieldsForSql("SELECT _sources FROM derived", all)).toHaveLength(6);
    // Word boundaries: `owner` is not `owners`, `created` is not `recreated`.
    expect(fieldsForSql("SELECT owners, recreated FROM derived", all)).toEqual([]);
  });

  it("fieldsForSql reads the run's own field list, with a command key's metacharacters escaped", () => {
    const fields = ["a.b", "created"];
    expect(fieldsForSql('SELECT "a.b" FROM derived', fields)).toEqual(["a.b"]);
    // Unescaped, `a.b` would match `axb`.
    expect(fieldsForSql('SELECT "axb" FROM derived', fields)).toEqual([]);
    expect(fieldsForSql("SELECT * FROM derived", fields)).toEqual(fields);
    expect(fieldsForSql('SELECT "verified-against" FROM derived', ["verified-against"])).toEqual([
      "verified-against",
    ]);
  });

  it("derivedColumns is the path, the built-ins, the command keys sorted, then the evidence", () => {
    expect(derivedColumns()).toEqual(["_path", ...DERIVABLE_FIELDS, "_sources"]);
    expect(
      derivedColumns({
        "verified-against": { run: ["true"], timeoutMs: 1 },
        "api-version": { run: ["true"], timeoutMs: 1 },
      }),
    ).toEqual(["_path", ...DERIVABLE_FIELDS, "api-version", "verified-against", "_sources"]);
  });
});

/**
 * The `command` source (proposal 0041) as the same commands see it. The
 * fixture manages one command-derived field, `verified-against`, whose
 * command reads `version.json` beside the config; the document asserts
 * `1.4.1` and the file says `1.4.2`. No git history is needed: `sources`
 * names `command` alone.
 */
describe("a command-derived field", () => {
  const COMMAND_FIXTURE = resolve(__dirname, "fixtures", "derive", "command");
  const ARGV = "node -p require('./version.json').version";

  function fixtureTree(): Record<string, string> {
    const out: Record<string, string> = {};
    const walk = (dir: string, prefix: string): void => {
      for (const name of readdirSync(dir)) {
        const abs = join(dir, name);
        const rel = prefix === "" ? name : `${prefix}/${name}`;
        if (statSync(abs).isDirectory()) walk(abs, rel);
        else out[rel] = readFileSync(abs, "utf8");
      }
    };
    walk(COMMAND_FIXTURE, "");
    return out;
  }

  function commandRepo(): string {
    const dir = makeTempRepo({ files: fixtureTree() });
    dirs.push(dir);
    return dir;
  }

  it("validate reports the stale stamp as derived:stale, naming the command", async () => {
    const dir = commandRepo();
    const { results, summary } = await runValidate({ inputs: [], cwd: dir });
    const install = resultFor(results, "docs/install.md");
    expect(install.ok).toBe(false);
    const findings = derivedFindings(install);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      schema: "derived:stale",
      keyword: "derived",
      instancePath: "/verified-against",
      subject: "verified-against",
      line: 3,
    });
    expect(findings[0]?.message).toContain("verified-against says 1.4.1");
    expect(findings[0]?.message).toContain(`command says 1.4.2 (${ARGV})`);
    expect(summary.failed).toBe(1);
  });

  it("get --derived shows the command's value and its argv", async () => {
    const dir = commandRepo();
    const results = await runGet({
      fields: ["verified-against"],
      inputs: ["docs/install.md"],
      cwd: dir,
      derived: true,
    });
    expect(results[0]?.derived).toEqual({
      "verified-against": { value: "1.4.2", source: "command", evidence: ARGV },
    });
    expect(renderGet(results, ["verified-against"])).toBe(
      `docs/install.md: verified-against=1.4.1 (derived 1.4.2, command: ${ARGV})`,
    );
  });

  it("the derived table has a column for the command's field", async () => {
    const dir = commandRepo();
    const run = await runQuery({
      sql: 'SELECT _path, "verified-against", _sources FROM derived',
      inputs: [],
      cwd: dir,
    });
    expect(run.rows).toEqual([
      {
        _path: "docs/install.md",
        "verified-against": "1.4.2",
        _sources: JSON.stringify({
          "verified-against": { source: "command", evidence: ARGV },
        }),
      },
    ]);
  });

  it("query refuses to write the command's field, as a managed one", async () => {
    const dir = commandRepo();
    await expect(
      runQuery({
        sql: `UPDATE docs SET "verified-against" = 'x'`,
        inputs: [],
        cwd: dir,
      }),
    ).rejects.toThrow('"verified-against" is managed by derive; run manni meta derive instead.');
  });
});

describe("fill never proposes a managed field", () => {
  it("reports it with skipReason managed and keeps it out of the request", async () => {
    const dir = makeTempRepo({
      init: false,
      files: {
        "manni.config.yaml": [
          "meta:",
          "  schemas:",
          "    - ./schema.json",
          "  derive:",
          "    fields: [last-updated]",
          "",
        ].join("\n"),
        "schema.json": JSON.stringify({
          type: "object",
          required: ["title", "last-updated"],
          properties: {
            title: { type: "string" },
            "last-updated": { type: "string" },
          },
        }),
        "doc.md": "# Hi\n\nSome text.\n",
      },
    });
    dirs.push(dir);
    const provider = new MockProvider([
      { json: { title: { value: "Hi", confidence: 1, reasoning: "the heading" } } },
    ]);
    const { results, summary } = await runFill({
      inputs: ["doc.md"],
      cwd: dir,
      cache: false,
      inferenceProvider: provider,
    });
    const fields = results[0]?.fields ?? [];
    const byName = Object.fromEntries(fields.map((f) => [f.field, f]));
    expect(byName["/title"]?.written).toBe(true);
    expect(byName["/last-updated"]).toEqual({
      field: "/last-updated",
      required: true,
      confidence: 0,
      reasoning: "managed by derive",
      written: false,
      skipReason: "managed",
    });
    expect(summary.written).toBe(1);
    expect(summary.skipped).toBe(1);
    // The request the model saw asks for the title only.
    expect(provider.requests).toHaveLength(1);
    expect(JSON.stringify(provider.requests[0]?.schema)).not.toContain(
      "last-updated",
    );
  });
});
