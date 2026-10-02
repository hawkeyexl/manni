// Plain-text transcript: titles, every typed command, the real output (ANSI stripped), captions.
const b = require("./out-graph/graph/beats.js");
const fs = require("node:fs");
const fps = b.FPS;
const mmss = (f) => { const s = Math.round(f / fps); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const total = (b.totalFrames / fps).toFixed(1);
let out = `manni graph vocabulary, demo video transcript (silent video; text describes what is on screen)\n\nFrame: 1080x1080, 30 fps, ${total} s. Every terminal line is real output of cat, sed, echo and of\n\`node dist/cli.js ...\` (typed as manni), run in a demo repository outside the manni checkout.\nmedia/graph/capture/capture.sh builds it from test/fixtures/term/ and captures every byte.\nTwo files are staged and not shown: manni.config.yaml (one collection, docs/**/*.md), and\ngraph-1.0.0-proposal.1.json, a byte copy of docs/proposals/0023/schemas/graph/1.0.0-proposal.1.json.\n\n`;
let t = 0;
b.beats.forEach((beat, i) => {
  const d = b.beatDurations[i];
  out += `[${mmss(t)}-${mmss(t + d)}] Title: ${beat.title} (${i + 1} / ${b.beats.length})\n`;
  for (const c of beat.commands) {
    out += `$ ${c.typed}\n`;
    if (c.output !== "") out += strip(c.output).replace(/\n$/, "").split("\n").map((raw) => {
      const l = raw.replace(/ +$/, "");
      if (/^✓ /.test(l)) return `${l}   (check mark in green)`;
      if (/^  notice /.test(l)) return `${l}   ("notice" in cyan)`;
      if (/^docs\/terms\/.*:1$/.test(l)) return `${l}   (bold)`;
      if (/^✗ /.test(l)) return `${l}   (cross in red)`;
      if (/^    \/graph /.test(l)) return `${l}   ("/graph" in cyan, line and schema tag dimmed)`;
      if (/^1 file checked/.test(l)) return `${l}   (in red)`;
      return l;
    }).join("\n") + "\n";
  }
  if (beat.highlight) out += `Highlighted rows: lines containing ${beat.highlight.map((h) => JSON.stringify(h)).join(", ")}\n`;
  out += `Caption: ${beat.caption}\n\n`;
  t += d;
});
fs.writeFileSync("../graph/graph-vocabulary-1x1.transcript.txt", out);
console.log(out);
