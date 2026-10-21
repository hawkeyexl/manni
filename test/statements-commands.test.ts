/**
 * `meta derive` pins inline statements and `meta get` lists them (proposal
 * 0099), and none of it reads git: the same pages copied outside a repository
 * give the same findings, pins and writes.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deriveFailed, runDerive } from "../src/meta/commands/derive.js";
import { runGet } from "../src/meta/commands/get.js";
import { runValidate } from "../src/meta/commands/validate.js";
import { pinStatements, readStatements } from "../src/meta/core/statements.js";
import { renderDerivePretty } from "../src/meta/reporters/derive.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const PAGES = ["markdown.md", "mdx.mdx", "asciidoc.adoc", "rst.rst", "html.html", "dita/task.dita"];

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** The statement fixtures, copied into a temporary directory no repository holds. */
function noGitCopy(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "manni-statements-")));
  dirs.push(dir);
  cpSync(resolve(root, "test/fixtures/statements"), dir, { recursive: true });
  return dir;
}

/** Statement findings, by page, as `rule line anchor`. */
async function statementFindings(cwd: string, base: string): Promise<Record<string, string[]>> {
  const { results } = await runValidate({ inputs: PAGES.map((p) => `${base}${p}`), cwd, noConfig: true });
  return Object.fromEntries(
    results.map((r) => [
      r.file.replace(base, "").replace(/\\/g, "/"),
      r.errors
        .filter((e) => e.statement !== undefined)
        .map((e) => `${e.keyword} ${String(e.line)} ${String(e.statement?.anchor)} ${e.message}`),
    ]),
  );
}

describe("meta derive pins statements", () => {
  it("pins every unpinned statement, keeps a changed pin, and says how many", async () => {
    const dir = noGitCopy();
    const before = readFileSync(join(dir, "markdown.md"), "utf8");
    const run = await runDerive({ inputs: ["markdown.md"], cwd: dir, noConfig: true, sources: ["git"] });
    expect(deriveFailed(run)).toBe(false);
    const after = readFileSync(join(dir, "markdown.md"), "utf8");
    const statements = readStatements(after, "markdown").statements;
    expect(statements.filter((s) => s.anchor !== undefined && s.status === "unpinned")).toEqual([]);
    expect(statements.filter((s) => s.status === "changed").map((s) => s.pin)).toEqual(
      readStatements(before, "markdown").statements.filter((s) => s.status === "changed").map((s) => s.pin),
    );
    const pinned = pinStatements(before, "markdown").pinned;
    expect(run.summary.statements).toEqual({ pinned, pages: 1 });
    expect(renderDerivePretty(run)).toContain(`pinned ${String(pinned)} statements in 1 page.`);
  });

  it("is idempotent", async () => {
    const dir = noGitCopy();
    await runDerive({ inputs: ["markdown.md"], cwd: dir, noConfig: true, sources: ["git"] });
    const once = readFileSync(join(dir, "markdown.md"), "utf8");
    const again = await runDerive({ inputs: ["markdown.md"], cwd: dir, noConfig: true, sources: ["git"] });
    expect(readFileSync(join(dir, "markdown.md"), "utf8")).toBe(once);
    expect(again.summary.statements).toBeUndefined();
  });

  it("fails --check with an unpinned statement, and writes nothing", async () => {
    const dir = noGitCopy();
    const before = readFileSync(join(dir, "markdown.md"), "utf8");
    const run = await runDerive({ inputs: ["markdown.md"], cwd: dir, noConfig: true, sources: ["git"], check: true });
    expect(deriveFailed(run)).toBe(true);
    expect(run.results[0]?.findings?.some((f) => f.keyword === "statement-unpinned")).toBe(true);
    expect(readFileSync(join(dir, "markdown.md"), "utf8")).toBe(before);
  });

  it("pins a DITA statement in its own form", () => {
    const dir = noGitCopy();
    const page = join(dir, "dita/task.dita");
    const pinned = readFileSync(page, "utf8");
    // Drop every pin, so derive has the four to write back.
    const bare = pinned.replace(/sha256-[0-9a-f]{64} /g, "");
    expect(pinStatements(bare, "xml")).toEqual({ content: pinned, pinned: 4 });
  });
});

describe("meta get lists statements", () => {
  it("carries statements per page, and never merges their fields into the page's", async () => {
    const [result] = await runGet({
      fields: ["title", "last-verified"],
      inputs: ["test/fixtures/statements/markdown.md"],
      cwd: root,
      noConfig: true,
      derived: false,
    });
    expect(result?.values).toEqual({ title: "Statements in Markdown", "last-verified": undefined });
    expect(result?.statements?.[0]).toEqual({
      line: 8,
      anchor: "9",
      scope: "block",
      section: "statements-in-markdown",
      pin: "sha256-3e793febee24429f9d75a01c322c6932360ce4055ee52754ae6a5701832d9517",
      status: "current",
      data: { "last-verified": "2026-10-21" },
    });
    expect(result?.statements?.find((s) => s.scope === "section")?.section).toBe("install-on-windows");
    expect(result?.statements?.at(-1)).toMatchObject({ anchor: null, status: "unpinned" });
  });

  it("omits statements on a page that has none", async () => {
    const [result] = await runGet({
      fields: ["title"],
      inputs: ["-"],
      as: "markdown",
      stdinContent: "---\ntitle: Plain\n---\n\nNo statements here.\n",
      cwd: root,
      noConfig: true,
      derived: false,
    });
    expect(result?.statements).toBeUndefined();
  });
});

describe("statements read no git", () => {
  it("gives the same statement findings outside a repository", async () => {
    const dir = noGitCopy();
    expect(await statementFindings(dir, "")).toEqual(await statementFindings(root, "test/fixtures/statements/"));
  });

  it("gives the same derive writes outside a repository", async () => {
    const dir = noGitCopy();
    await runDerive({ inputs: ["markdown.md"], cwd: dir, noConfig: true, sources: ["git"] });
    const written = readStatements(readFileSync(join(dir, "markdown.md"), "utf8"), "markdown").statements;
    const expected = readStatements(
      pinStatements(readFileSync(resolve(root, "test/fixtures/statements/markdown.md"), "utf8"), "markdown").content,
      "markdown",
    ).statements;
    expect(written.map((s) => s.pin)).toEqual(expected.map((s) => s.pin));
  });

  it("names git in no statement finding", async () => {
    const dir = noGitCopy();
    const findings = Object.values(await statementFindings(dir, "")).flat();
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some((f) => /\bgit\b/.test(f))).toBe(false);
  });
});
