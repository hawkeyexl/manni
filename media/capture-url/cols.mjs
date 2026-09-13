// Font-size derivation (design.md "Capture geometry"): columns = floor(1040 / (0.6 * px)).
// A line longer than the column count hard-wraps like a terminal. Accept a size only if
// every wrap point falls on a space, so no token is split (design.md check 2).
import { readFileSync } from "node:fs";
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const files = ["validate.ans","token-unset.ans","offline.ans","cat-manni.config.public.txt","cat-manni.config.private.txt"];
const lines = [];
for (const f of files) for (const l of strip(readFileSync("capture-url/"+f,"utf8")).replace(/\r/g,"").split("\n")) lines.push(l);
for (const t of ["$ cat manni.config.yaml","$ manni meta validate","$ manni meta validate --offline","$ echo $?"]) lines.push(t);
const longest = Math.max(...lines.map(l=>l.length));
console.log("longest visible line:", longest);
for (let px = 30; px >= 14; px--) {
  const cols = Math.floor(1040 / (0.6 * px));
  const bad = [];
  let rows = 0;
  for (const l of lines) {
    rows += Math.max(1, Math.ceil(l.length / cols));
    for (let k = cols; k < l.length; k += cols) {
      if (l[k-1] !== " " && l[k] !== " ") bad.push(`"${l.slice(k-8,k)}|${l.slice(k,k+8)}"`);
    }
  }
  console.log(`px ${px} cols ${cols} lineH ${Math.round(px*1.375)} ${bad.length===0?"OK":"split: "+bad.slice(0,3).join(" ")}`);
}
