// Plain-text transcript: titles, every typed command, the real output (ANSI stripped), captions.
const b = require("./out-cite-repos/cite-repos/beats.js");
const fs = require("node:fs");
const fps = b.FPS;
const mmss = (f) => {
  const s = Math.round(f / fps);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const total = (b.totalFrames / fps).toFixed(1);
let out = `Citations from more than one checkout (proposal 0100), demo video transcript (silent video; text describes what is on screen)

Frame: 1080x1080, 30 fps, ${total} s. Every terminal line is real output from this
branch's build, node dist/cli.js, typed as manni, and from git. The commands run
in docs/, one of three git checkouts (docs, api, sdk) that
media/capture-repos/capture.sh stages side by side in media/scratch-cite-repos/.
Beat 1's pins were minted before cite.repos was declared, one --root per pin.
Each command appears after its measured latency, at 1x.

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
            if (/^\s*✗/.test(l)) return `${l}   (✗ in red)`;
            if (/^\s*✓/.test(l)) return `${l}   (✓ in green)`;
            if (/^1 file checked, 1 passed/.test(l)) return `${l}   (green)`;
            if (/^1 file checked/.test(l)) return `${l}   (red)`;
            if (/^\s+(manni:cite |Guide: )/.test(l)) return `${l}   (dim)`;
            if (/^-  /.test(l)) return `${l}   (removed, red)`;
            if (/^\+  /.test(l)) return `${l}   (added, green)`;
            return l;
          })
          .join("\n") + "\n";
  }
  if (beat.highlight)
    out += `Highlighted rows: lines containing ${beat.highlight.map((h) => JSON.stringify(h)).join(", ")}\n`;
  out += `Caption: ${beat.caption}\n\n`;
  t += d;
});
fs.writeFileSync("../../cite-repos-1x1.transcript.txt", out);
console.log(out);
