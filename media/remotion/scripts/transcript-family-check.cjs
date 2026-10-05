// Plain-text transcript: titles, every typed command, the real output (ANSI stripped), captions.
const b = require("./out-family-check/family-check/beats.js");
const fs = require("node:fs");
const fps = b.FPS;
const mmss = (f) => {
  const s = Math.round(f / fps);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const total = (b.totalFrames / fps).toFixed(1);
let out = `manni check and manni status, demo video transcript (silent video; text describes what is on screen)

Frame: 1080x1080, 30 fps, ${total} s. Every terminal line is real output of cat, sed and
\`node dist/cli.js status|check\` (typed as manni), run inside a demo repository staged
by media/family-check/capture/capture.sh from media/family-check/repo/.

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
            if (/^✗ /.test(l) && c.output.includes("\x1b[31m")) return `${l}   (red cross)`;
            if (/^\s+\(root\)/.test(l) && c.output.includes("\x1b[36m")) return `${l}   (field cyan, detail dim)`;
            return l;
          })
          .join("\n") + "\n";
  }
  if (beat.highlight)
    out += `Highlighted rows: lines containing ${beat.highlight.map((h) => JSON.stringify(h)).join(", ")}\n`;
  out += `Caption: ${beat.caption}\n\n`;
  t += d;
});
out += `Colour: in beats 2 and 4, a domain's summary line is red when it failed and green when it passed.
The hook run in beat 3 prints without colour, because it writes for an agent, not a terminal.
`;
fs.writeFileSync("../../family-check/family-check-1x1.transcript.txt", out);
console.log(out);
