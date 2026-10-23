/**
 * The plugin's MCP server, `plugin/manni/hooks/graph-server.mjs`. Where the
 * project sets up collections it starts `manni graph serve --publish`, into
 * the project's own graph output when `graph:` is set and into the plugin's
 * data directory when not. Elsewhere it answers MCP itself with no tools.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");
const SERVER = join(ROOT, "plugin/manni/hooks/graph-server.mjs");
const PLUGIN_VERSION = (
  JSON.parse(readFileSync(join(ROOT, "plugin/manni/.claude-plugin/plugin.json"), "utf8")) as { version: string }
).version;

type Plan = { kind: "serve"; args: string[] } | { kind: "none" };
const { serverPlan } = (await import(pathToFileURL(SERVER).href)) as {
  serverPlan: (config: string | undefined, project: string, env: NodeJS.ProcessEnv) => Plan;
};

const PROJECT = resolve("/work/docs-site");
const hash = createHash("sha256").update(PROJECT).digest("hex").slice(0, 16);

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

describe("graph server plan", () => {
  it("serves the project's own graph where collections and graph are set up", () => {
    const config = "collections:\n  - name: site\n    paths: [docs]\ngraph:\n  output: .manni/graph\n";
    expect(serverPlan(config, PROJECT, {})).toEqual({ kind: "serve", args: ["graph", "serve", "--publish"] });
  });

  it("publishes into the plugin's data directory where only collections are set up", () => {
    const data = resolve("/plugin-data");
    expect(serverPlan("collections: []\n", PROJECT, { CLAUDE_PLUGIN_DATA: data })).toEqual({
      kind: "serve",
      args: ["graph", "serve", "--publish", "-i", join(data, "graph", hash)],
    });
  });

  it("publishes under the system temp directory without plugin data", () => {
    for (const env of [{}, { CLAUDE_PLUGIN_DATA: "" }]) {
      expect(serverPlan("collections: []\n", PROJECT, env)).toEqual({
        kind: "serve",
        args: ["graph", "serve", "--publish", "-i", join(tmpdir(), "manni", "graph", hash)],
      });
    }
  });

  it("offers nothing without collections or without a config", () => {
    expect(serverPlan("graph:\n  output: out\n", PROJECT, {})).toEqual({ kind: "none" });
    // Only top-level keys count: a nested `collections:` is some other key's.
    expect(serverPlan("lint:\n  collections: []\n", PROJECT, {})).toEqual({ kind: "none" });
    expect(serverPlan(undefined, PROJECT, {})).toEqual({ kind: "none" });
  });
});

describe("graph server with collections", () => {
  it("runs the project's manni from the project, creating the publish directory, with its exit code", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "manni-graph-server-")));
    const data = realpathSync(mkdtempSync(join(tmpdir(), "manni-plugin-data-")));
    dirs.push(dir, data);
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "docs-site", private: true }));
    writeFileSync(join(dir, "manni.config.yaml"), "collections: []\n");
    const stub = join(dir, "node_modules/@hawkeyexl/manni");
    mkdirSync(stub, { recursive: true });
    writeFileSync(join(stub, "package.json"), JSON.stringify({ name: "@hawkeyexl/manni", bin: { manni: "bin.js" } }));
    writeFileSync(
      join(stub, "bin.js"),
      "const fs = require('node:fs'); const a = process.argv.slice(2);\n" +
        "process.stdout.write(JSON.stringify({ args: a, cwd: process.cwd(), made: fs.existsSync(a[4]) }));\n" +
        "process.exitCode = 3;\n",
    );
    const r = spawnSync(process.execPath, [SERVER], {
      cwd: tmpdir(),
      input: "",
      encoding: "utf8",
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir, CLAUDE_PLUGIN_DATA: data },
    });
    const out = join(data, "graph", createHash("sha256").update(dir).digest("hex").slice(0, 16));
    expect(r.status).toBe(3);
    expect(JSON.parse(r.stdout)).toEqual({ args: ["graph", "serve", "--publish", "-i", out], cwd: dir, made: true });
  });
});

describe("graph server without collections", () => {
  it("answers MCP with no tools and exits when stdin closes", async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "manni-graph-server-")));
    dirs.push(dir);
    // A repository root, so the config walk stops here.
    writeFileSync(join(dir, ".git"), "");
    const child = spawn(process.execPath, [SERVER], {
      cwd: dir,
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c: Buffer) => (stdout += c.toString()));
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
    const exited = new Promise<number | null>((r) => child.on("exit", r));
    const send = (message: object) => child.stdin.write(`${JSON.stringify(message)}\n`);
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {} } });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    send({ jsonrpc: "2.0", id: 3, method: "ping" });
    send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "lookup" } });
    child.stdin.end();
    expect(await exited).toBe(0);

    const replies = stdout.trim().split("\n").map((l) => JSON.parse(l) as unknown);
    expect(replies).toEqual([
      {
        jsonrpc: "2.0",
        id: 1,
        result: {
          protocolVersion: "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "manni", version: PLUGIN_VERSION },
        },
      },
      { jsonrpc: "2.0", id: 2, result: { tools: [] } },
      { jsonrpc: "2.0", id: 3, result: {} },
      { jsonrpc: "2.0", id: 4, error: { code: -32601, message: "Method not found: tools/call" } },
    ]);
    expect(stderr).toBe("manni: no collections are set up here, so the graph server offers no tools.\n");
  });
});
