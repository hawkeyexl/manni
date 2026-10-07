// Plain-text transcript: titles, every typed command, the real output (ANSI stripped), captions.
const b = require("./out-system-prompt/system-prompt/beats.js");
const fs = require("node:fs");
const fps = b.FPS;
const mmss = (f) => {
  const s = Math.round(f / fps);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const total = (b.totalFrames / fps).toFixed(1);
let out = `manni tracevals check reads the system prompt the session ran under, demo video transcript (silent video; text describes what is on screen)

Frame: 1080x1080, 30 fps, ${total} s. Every terminal line is real output of grep, tail and
\`node dist/cli.js tracevals check\` (typed as manni), run in a copy of the committed fixture
test/tracevals/fixtures/conformance/project/ with its system-prompt.jsonl and
system-prompt-custom.jsonl traces, staged by media/system-prompt/capture/capture.sh. The
fixture's config extracts and judges with the mock provider, offline and deterministic, as CI
does. No model judged this run.

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
            if (/^\s+! /.test(l) && c.output.includes("\x1b[33m")) return `${l}   (yellow mark)`;
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
out += `The two traces differ only in their recorded system prompt. The default one carries Claude Code's
__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__ marker, so its rules are reported as warnings and the check exits 0.
The custom one has no marker, as a prompt replaced with --system-prompt has none, so its rules are errors
and the check exits 1. The mock judge reads a rule's first code span and finds \`Tests pass\` in the turn.
`;
fs.writeFileSync("../../system-prompt/system-prompt-1x1.transcript.txt", out);
console.log(out);
