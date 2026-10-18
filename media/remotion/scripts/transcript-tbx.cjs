// Plain-text transcript: titles, every typed command, the real output (ANSI stripped), captions.
const b = require("./out-tbx/tbx/beats.js");
const fs = require("node:fs");
const fps = b.FPS;
const mmss = (f) => { const s = Math.round(f / fps); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const total = (b.totalFrames / fps).toFixed(1);
let out = `manni term and TBX, demo video transcript (silent video; text describes what is on screen)\n\nFrame: 1080x1080, 30 fps, ${total} s. Every terminal line is real output of grep, cmp, echo and of\n\`node dist/cli.js term ...\` (typed as manni) run inside media/scratch-tbx/,\na git repository holding test/fixtures/term/readers/tbx/tbx-basic-v3.tbx as glossary.tbx,\nbuilt by media/capture-tbx/capture.sh.\n\n`;
let t = 0;
b.beats.forEach((beat, i) => {
  const d = b.beatDurations[i];
  out += `[${mmss(t)}-${mmss(t + d)}] Title: ${beat.title} (${i + 1} / ${b.beats.length})\n`;
  for (const c of beat.commands) {
    out += `$ ${c.typed}\n`;
    if (c.output !== "") out += strip(c.output).replace(/\n$/, "").split("\n").map((raw) => {
      const l = raw.replace(/ +$/, "");
      if (/^  notice /.test(l)) return `${l}   ("notice" in cyan)`;
      if (/^glossary\.tbx:\d+$/.test(l) || /^progressive lens /.test(l)) return `${l}   (bold${/:15$/.test(l) && /^progressive/.test(l) ? ", location dimmed" : ""})`;
      return l;
    }).join("\n") + "\n";
  }
  if (beat.highlight) out += `Highlighted rows: lines containing ${beat.highlight.map((h) => JSON.stringify(h)).join(", ")}\n`;
  out += `Caption: ${beat.caption}\n\n`;
  t += d;
});
fs.writeFileSync("../term-tbx-1x1.transcript.txt", out);
console.log(out);
