// Turn the pseudo-terminal bytes of the Vale run into the screen they draw.
// ConPTY re-renders a program's output: it homes the cursor, clears the screen,
// sets the window title and moves the cursor with CSI row;col H and CSI n C
// instead of printing blank lines and spaces. This applies those moves to a
// grid, keeps every SGR (colour) sequence where it landed, and drops the
// sequences that draw nothing (mode switches, cursor visibility, the title).
//
// It then checks the result against the plain run, which Vale printed to a
// pipe without colour: with the SGR removed, the two must be the same text,
// line for line, ignoring trailing spaces. The capture fails if they differ.
//
//   node capture-term/pty-screen.mjs      (from media/)
import { readFileSync, writeFileSync } from "node:fs";

const dir = new URL(".", import.meta.url);
const raw = readFileSync(new URL("vale-pty.raw", dir), "latin1");
const bytes = Buffer.from(raw, "latin1").toString("utf8");

const rows = [];
let row = 0;
const line = () => (rows[row] ??= "");
let i = 0;
while (i < bytes.length) {
  const rest = bytes.slice(i);
  let m;
  if ((m = /^\x1b\](?:[^\x07\x1b]*)(?:\x07|\x1b\\)/.exec(rest))) {
    // OSC: window title. Draws nothing.
  } else if ((m = /^\x1b\[(\d*)(?:;(\d*))?H/.exec(rest))) {
    row = Number(m[1] || "1") - 1;
    line();
  } else if ((m = /^\x1b\[(\d*)C/.exec(rest))) {
    // A cursor move skips cells without painting them, so the skipped cells
    // take no attribute set just before the move: the spaces go ahead of it.
    const cur = line();
    const pending = /(?:\x1b\[[0-9;]*m)+$/.exec(cur);
    const at = pending === null ? cur.length : pending.index;
    rows[row] = cur.slice(0, at) + " ".repeat(Number(m[1] || "1")) + cur.slice(at);
  } else if ((m = /^\x1b\[[0-9;]*m/.exec(rest))) {
    rows[row] = line() + m[0];
  } else if ((m = /^\x1b\[[?0-9;]*[A-Za-z]/.exec(rest))) {
    // Modes, cursor visibility, screen clear: draw nothing on a fresh screen.
  } else if ((m = /^\r?\n/.exec(rest))) {
    row += 1;
    line();
  } else if ((m = /^\r/.exec(rest))) {
    // Carriage return before a CUP or LF: column is carried by the row string.
  } else {
    m = [rest[0]];
    rows[row] = line() + rest[0];
  }
  i += m[0].length;
}

const screen = rows.map((r) => r ?? "");
while (screen.length > 0 && screen[screen.length - 1].replace(/\x1b\[[0-9;]*m/g, "").trim() === "") screen.pop();
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "").replace(/\s+$/, "");
const plain = readFileSync(new URL("vale-plain.ans", dir), "utf8").replace(/\r\n/g, "\n").replace(/\n+$/, "").split("\n");
const a = screen.map(strip);
const b = plain.map(strip);
if (a.length !== b.length || a.some((l, k) => l !== b[k])) {
  console.error("pty screen and plain run differ:");
  for (let k = 0; k < Math.max(a.length, b.length); k++) if (a[k] !== b[k]) console.error(`${k + 1}\n  pty:   ${JSON.stringify(a[k])}\n  plain: ${JSON.stringify(b[k])}`);
  process.exit(1);
}
writeFileSync(new URL("vale.ans", dir), screen.join("\n") + "\n");
console.log(`wrote vale.ans: ${screen.length} lines, text identical to the plain run`);
