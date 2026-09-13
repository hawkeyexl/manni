/**
 * `provenance` in the `derived` table (proposal 0046). Blame runs only when
 * the field is asked for, by name or by `derive.fields`, never because a
 * statement selects `*` or counts rows: a blame per page is the cost the
 * proposal confines to runs that manage provenance.
 *
 * Whether blame ran is observed through git itself: a local
 * `blame.date=bogus` makes every `git blame` fail and leaves `git log` alone,
 * so a statement that blames errors and one that does not answers.
 */
import { cpSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runQuery } from "../src/meta/commands/query.js";
import { fieldsForSql } from "../src/meta/core/derive/table.js";
import { derivableFields } from "../src/meta/core/derive/types.js";
import { hashLines } from "../src/shared/pin.js";
import { commit, git, makeTempRepo, removeTempRepo, writeFile } from "./helpers/temp-repo.js";

vi.setConfig({ testTimeout: 60_000 });

const here = dirname(fileURLToPath(import.meta.url));
const PROVENANCE = resolve(here, "fixtures", "derive", "provenance");
const SONNET = "claude-sonnet-5";
const D1 = "2026-08-20T10:00:00+00:00";
const D2 = "2026-09-01T10:00:00+00:00";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) removeTempRepo(d);
});

/** One page whose body line 2 a machine's commit wrote; `fields` is `derive.fields`. */
function stage(fields: string[]): string {
  const dir = makeTempRepo({ files: {} });
  dirs.push(dir);
  writeFile(
    dir,
    "manni.config.yaml",
    `meta:\n  derive:\n    fields: [${fields.join(", ")}]\n    sources: [git]\n`,
  );
  writeFile(dir, "docs/a.md", "---\ntitle: t\n---\n\none\n");
  commit(dir, "add", { authorDate: D1 });
  writeFile(dir, "docs/a.md", "---\ntitle: t\n---\n\nONE\n");
  commit(dir, "edit", { authorDate: D2, trailers: [`Generated-by: ${SONNET}`] });
  return dir;
}

const query = (dir: string, sql: string) => runQuery({ sql, inputs: ["docs"], cwd: dir });

/** Make every `git blame` in `dir` fail, so a run that blames cannot answer. */
const breakBlame = (dir: string): void => {
  git(dir, ["config", "blame.date", "bogus"]);
};

describe("fieldsForSql and provenance", () => {
  const all = derivableFields();

  it("leaves provenance out of what `*`, `_sources` and `_origin` read", () => {
    for (const sql of [
      "SELECT count(*) FROM derived",
      "SELECT * FROM derived",
      "SELECT _sources FROM derived",
      "SELECT _path, _origin FROM resolved",
    ]) {
      const fields = fieldsForSql(sql, all);
      expect(fields).not.toContain("provenance");
      expect(fields).toEqual(all.filter((f) => f !== "provenance"));
    }
  });

  it("derives provenance when the statement names it", () => {
    expect(fieldsForSql("SELECT provenance FROM derived", all)).toEqual(["provenance"]);
    expect(fieldsForSql('SELECT *, "provenance" FROM derived', all)).toEqual(all);
  });
});

describe("runQuery: provenance in the derived table", () => {
  it("does not blame for SELECT count(*) or SELECT *, and shows provenance NULL there", async () => {
    const dir = stage(["created"]);
    breakBlame(dir);

    const counted = await query(dir, "SELECT count(*) AS n FROM derived");
    expect(counted.rows).toEqual([{ n: 1 }]);
    const star = await query(dir, "SELECT * FROM derived");
    expect(star.rows[0]?.provenance).toBeNull();
    expect(star.rows[0]?.created).toBe("2026-08-20");
  });

  it("blames when the statement names provenance", async () => {
    const dir = stage(["created"]);
    const run = await query(dir, "SELECT provenance FROM derived");
    expect(JSON.parse(String(run.rows[0]?.provenance))).toEqual([
      { "generated-by": SONNET, lines: 2, integrity: hashLines("ONE") },
    ]);

    breakBlame(dir);
    await expect(query(dir, "SELECT provenance FROM derived")).rejects.toThrow(
      /unknown date format bogus/,
    );
  });

  it("blames for any statement over the table when derive.fields manages provenance", async () => {
    const dir = stage(["provenance"]);
    const star = await query(dir, "SELECT * FROM derived");
    expect(JSON.parse(String(star.rows[0]?.provenance))).toEqual([
      { "generated-by": SONNET, lines: 2, integrity: hashLines("ONE") },
    ]);

    breakBlame(dir);
    await expect(query(dir, "SELECT count(*) FROM derived")).rejects.toThrow(
      /unknown date format bogus/,
    );
  });
});

describe("runQuery: provenance kept in an external manifest", () => {
  const LIMITS = "docs/limits.md";
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

  it("reads the stamp committed in the manifest with the agent's edit (evidence rule 2)", async () => {
    const dir = makeTempRepo({ files: {} });
    dirs.push(dir);
    cpSync(PROVENANCE, dir, { recursive: true });
    commit(dir, "add docs", { authorDate: D1 });

    // The agent's rewrite of body lines 6-8, and its stamp in the manifest,
    // committed together by an author no `machines` pattern names.
    const page = readFileSync(join(dir, LIMITS), "utf8");
    writeFile(dir, LIMITS, page.replace(HUMAN.join("\n"), AGENT.join("\n")));
    const stamp = { "generated-by": SONNET, lines: "6-8", integrity: hashLines(AGENT.join("\n")) };
    writeFile(
      dir,
      "private/provenance.yaml",
      [
        "# Provenance for pages that keep their record out of the page.",
        `${LIMITS}:`,
        "  provenance:",
        `    - generated-by: ${stamp["generated-by"]}`,
        `      lines: ${stamp.lines}`,
        `      integrity: ${stamp.integrity}`,
        "",
      ].join("\n"),
    );
    commit(dir, "docs: rewrite the limits", {
      authorDate: D2,
      author: { name: "Agent", email: "agent@example.com" },
    });

    const run = await runQuery({
      sql: `SELECT provenance FROM derived WHERE _path = '${LIMITS}'`,
      inputs: ["docs"],
      cwd: dir,
      configPath: "manifest.config.yaml",
    });
    expect(run.rows).toHaveLength(1);
    expect(JSON.parse(String(run.rows[0]?.provenance))).toEqual([stamp]);
  });
});
