// Plain-text transcript: titles, every typed command, the real output (ANSI stripped), captions.
const b = require("./out-plugin-records/plugin-records/beats.js");
const fs = require("node:fs");
const fps = b.FPS;
const mmss = (f) => {
  const s = Math.round(f / fps);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const total = (b.totalFrames / fps).toFixed(1);
let out = `A page read names the records the page names, demo video transcript (silent video; text describes what is on screen)

Frame: 1080x1080, 30 fps, ${total} s. Every terminal line is real output, run at the root of the
manni repository against its own docs pages and strategy records, by
media/plugin-records/capture/capture.sh. \`manni\` is this branch's built CLI. \`read-page\` builds
the PostToolUse envelope Claude Code sends after a Read and pipes it into the plugin's real hook,
plugin/manni/hooks/page-metadata.mjs, then prints the context the hook returns.

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
out += `Beat 3: \`cut -c -500\` keeps each line of the reply to 500 characters, so the page JSON stops
after its key fields. The whole reply, as read-page prints it, is 2,543 characters (media/plugin-records/capture/read-whole.txt).

Beat 4: the cite CLI reference stores 59,338 characters of metadata as JSON
(media/plugin-records/capture/big-values-length.txt). The reply holds every key field and 14
references, and leaves out citations and provenance.

Colour: the only colour in the terminal is the dim file prefix and "(asserted)" in beat 2's output.
`;
fs.writeFileSync("../../plugin-records/plugin-records-1x1.transcript.txt", out);
console.log(out);
