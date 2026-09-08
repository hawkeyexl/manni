/**
 * The `manni` umbrella and the `docmeta` compatibility bin, against the built
 * `dist/`. The metadata tool's own commands are exercised exhaustively in
 * `cli.integration.test.ts` through the `docmeta` bin; this file pins the
 * mounting: that `manni meta …` is the same program, that the prefix on
 * stderr follows the bin that was run, and that a bare `manni validate` is a
 * usage error that says where the command went.
 */
import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const manni = resolve(root, "dist", "cli.js");
const docmeta = resolve(root, "dist", "docmeta.js");
const version = (
  JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
    version: string;
  }
).version;

interface Run {
  stdout: string;
  stderr: string;
  status: number;
}

function run(bin: string, args: string[]): Run {
  try {
    const stdout = execFileSync("node", [bin, ...args], {
      cwd: root,
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

describe("manni (built bin)", () => {
  beforeAll(() => {
    if (!existsSync(manni) || !existsSync(docmeta)) {
      execSync("npm run build", { cwd: root, stdio: "ignore" });
    }
  }, 180000);

  it("lists meta and cite as subcommands", () => {
    const r = run(manni, ["--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^Usage: manni /m);
    expect(r.stdout).toMatch(/^\s+meta\b/m);
    expect(r.stdout).toMatch(/^\s+cite\b/m);
  });

  it("mounts the citation tool under cite, with no default command", () => {
    expect(run(manni, ["cite", "check", "--help"]).stdout).toMatch(
      /^Usage: manni cite check /m,
    );
    // Proposal 0034: `cite` has verbs and nothing else, so a bare `manni cite`
    // is a usage error that shows them.
    const bare = run(manni, ["cite"]);
    expect(bare.status).toBe(2);
    expect(bare.stdout).toBe("");
    expect(bare.stderr).toMatch(/^Usage: manni cite /m);
    expect(bare.stderr).toMatch(/^\s+check\b/m);
  });

  it("lists a11y as a subcommand", () => {
    const r = run(manni, ["--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^\s+a11y\b/m);
  });

  it("shows the full path in a11y's usage line", () => {
    const r = run(manni, ["a11y", "check", "--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^Usage: manni a11y check /m);
  });

  it("with no command is a usage error that points at the subcommands", () => {
    const r = run(manni, []);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/\bmeta\b/);
  });

  it("reports the package version at the root and under meta", () => {
    expect(run(manni, ["--version"]).stdout.trim()).toBe(version);
    expect(run(manni, ["meta", "--version"]).stdout.trim()).toBe(version);
  });

  it("runs the metadata tool under meta", () => {
    const ok = run(manni, ["meta", "validate", "test/fixtures/valid.md"]);
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain("✓");

    const bad = run(manni, ["meta", "validate", "test/fixtures/missing-type.md"]);
    expect(bad.status).toBe(1);
  });

  it("keeps validate as meta's default command", () => {
    const r = run(manni, ["meta", "test/fixtures/valid.md"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("✓");
  });

  it("shows the full path in meta's usage line", () => {
    const r = run(manni, ["meta", "--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^Usage: manni meta /m);
    expect(run(manni, ["meta", "validate", "--help"]).stdout).toMatch(
      /^Usage: manni meta validate /m,
    );
  });

  it("a docmeta command given to manni directly is a usage error naming manni meta", () => {
    const r = run(manni, ["validate", "test/fixtures/valid.md"]);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("manni meta validate");
  });

  it("prefixes the tool's diagnostics with manni", () => {
    const r = run(manni, [
      "meta",
      "validate",
      "test/fixtures/valid.md",
      "--format",
      "nonsense",
    ]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/^manni: Unknown --format "nonsense"/);
  });
});

describe("docmeta (compatibility bin)", () => {
  it("is the metadata tool under its old name", () => {
    const r = run(docmeta, ["validate", "test/fixtures/valid.md"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("✓");
    expect(run(docmeta, ["test/fixtures/missing-type.md"]).status).toBe(1);
  });

  it("reports the same version", () => {
    expect(run(docmeta, ["--version"]).stdout.trim()).toBe(version);
  });

  it("keeps the docmeta usage line and stderr prefix", () => {
    expect(run(docmeta, ["--help"]).stdout).toMatch(/^Usage: docmeta /m);
    const r = run(docmeta, ["validate", "test/fixtures/valid.md", "--format", "nonsense"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/^docmeta: Unknown --format "nonsense"/);
  });

  it("does not know about the other tools", () => {
    const r = run(docmeta, ["meta", "validate", "test/fixtures/valid.md"]);
    expect(r.status).toBe(2);
  });
});
