/**
 * An inline ai eval with no `examples` is advice, so docevals reports it as a
 * `notice` on the family scale: in every run format, in `list`, and with the
 * exit code unchanged. Against the built `dist/cli.js`.
 */
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../../..");
const MANNI = join(ROOT, "dist", "cli.js");
const DIR = join(ROOT, "test/docevals/fixtures/examples-notice");
const ADVICE =
  'Eval "states-purpose": ai-graded evals work best with examples.pass/examples.fail';

function manni(...args: string[]): { stdout: string; status: number | null } {
  const r = spawnSync("node", [MANNI, "docevals", ...args], {
    cwd: DIR,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  return { stdout: r.stdout, status: r.status };
}

const run = (format: string) =>
  manni("run", "--deterministic-only", "--no-generate", "-f", format);

describe("missing judge examples is a notice", () => {
  it("pretty tags it notice and exits 0", () => {
    const r = run("pretty");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`\nnotice docs/page.md:4 ${ADVICE}\n`);
    expect(r.stdout).not.toMatch(/^warn /m);
  });

  it("json carries level notice and exits 0", () => {
    const r = run("json");
    expect(r.status).toBe(0);
    const doc = JSON.parse(r.stdout) as { exitCode: number; problems: unknown[] };
    expect(doc.exitCode).toBe(0);
    expect(doc.problems).toEqual([
      { file: "docs/page.md", message: ADVICE, level: "notice", line: 4 },
    ]);
  });

  it("github annotates it ::notice and exits 0", () => {
    const r = run("github");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(
      `::notice file=docs/page.md,line=4,title=manni docevals::${ADVICE}\n`,
    );
    expect(r.stdout).not.toMatch(/^::warning /m);
  });

  it("markdown marks it ℹ️ rather than ⚠️", () => {
    const r = run("markdown");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`- ℹ️ \`docs/page.md\`:4 ${ADVICE}`);
    expect(r.stdout).not.toContain("⚠️");
  });

  it("sarif and junit report no failure for it", () => {
    const sarif = run("sarif");
    expect(sarif.status).toBe(0);
    const log = JSON.parse(sarif.stdout) as { runs: { results: { level: string }[] }[] };
    expect((log.runs[0]?.results ?? []).filter((r) => r.level !== "note")).toEqual([]);

    const junit = run("junit");
    expect(junit.status).toBe(0);
    expect(junit.stdout).toContain('failures="0" errors="0"');
  });

  it("list tags it notice and exits 0", () => {
    const r = manni("list");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`  notice:4 ${ADVICE}\n`);
    expect(r.stdout).not.toContain("warn");
  });
});
