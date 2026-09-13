// WebVTT sidecar from the same beat timings the composition burns in.
const b = require("./out-join/join/beats.js");
const fs = require("node:fs");
const fps = b.FPS;
const ts = (f) => { const s = f / fps; const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = (s % 60).toFixed(3).padStart(6, "0"); return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${sec}`; };
let out = "WEBVTT\n\nNOTE Silent video. Cues are the on-screen step captions; the terminal text is in the transcript.\n\n";
let t = 0;
b.beats.forEach((beat, i) => {
  const d = b.beatDurations[i];
  out += `${i + 1}\n${ts(t)} --> ${ts(t + d)}\n${beat.title}: ${beat.caption}\n\n`;
  t += d;
});
fs.writeFileSync("../sidecar-join-1x1.vtt", out);
console.log(out);
console.log(`total ${(b.totalFrames / fps).toFixed(1)}s (${b.totalFrames} frames)`);
