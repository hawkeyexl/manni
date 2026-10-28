// Plain-text transcript: titles, every typed command, the real output, captions.
const b = require("./out-flare-site/flare-site/beats.js");
const fs = require("node:fs");
const fps = b.FPS;
const mmss = (f) => { const s = Math.round(f / fps); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const total = (b.totalFrames / fps).toFixed(1);
let out = `manni site builds and previews a MadCap Flare project, demo video transcript (silent video; text describes what is on screen)

Frame: 1080x1080, 30 fps, ${total} s. Every terminal line is real output of ls, tail, curl, head and of
\`node dist/cli.js ...\` (typed as manni) run in C:\\widget, a directory junction to media/scratch-flare-site/,
a git repository holding test/fixtures/flare/widget/ as committed, built by media/capture-flare-site/capture.sh.

madbuild in this video is a stand-in, not MadCap Flare: test/fixtures/flare/madbuild-standin/, a few lines of
Node that copy each topic as written and write a Default.htm linking them. It was first on PATH, and USERNAME
was set to maya, so the output folder reads Output/maya/HTML5. The video makes no claim about real Flare output.

`;
let t = 0;
b.beats.forEach((beat, i) => {
  const d = b.beatDurations[i];
  out += `[${mmss(t)}-${mmss(t + d)}] Title: ${beat.title} (${i + 1} / ${b.beats.length})\n`;
  for (const c of beat.commands) {
    out += `$ ${c.typed}\n`;
    const all = c.output + (c.more ?? []).map((m) => m.output).join("");
    if (all !== "") out += strip(all).replace(/\n$/, "") + "\n";
    if (c.running) out += "(the server keeps running; no prompt returns)\n";
  }
  if (beat.highlight) out += `Highlighted rows: lines containing ${beat.highlight.map((h) => JSON.stringify(h)).join(", ")}\n`;
  out += `Caption: ${beat.caption}\n\n`;
  t += d;
});
fs.writeFileSync("../flare-site-1x1.transcript.txt", out);
console.log(out);
