/**
 * `manni docevals` against the built `dist/cli.js`, over corpora whose eval
 * keys live in an external-metadata manifest (proposal 0037, 0041).
 *
 * The round trip is the claim worth pinning: a corpus is run, `manni meta
 * relocate` moves its `evals` and `eval-suite` out of the pages and into a
 * manifest, and the same run reports the same verdicts. Relocating is a move,
 * not a change of what is checked, and the only way to show that is to check
 * twice through the real bins.
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../../..");
const MANNI = join(ROOT, "dist", "cli.js");
const FIXTURES = join(ROOT, "test", "docevals", "fixtures", "manifest");
const DRAFT = join(
  ROOT,
  "docs/proposals/0023/schemas/evals/1.0.0-proposal.4.json",
);

interface Run {
  stdout: string;
  stderr: string;
  status: number | null;
}

function manni(args: string[], cwd: string): Run {
  const r = spawnSync("node", [MANNI, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status };
}

/** A writable copy of a fixture corpus, since relocate rewrites it. */
function copyOf(fixture: string): string {
  const dir = mkdtempSync(join(tmpdir(), "manni-docevals-manifest-"));
  cpSync(join(FIXTURES, fixture), dir, { recursive: true });
  return dir;
}

/** `<file> <eval> <outcome>` for every result, sorted, from a `-f json` run. */
function verdicts(run: Run): string[] {
  const report = JSON.parse(run.stdout) as {
    evalResults: { file: string; evalName: string; outcome: string }[];
  };
  return report.evalResults
    .map((r) => `${r.file} ${r.evalName} ${r.outcome}`)
    .sort();
}

const RUN = ["docevals", "run", "--deterministic-only", "-f", "json"];

describe("relocating eval keys does not change what is checked", () => {
  it("reports the same verdicts before and after the move", () => {
    const cwd = copyOf("roundtrip");

    const before = manni(RUN, cwd);
    expect(before.status).toBe(1);
    expect(verdicts(before)).toEqual([
      "docs/install.md fresh-enough pass",
      "docs/stale.md long-overdue fail",
    ]);

    const moved = manni(
      ["meta", "relocate", "--fields", "evals,eval-suite", "-s", DRAFT],
      cwd,
    );
    expect(moved.status).toBe(0);
    // The pages no longer declare anything; the manifest does.
    expect(readFileSync(join(cwd, "docs", "install.md"), "utf8")).not.toContain(
      "eval-suite",
    );
    expect(readFileSync(join(cwd, "site.metadata.yaml"), "utf8")).toContain(
      "use: fresh-enough",
    );

    const after = manni(RUN, cwd);
    expect(after.status).toBe(1);
    expect(verdicts(after)).toEqual(verdicts(before));
  }, 60000);

  it("lists the same plan from the manifest as from the pages", () => {
    const cwd = copyOf("roundtrip");
    const before = manni(["docevals", "list", "-f", "json"], cwd);
    manni(["meta", "relocate", "--fields", "evals,eval-suite", "-s", DRAFT], cwd);
    const after = manni(["docevals", "list", "-f", "json"], cwd);
    expect(after.status).toBe(0);
    expect(after.stdout).toBe(before.stdout);
  }, 60000);
});

describe("the refusals", () => {
  it("errors on a key the page keeps after a manifest took it over", () => {
    const run = manni(["docevals", "run", "--deterministic-only"], join(FIXTURES, "collision"));
    expect(run.status).toBe(1);
    expect(run.stdout).toContain(
      'docs/install.md:4 "evals" is owned by manifest site.metadata.yaml (collection site); remove it from the document',
    );
  }, 60000);

  it("refuses a URL manifest that owns an eval key", () => {
    const run = manni(["docevals", "run", "--deterministic-only"], join(FIXTURES, "url"));
    expect(run.status).toBe(2);
    expect(run.stderr).toBe(
      "manni: manni.config.yaml: collection site: evals cannot come from a URL manifest, because docevals writes them.\n",
    );
  }, 60000);

  it("refuses a page whose collections both keep evals in a manifest", () => {
    const run = manni(
      ["docevals", "run", "--deterministic-only"],
      join(FIXTURES, "two-collections"),
    );
    expect(run.status).toBe(2);
    expect(run.stderr).toBe(
      "manni: docs/install.md is in collections site and guides, and both keep evals in a manifest.\n",
    );
  }, 60000);
});
