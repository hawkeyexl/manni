// WebVTT sidecar from the same beat timings the composition burns in.
const b = require("./out-docevals-formats/docevals-formats/beats.js");
const fs = require("node:fs");
const fps = b.FPS;
const ts = (f) => { const s = f / fps; const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = (s % 60).toFixed(3).padStart(6, "0"); return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${sec}`; };
// Cue text is markup in WebVTT: tags such as <MadCap:glossaryTerm> are escaped, or a player drops them as tags.
const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
let out = "WEBVTT\n\nNOTE Silent video. Cues are the on-screen step captions; the terminal text is in the transcript.\n\n";
let t = 0;
b.beats.forEach((beat, i) => {
  const d = b.beatDurations[i];
  out += `${i + 1}\n${ts(t)} --> ${ts(t + d)}\n${esc(`${beat.title}: ${beat.caption}`)}\n\n`;
  t += d;
});
fs.writeFileSync("../docevals-formats-1x1.vtt", out);
console.log(out);
console.log(`total ${(b.totalFrames / fps).toFixed(2)}s (${b.totalFrames} frames)`);
