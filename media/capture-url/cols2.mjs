import { readFileSync } from "node:fs";
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const rd = (f) => strip(readFileSync("capture-url/"+f,"utf8")).replace(/\r/g,"").replace(/\n$/,"").split("\n");
// Beats as the video will print them (prompt lines included), for the row-count check.
const beats = {
  b1: ["$ cat manni.config.yaml", ...rd("cat-manni.config.public.txt"), "$ "],
  b2: ["$ manni meta validate", ...rd("validate.ans"), "$ echo $?", "1", "$ "],
  b3: ["$ cat manni.config.yaml", ...rd("cat-manni.config.private.txt"), "$ manni meta validate", ...rd("token-unset.ans"), "$ echo $?", "2", "$ "],
  b45: ["$ manni meta validate --offline", ...rd("offline.ans"), "$ echo $?", "2", "$ "],
};
const all = Object.values(beats).flat();
const splits = (cols) => { const bad=[]; for (const l of all) for (let k=cols;k<l.length;k+=cols) if (l[k-1]!==" "&&l[k]!==" ") bad.push(l.slice(k-6,k)+"|"+l.slice(k,k+6)); return bad; };
const rows = (cols) => Object.fromEntries(Object.entries(beats).map(([k,ls])=>[k, ls.reduce((a,l)=>a+Math.max(1,Math.ceil(l.length/cols)),0)]));
for (let px = 30; px >= 16; px--) {
  const maxCols = Math.floor(1040/(0.6*px)); const lh = Math.round(px*1.375);
  const good = [];
  for (let c = maxCols; c >= 40; c--) if (splits(c).length===0) good.push(c);
  const c = good[0];
  if (c===undefined) { console.log(`px ${px}: none`); continue; }
  const r = rows(c); const maxRows = Math.max(...Object.values(r));
  console.log(`px ${px} maxCols ${maxCols} -> cols ${c} (${good.slice(0,6).join(",")}) lineH ${lh} rows ${JSON.stringify(r)} tallest ${maxRows*lh}px ${maxRows*lh<=838?"fits":"TOO TALL"}`);
}
