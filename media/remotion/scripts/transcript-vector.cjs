// Plain-text transcript: titles, every typed command, the real output (ANSI stripped), captions.
const b = require("./out-vector/vector/beats.js");
const fs = require("node:fs");
const fps = b.FPS;
const mmss = (f) => {
  const s = Math.round(f / fps);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const total = (b.totalFrames / fps).toFixed(1);
let out = `manni vector, demo video transcript (silent video; text describes what is on screen)

Frame: 1080x1080, 30 fps, ${total} s. Every terminal line is real output of
\`node dist/cli.js\` (typed as manni), run at the root of this repository with its own
manni.config.yaml and its \`site\` collection, captured by media/capture-vector/capture.sh.
The build's wait is shortened in the edit; bash's own \`time\` output shows the real 3m21.828s.

`;
let t = 0;
b.beats.forEach((beat, i) => {
  const d = b.beatDurations[i];
  out += `[${mmss(t)}-${mmss(t + d)}] Title: ${beat.title} (${i + 1} / ${b.beats.length})\n`;
  if (beat.continues && beat.commands.length === 0) out += "(The previous screen stays in frame.)\n";
  for (const c of beat.commands) {
    out += `$ ${c.typed}\n`;
    if (c.note) out += `${c.note}   (on-screen note from the edit, not output)\n`;
    if (c.output !== "") out += strip(c.output).replace(/\n$/, "") + "\n";
  }
  if (beat.highlight)
    out += `Highlighted rows: lines containing ${beat.highlight.map((h) => JSON.stringify(h)).join(", ")}\n`;
  out += `Caption: ${beat.caption}\n\n`;
  t += d;
});
fs.writeFileSync("../vector-1x1.transcript.txt", out);
console.log(out);
