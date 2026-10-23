// The plugin's MCP server, registered in ../.mcp.json.
//
// Where the project sets up `collections:`, it runs `manni graph serve
// --publish` with stdio passed straight through, so manni speaks MCP to the
// client. With `graph:` set too, manni publishes into the project's own graph
// output. Without it, into a directory of the plugin's data kept per project.
//
// Elsewhere there is no graph to serve, and it answers MCP itself with no
// tools, so the client sees a server that is up and empty, not one that
// failed to start.
//
// Plain ESM with no dependencies: the plugin ships as files, not a package.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { configFile, isMain, launch, pluginVersion, project } from "./manni.mjs";

/**
 * What to run for a project whose config text is `config` (`undefined` with
 * no config): `{ kind: "serve", args }` for manni's arguments, or
 * `{ kind: "none" }` for the zero-tool server.
 */
export function serverPlan(config, projectDir, env) {
  // ponytail: top-level block keys only; a flow-style config (`{collections: [...]}`)
  // reads as unset. Parse the YAML if one ever turns up.
  if (config === undefined || !/^collections\s*:/m.test(config)) return { kind: "none" };
  const args = ["graph", "serve", "--publish"];
  if (/^graph\s*:/m.test(config)) return { kind: "serve", args };
  const hash = createHash("sha256").update(projectDir).digest("hex").slice(0, 16);
  const base = env.CLAUDE_PLUGIN_DATA ? env.CLAUDE_PLUGIN_DATA : join(tmpdir(), "manni");
  return { kind: "serve", args: [...args, "-i", join(base, "graph", hash)] };
}

/** Answers MCP over newline-delimited JSON-RPC with no tools, until stdin closes. */
function serveNothing(reason) {
  process.stderr.write(`manni: ${reason}, so the graph server offers no tools.\n`);
  const reply = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
  const lines = createInterface({ input: process.stdin });
  lines.on("line", (line) => {
    if (line.trim() === "") return;
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      reply({ id: null, error: { code: -32700, message: "Parse error" } });
      return;
    }
    // A notification has no id and gets no answer.
    if (request?.id === undefined || request.id === null) return;
    const { id, method } = request;
    if (method === "initialize") {
      reply({
        id,
        result: {
          // A server answers with the client's version when it supports it. With no
          // tools there is nothing to differ between versions, so this one supports
          // any, and names its own only when the client named none.
          protocolVersion: request.params?.protocolVersion ?? "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "manni", version: pluginVersion() },
        },
      });
    } else if (method === "tools/list") reply({ id, result: { tools: [] } });
    else if (method === "ping") reply({ id, result: {} });
    else reply({ id, error: { code: -32601, message: `Method not found: ${method}` } });
  });
  // Nothing else holds the event loop, so the process ends once stdout drains.
  lines.on("close", () => {
    process.exitCode = 0;
  });
}

if (isMain(import.meta.url)) {
  const file = configFile();
  const plan = serverPlan(file === undefined ? undefined : readFileSync(file, "utf8"), project, process.env);
  if (plan.kind === "none") serveNothing("no collections are set up here");
  else {
    const i = plan.args.indexOf("-i");
    const dir = i === -1 ? undefined : plan.args[i + 1];
    if (dir !== undefined) mkdirSync(dir, { recursive: true });
    const child = launch(plan.args, { stdio: "inherit", cwd: project });
    // Only manni's own checkout, before it is built, has no manni to run.
    if (child === undefined) serveNothing("this checkout of manni is not built; run npm run build");
    else {
      child.on("error", () => {
        process.exitCode = 1;
      });
      child.on("exit", (code) => {
        process.exitCode = code ?? 1;
      });
    }
  }
}
