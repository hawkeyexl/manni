/**
 * The plugin's hook launcher, `plugin/manni/hooks/manni.mjs`: which manni a
 * hook runs. The project's own build when the project is manni, then the copy
 * the project installed, then npx as before. Stdin and the exit code pass
 * through, since the hook envelope and exit 2 are the protocol.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import pkg from "../package.json" with { type: "json" };

const ROOT = resolve(import.meta.dirname, "..");
const LAUNCHER = join(ROOT, "plugin/manni/hooks/manni.mjs");

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

function tempDir(): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), "manni-launcher-")));
  dirs.push(d);
  return d;
}

function launch(projectDir: string, args: string[], input = "", env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [LAUNCHER, ...args], {
    cwd: projectDir,
    input,
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir, ...env },
  });
}

/** A project that installed a stub manni which echoes what it was given. */
function projectWithStub(): string {
  const dir = tempDir();
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "docs-site", private: true }));
  const stub = join(dir, "node_modules/@hawkeyexl/manni");
  mkdirSync(stub, { recursive: true });
  writeFileSync(join(stub, "package.json"), JSON.stringify({ name: "@hawkeyexl/manni", bin: { manni: "bin.js" } }));
  writeFileSync(
    join(stub, "bin.js"),
    [
      "let input = '';",
      "process.stdin.on('data', (c) => { input += c; });",
      "process.stdin.on('end', () => {",
      "  process.stdout.write(JSON.stringify({ args: process.argv.slice(2), input }));",
      "  process.exitCode = 2;",
      "});",
    ].join("\n"),
  );
  return dir;
}

describe("plugin hook launcher", () => {
  it("runs manni's own build inside manni's own repository", () => {
    const r = launch(ROOT, ["--version"]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(pkg.version);
  });

  it("runs the project's installed copy, passing arguments, stdin and the exit code", () => {
    const dir = projectWithStub();
    const r = launch(dir, ["check"], '{"hook_event_name":"Stop"}');
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stdout)).toEqual({ args: ["check"], input: '{"hook_event_name":"Stop"}' });
  });

  it("finds the installed copy from a subdirectory of the project", () => {
    const dir = projectWithStub();
    const sub = join(dir, "docs/guides");
    mkdirSync(sub, { recursive: true });
    const r = launch(sub, ["status"]);
    expect(JSON.parse(r.stdout)).toMatchObject({ args: ["status"] });
  });

  it("never answers with exit 2 when no manni can be found", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "elsewhere", private: true }));
    // An empty global prefix, so npx finds no global install either.
    const r = launch(dir, ["check"], "", { npm_config_prefix: tempDir() });
    expect(r.status).not.toBe(2);
    expect(r.stdout).toBe("");
  });
});
