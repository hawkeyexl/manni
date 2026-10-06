/**
 * A family fixture repository, copied to a temp directory and committed.
 *
 * The copy sits outside this checkout on purpose: the root manni.config.yaml
 * is discovered by any run beneath it, and a run in a fixture under `test/`
 * would find the fixture's own config first only by luck of nesting. A real
 * git repository is also what `check`'s Stop scope and `cite` read.
 */
import { cpSync, mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { commitAll } from "../helpers/temp-repo.js";

const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURES = resolve(here, "fixtures");

export type FixtureRepo = "only-docevals" | "only-citations" | "only-graph" | "everything";

/** Copy `name` to a temp directory, `git init` it and commit everything. */
export function fixtureRepo(name: FixtureRepo): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `manni-family-${name}-`)));
  cpSync(join(FIXTURES, name), dir, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: dir, stdio: "ignore" });
  commitAll(dir, "fixture");
  return dir;
}

/** An envelope fixture's text, with `cwd` set when given. */
export function envelope(name: string, cwd?: string): string {
  const doc = JSON.parse(readFileSync(join(FIXTURES, "envelopes", `${name}.json`), "utf8")) as Record<string, unknown>;
  return JSON.stringify(cwd === undefined ? doc : { ...doc, cwd });
}
