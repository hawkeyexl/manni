// Plain-text transcript: titles, every typed command, the real output (ANSI stripped), captions.
const b = require("./out-join/join/beats.js");
const fs = require("node:fs");
const fps = b.FPS;
const mmss = (f) => { const s = Math.round(f / fps); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const total = (b.totalFrames / fps).toFixed(1);
let out = `Sidecar join by frontmatter field, demo video transcript (silent video; text describes what is on screen)\n\nFrame: 1080x1080, 30 fps, ${total} s. Every terminal line is real output of\n\`node dist/cli.js meta ...\` run inside media/scratch-join/, a copy of\ntest/fixtures/sidecars-join/ with docs/auth.md renamed on camera.\n\n`;
let t = 0;
b.beats.forEach((beat, i) => {
  const d = b.beatDurations[i];
  out += `[${mmss(t)}-${mmss(t + d)}] Title: ${beat.title} (${i + 1} / ${b.beats.length})\n`;
  if (beat.continues) out += "(same screen as the previous step)\n";
  for (const c of beat.commands) {
    out += `$ ${c.typed}\n`;
    if (c.output !== "") out += strip(c.output).replace(/\n$/, "").split("\n").map((l) => {
      if (/^✓ /.test(l)) return `${l}   (green check)`;
      if (/^✗ /.test(l)) return `${l}   (red cross)`;
      if (/files checked/.test(l)) return `${l}   (red)`;
      return l;
    }).join("\n") + "\n";
  }
  if (beat.highlight) out += `Highlighted rows: lines containing ${beat.highlight.map((h) => JSON.stringify(h)).join(", ")}\n`;
  out += `Caption: ${beat.caption}\n\n`;
  t += d;
});
fs.writeFileSync("../sidecar-join-1x1.transcript.txt", out);
console.log(out);
