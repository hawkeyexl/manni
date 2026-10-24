// Plain-text transcript: titles, every typed command, the real output (ANSI stripped), captions.
const b = require("./out-strategy-steps/strategy-steps/beats.js");
const fs = require("node:fs");
const fps = b.FPS;
const mmss = (f) => {
  const s = Math.round(f / fps);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const total = (b.totalFrames / fps).toFixed(1);
let out = `manni strategy, journey steps: demo video transcript (silent video; text describes what is on screen)

Frame: 1080x1080, 30 fps, ${total} s. Every terminal line is real output. The CLI is
this branch's build, node dist/cli.js, typed as manni. It runs in
media/scratch-strategy-steps/, which media/capture-strategy-steps/capture.sh stages
from a copy of test/fixtures/strategy/steps/ with strategy/journeys/m1.md trimmed to
four steps (media/capture-strategy-steps/m1.before.md). The edit in beat 3 is
media/capture-strategy-steps/reference.after.md copied over docs/reference.md.
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
            if (/^  warning /.test(l)) return `${l}   ("warning" in yellow)`;
            if (/^  notice /.test(l)) return `${l}   ("notice" in cyan)`;
            if (/^\s+(manni:strategy |Guide: )/.test(l)) return `${l}   (dim)`;
            if (/^\+[a-z]/.test(l)) return `${l}   (green)`;
            if (/^@@/.test(l)) return `${l}   (cyan)`;
            return l;
          })
          .join("\n") + "\n";
  }
  if (beat.highlight)
    out += `Highlighted rows: lines containing ${beat.highlight.map((h) => JSON.stringify(h)).join(", ")}\n`;
  out += `Caption: ${beat.caption}\n\n`;
  t += d;
});
fs.writeFileSync("../../strategy-steps-1x1.transcript.txt", out);
console.log(out);
