import { beatDurations, totalFrames, FPS } from "./collections/beats.js";
console.log("beat durations (frames):", beatDurations);
console.log("beat seconds:", beatDurations.map((f) => (f / FPS).toFixed(2)));
console.log("total frames:", totalFrames, "=", (totalFrames / FPS).toFixed(2), "s");
