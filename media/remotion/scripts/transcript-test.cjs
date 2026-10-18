// Plain-text transcript: titles, every typed command, the real output (ANSI stripped), captions.
const b = require("./out-test/test/beats.js");
const fs = require("node:fs");
const fps = b.FPS;
const mmss = (f) => {
  const s = Math.round(f / fps);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const total = (b.totalFrames / fps).toFixed(1);
let out = `manni test run, demo video transcript (silent video; text describes what is on screen)

Frame: 1080x1080, 30 fps, ${total} s. Every terminal line is real output of cat, sed and
\`node dist/cli.js test run ...\` (typed as manni), run under bash's time in
media/scratch-test/, which media/capture-test/capture.sh stages from a copy of
test/test/fixtures/fail.md. Each run took about 8 s. The replay shortens only that
wait, and bash's own real line is on screen for every run.

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
            if (/^\s*\d+\s+FAIL\b/.test(l)) return `${l}   (FAIL in red)`;
            if (/^fail\.md$/.test(l)) return `${l}   (bold)`;
            return l;
          })
          .join("\n") + "\n";
  }
  if (beat.highlight)
    out += `Highlighted rows: lines containing ${beat.highlight.map((h) => JSON.stringify(h)).join(", ")}\n`;
  out += `Caption: ${beat.caption}\n\n`;
  t += d;
});
fs.writeFileSync("../../test-run-1x1.transcript.txt", out);
console.log(out);
