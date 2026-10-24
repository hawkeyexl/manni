/**
 * The plugin's hook launcher, `plugin/manni/hooks/manni.mjs`: which manni a
 * hook runs. The project's own build when the project is manni, then the copy
 * the project installed, then npx as before. Stdin and the exit code pass
 * through, since the hook envelope and exit 2 are the protocol. And its gate,
 * `plugin/manni/hooks/tracevals.mjs`, which runs manni the same way for a
 * user who turned tracevals on, and nothing otherwise.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import pkg from "../package.json" with { type: "json" };

const ROOT = resolve(import.meta.dirname, "..");
const LAUNCHER = join(ROOT, "plugin/manni/hooks/manni.mjs");
const TRACEVALS = join(ROOT, "plugin/manni/hooks/tracevals.mjs");
// A developer's shell may set either, so every case below says which it means.
const TRACEVALS_VARS = ["manni_tracevals_hooks", "claude_plugin_option_tracevals"];
const PLUGIN_SPEC = `@hawkeyexl/manni@${
  (JSON.parse(readFileSync(join(ROOT, "plugin/manni/.claude-plugin/plugin.json"), "utf8")) as { version: string }).version
}`;

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

function launch(projectDir: string, args: string[], input = "", env: NodeJS.ProcessEnv = {}, script = LAUNCHER) {
  // Windows names are case-insensitive, and npm run exports NPM_CONFIG_*
  // in capitals, so an override must replace the inherited name, not sit
  // beside it.
  const overridden = new Set([...Object.keys(env).map((k) => k.toLowerCase()), ...TRACEVALS_VARS]);
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !overridden.has(k.toLowerCase())),
  );
  return spawnSync(process.execPath, [script, ...args], {
    cwd: projectDir,
    input,
    encoding: "utf8",
    env: { ...inherited, CLAUDE_PROJECT_DIR: projectDir, ...env },
  });
}

/**
 * Imports `module` in a fresh node with tracevals on, and prints `print`
 * about its exports `m`. A launch would print to stdout too.
 */
function importIn(dir: string, module: string, print: string) {
  const script = `const m = await import(${JSON.stringify(pathToFileURL(module).href)}); console.log(${print});`;
  return spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: dir,
    input: "",
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir, CLAUDE_PLUGIN_OPTION_TRACEVALS: "true" },
  });
}

