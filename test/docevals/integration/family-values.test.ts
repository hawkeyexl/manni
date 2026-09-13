/**
 * `manni docevals` speaking the family's shared values, against the built
 * `dist/cli.js`: the format names every domain uses, with each usage error's
 * stderr line and exit code.
 */
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../../..");
const MANNI = join(ROOT, "dist", "cli.js");
const PAGE = "test/docevals/fixtures/pages/docs/actions/find.mdx";

interface Run {
  stdout: string;
  stderr: string;
  status: number | null;
}

function manni(args: string[], cwd = ROOT): Run {
  const r = spawnSync("node", [MANNI, "docevals", ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status };
}

describe("manni docevals --format", () => {
  it("lists all seven run formats in its help", () => {
    const run = manni(["run", "--help"]);
    expect(run.status).toBe(0);
    expect(run.stdout.replace(/\s+/g, " ")).toContain(
      "Output format: pretty | json | markdown | github | sarif | junit | html (default: \"pretty\")",
    );
  });

  it("lists pretty and json for list and fill", () => {
    for (const verb of ["list", "fill"]) {
      const run = manni([verb, "--help"]);
      expect(run.stdout.replace(/\s+/g, " ")).toContain(
        'Output format: pretty | json (default: "pretty")',
      );
    }
  });

  it("renders pretty by default and when named", () => {
    const bare = manni(["list", PAGE]);
    const named = manni(["list", PAGE, "-f", "pretty"]);
    expect(bare.status).toBe(0);
    expect(named.stdout).toBe(bare.stdout);
  });

  it("refuses human on run, exit 2", () => {
    const run = manni(["run", PAGE, "--deterministic-only", "-f", "human"]);
    expect(run.status).toBe(2);
    expect(run.stdout).toBe("");
    expect(run.stderr).toBe(
      'manni: --format must be one of pretty | json | markdown | github | sarif | junit | html, got "human"\n',
    );
  });

  it("refuses human on list and fill, exit 2", () => {
    for (const verb of ["list", "fill"]) {
      const run = manni([verb, PAGE, "-f", "human"]);
      expect(run.status).toBe(2);
      expect(run.stderr).toBe('manni: --format must be one of pretty | json, got "human"\n');
    }
  });
});
