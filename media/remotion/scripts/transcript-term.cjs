// Plain-text transcript: titles, every typed command, the real output (ANSI stripped), captions.
const b = require("./out-term/term/beats.js");
const fs = require("node:fs");
const fps = b.FPS;
const mmss = (f) => { const s = Math.round(f / fps); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const total = (b.totalFrames / fps).toFixed(1);
let out = `manni term and Vale, demo video transcript (silent video; text describes what is on screen)\n\nFrame: 1080x1080, 30 fps, ${total} s. Every terminal line is real output of cat, sed, Vale 3.20.0 and of\n\`node dist/cli.js term ...\` (typed as manni) run inside media/scratch-term/,\na git repository staged from test/fixtures/term/cli/failing/ by media/capture-term/capture.sh.\nIts manni.config.yaml (term.manifests: [glossary.yaml]) and .vale.ini are staged and not shown.\n\n`;
let t = 0;
b.beats.forEach((beat, i) => {
  const d = b.beatDurations[i];
  out += `[${mmss(t)}-${mmss(t + d)}] Title: ${beat.title} (${i + 1} / ${b.beats.length})\n`;
  for (const c of beat.commands) {
    out += `$ ${c.typed}\n`;
    if (c.output !== "") out += strip(c.output).replace(/\n$/, "").split("\n").map((raw) => {
      const l = raw.replace(/ +$/, "");
      if (/ warning  /.test(l)) return `${l}   ("warning" in yellow)`;
      if (/ error  /.test(l)) return `${l}   ("error" in red)`;
      if (/^ docs.fitting\.md$/.test(l)) return `${l}   (underlined)`;
      if (/^✖ /.test(l)) return `${l}   ("1 error" red, "2 warnings" yellow, "0 suggestions" blue)`;
      return l;
    }).join("\n") + "\n";
  }
  if (beat.highlight) out += `Highlighted rows: lines containing ${beat.highlight.map((h) => JSON.stringify(h)).join(", ")}\n`;
  out += `Caption: ${beat.caption}\n\n`;
  t += d;
});
fs.writeFileSync("../term-vale-1x1.transcript.txt", out);
console.log(out);
