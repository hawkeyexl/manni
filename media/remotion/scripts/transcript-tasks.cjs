// Plain-text transcript: titles, every typed command, the real output (ANSI stripped), captions.
const b = require("./out-tasks/tasks/beats.js");
const fs = require("node:fs");
const fps = b.FPS;
const mmss = (f) => {
  const s = Math.round(f / fps);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const total = (b.totalFrames / fps).toFixed(1);
const t1Real = (/real\t(\S+)/.exec(strip(b.beats[4].commands[0].more.at(-1).output)) ?? [])[1];
let out = `manni test tasks, demo video transcript (silent video; text describes what is on screen)

Frame: 1080x1080, 30 fps, ${total} s. Every terminal line is real output of the built
\`node dist/cli.js\` (typed as manni). Beat 1 ran in media/scratch-tasks/, a copy of
test/test/fixtures/tasks/red-pr; beat 5 ran from the repo root. Both were captured
by media/capture-tasks/capture.sh, colour on, under bash's time. Beats 2 and 3
replay media/capture-tasks/raw/df1.*, the dogfood run that found the docs bug. It
cannot be re-run, because the page it flags was fixed. It took about 12.6 minutes:
28 s of Claude Code, then about 12 minutes of judging
(media/capture-tasks/df1-timing.txt). Beat 4 replays raw/theo-fix.*, the same task
rerun after the page fix: 37 s of Claude Code, then judging, whose time was not
recorded. Beats 2 to 4 were captured to files, without colour. Beat 5 took
${t1Real}, its real line on screen. The replay shortens only the waits; typing
and output are 1x. The long command in beats 2 and 4 is pasted, not typed.

`;
let t = 0;
const lines = (s) => strip(s).replace(/\n$/, "");
// Beats 2 to 4 replay reports taller than the frame. For them the transcript
// lists the rows the frame shows, between two lines of the real output.
const rows = (c) => lines([c.output, ...c.more.map((m) => m.output)].join("")).split("\n");
const between = (all, from, to) => {
  const i = all.findIndex((l) => l.includes(from));
  const j = all.findIndex((l) => l.includes(to));
  return all.slice(i, j + 1).join("\n") + "\n";
};
const df1 = rows(b.beats[1].commands[0]);
const fix = rows(b.beats[3].commands[0]);
const onScreen = {
  "Hand Theo the task": between(df1, "task as theo", "to pin it.") + "(judging; the beat ends before the report prints)\n",
  "Where Theo got stuck":
    "The report prints. Rows on screen, scrolling from Account to the account's last line:\n" +
    between(df1, "  Account", "didn't read it because"),
  "Same task, fixed page": between(fix, "task as theo", "    ```yaml") + "(the account continues below the frame)\n",
};
b.beats.forEach((beat, i) => {
  const d = b.beatDurations[i];
  out += `[${mmss(t)}-${mmss(t + d)}] Title: ${beat.title} (${i + 1} / ${b.beats.length})\n`;
  if (beat.continues) out += "(Same screen as the beat before, scrolled.)\n";
  for (const c of beat.commands) {
    out += `$ ${c.typed}${c.paste ? "   (pasted)" : ""}\n`;
    if (onScreen[beat.title]) continue;
    const all = [c.output, ...(c.more ?? []).map((m) => m.output)].filter((o) => o !== "");
    if (all.length) out += lines(all.join("")) + "\n";
  }
  if (onScreen[beat.title]) out += onScreen[beat.title];
  if (beat.highlight)
    out += `Highlighted rows: lines containing ${beat.highlight.map((h) => JSON.stringify(h.trim())).join(", ")}\n`;
  out += `Caption: ${beat.caption}\n\n`;
  t += d;
});
out += "Colour: in beats 1 and 5, PASS is green, the failed file and its summary red, the\nfield path (root) cyan, locations dim. Beats 2 to 4 are uncoloured, as captured.\n";
fs.writeFileSync("../../test-tasks-1x1.transcript.txt", out);
console.log(out);
