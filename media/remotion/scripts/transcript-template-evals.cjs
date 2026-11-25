// Plain-text transcript: titles, every typed command, the real output (ANSI stripped), captions.
const b = require("./out-template-evals/template-evals/beats.js");
const fs = require("node:fs");
const fps = b.FPS;
const mmss = (f) => { const s = Math.round(f / fps); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const total = (b.totalFrames / fps).toFixed(1);
let out = `Lint templates carry evals, and manni docevals grades them, demo video transcript (silent video; text describes what is on screen)

Frame: 1080x1080, 30 fps, ${total} s. Every terminal line is real output of cat and of
\`node dist/cli.js ...\` (typed as manni) run in media/scratch-template-evals/, a git repository holding
test/docevals/fixtures/template-evals/ unchanged, built by media/capture-template-evals/capture.sh.

`;
let t = 0;
b.beats.forEach((beat, i) => {
  const d = b.beatDurations[i];
  out += `[${mmss(t)}-${mmss(t + d)}] Title: ${beat.title} (${i + 1} / ${b.beats.length})\n`;
  for (const c of beat.commands) {
    out += `$ ${c.typed}\n`;
    const all = c.output + (c.more ?? []).map((m) => m.output).join("");
    if (all !== "") out += strip(all).replace(/\n$/, "").split("\n").map((raw) => {
      const l = raw.replace(/ +$/, "");
      if (/\(template: /.test(l)) return `${l}   (path bold, suite and template dimmed)`;
      if (/^  - .*\[/.test(l)) return `${l}   (grader in cyan, tags dimmed${/skip\]/.test(l) ? ', "skip" in yellow' : ""})`;
      if (/^ {6}\S/.test(l) && i === 2) return `${l}   (dimmed)`;
      if (/^ *skip /.test(l)) return `${l}   ("skip" and the path dimmed)`;
      if (/^ *pass /.test(l)) return `${l}   ("pass" in green, path dimmed)`;
      if (/^ *FAIL /.test(l)) return `${l}   ("FAIL" in red, path dimmed)`;
      if (/^ *error:/.test(l)) return `${l}   ("error" in red, rule id dimmed)`;
      if (/shows-the-command: The page|Guide: |judge skipped|eval skipped/.test(l)) return `${l}   (dimmed)`;
      if (/below target/.test(l)) return `${l}   ("below target" in red, skipped count dimmed)`;
      if (l === "docs/typed-fails.md" || l === "Suites") return `${l}   (bold)`;
      return l;
    }).join("\n") + "\n";
  }
  if (beat.highlight) out += `Highlighted rows: lines containing ${beat.highlight.map((h) => JSON.stringify(h)).join(", ")}\n`;
  out += `Caption: ${beat.caption}\n\n`;
  t += d;
});
fs.writeFileSync("../template-evals-1x1.transcript.txt", out);
console.log(out);
