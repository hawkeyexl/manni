// Plain-text transcript: titles, every typed command, the real output (ANSI stripped), captions.
const b = require("./out-cite-impact/cite-impact/beats.js");
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
media/scratch-cite-impact/, which media/cite-impact/capture.sh stages from
test/fixtures/cite/impact/: two pages whose sidecars name persona maya and
journeys m5 and m6, the three records, and src/value.ts, which both pages
cite. Each command appears after its measured latency, at 1x.

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
            if (/^✓/.test(l) || /^\s+✓/.test(l)) return `${l}   (✓ in green)`;
            if (/^✗/.test(l) || /^\s+✗/.test(l)) return `${l}   (✗ in red)`;
            if (/^\s+(manni:cite |Guide: )/.test(l)) return `${l}   (dim)`;
            if (/^-export/.test(l)) return `${l}   (red)`;
            if (/^\+export/.test(l)) return `${l}   (green)`;
            if (/files checked, 5 passed/.test(l)) return `${l}   (green)`;
            if (/files checked/.test(l)) return `${l}   (red)`;
            return l;
          })
          .join("\n") + "\n";
  }
  if (beat.highlight)
    out += `Highlighted rows: lines containing ${beat.highlight.map((h) => JSON.stringify(h)).join(", ")}\n`;
  out += `Caption: ${beat.caption}\n\n`;
  t += d;
});
fs.writeFileSync("../../cite-impact/cite-impact-1x1.transcript.txt", out);
console.log(out);
