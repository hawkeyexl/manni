// Plain-text transcript: titles, every typed command, the real output (ANSI stripped), captions.
const b = require("./out-strategy-shared/strategy-shared/beats.js");
const fs = require("node:fs");
const fps = b.FPS;
const mmss = (f) => {
  const s = Math.round(f / fps);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const total = (b.totalFrames / fps).toFixed(1);
let out = `Borrowed strategy records, demo video transcript (silent video; text describes what is on screen)

Frame: 1080x1080, 30 fps, ${total} s. Every terminal line is real output, captured by
media/strategy-shared/capture/capture.sh in two checkouts side by side. manni holds a copy of
this repository's strategy records and docs pages. manni-plugin borrows manni's records through
its strategy collection, and keeps an old copy of persona maya. Beats 1 and 2 run inside
manni-plugin, and beat 3 runs in the folder that holds both. \`manni\` is this branch's built CLI.

`;
let t = 0;
b.beats.forEach((beat, i) => {
  const d = b.beatDurations[i];
  out += `[${mmss(t)}-${mmss(t + d)}] Title: ${beat.title} (${i + 1} / ${b.beats.length})\n`;
  for (const c of beat.commands) {
    out += `$ ${c.typed}\n`;
    if (c.output !== "") out += strip(c.output).replace(/\n$/, "") + "\n";
  }
  if (beat.highlight)
    out += `Highlighted rows: lines containing ${beat.highlight.map((h) => JSON.stringify(h)).join(", ")}\n`;
  out += `Caption: ${beat.caption}\n\n`;
  t += d;
});
out += `Beat 3: each repository's strategy list -f json lists every record with the pages that name
it. The node -e line joins the two files by id and prints pages per repository for four journeys.
The strategy docs do the same join with jq, which the capture machine does not have. The line is
pasted, not typed, because it is 254 characters long.

Colour: the error label is red and the check mark green, as the CLI prints them. The file name in
beat 1 is bold, and the rule and Guide lines are dim.
`;
fs.writeFileSync("../../strategy-shared/strategy-shared-1x1.transcript.txt", out);
console.log(out);
