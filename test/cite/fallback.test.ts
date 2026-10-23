/**
 * The scope rule of proposal 0108: a claim by pointer runs on strategy records
 * only, and every other page prints what 4.20.0 printed, byte for byte.
 *
 * Each snapshot in `fallback/` was captured from the 4.20.0 build, before any
 * source edit for 0108, by running this file with `MANNI_CAPTURE_FALLBACK=1`.
 * Never re-capture them from a later build: they are the old behaviour, and a
 * new capture would only record whatever the branch prints.
 *
 * The runs work in a throwaway copy of each fixture, outside any git work
 * tree, so nothing depends on this repository's own history or config.
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnText } from "../helpers/spawn.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const manni = resolve(root, "dist", "cli.js");
const SNAPSHOTS = join(here, "fallback");
const CAPTURE = process.env.MANNI_CAPTURE_FALLBACK === "1";

interface Case {
  name: string;
  fixture: "cite-repos" | "cite-pointer";
  args: string[];
}

const REPOS = ["--no-config", "--repo", "api=api", "--repo", "sdk=sdk", "docs/pages/limits.md"];
const PLAIN = ["--no-config", "--root", ".", "plain.md", "plain-pointer.md"];

const CASES: Case[] = [
  { name: "repos-check-pretty", fixture: "cite-repos", args: ["cite", "check", ...REPOS, "--no-color"] },
  { name: "repos-check-json", fixture: "cite-repos", args: ["cite", "check", ...REPOS, "-f", "json"] },
  { name: "repos-check-github", fixture: "cite-repos", args: ["cite", "check", ...REPOS, "-f", "github"] },
  { name: "plain-check-pretty", fixture: "cite-pointer", args: ["cite", "check", ...PLAIN, "--no-color"] },
  { name: "plain-check-json", fixture: "cite-pointer", args: ["cite", "check", ...PLAIN, "-f", "json"] },
  { name: "plain-check-github", fixture: "cite-pointer", args: ["cite", "check", ...PLAIN, "-f", "github"] },
  {
    name: "plain-add-frontmatter",
    fixture: "cite-pointer",
    args: ["cite", "add", "--no-config", "--root", ".", "plain.md:2", "src/limits.ts:2", "--id", "x"],
  },
  {
    name: "plain-add-pointer",
    fixture: "cite-pointer",
    args: ["cite", "add", "--no-config", "--root", ".", "plain.md#/title", "src/limits.ts:2", "--id", "x"],
  },
  {
    name: "plain-add-stdin-pointer",
    fixture: "cite-pointer",
    args: ["cite", "add", "--no-config", "--root", ".", "-#/pains/0", "src/limits.ts:2", "--as", "markdown"],
  },
  {
    name: "plain-validate-json",
    fixture: "cite-pointer",
    args: ["meta", "validate", "--no-config", "-f", "json", "plain-pointer.md"],
  },
];

/** The run as one text, with the temp directory's name, which differs per run, as `<dir>`. */
function render(status: number | null, stdout: string, stderr: string): string {
  const text = `exit: ${String(status)}\n--- stdout\n${stdout}--- stderr\n${stderr}`;
  return text.replace(/\S*manni-cite-fallback-[A-Za-z0-9]+/g, "<dir>");
}

/** The environment, with color off and no family key. */
function env(): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: "1" };
  delete out.MANNI_ENCRYPTION_KEY;
  return out;
}

const dirs: string[] = [];

function copyOf(fixture: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "manni-cite-fallback-")));
  cpSync(join(root, "test", "fixtures", fixture), dir, { recursive: true });
  dirs.push(dir);
  return dir;
}

beforeAll(() => {
  expect(readFileSync(manni, "utf8").length).toBeGreaterThan(0);
});

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("cite on a page that is not a record prints what 4.20.0 printed", () => {
  for (const c of CASES) {
    it(c.name, () => {
      const cwd = copyOf(c.fixture);
      const run = spawnText(
        spawnSync(process.execPath, [manni, ...c.args], {
          cwd,
          encoding: "utf8",
          input: c.args.includes("-#/pains/0") ? readFileSync(join(cwd, "plain.md"), "utf8") : "",
          env: env(),
        }),
      );
      const got = render(run.status, run.stdout ?? "", run.stderr ?? "");
      const file = join(SNAPSHOTS, `${c.name}.txt`);
      if (CAPTURE) writeFileSync(file, got);
      expect(got).toBe(readFileSync(file, "utf8"));
    });
  }
});
