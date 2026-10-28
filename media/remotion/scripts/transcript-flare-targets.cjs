// Plain-text transcript: titles, every typed command, the real output (ANSI stripped), captions.
const b = require("./out-flare-targets/flare-targets/beats.js");
const fs = require("node:fs");
const fps = b.FPS;
const mmss = (f) => { const s = Math.round(f / fps); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const total = (b.totalFrames / fps).toFixed(1);
let out = `manni reads a MadCap Flare topic as its target builds it, demo video transcript (silent video; text describes what is on screen)\n\nFrame: 1080x1080, 30 fps, ${total} s. Every terminal line is real output of grep and of\n\`node dist/cli.js ...\` (typed as manni) run in C:\\flare, a directory junction to media/scratch-flare-targets/,\na git repository holding test/fixtures/flare/widget/ as committed, built by media/capture-flare-targets/capture.sh.\n\n`;
let t = 0;
b.beats.forEach((beat, i) => {
  const d = b.beatDurations[i];
  out += `[${mmss(t)}-${mmss(t + d)}] Title: ${beat.title} (${i + 1} / ${b.beats.length})\n`;
  for (const c of beat.commands) {
    out += `$ ${c.typed}\n`;
    const all = c.output + (c.more ?? []).map((m) => m.output).join("");
    if (all !== "") out += strip(all).replace(/\n$/, "").split("\n").map((raw) => {
      const l = raw.replace(/ +$/, "");
      if (/^▸ /.test(l)) return `${l}   (cyan marker)`;
      if (/^ *→ cli/.test(l)) return `${l}   (green arrow)`;
      return l;
    }).join("\n") + "\n";
  }
  if (beat.highlight) out += `Highlighted rows: lines containing ${beat.highlight.map((h) => JSON.stringify(h)).join(", ")}\n`;
  out += `Caption: ${beat.caption}\n\n`;
  t += d;
});
fs.writeFileSync("../flare-targets-1x1.transcript.txt", out);
console.log(out);
