/**
 * `x-manni-term` (proposal 0085 §6) through the built bins. `manni` registers
 * the termbase source, so `manni meta validate` checks marked values. The
 * `docmeta` bin registers none, so it warns once and checks nothing.
 */
import { execSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const manni = resolve(root, "dist", "cli.js");
const docmeta = resolve(root, "dist", "docmeta.js");
const fixture = resolve(here, "fixtures", "term-keyword");

const run = (bin: string, args: string[]) =>
  spawnSync("node", [bin, ...args], { cwd: fixture, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });

describe("x-manni-term through the built bins", () => {
  beforeAll(() => {
    if (!existsSync(manni) || !existsSync(docmeta)) execSync("npm run build", { cwd: root, stdio: "ignore" });
  }, 180000);

  it("manni meta validate reports the three findings and exits 1", () => {
    const r = run(manni, ["meta", "validate", "docs/team.md"]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain(
      `/audiences/1  "Writer" is a term, but not under "Audience", which audience.schema.json requires.  (line 5)  [term:outside-branch]`,
    );
    expect(r.stdout).toContain(
      `/audiences/2  warning "SRE" is an alt-label of "Site reliability engineer", so use the label.  (line 6)  [term:alt-label]`,
    );
    expect(r.stdout).toContain(
      `/audiences/3  "devops" names no term; audience.schema.json marks this field x-manni-term.  (line 7)  [term:undefined]`,
    );
    expect(r.stdout).toContain("4 errors, 2 warnings");
  });

  it("exits 2 when under names no term", () => {
    const r = run(manni, ["meta", "validate", "docs/team.md", "-s", "bad-under.schema.json"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('bad-under.schema.json: x-manni-term under "Audiense" names no term.');
  });

  it("exits 2 on a bad argument", () => {
    const r = run(manni, ["meta", "validate", "docs/team.md", "-s", "bad-argument.schema.json"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(
      'bad-argument.schema.json: "x-manni-term" must be an object with an optional "under" string.',
    );
  });

  it("docmeta finds no termbase, warns once, and passes", () => {
    const r = run(docmeta, ["validate", "docs/team.md"]);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain(
      "docmeta: x-manni-term marks 2 fields, and no termbase was found, so their values were not checked.",
    );
  });
});
