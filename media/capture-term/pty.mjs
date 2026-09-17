// Record what a real terminal receives from a command that decides colour by
// isatty and offers no flag to force it (Vale). ttyd runs the command in a
// pseudo-terminal (ConPTY on Windows), 200 columns wide so the terminal wraps
// nothing. This client saves every output byte ttyd relays, verbatim.
//
//   node capture-term/pty.mjs <out.raw> "<command>"     (cwd: the demo repository)
//
// The command runs under Git's bash and is followed by `sleep 1`, so the
// session stays open until ConPTY has flushed the last frame.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const [out, command] = process.argv.slice(2);
if (out === undefined || command === undefined) throw new Error("usage: pty.mjs <out.raw> <command>");
const port = 7700 + Math.floor(Math.random() * 200);
const bash = "C:\\Program Files\\Git\\usr\\bin\\bash.exe";
const ttyd = spawn("ttyd", ["-p", String(port), "-o", bash, "-c", `${command}; sleep 1`], { stdio: "ignore" });

await new Promise((r) => setTimeout(r, 1500));
const chunks = [];
const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, ["tty"]);
ws.binaryType = "arraybuffer";
ws.onopen = () => ws.send(JSON.stringify({ AuthToken: "", columns: 200, rows: 50 }));
ws.onmessage = (event) => {
  const data = new Uint8Array(event.data);
  if (data[0] === 0x30) chunks.push(Buffer.from(data.subarray(1)));
};
ws.onclose = () => {
  const bytes = Buffer.concat(chunks);
  writeFileSync(out, bytes);
  console.log(`wrote ${out} (${bytes.length} bytes)`);
  ttyd.kill();
};
