// WebVTT sidecar from the same beat timings the composition burns in.
// Two lines per cue, matching the frame: the title band, then the caption band.
const b = require("./out-tracevals/tracevals/beats.js");
const fs = require("node:fs");
const fps = b.FPS;
const ts = (f) => {
  const s = f / fps;
  const h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60),
    sec = (s % 60).toFixed(3).padStart(6, "0");
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${sec}`;
};
let out =
  "WEBVTT\n\nNOTE Captions are burned into tracevals-1x1.mp4 (LinkedIn autoplays muted). This sidecar carries the same text for players and for hosts that accept a caption track. Silent video: there is no narration, and the terminal text is in the transcript.\n\n";
let t = 0;
b.beats.forEach((beat, i) => {
  const d = b.beatDurations[i];
  out += `${i + 1}\n${ts(t)} --> ${ts(t + d)}\n${beat.title}\n${beat.caption}\n\n`;
  t += d;
});
fs.writeFileSync("../tracevals-1x1.vtt", out);
console.log(out);
console.log(`total ${(b.totalFrames / fps).toFixed(2)}s (${b.totalFrames} frames)`);
