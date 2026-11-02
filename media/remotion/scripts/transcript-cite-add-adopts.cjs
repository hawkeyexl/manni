// Plain-text transcript: titles, every typed command, the real output (ANSI stripped), captions.
const b = require("./out-cite-add-adopts/cite-add-adopts/beats.js");
const fs = require("node:fs");
const fps = b.FPS;
const mmss = (f) => {
  const s = Math.round(f / fps);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const total = (b.totalFrames / fps).toFixed(1);
let out = `Marker adoption in manni cite add (proposal 0127), demo video transcript (silent video; text describes what is on screen)

Frame: 1080x1080, 30 fps, ${total} s. Every terminal line is real output from this
branch's build, node dist/cli.js, typed as manni, and from git. The commands run
in media/scratch-cite-adopts/, a git repository that
media/capture-cite-adopts/capture.sh stages with a pinned author and pinned dates.
The page is written before any entry exists. Each command appears after its
measured latency, at 1x.

`;
let t = 0;
b.beats.forEach((beat, i) => {
  const d = b.beatDurations[i];
  out += `[${mmss(t)}-${mmss(t + d)}] Title: ${beat.title} (${i + 1} / ${b.beats.length})\n`;
  for (const c of beat.commands) {
    out += `$ ${c.typed}\n`;
    if (c.output !== "")
      out +=
        strip(c.output)
          .replace(/\n$/, "")
          .split("\n")
          .map((l) => {
            if (/^s*✗/.test(l)) return `${l}   (✗ in red)`;
            if (/^s*✓/.test(l)) return `${l}   (✓ in green)`;
            if (/^1 file checked, 1 passed/.test(l)) return `${l}   (green)`;
            if (/^1 file checked/.test(l)) return `${l}   (red)`;
            if (/^s+(manni:cite |Guide: )/.test(l)) return `${l}   (dim)`;
            if (l.endsWith("+++")) return `${l}   (+ in green)`;
            return l;
          })
          .join("\n") + "\n";
  }
  if (beat.highlight)
    out += `Highlighted rows: lines containing ${beat.highlight.map((h) => JSON.stringify(h)).join(", ")}\n`;
  out += `Caption: ${beat.caption}\n\n`;
  t += d;
});
fs.writeFileSync("../../cite-add-adopts-1x1.transcript.txt", out);
console.log(out);