/**
 * A project that installed a stub manni which echoes what it was given,
 * with `MANNI_TRACEVALS_HOOKS` as `hooks` where it is set.
 */
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
      "  process.stdout.write(JSON.stringify({ args: process.argv.slice(2), input, hooks: process.env.MANNI_TRACEVALS_HOOKS }));",
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

  // npm pointed at a registry nothing listens on, with an empty cache and
  // global prefix, so no test ever reaches the network or a real install.
  // The fetch case does open a loopback connection to port 9 (discard), and
  // reads the refusal as proof that npx was asked to download. No retries
  // and a 2s fetch timeout bound it if something there accepts instead.
  // npm run exports npm_config_global_prefix, which `npm root -g` prefers
  // over npm_config_prefix, so both name the same empty directory.
  const offline = (prefix = tempDir()): NodeJS.ProcessEnv => ({
    npm_config_prefix: prefix,
    npm_config_global_prefix: prefix,
    npm_config_cache: tempDir(),
    npm_config_registry: "http://127.0.0.1:9/",
    npm_config_fetch_retries: "0",
    npm_config_fetch_timeout: "2000",
  });

  it("touches no registry and exits quietly where manni is not set up or installed", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "elsewhere", private: true }));
    const r = launch(dir, ["check"], "", offline());
    expect(r).toMatchObject({ status: 0, stdout: "", stderr: "" });
  });

  it("runs a global install, found without asking the registry", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "elsewhere", private: true }));
    const env = offline();
    const prefix = env.npm_config_prefix ?? "";
    // Where `npm root -g` puts global packages for that prefix.
    const root = process.platform === "win32" ? join(prefix, "node_modules") : join(prefix, "lib/node_modules");
    const stub = join(root, "@hawkeyexl/manni");
    mkdirSync(stub, { recursive: true });
    writeFileSync(join(stub, "package.json"), JSON.stringify({ name: "@hawkeyexl/manni", bin: { manni: "bin.js" } }));
    writeFileSync(join(stub, "bin.js"), "process.stdout.write(JSON.stringify(process.argv.slice(2)));");
    const r = launch(dir, ["tracevals", "capture"], "", env);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual(["tracevals", "capture"]);
  });

  it("fetches the plugin's own version where manni is set up but not installed", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "docs-site", private: true }));
    writeFileSync(join(dir, "manni.config.yaml"), "collections:\n  - name: site\n    paths: [\"docs/**/*.md\"]\n");
    // A skill passes the agent's own paths, which may hold a space.
    const r = launch(dir, ["check", "docs/my page.md"], "", { ...offline(), npm_config_loglevel: "silly" });
    expect(r.status).not.toBe(2);
    expect(r.stderr).toMatch(/127\.0\.0\.1|ECONNREFUSED/);
    // npm logs its argv one quoted word at a time: the pinned spec, and the
    // path as one argument rather than split at the space.
    const argv = /npm verbose argv (.*)/.exec(r.stderr)?.[1] ?? "";
    expect(argv).toContain(`"${PLUGIN_SPEC}" "check" "docs/my page.md"`);
  });

  // The graph server imports the launcher for its functions, not its run.
  it("launches nothing when imported", () => {
    const r = importIn(projectWithStub(), LAUNCHER, "typeof m.launch, typeof m.configFile, typeof m.run");
    expect(r).toMatchObject({ status: 0, stdout: "function function function\n", stderr: "" });
  });

  it("launches nothing when the tracevals gate is imported, even with tracevals on", () => {
    const r = importIn(projectWithStub(), TRACEVALS, "Object.keys(m).length");
    expect(r).toMatchObject({ status: 0, stdout: "0\n", stderr: "" });
  });

  it("hands manni MANNI_TRACEVALS_HOOKS=1 where the plugin's tracevals option is on", () => {
    const dir = projectWithStub();
    const on = launch(dir, ["check"], "", { CLAUDE_PLUGIN_OPTION_TRACEVALS: "true" });
    expect(JSON.parse(on.stdout)).toMatchObject({ args: ["check"], hooks: "1" });
    const off = launch(dir, ["check"], "", { CLAUDE_PLUGIN_OPTION_TRACEVALS: "false" });
    expect(JSON.parse(off.stdout)).not.toHaveProperty("hooks");
  });

  describe("the tracevals gate", () => {
    const gate = (dir: string, env: NodeJS.ProcessEnv) =>
      launch(dir, ["tracevals", "capture"], '{"hook_event_name":"SessionStart"}', env, TRACEVALS);

    it("starts no manni and exits quietly where tracevals is off", () => {
      expect(gate(projectWithStub(), {})).toMatchObject({ status: 0, stdout: "", stderr: "" });
    });

    it("starts no manni where the plugin's option is false", () => {
      const r = gate(projectWithStub(), { CLAUDE_PLUGIN_OPTION_TRACEVALS: "false" });
      expect(r).toMatchObject({ status: 0, stdout: "", stderr: "" });
    });

    it("runs manni with its arguments, stdin and exit code where the plugin's option is on", () => {
      const r = gate(projectWithStub(), { CLAUDE_PLUGIN_OPTION_TRACEVALS: "true" });
      expect(r.status).toBe(2);
      expect(JSON.parse(r.stdout)).toEqual({
        args: ["tracevals", "capture"],
        input: '{"hook_event_name":"SessionStart"}',
        hooks: "1",
      });
    });

    it("runs manni where MANNI_TRACEVALS_HOOKS=1 alone turns it on", () => {
      const r = gate(projectWithStub(), { MANNI_TRACEVALS_HOOKS: "1" });
      expect(r.status).toBe(2);
      expect(JSON.parse(r.stdout)).toMatchObject({ args: ["tracevals", "capture"], hooks: "1" });
    });
  });

  it("runs nothing in manni's own repository before it is built", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "@hawkeyexl/manni", bin: { manni: "dist/cli.js" } }));
    writeFileSync(join(dir, "manni.config.yaml"), "collections: []\n");
    // Not the published release over the checkout's own code: nothing at all.
    const r = launch(dir, ["check"], "", offline());
    expect(r).toMatchObject({ status: 0, stdout: "", stderr: "" });
  });
});
