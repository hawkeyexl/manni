// Starts the plugin's MCP server as a client would, asks one tool one question
// and prints the answer. The server's own stderr lines pass straight through.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const [tool, question] = process.argv.slice(2);
const server = spawn(process.execPath, [process.env.MANNI_GRAPH_SERVER], {
  stdio: ["pipe", "pipe", "inherit"],
  env: { ...process.env, CLAUDE_PROJECT_DIR: process.cwd() },
});
const send = (m) => server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...m })}\n`);
send({ id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-code", version: "0" } } });
createInterface({ input: server.stdout }).on("line", (line) => {
  const m = JSON.parse(line);
  if (m.id === 1) {
    send({ method: "notifications/initialized" });
    send({ id: 2, method: "tools/call", params: { name: tool, arguments: { question } } });
  } else if (m.id === 2) {
    // The tool answers in JSON. Show the best passage: where it is and what it says.
    for (const part of m.result?.content ?? []) {
      const best = JSON.parse(part.text).matches.passages[0];
      const body = best.text.split("\n").filter((l) => l !== "" && !l.startsWith("#")).join(" ");
      process.stdout.write(`${tool}: ${best.page}:${best.lines}  ${body}\n`);
    }
    server.stdin.end();
  }
});
