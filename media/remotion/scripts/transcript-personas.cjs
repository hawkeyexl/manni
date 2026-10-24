// Plain-text transcript: titles, every typed command, the real output (ANSI stripped), captions.
const b = require("./out-personas/personas/beats.js");
const fs = require("node:fs");
const fps = b.FPS;
const mmss = (f) => {
  const s = Math.round(f / fps);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const total = (b.totalFrames / fps).toFixed(1);
let out = `manni docevals, readers: personas, demo video transcript (silent video; text describes what is on screen)

Frame: 1080x1080, 30 fps, ${total} s. Every terminal line is real output. The CLI is
this branch's build, node dist/cli.js, typed as manni. It runs in
media/scratch-persona-evals/, which media/capture-personas/stage.sh stages from a
byte copy of test/docevals/fixtures/personas/. Its config names the repository's
local judge (llama-cpp, granite-4.1-3b-q2) and lowers autoFail to 0.7, and
docs/one-reader.md is media/capture-personas/one-reader.before.md. The edit in beat 3
copies one-reader.after.md over it. Each judged run took about 8.1 s; the replay
shortens that wait by 3.5x, and bash's own "real" line shows the true time.

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
            if (/^  FAIL /.test(l)) return `${l}   ("FAIL" in red)`;
            if (/^  pass /.test(l)) return `${l}   ("pass" in green)`;
            if (/^\s+(votes |docs\/one-reader\.md names|Guide: )/.test(l)) return `${l}   (dim)`;
            if (/below target/.test(l)) return `${l}   ("below target" in red)`;
            if (/ ok$/.test(l)) return `${l}   ("ok" in green)`;
            if (/^-[A-Z]/.test(l)) return `${l}   (red)`;
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
fs.writeFileSync("../../persona-judge-1x1.transcript.txt", out);
console.log(out);
