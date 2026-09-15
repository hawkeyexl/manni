// Plain-text transcript: titles, every typed command, the real output (ANSI stripped), captions.
const b = require("./out-location/location/beats.js");
const fs = require("node:fs");
const fps = b.FPS;
const mmss = (f) => { const s = Math.round(f / fps); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const total = (b.totalFrames / fps).toFixed(1);
let out = `Field location, demo video transcript (silent video; text describes what is on screen)\n\nFrame: 1080x1080, 30 fps, ${total} s. Every terminal line is real output of cat, git and of\n\`node dist/cli.js meta ...\` (typed as manni) run inside media/scratch-location/,\na git repository built from test/fixtures/location/relocate-create/ by\nmedia/capture-location/capture.sh.\n\n`;
let t = 0;
b.beats.forEach((beat, i) => {
  const d = b.beatDurations[i];
  out += `[${mmss(t)}-${mmss(t + d)}] Title: ${beat.title} (${i + 1} / ${b.beats.length})\n`;
  for (const c of beat.commands) {
    out += `$ ${c.typed}\n`;
    if (c.output !== "") out += strip(c.output).replace(/\n$/, "").split("\n").map((l) => {
      if (/^✓ /.test(l)) return `${l}   (green check)`;
      if (/^⚠ /.test(l)) return `${l}   (yellow warning sign)`;
      if (/warnings$/.test(l)) return `${l}   (green)`;
      if (/files? checked, .* 0 errors$/.test(l)) return `${l}   (green)`;
      if (/^\+[^+]/.test(l)) return `${l}   (green, added)`;
      if (/^-[^-]/.test(l)) return `${l}   (red, removed)`;
      return l;
    }).join("\n") + "\n";
  }
  if (beat.highlight) out += `Highlighted rows: lines containing ${beat.highlight.map((h) => JSON.stringify(h)).join(", ")}\n`;
  out += `Caption: ${beat.caption}\n\n`;
  t += d;
});
fs.writeFileSync("../field-location-1x1.transcript.txt", out);
console.log(out);
