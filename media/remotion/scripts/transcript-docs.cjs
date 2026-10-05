// Plain-text transcript: titles, every typed command, the real output (ANSI stripped), captions.
const b = require("./out-docs/docs/beats.js");
const fs = require("node:fs");
const fps = b.FPS;
const mmss = (f) => { const s = Math.round(f / fps); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const total = (b.totalFrames / fps).toFixed(1);
const body = (out) => strip(out).replace(/\n$/, "").split("\n").map((raw) => {
  if (raw.startsWith("@@cut@@")) return `[edit: ${raw.slice(7).replace(/^\.\.\. | \.\.\.$/g, "")}; drawn in the accent colour, in italics]`;
  const l = raw.replace(/ +$/, "");
  if (/^\d+ violations? on /.test(l)) return `${l}   (the whole line in green)`;
  return l;
}).join("\n") + "\n";
let out = `manni docs preview, demo video transcript (silent video; text describes what is on screen)

Frame: 1080x1080, 30 fps, ${total} s. Every terminal line is real output, captured by
media/capture-docs/capture.sh at the root of the manni checkout. \`manni\` is the built CLI
(node dist/cli.js). The shell had its AI-agent variables removed, so Astro printed what a person sees.

Two waits are compressed, and the real time stays on screen. The astro build took 15.4 s and is
shown for 1.2 s; its 281 log lines are replaced by one marker line that says so, and astro's own
"239 page(s) built in 11.45s" line is kept. The accessibility crawl took 4m36.662s over 238 pages and
is shown for 2 s; bash's own \`time\` output is on screen, unedited. Everything else is real time.

`;
let t = 0;
b.beats.forEach((beat, i) => {
  const d = b.beatDurations[i];
  out += `[${mmss(t)}-${mmss(t + d)}] Title: ${beat.title} (${i + 1} / ${b.beats.length})\n`;
  if (beat.continues) out += `(the screen carries on from the beat before; nothing is cleared)\n`;
  for (const c of beat.commands) {
    out += `$ ${c.typed}\n`;
    if (c.output !== "") out += body(c.output);
    for (const m of c.more ?? []) out += body(m.output);
    if (c.running) out += `(the server keeps running; no prompt returns)\n`;
  }
  if (beat.highlight) out += `Highlighted rows: lines containing ${beat.highlight.map((h) => JSON.stringify(h)).join(", ")}\n`;
  out += `Caption: ${beat.caption}\n\n`;
  t += d;
});
fs.writeFileSync("../docs-preview-1x1.transcript.txt", out);
console.log(out);
