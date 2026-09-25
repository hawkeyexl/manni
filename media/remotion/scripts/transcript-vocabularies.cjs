// Plain-text transcript: titles, every typed command, the real output (ANSI stripped), captions.
const b = require("./out-vocabularies/vocabularies/beats.js");
const fs = require("node:fs");
const fps = b.FPS;
const mmss = (f) => { const s = Math.round(f / fps); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const total = (b.totalFrames / fps).toFixed(1);
let out = `manni vocabularies, demo video transcript (silent video; text describes what is on screen)\n\nFrame: 1080x1080, 30 fps, ${total} s. Every terminal line is real output of cat, head, echo, bash's time and of\n\`node dist/cli.js meta ...\` (typed as manni), run in a directory outside the manni checkout with no manni.config.yaml.\nmedia/vocabularies/capture/capture.sh stages page.md from test/fixtures/missing-description.md and captures every byte.\nfill ran a real model through the claude CLI. It took ${b.FILL_REAL_S} s, and the replay shows that wait as ${b.FILL_REPLAY_S} s.\n\n`;
let t = 0;
b.beats.forEach((beat, i) => {
  const d = b.beatDurations[i];
  out += `[${mmss(t)}-${mmss(t + d)}] Title: ${beat.title} (${i + 1} / ${b.beats.length})\n`;
  for (const c of beat.commands) {
    out += `$ ${c.typed}\n`;
    if (c.output !== "") out += strip(c.output).replace(/\n$/, "").split("\n").map((raw) => {
      const l = raw.replace(/ +$/, "");
      if (/^✗ /.test(l)) return `${l}   (cross in red)`;
      if (/^✓ /.test(l)) return `${l}   (check mark in green)`;
      if (/^⚠ /.test(l)) return `${l}   (warning sign in yellow)`;
      if (/^    \(root\) /.test(l)) return `${l}   ("(root)" in cyan, line and schema tag dimmed)`;
      if (/^    \/meta-provenance /.test(l)) return `${l}   ("/meta-provenance" in cyan, "warning" in yellow, line and tag dimmed)`;
      if (/^    \/|^    meta-provenance /.test(l)) return `${l}   (field name in cyan, confidence dimmed)`;
      if (/^1 file checked, 0 passed/.test(l)) return `${l}   (in red)`;
      if (/^1 file checked, 1 passed/.test(l)) return `${l}   (in green)`;
      return l;
    }).join("\n") + "\n";
  }
  if (beat.highlight) out += `Highlighted rows: lines containing ${beat.highlight.map((h) => JSON.stringify(h)).join(", ")}\n`;
  out += `Caption: ${beat.caption}\n\n`;
  t += d;
});
fs.writeFileSync("../vocabularies/manni-vocabularies-1x1.transcript.txt", out);
console.log(out);
