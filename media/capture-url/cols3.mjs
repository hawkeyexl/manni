import { readFileSync } from "node:fs";
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const rd = (f) => strip(readFileSync("capture-url/"+f,"utf8")).replace(/\r/g,"").replace(/\n$/,"").split("\n");
const beats = {
  b1: ["$ cat manni.config.yaml", ...rd("cat-manni.config.public.txt"), "$ "],
  b2: ["$ manni meta validate", ...rd("validate.ans"), "$ echo $?", "1", "$ "],
  b3: ["$ cat manni.config.yaml", ...rd("cat-manni.config.private.txt"), "$ manni meta validate", ...rd("token-unset.ans"), "$ echo $?", "2", "$ "],
  b45: ["$ manni meta validate --offline", ...rd("offline.ans"), "$ echo $?", "2", "$ "],
};
// Word wrap: break at the last space at or before `cols`; continuation rows take the line's own indent.
function wrap(line, cols) {
  const indent = line.match(/^ */)[0];
  const rows = []; let rest = line; let first = true;
  while (rest.length > cols) {
    const body = first ? rest : rest;
    let k = body.lastIndexOf(" ", cols);
    if (k <= indent.length) return null; // an unbreakable token wider than the column: reject
    rows.push(body.slice(0, k).replace(/ +$/,""));
    rest = indent + body.slice(k + 1); first = false;
  }
  rows.push(rest); return rows;
}
for (let px = 30; px >= 16; px--) {
  const cols = Math.floor(1040/(0.6*px)); const lh = Math.round(px*1.4);
  let ok = true; const r = {};
  for (const [k, ls] of Object.entries(beats)) { let n = 0; for (const l of ls) { const w = wrap(l, cols); if (!w) { ok = false; break; } n += w.length; } r[k] = n; }
  const tallest = Math.max(...Object.values(r)) * lh;
  console.log(`px ${px} cols ${cols} lineH ${lh} ${ok ? "wraps OK" : "token too wide"} rows ${JSON.stringify(r)} tallest ${tallest}px ${tallest <= 838 ? "fits" : "TOO TALL"}`);
}
console.log("\n--- sample at the chosen size (px 22):");
for (const l of [...rd("validate.ans"), ...rd("token-unset.ans"), ...rd("offline.ans")]) for (const w of wrap(l, Math.floor(1040/(0.6*22)))) console.log("|" + w);
