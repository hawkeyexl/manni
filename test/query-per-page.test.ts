/**
 * `manni meta query` on a `{page}` manifest (proposal 0058): a write to an
 * owned key lands in the page's own manifest, creating it when the page had
 * none, and a `_path` rename of a page whose values live in a manifest named
 * after its path is refused. Each case runs on a private copy of its fixture.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { runQuery } from "../src/meta/commands/query.js";
import { DocmetaError } from "../src/meta/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "fixtures", "per-page");

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function copy(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `manni-per-page-${name}-`));
  dirs.push(dir);
  cpSync(join(fixtures, name), dir, { recursive: true });
  return dir;
}

const read = (dir: string, file: string): string => readFileSync(join(dir, file), "utf8");
const yamlOf = (dir: string, file: string): unknown => parseYaml(read(dir, file));
const q = (dir: string, sql: string) => runQuery({ cwd: dir, inputs: [], sql });

describe("query on a {page} manifest", () => {
  it("UPDATE SET writes the page's own manifest", async () => {
    const dir = copy("query");
    const run = await q(dir, "UPDATE docs SET owner = 'web' WHERE _path = 'docs/auth.md'");
    expect(run.changes).toEqual([
      { file: "docs/auth.md", key: "owner", from: "platform", to: "web", written: true, manifest: "docs/auth.meta.yaml" },
    ]);
    expect(read(dir, "docs/auth.meta.yaml")).toBe("docs/auth.md:\n  owner: web\n");
  });

  it("UPDATE SET creates the manifest of a page that had none", async () => {
    const dir = copy("query");
    const run = await q(dir, "UPDATE docs SET owner = 'payments' WHERE _path = 'docs/billing.md'");
    expect(run.changes).toEqual([
      { file: "docs/billing.md", key: "owner", to: "payments", written: true, manifest: "docs/billing.meta.yaml" },
    ]);
    expect(yamlOf(dir, "docs/billing.meta.yaml")).toEqual({ "docs/billing.md": { owner: "payments" } });
    expect(read(dir, "docs/billing.md")).toBe(read(join(fixtures, "query"), "docs/billing.md"));
  });

  it("refuses to move a page whose values live in a manifest named after its path", async () => {
    const dir = copy("query");
    const run = q(dir, "UPDATE docs SET _path = 'docs/login.md' WHERE _path = 'docs/auth.md'");
    await expect(run).rejects.toThrow(DocmetaError);
    await expect(run).rejects.toThrow(
      'docs/auth.md cannot move to docs/login.md, because its "owner" lives in docs/auth.meta.yaml, a {page} manifest named after the page\'s path. Move the page and its manifest together, then rename the entry\'s key.',
    );
    expect(existsSync(join(dir, "docs/auth.md"))).toBe(true);
    expect(existsSync(join(dir, "docs/login.md"))).toBe(false);
  });

  it("moves a page that has no value in its {page} manifest", async () => {
    const dir = copy("query");
    const run = await q(dir, "UPDATE docs SET _path = 'docs/payments.md' WHERE _path = 'docs/billing.md'");
    expect(run.changes).toEqual([{ file: "docs/billing.md", renamed: "docs/payments.md", written: true }]);
    expect(existsSync(join(dir, "docs/payments.md"))).toBe(true);
  });
});
