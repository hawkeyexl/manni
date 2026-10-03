/**
 * `manni docevals` colour against the built `dist/cli.js`: on only for a TTY,
 * never under `NO_COLOR` or `--no-color`. These runs pipe stdout, so none of
 * them is a TTY, and `CI=1` must not switch colour back on.
 */
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../../..");
const MANNI = join(ROOT, "dist", "cli.js");
const PAGES = join(ROOT, "test/docevals/fixtures/pages");
const ESC = "\u001b[";
const RUN = ["run", "docs/actions/goTo.mdx", "--deterministic-only", "--no-generate"];

function manni(args: string[], env: Record<string, string>) {
  const base = { ...process.env };
  delete base.FORCE_COLOR;
  delete base.NO_COLOR;
  return spawnSync("node", [MANNI, "docevals", ...args], {
    cwd: PAGES,
    encoding: "utf8",
    env: { ...base, ...env },
  });
}

describe("manni docevals colour", () => {
  it("prints no colour to a pipe, even with CI set", () => {
    const r = manni(RUN, { CI: "1" });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("no-todo-markers");
    expect(r.stdout).not.toContain(ESC);
  });

  it("prints no colour under NO_COLOR", () => {
    const r = manni(RUN, { CI: "1", NO_COLOR: "1" });
    expect(r.status).toBe(1);
    expect(r.stdout).not.toContain(ESC);
  });

  it("accepts --no-color on run and keeps its exit code", () => {
    const r = manni([...RUN, "--no-color"], { CI: "1" });
    expect(r.stderr).toBe("");
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("no-todo-markers");
    expect(r.stdout).not.toContain(ESC);
  });

  it("accepts --no-color before the verb and on list", () => {
    const before = manni(["--no-color", ...RUN], { CI: "1" });
    expect(before.status).toBe(1);
    expect(before.stdout).not.toContain(ESC);
    const list = manni(["list", "docs/actions/goTo.mdx", "--no-color"], { CI: "1" });
    expect(list.status).toBe(0);
    expect(list.stdout).not.toContain(ESC);
  });
});
