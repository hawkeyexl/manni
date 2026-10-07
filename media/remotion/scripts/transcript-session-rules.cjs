// Plain-text transcript: titles, every typed command, the real output (ANSI stripped), captions.
const b = require("./out-session-rules/session-rules/beats.js");
const fs = require("node:fs");
const fps = b.FPS;
const mmss = (f) => {
  const s = Math.round(f / fps);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const total = (b.totalFrames / fps).toFixed(1);
let out = `manni tracevals check holds a session to what it was asked, demo video transcript (silent video; text describes what is on screen)

Frame: 1080x1080, 30 fps, ${total} s. Every terminal line is real output of grep, tail and
\`node dist/cli.js tracevals check\` (typed as manni), run in a copy of the committed fixture
test/tracevals/fixtures/conformance/requests/ with its requests.jsonl trace, staged by
media/session-rules/capture/capture.sh. The fixture's config extracts and judges with the
mock provider, offline and deterministic, as CI does. No model judged this run.

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
            if (/^\s+not-followed /.test(l) && c.output.includes("\x1b[2m")) return `${l}   (dim)`;
            return l;
          })
          .join("\n") + "\n";
  }
  if (beat.highlight)
    out += `Highlighted rows: lines containing ${beat.highlight.map((h) => JSON.stringify(h)).join(", ")}\n`;
  out += `Caption: ${beat.caption}\n\n`;
  t += d;
});
out += `Beat 4 is the same check with -f json, filtered to its sources. Every source after CLAUDE.md is new in
proposal 0080: the typed prompts, the approved plan, and the Spec Kit, Kiro, OpenSpec and plans files
the session touched. The mock judge reads a rule's code span only, so it judges T014 in
specs/001-login/tasks.md followed (T014 names no code span). This video does not show a ticked task caught.
`;
fs.writeFileSync("../../session-rules/session-rules-1x1.transcript.txt", out);
console.log(out);
