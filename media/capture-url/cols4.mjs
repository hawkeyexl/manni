import { readFileSync } from "node:fs";
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const rd = (f) => strip(readFileSync("capture-url/"+f,"utf8")).replace(/\r/g,"").replace(/\n$/,"").split("\n");
function wrap(line, cols) { const indent = line.match(/^ */)[0]; const rows = []; let rest = line;
  while (rest.length > cols) { let k = rest.lastIndexOf(" ", cols); if (k <= indent.length) return null; rows.push(rest.slice(0, k).replace(/ +$/,"")); rest = indent + rest.slice(k + 1); }
  rows.push(rest); return rows; }
const lines = [...rd("validate.ans"), ...rd("token-unset.ans"), ...rd("offline.ans")].filter(l => l.length > 60);
for (const cols of [75, 72, 69, 66]) { console.log(`\n=== cols ${cols}`); for (const l of lines) { for (const w of wrap(l, cols)) console.log(`|${w}`); console.log("-"); } }
