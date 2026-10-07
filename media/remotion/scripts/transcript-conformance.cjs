// Plain-text transcript: titles, every typed command, the real output (ANSI stripped), captions.
const b = require("./out-conformance/conformance/beats.js");
const fs = require("node:fs");
const fps = b.FPS;
const mmss = (f) => {
  const s = Math.round(f / fps);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const total = (b.totalFrames / fps).toFixed(1);
let out = `manni tracevals check and the Stop hook, demo video transcript (silent video; text describes what is on screen)

Frame: 1080x1080, 30 fps, ${total} s. Every terminal line is real output of cat, grep and
\`node dist/cli.js tracevals check|check\` (typed as manni), run in a copy of the committed
fixture test/tracevals/fixtures/conformance/ staged by media/conformance/capture/capture.sh.
The fixture's config judges with the mock provider, offline, as CI does.

`;
let t = 0;
b.beats.forEach((beat, i) => {
  const d = b.beatDurations[i];
  out += `[${mmss(t)}-${mmss(t + d)}] Title: ${beat.title} (${i + 1} / ${b.beats.length})\n`;
  if (beat.continues) out += `(continues on the previous beat's screen)\n`;
  for (const c of beat.commands) {
    out += `$ ${c.typed}\n`;
    if (c.output !== "")
      out +=
        strip(c.output)
          .replace(/\n$/, "")
          .split("\n")
          .map((l) => {
            if (/^\s+✖ /.test(l) && c.output.includes("\x1b[31m")) return `${l}   (red cross)`;
            if (/^\s+\? /.test(l) && c.output.includes("\x1b[33m")) return `${l}   (yellow question mark)`;
            if (/with probability/.test(l) && c.output.includes("\x1b[2m")) return `${l}   (dim)`;
            return l;
          })
          .join("\n") + "\n";
  }
  if (beat.highlight)
    out += `Highlighted rows: lines containing ${beat.highlight.map((h) => JSON.stringify(h)).join(", ")}\n`;
  out += `Caption: ${beat.caption}\n\n`;
  t += d;
});
out += `The hook run in beat 4 prints one line of JSON without colour, because Claude Code reads it, not a person.
"decision":"block" stops the agent from finishing once; the reason is the report it is told to act on.
`;
fs.writeFileSync("../../conformance/conformance-1x1.transcript.txt", out);
console.log(out);
