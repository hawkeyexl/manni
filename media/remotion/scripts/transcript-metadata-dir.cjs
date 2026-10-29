// Plain-text transcript: titles, every typed command, the real output, captions.
const b = require("./out-metadata-dir/metadata-dir/beats.js");
const fs = require("node:fs");
const fps = b.FPS;
const mmss = (f) => { const s = Math.round(f / fps); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const total = (b.totalFrames / fps).toFixed(1);
let out = `manni meta keeps a page's external metadata in metadata/<id>.yaml, demo video transcript (silent video; text describes what is on screen)

Frame: 1080x1080, 30 fps, ${total} s. Every terminal line is real output of cat, git mv and of
\`node dist/cli.js ...\` (typed as manni) run in media/scratch-metadata-dir/, a one-page git repository
built by media/capture-metadata-dir/capture.sh. Its config gives the collection a per-page manifest,
externalMetadata: - file: "{page}.meta.yaml", and its schema marks personas and owner x-manni-location: external.

`;
let t = 0;
b.beats.forEach((beat, i) => {
  const d = b.beatDurations[i];
  out += `[${mmss(t)}-${mmss(t + d)}] Title: ${beat.title} (${i + 1} / ${b.beats.length})\n`;
  for (const c of beat.commands) {
    out += `$ ${c.typed}\n`;
    const all = c.output + (c.more ?? []).map((m) => m.output).join("");
    if (all !== "") out += strip(all).replace(/\n$/, "") + "\n";
  }
  if (beat.highlight) out += `Highlighted rows: lines containing ${beat.highlight.map((h) => JSON.stringify(h)).join(", ")}\n`;
  out += `Caption: ${beat.caption}\n\n`;
  t += d;
});
fs.writeFileSync("../metadata-dir-1x1.transcript.txt", out);
console.log(out);
