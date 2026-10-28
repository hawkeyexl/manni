// Plain-text transcript: titles, every typed command, the real output (ANSI stripped), captions.
const b = require("./out-docevals-formats/docevals-formats/beats.js");
const fs = require("node:fs");
const fps = b.FPS;
const mmss = (f) => { const s = Math.round(f / fps); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const total = (b.totalFrames / fps).toFixed(1);
let out = `manni docevals grades every format manni's metadata tool reads, demo video transcript (silent video; text describes what is on screen)

Frame: 1080x1080, 30 fps, ${total} s. Every terminal line is real output of ls, grep, cat and of
\`node dist/cli.js ...\` (typed as manni) run in C:\\formats, a directory junction to media/scratch-docevals-formats/,
a git repository holding test/docevals/fixtures/formats/ as committed, built by media/capture-docevals-formats/capture.sh.

`;
let t = 0;
b.beats.forEach((beat, i) => {
  const d = b.beatDurations[i];
  out += `[${mmss(t)}-${mmss(t + d)}] Title: ${beat.title} (${i + 1} / ${b.beats.length})\n`;
  for (const c of beat.commands) {
    out += `$ ${c.typed}\n`;
    const all = c.output + (c.more ?? []).map((m) => m.output).join("");
    if (all !== "") out += strip(all).replace(/\n$/, "").split("\n").map((raw) => {
      const l = raw.replace(/ +$/, "");
      if (/^ *FAIL /.test(l)) return `${l}   ("FAIL" in red, manifest path dimmed)`;
      if (/^ *error:/.test(l)) return `${l}   ("error" in red, rule id dimmed)`;
      if (/no-todo: The page|Guide: /.test(l)) return `${l}   (dimmed)`;
      if (/below target/.test(l)) return `${l}   ("below target" in red)`;
      if (/^Content\/[a-z]+\.[a-z]+$/.test(l) || l === "Suites") return `${l}   (bold)`;
      return l;
    }).join("\n") + "\n";
  }
  if (beat.highlight) out += `Highlighted rows: lines containing ${beat.highlight.map((h) => JSON.stringify(h)).join(", ")}\n`;
  out += `Caption: ${beat.caption}\n\n`;
  t += d;
});
fs.writeFileSync("../docevals-formats-1x1.transcript.txt", out);
console.log(out);
