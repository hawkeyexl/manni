// Plain-text transcript: titles, every typed command, the real output (ANSI stripped), captions.
const b = require("./out-lint/lint/beats.js");
const fs = require("node:fs");
const fps = b.FPS;
const mmss = (f) => {
  const s = Math.round(f / fps);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const total = (b.totalFrames / fps).toFixed(1);
let out =
  `manni lint templates infer, demo video transcript (silent video; text describes what is on screen)\n\n` +
  `Frame: 1080x1080, 30 fps, ${total} s. Every terminal line is real output of cat, sed and of\n` +
  `\`node dist/cli.js lint ...\` (typed as manni) run inside media/scratch-lint/, a git repository\n` +
  `staged from test/lint/fixtures/formats/how-to.md by media/capture-lint/capture.sh.\n` +
  `Its manni.config.yaml (lint.templates: [templates.yaml]) is staged and not shown; the\n` +
  `"Using manni.config.yaml (.)" line each command prints is manni reporting that it found it.\n\n`;
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
          .map((raw) => {
            const l = raw.replace(/ +$/, "");
            if (/^✗ /.test(l)) return `${l}   ("✗" in red)`;
            if (/^✓ /.test(l)) return `${l}   ("✓" in green)`;
            if (/manni:lint\//.test(l)) return `${l}   (line:column dim, rule id cyan)`;
            if (/^\d+ files? checked/.test(l)) return `${l}   (${/0 failed/.test(l) ? "green" : "red"})`;
            return l;
          })
          .join("\n") + "\n";
  }
  if (beat.highlight)
    out += `Highlighted rows: lines containing ${beat.highlight.map((h) => JSON.stringify(h)).join(", ")}\n`;
  out += `Caption: ${beat.caption}\n\n`;
  t += d;
});
fs.writeFileSync("../lint-templates-infer-1x1.transcript.txt", out);
console.log(out);
