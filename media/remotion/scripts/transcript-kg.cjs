// Plain-text transcript: titles, every typed command, the real output, captions.
// manni kg's pretty reporters emit no ANSI at all (checked with `cat -v` on
// media/kg/capture/*.ans), so unlike the meta videos there is no colour to
// describe here — the strip below is kept only so a future capture that does
// carry colour cannot leak escape codes into the transcript.
const b = require("./out-kg/kg/beats.js");
const fs = require("node:fs");
const fps = b.FPS;
const mmss = (f) => { const s = Math.round(f / fps); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const total = (b.totalFrames / fps).toFixed(1);
let out = `manni kg, demo video transcript (silent video; text describes what is on screen)

Frame: 1080x1080, 30 fps, ${total} s. Every terminal line is real output of grep and of
\`node dist/cli.js kg ...\` (typed as manni) run inside C:\\kgdemo, a git repository
built from test/kg/fixtures/corpus/ by media/kg/capture.sh.

`;
let t = 0;
b.beats.forEach((beat, i) => {
  const d = b.beatDurations[i];
  out += `[${mmss(t)}-${mmss(t + d)}] Title: ${beat.title} (${i + 1} / ${b.beats.length})\n`;
  for (const c of beat.commands) {
    out += `$ ${c.typed}\n`;
    if (c.output !== "") out += strip(c.output).replace(/\n$/, "") + "\n";
  }
  if (beat.highlight) out += `Highlighted rows: lines containing ${beat.highlight.map((h) => JSON.stringify(h)).join(", ")}\n`;
  out += `Caption: ${beat.caption}\n\n`;
  t += d;
});
fs.writeFileSync(require("node:path").join(__dirname, "..", "..", "kg", "kg-impact-1x1.transcript.txt"), out);
console.log(out);
