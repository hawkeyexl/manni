/**
 * The derived channel through the built bin: the flags E1 wires
 * (`validate --no-derive`, `get --derived`) and the refusals that need none.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync, execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  commit,
  makeTempRepo,
  removeTempRepo,
  writeFile,
} from "./helpers/temp-repo.js";

// Every case here spawns git, the built bin, or a fake CLI, and a Windows
// runner under load takes longer than vitest's 5 s default for a single
// spawn chain. The whole file gets the budget the bin-spawning suites use.
vi.setConfig({ testTimeout: 60_000 });

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const bin = resolve(root, "dist", "cli.js");
const FIXTURE = resolve(here, "fixtures", "derive", "commands");

interface Run {
  stdout: string;
  stderr: string;
  status: number;
}

function run(cwd: string, args: string[]): Run {
  try {
    const stdout = execFileSync("node", [bin, "meta", ...args], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" },
    });
    return { stdout, stderr: "", status: 0 };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
      status: err.status ?? 1,
    };
  }
}

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

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) removeTempRepo(d);
});

/** The fixture committed on 2026-08-20, then a.md's body revised on 2026-09-07. */
function staleRepo(): string {
  const files = fixtureFiles();
  const dir = makeTempRepo({ files });
  dirs.push(dir);
  commit(dir, "init", { authorDate: "2026-08-20T10:00:00+00:00" });
  writeFile(
    dir,
    "docs/a.md",
    (files["docs/a.md"] ?? "").replace("Body of a.", "Body of a, revised."),
  );
  commit(dir, "revise a", { authorDate: "2026-09-07T10:00:00+00:00" });
  return dir;
}

describe("derived channel (built bin)", () => {
  beforeAll(() => {
    if (!existsSync(bin)) execSync("npm run build", { cwd: root, stdio: "ignore" });
  }, 180000);

  it("validate exits 1 with a derived:stale finding", () => {
    const r = run(staleRepo(), ["validate"]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("[derived:stale]");
    expect(r.stdout).toContain("git says 2026-09-07");
  });

  it("validate --no-derive exits 0", () => {
    const r = run(staleRepo(), ["validate", "--no-derive"]);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });

  it("get --derived prints the derived value and its evidence", () => {
    const r = run(staleRepo(), ["get", "last-updated", "docs/a.md", "--derived"]);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(
      // The evidence's own `(2026-09-07)` is trimmed: the date is already on the line.
      /^docs\/a\.md: last-updated=2026-08-20 \(derived 2026-09-07, git: body changed in [0-9a-f]{7}\)$/m,
    );
  });

  it("query refuses a write to a managed key with exit 2", () => {
    const r = run(staleRepo(), [
      "query",
      `UPDATE docs SET "last-updated" = '2026-09-07'`,
    ]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(
      '"last-updated" is managed by derive; run manni meta derive instead.',
    );
  });
});
