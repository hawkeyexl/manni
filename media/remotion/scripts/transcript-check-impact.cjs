// Plain-text transcript: titles, every typed command, the real output on
// screen (ANSI stripped), captions. A run of ~2,700 lines scrolls; the
// transcript gives the lines its window holds when the beat settles, and the
// full bytes are in media/check-impact/*.ans.
const b = require("./out-check-impact/check-impact/beats.js");
const fs = require("node:fs");
const fps = b.FPS;
const mmss = (f) => {
  const s = Math.round(f / fps);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const lines = (s) => strip(s).replace(/\n$/, "").split("\n");

// The replay's wrap (src/Demo.tsx, wrapLine), for row counts only.
function rows(line, cols) {
  const indent = line.match(/^ */)[0];
  let start = 0, first = true, n = 1;
  for (;;) {
    const width = first ? cols : cols - indent.length;
    if (line.length - start <= width) return n;
    const limit = start + width;
    let k = line.lastIndexOf(" ", limit);
    if (k <= start + (first ? indent.length : 0)) k = limit;
    while (line[k] === " ") k++;
    start = k; first = false; n++;
  }
}

/** The logical lines a scrolling window shows: from `anchor`'s last line, or the bottom. */
function windowOf(screen, beat, anchor) {
  const { cols, linePx } = beat.type;
  const cap = Math.floor((878 - 40) / linePx);
  const counts = screen.map((l) => rows(l, cols));
  const total = counts.reduce((a, n) => a + n, 0);
  const bottom = Math.max(0, total - cap);
  let start = bottom;
  if (anchor !== undefined) {
    const i = screen.map((l, k) => (l.includes(anchor) ? k : -1)).filter((k) => k >= 0).pop();
    start = Math.min(counts.slice(0, i).reduce((a, n) => a + n, 0), bottom);
  }
  const out = [];
  let row = 0;
  screen.forEach((l, k) => {
    if (row + counts[k] > start && row < start + cap) out.push(l);
    row += counts[k];
  });
  return out;
}

const total = (b.totalFrames / fps).toFixed(1);
let out = `manni check, demo video transcript (silent video; text describes what is on screen)

Frame: 1080x1080, 30 fps, ${total} s. Every terminal line is real output. The CLI is
this branch's build, node dist/cli.js, typed as manni. It runs in
media/scratch-check-impact/, a clone of the manni repository at 9caf1313 with
one commit on top: it rewords line 2 of the doc comment in
src/meta/core/resolve-schema.ts. Six citations pin a range holding that line,
three of them on pages that serve journey m1. Each run waited longer than the
replay shows; a note under the command states the real time, and only the wait
is cut. Lines in [brackets] are those notes, not output.

`;
let t = 0;
let prev = [];
b.beats.forEach((beat, i) => {
  const d = b.beatDurations[i];
  out += `[${mmss(t)}-${mmss(t + d)}] Title: ${beat.title} (${i + 1} / ${b.beats.length})\n`;
  const screen = beat.continues ? [...prev] : [];
  for (const c of beat.commands) {
    out += `$ ${c.typed}\n`;
    if (c.note) out += `${c.note}\n`;
    const o = c.output === "" ? [] : lines(c.output);
    screen.push(`$ ${c.typed}`, ...(c.note ? [c.note] : []), ...o);
    if (c.revealFrames === undefined) out += o.join("\n") + "\n";
    else out += `(${o.length} lines of output scroll past)\n`;
  }
  screen.push("$ ");
  if (beat.scroll !== undefined) {
    if (beat.commands.length > 0)
      out += "On screen when the output settles:\n" + windowOf(screen, beat).join("\n") + "\n";
    if (typeof beat.scroll === "string")
      out += "The view scrolls back to the roll-up's heading:\n" + windowOf(screen, beat, beat.scroll).join("\n") + "\n";
  }
  if (beat.highlight)
    out += `Highlighted rows: lines containing ${beat.highlight.map((h) => JSON.stringify(h)).join(", ")}\n`;
  out += `Caption: ${beat.caption}\n\n`;
  prev = screen.slice(0, -1);
  t += d;
});
fs.writeFileSync("../../check-impact/check-impact-1x1.transcript.txt", out);
console.log(out);
