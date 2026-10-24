// Plain-text transcript: titles, every typed command, the real output (ANSI stripped), captions.
const b = require("./out-evidence-pins/evidence-pins/beats.js");
const fs = require("node:fs");
const fps = b.FPS;
const mmss = (f) => {
  const s = Math.round(f / fps);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const total = (b.totalFrames / fps).toFixed(1);
let out = `manni cite, demo video transcript (silent video; text describes what is on screen)

Frame: 1080x1080, 30 fps, ${total} s. Every terminal line is real output. The CLI is
this branch's build, node dist/cli.js, typed as manni. It runs in
media/scratch-evidence-pins/, which media/evidence-pins/capture/capture.sh stages from a
copy of test/fixtures/strategy/evidence/ with its research note moved to
research/contributor.md, then commits as one baseline. The reordered persona
and the edited note are theo.reordered.md and note.edited.md in media/evidence-pins/capture/,
copied in before each diff. Each command appears after its measured latency, at 1x.

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
            if (/^\s*✓/.test(l)) return `${l}   (✓ in green)`;
            if (/^\s*✗/.test(l)) return `${l}   (✗ in red)`;
            if (/^\s*ℹ/.test(l)) return `${l}   (ℹ dim)`;
            if (/^\s+(manni:cite |Guide: )/.test(l)) return `${l}   (dim)`;
            if (/^\d+ (file|citation)/.test(l)) return `${l}   (${/ 0 failed| 0 skipped/.test(l) ? "green" : "red"})`;
            if (/^-[^-]/.test(l)) return `${l}   (red)`;
            if (/^\+[^+]/.test(l)) return `${l}   (green)`;
            return l;
          })
          .join("\n") + "\n";
  }
  if (beat.highlight)
    out += `Highlighted rows: lines containing ${beat.highlight.map((h) => JSON.stringify(h)).join(", ")}\n`;
  out += `Caption: ${beat.caption}\n\n`;
  t += d;
});
fs.writeFileSync("../../evidence-pins/evidence-pins-1x1.transcript.txt", out);
console.log(out);
