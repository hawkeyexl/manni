// Plain-text transcript: titles, every typed command, the real output, captions.
// manni graph's pretty reporters emit no ANSI at all (checked with `cat -v` on
// media/graph/capture-formats/*.ans), so there is no colour to describe here; the
// strip below only keeps a future capture that carries colour from leaking escapes.
const b = require("./out-graph-formats/graph-formats/beats.js");
const fs = require("node:fs");
const fps = b.FPS;
const mmss = (f) => { const s = Math.round(f / fps); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const total = (b.totalFrames / fps).toFixed(1);
let out = `manni graph reads every format, demo video transcript (silent video; text describes what is on screen)

Frame: 1080x1080, 30 fps, ${total} s. Every terminal line is real output of
\`node dist/cli.js graph ...\` (typed as manni) run inside media/scratch-formats, a git repository
holding test/graph/fixtures/formats/ byte for byte, staged by media/graph/graph-formats-capture.sh.
The two builds print nothing because their stdout is redirected to /dev/null on screen; the
line they would have printed is kept in media/graph/capture-formats/build-*.stdout.

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
fs.writeFileSync(require("node:path").join(__dirname, "..", "..", "graph", "graph-formats-1x1.transcript.txt"), out);
console.log(out);
