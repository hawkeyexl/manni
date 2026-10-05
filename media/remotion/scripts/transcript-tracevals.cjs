// Plain-text transcript: titles, every typed command, the real output (ANSI stripped), captions.
const b = require("./out-tracevals/tracevals/beats.js");
const fs = require("node:fs");
const fps = b.FPS;
const mmss = (f) => {
  const s = Math.round(f / fps);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const total = (b.totalFrames / fps).toFixed(1);
let out = `manni tracevals, demo video transcript (silent video; text describes what is on screen)

Frame: 1080x1080, 30 fps, ${total} s. Every terminal line is real output of cat and of
\`node dist/cli.js tracevals run ...\` (typed as manni), run inside a demo repository
staged by media/capture-tracevals/capture.sh from test/tracevals/fixtures/traces/
claude-session.jsonl and test/tracevals/fixtures/project/.

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
            if (/^\s*PASS\b/.test(l)) return `${l}   (green)`;
            if (/^\s*FAIL\b/.test(l)) return `${l}   (red)`;
            if (/^\s*SKIP\b/.test(l)) return `${l}   (dim)`;
            if (/^\s*✓ /.test(l)) return `${l}   (green check)`;
            if (/eval\(s\):/.test(l)) return `${l}   (pass count green, fail count red)`;
            return l;
          })
          .join("\n") + "\n";
  }
  if (beat.highlight)
    out += `Highlighted rows: lines containing ${beat.highlight.map((h) => JSON.stringify(h)).join(", ")}\n`;
  out += `Caption: ${beat.caption}\n\n`;
  t += d;
});
fs.writeFileSync("../tracevals-1x1.transcript.txt", out);
console.log(out);
