// Plain-text transcript: titles, every typed command, the real output (ANSI stripped), captions.
const b = require("./out-a11y/a11y/beats.js");
const fs = require("node:fs");
const fps = b.FPS;
const mmss = (f) => { const s = Math.round(f / fps); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const total = (b.totalFrames / fps).toFixed(1);
let out = `manni a11y check --exclude, demo video transcript (silent video; text describes what is on screen)

Frame: 1080x1080, 30 fps, ${total} s. Every terminal line is real output of \`node dist/cli.js a11y check ...\`
(typed as manni) run at the root of the manni checkout against this repository's own docs site,
served by \`astro preview\` at http://127.0.0.1:4321/manni/. The seed URL is not typed because it comes
from manni.config.yaml's \`site\` collection. media/capture-a11y/capture.sh is the record of the runs.

The two crawls are real, cold and uncapped: 1m46.641s over 101 pages and 1m7.458s over 67.
The replay shortens the wait between Enter and the output, both crawls by the same factor of 1/53.3,
so the replay keeps the ratio the two real runs had. Typing and output are 1x, and bash's own \`time\`
output stays on screen unedited, so the real elapsed time is what the viewer reads.

`;
let t = 0;
b.beats.forEach((beat, i) => {
  const d = b.beatDurations[i];
  out += `[${mmss(t)}-${mmss(t + d)}] Title: ${beat.title} (${i + 1} / ${b.beats.length})\n`;
  if (beat.continues) out += `(the screen carries on from the beat before; nothing is cleared)\n`;
  for (const c of beat.commands) {
    out += `$ ${c.typed}\n`;
    if (c.output !== "") out += strip(c.output).replace(/\n$/, "").split("\n").map((raw) => {
      const l = raw.replace(/ +$/, "");
      if (/^\d+ violations? on /.test(l)) return `${l}   (the whole line in green)`;
      return l;
    }).join("\n") + "\n";
  }
  if (beat.highlight) out += `Highlighted rows: lines containing ${beat.highlight.map((h) => JSON.stringify(h)).join(", ")}\n`;
  out += `Caption: ${beat.caption}\n\n`;
  t += d;
});
fs.writeFileSync("../a11y-exclude-1x1.transcript.txt", out);
console.log(out);
