/**
 * `manni term fill` against the built `dist/cli.js`: the ladder's offline and
 * scripting rungs, and every usage error with its exact stderr line and exit
 * code. No rung reaches a model: each is `--offline`, or names a provider
 * whose key the environment withholds.
 */
import { execSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const manni = resolve(root, "dist", "cli.js");
const FIXTURE = resolve(root, "test", "fixtures", "term", "fill", "basic");

let work: string;

function fill(args: string[], env: Record<string, string> = {}): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [manni, "term", "fill", ...args], {
    cwd: work,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", ...env },
  });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status ?? 1 };
}

beforeAll(() => {
  if (!existsSync(manni)) execSync("npm run build", { cwd: root, stdio: "ignore" });
}, 180000);

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "manni-term-fill-cli-"));
  cpSync(FIXTURE, work, { recursive: true });
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

describe("manni term fill", () => {
  it("--offline creates stub pages and exits 0", () => {
    const r = fill(["--offline"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(
      [
        "created docs/glossary/backoff.md   Backoff   definition from graph: block",
        "created docs/glossary/retry.md     Retry     stub, no definition",
        "created docs/glossary/errors.md    Errors    stub, no definition",
        "3 terms created, 0 filled, 2 left without a definition",
        "",
      ].join("\n"),
    );
    expect(readFileSync(join(work, "docs/glossary/retry.md"), "utf8")).toContain("broader:\n  - Errors\n");
  });

  it("--dry-run -f json reports and writes nothing", () => {
    const r = fill(["--offline", "--dry-run", "-f", "json"]);
    expect(r.status).toBe(0);
    const report = JSON.parse(r.stdout) as { entries: unknown[]; summary: unknown };
    expect(report.entries[0]).toEqual({
      action: "create",
      file: "docs/glossary/backoff.md",
      id: "backoff",
      label: "Backoff",
      language: "en",
      source: "metadata",
      from: ["docs/api/payments.md:7", "docs/api/retries.md:11"],
      definition: { status: "carried" },
    });
    expect(report.summary).toEqual({ created: 3, filled: 0, skipped: 0, withoutDefinition: 2, turns: 0 });
    expect(existsSync(join(work, "docs/glossary/backoff.md"))).toBe(false);
  });

  it("warns once when no provider resolves, and writes stubs", () => {
    writeFileSync(join(work, "manni.config.yaml"), `${readFileSync(join(work, "manni.config.yaml"), "utf8")}term:\n  provider: anthropic\n`);
    const r = fill(["--dry-run"], { ANTHROPIC_API_KEY: "" });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe(
      "manni: no model provider is configured, so new terms have no definition; pass --provider or --offline.\n",
    );
    expect(r.stdout).toContain("3 terms would be created");
  });

  it.each([
    [["--crawl", "--offline"], "manni: --crawl asks a model to find terms, so it cannot run with --offline.\n"],
    [["docs/api", "--offline"], "manni: new term pages need a directory; pass -o or set term.fill.out.\n"],
    [["--confidence", "2"], "manni: --confidence must be a number between 0 and 1, got 2.\n"],
    [["-f", "csv"], 'manni: unknown format "csv". Expected pretty | json.\n'],
  ])("exits 2 for %j", (args, stderr) => {
    const r = fill(args);
    expect(r.status).toBe(2);
    expect(r.stderr).toBe(stderr);
  });

  it("exits 2 for --crawl when no provider resolves", () => {
    writeFileSync(join(work, "manni.config.yaml"), `${readFileSync(join(work, "manni.config.yaml"), "utf8")}term:\n  provider: anthropic\n`);
    const r = fill(["--crawl"], { ANTHROPIC_API_KEY: "" });
    expect(r.status).toBe(2);
    expect(r.stderr).toBe("manni: --crawl needs a model, and no provider is configured; pass --provider or set providers:.\n");
  });
});
