/**
 * Proposal 0070's ladder against the built `manni` bin: what a person types
 * and reads, exit codes included. The command cores are pinned case by case
 * in `defaults-register.test.ts`; this file checks the rungs end to end.
 */
import { execSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const manni = resolve(root, "dist", "cli.js");
const DEFAULTS = resolve(here, "fixtures", "defaults");
const REGISTER = resolve(here, "fixtures", "register");

interface Run {
  stdout: string;
  stderr: string;
  status: number;
}

function run(args: string[], cwd: string): Run {
  // spawnSync rather than execFileSync: a passing run's stderr (a warning)
  // is part of what some rungs assert.
  const r = spawnSync("node", [manni, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NO_COLOR: "1" },
  });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status ?? 1 };
}

describe("manni meta validate, proposal 0070's ladder (built bin)", () => {
  beforeAll(() => {
    if (!existsSync(manni)) execSync("npm run build", { cwd: root, stdio: "ignore" });
  }, 180000);

  let tmp: string | undefined;
  afterEach(() => {
    if (tmp !== undefined) rmSync(tmp, { recursive: true, force: true });
    tmp = undefined;
  });

  it("1. a page with a title and a description passes the default set", () => {
    const r = run(["meta", "validate", "page.md", "--no-config"], DEFAULTS);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("✓ page.md");
  });

  it("2. a page with no description fails on core", () => {
    const r = run(["meta", "validate", "no-description.md", "--no-config"], DEFAULTS);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("(root)  must have required property 'description'  (line 1)  [manni:core:1.0.0]");
  });

  it("8. a registered schema and its strict version judge through the config", () => {
    const r = run(["meta", "validate", "good.md", "loose-team.md", "-f", "json"], REGISTER);
    expect(r.status).toBe(1);
    const report = JSON.parse(r.stdout) as { results: { file: string; ok: boolean; schemas: string[] }[] };
    const good = report.results.find((x) => x.file === "good.md");
    expect(good?.ok).toBe(true);
    expect(good?.schemas).toContain("house:page-strict:1.0.0");
    expect(report.results.find((x) => x.file === "loose-team.md")?.ok).toBe(false);
  });

  it("8. -s house:page:1.0.0 resolves through the config", () => {
    const r = run(["meta", "validate", "good.md", "-s", "house:page:1.0.0"], REGISTER);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("✓ good.md");
  });

  it("9. -s house:page:1.0.0 --no-config is an unknown schema, exit 2", () => {
    const r = run(["meta", "validate", "good.md", "-s", "house:page:1.0.0", "--no-config"], REGISTER);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('Unknown schema "house:page:1.0.0". manni meta schemas lists the built-in ids.');
    expect(r.stderr).toContain("Registered by meta.register: none.");
  });

  it("manni meta schemas warns on a broken config and still lists the built-ins", () => {
    tmp = realpathSync(mkdtempSync(join(tmpdir(), "manni-0070-cli-")));
    writeFileSync(join(tmp, "manni.config.yaml"), "meta:\n  defaults: maybe\n", "utf8");
    const r = run(["meta", "schemas"], tmp);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("google:okf:0.1");
    expect(r.stderr).toContain(
      "manni.config.yaml: meta.defaults must be true or false. Registered schemas are not listed.",
    );
  });

  it("10. defaults: maybe is a config error, exit 2", () => {
    tmp = realpathSync(mkdtempSync(join(tmpdir(), "manni-0070-cli-")));
    writeFileSync(join(tmp, "manni.config.yaml"), "meta:\n  defaults: maybe\n", "utf8");
    writeFileSync(join(tmp, "page.md"), "---\ntype: guide\ntitle: t\ndescription: d\n---\n", "utf8");
    const r = run(["meta", "validate", "page.md"], tmp);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("manni.config.yaml: meta.defaults must be true or false.");
  });
});

describe("manni meta schemas lists registered schemas (built bin)", () => {
  beforeAll(() => {
    if (!existsSync(manni)) execSync("npm run build", { cwd: root, stdio: "ignore" });
  }, 180000);

  it("prints a Registered section naming each id and its file", () => {
    const r = run(["meta", "schemas"], REGISTER);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Registered schemas:");
    expect(r.stdout).toContain("house:page:1.0.0  —  schemas/house-page.json");
    expect(r.stdout).toContain("house:page-strict:1.0.0  —  schemas/house-page-strict.json");
  });

  it("adds a registered array of {id, file} to the JSON", () => {
    const r = run(["meta", "schemas", "-f", "json"], REGISTER);
    expect(r.status).toBe(0);
    const info = JSON.parse(r.stdout) as { registered: { id: string; file: string }[] };
    expect(info.registered).toEqual([
      { id: "house:page-strict:1.0.0", file: "schemas/house-page-strict.json" },
      { id: "house:page:1.0.0", file: "schemas/house-page.json" },
    ]);
  });
});
