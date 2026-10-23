// Plain-text transcript: titles, every typed command, the real output (ANSI stripped), captions.
const b = require("./out-plugin-metadata/plugin-metadata/beats.js");
const fs = require("node:fs");
const fps = b.FPS;
const mmss = (f) => {
  const s = Math.round(f / fps);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "").replace("@@cut@@", "");
const total = (b.totalFrames / fps).toFixed(1);
let out = `The manni plugin hands the agent a page's metadata, demo video transcript (silent video; text describes what is on screen)

Frame: 1080x1080, 30 fps, ${total} s. Every terminal line is real output, run inside a demo
repository staged by media/plugin-metadata/capture/capture.sh from media/plugin-metadata/repo/.
\`manni\` is this branch's built CLI. \`read-page\` builds the PostToolUse envelope Claude Code
sends after a Read and pipes it into the plugin's real hook, plugin/manni/hooks/page-metadata.mjs,
then prints the context the hook returns. \`mcp-call\` starts the plugin's real MCP server,
plugin/manni/hooks/graph-server.mjs, asks its lookup tool one question and prints the best passage.

`;
let t = 0;
b.beats.forEach((beat, i) => {
  const d = b.beatDurations[i];
  out += `[${mmss(t)}-${mmss(t + d)}] Title: ${beat.title} (${i + 1} / ${b.beats.length})\n`;
  for (const c of beat.commands) {
    out += `$ ${c.typed}\n`;
    for (const chunk of [c.output, ...(c.more ?? []).map((m) => m.output)])
      if (chunk !== "") out += strip(chunk).replace(/\n$/, "") + "\n";
  }
  if (beat.highlight)
    out += `Highlighted rows: lines containing ${beat.highlight.map((h) => JSON.stringify(h)).join(", ")}\n`;
  out += `Caption: ${beat.caption}\n\n`;
  t += d;
});
out += `Beat 4: the second read-page prints nothing, which is the point: the hook gives a page's
metadata once, and again only when it changes.

Colour: the only colour in the terminal is the dim file prefix in beat 2's output. Beat 5's marker
line "... 2 advisory lines left out" is drawn in the accent blue and italic because it is not output.
The server printed two more notices there (no eval report configured, no vector sidecar), and the
edit leaves them out to keep the frame legible at phone size.
`;
fs.writeFileSync("../../plugin-metadata/plugin-metadata-1x1.transcript.txt", out);
console.log(out);
