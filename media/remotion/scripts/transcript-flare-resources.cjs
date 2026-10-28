// Plain-text transcript: titles, every typed command, the real output (ANSI stripped), captions.
const b = require("./out-flare-resources/flare-resources/beats.js");
const fs = require("node:fs");
const fps = b.FPS;
const mmss = (f) => { const s = Math.round(f / fps); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const total = (b.totalFrames / fps).toFixed(1);
let out = `manni reads a MadCap Flare glossary as a termbase and a meta tag set as a schema, demo video transcript (silent video; text describes what is on screen)

Frame: 1080x1080, 30 fps, ${total} s. Every terminal line is real output of sed, grep and of
\`node dist/cli.js ...\` (typed as manni) run in C:\\flare, a directory junction to media/scratch-flare-resources/,
a git repository holding test/fixtures/flare/widget/ as committed, built by media/capture-flare-resources/capture.sh.
In beat 3, manni's output goes through a pipe, so it prints without colour, as it does in a real terminal.

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
      if (/^✗ /.test(l)) return `${l}   (red cross)`;
      if (/^ *notice /.test(l)) return `${l}   ("notice" in cyan)`;
      if (/^ *\/Status /.test(l)) return `${l}   ("/Status" in cyan)`;
      if (/^1 file checked/.test(l)) return `${l}   (red)`;
      return l;
    }).join("\n") + "\n";
  }
  if (beat.highlight) out += `Highlighted rows: lines containing ${beat.highlight.map((h) => JSON.stringify(h)).join(", ")}\n`;
  out += `Caption: ${beat.caption}\n\n`;
  t += d;
});
fs.writeFileSync("../flare-resources-1x1.transcript.txt", out);
console.log(out);
