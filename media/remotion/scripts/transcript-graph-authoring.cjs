// Plain-text transcript: titles, every typed command, the real output (ANSI stripped), captions.
const b = require("./out-graph-authoring/graph-authoring/beats.js");
const fs = require("node:fs");
const fps = b.FPS;
const mmss = (f) => {
  const s = Math.round(f / fps);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const total = (b.totalFrames / fps).toFixed(1);
let out = `Author-facing content in the graph, demo video transcript (silent video; text describes what is on screen)

Frame: 1080x1080, 30 fps, ${total} s. Every terminal line is real output, run at the root of the
manni repository against its own docs, collections and 82 strategy records, by
media/capture-graph-authoring/capture.sh. \`manni\` is this branch's built CLI. The last beat runs
the plugin's own MCP server script, plugin/manni/hooks/graph-server.mjs, with stdin closed, so the
stdio server ends once it is up.

`;
let t = 0;
b.beats.forEach((beat, i) => {
  const d = b.beatDurations[i];
  out += `[${mmss(t)}-${mmss(t + d)}] Title: ${beat.title} (${i + 1} / ${b.beats.length})\n`;
  for (const c of beat.commands) {
    out += `$ ${c.typed}\n`;
    const all = c.output + (c.more ?? []).map((m) => m.output).join("");
    if (all !== "") out += strip(all).replace(/\n$/, "") + "\n";
  }
  if (beat.highlight)
    out += `Highlighted rows: lines containing ${beat.highlight.map((h) => JSON.stringify(h)).join(", ")}\n`;
  out += `Caption: ${beat.caption}\n\n`;
  t += d;
});
out += `Timing: the waits over a second are replayed at 1/5. The real times are on screen: bash's time
output after each publish (11.687 s and 9.111 s), and the server's own "published the graph in 11.0s".

Beat 2: the four pages are the ones manni strategy get d11 lists
(media/capture-graph-authoring/strategy-get-d11.txt).

Beat 3: the default graph from beat 1 answers the same query with 262 matches
(media/capture-graph-authoring/internal-created.txt).

Beat 4: with CLAUDE_PLUGIN_DATA unset, as here, the server's data directory is <tmpdir>/manni/graph/<hash>.
Under Claude Code it is inside the plugin's data directory. Either way it is outside the repository.
`;
fs.writeFileSync("../../graph-authoring-1x1.transcript.txt", out);
console.log(out);
