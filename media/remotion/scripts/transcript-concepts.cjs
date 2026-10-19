// Plain-text transcript: titles, every typed command, the real output (ANSI stripped), captions.
const b = require("./out-concepts/concepts/beats.js");
const fs = require("node:fs");
const fps = b.FPS;
const mmss = (f) => { const s = Math.round(f / fps); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const total = (b.totalFrames / fps).toFixed(1);
let out = `One concept scheme, from freeform tags to checked questions: demo video transcript\n(silent video; text describes what is on screen)\n\nFrame: 1080x1080, 30 fps, ${total} s. Every terminal line is real output of grep, sed, echo, bash's\ntime and \`node dist/cli.js ...\` (typed as manni), run in C:\\concepts, a junction to\nmedia/scratch-concepts/, built by media/capture-concepts/capture.sh. graph fill took 7.35 s;\nthe replay shortens only that wait, to 2.1 s, and shows bash's real time line.\n\n`;
let t = 0;
b.beats.forEach((beat, i) => {
  const d = b.beatDurations[i];
  out += `[${mmss(t)}-${mmss(t + d)}] Title: ${beat.title} (${i + 1} / ${b.beats.length})\n`;
  for (const c of beat.commands) {
    out += `$ ${c.typed}\n`;
    if (c.output !== "") out += strip(c.output).replace(/\n$/, "").split("\n").map((raw) => {
      const l = raw.replace(/ +$/, "");
      if (/^  error /.test(l)) return `${l}   ("error" in red)`;
      if (/^docs\/.*:\d+$/.test(l)) return `${l}   (bold)`;
      return l;
    }).join("\n") + "\n";
  }
  if (beat.highlight) out += `Highlighted rows: lines containing ${beat.highlight.map((h) => JSON.stringify(h)).join(", ")}\n`;
  out += `Caption: ${beat.caption}\n\n`;
  t += d;
});
fs.writeFileSync("../concept-lifecycle-1x1.transcript.txt", out);
console.log(out);
