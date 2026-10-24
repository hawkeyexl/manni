"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.totalFrames = exports.beatDurations = exports.beats = exports.latency = exports.TYPING_MS = exports.FPS = void 0;
const captures_json_1 = __importDefault(require("./captures.json"));
const beats_1 = require("../beats");
Object.defineProperty(exports, "FPS", { enumerable: true, get: function () { return beats_1.FPS; } });
// Typing speed for this video (design.md: 35-70 ms). The shared 45 ms default.
exports.TYPING_MS = 45;
// Measured wall-clock latency, from media/capture-personas/latency.txt:
//   run-before  8192 ms (bash `time`: real 0m8.172s)
//   diff          57 ms
//   run-after   8114 ms (bash `time`: real 0m8.095s)
// Each judged run is two real calls to a 3B model on this machine. The replay
// shortens that wait, and only that wait, by 1/3.5 to 2.3 s. design.md allows
// compressing static wait and requires the real elapsed time on screen: bash's
// own `time` line is in frame, unedited. Typing and output stay 1x.
const COMPRESS = 3.5;
exports.latency = {
    runBefore: Math.round((8.172 / COMPRESS) * beats_1.FPS),
    diff: 2,
    runAfter: Math.round((8.095 / COMPRESS) * beats_1.FPS),
    cat: 2,
    echo: 1,
};
const run = "time manni docevals run docs/one-reader.md --ai-only";
// Type size per beat, derived from each beat's own lines by
// media/capture-personas/cols.mjs. Beat 2 takes the video's 21 px from Root.tsx:
// the judge's reasoning and the notices wrap there, and its 28 rows fit.
exports.beats = [
    {
        title: "One eval reads as Theo",
        type: { fontPx: 27, linePx: 38, cols: 64 },
        caption: "readers: personas on one eval. The page names theo.",
        highlight: ["readers: personas", "- theo"],
        commands: [{ typed: "cat docs/one-reader.md", output: captures_json_1.default["cat docs/one-reader.md"], latencyFrames: exports.latency.cat, holdFrames: 4.6 * beats_1.FPS }],
    },
    {
        title: "manni docevals run",
        caption: "Read as theo: FAIL. The untagged eval passes. Exit 1.",
        highlight: ["(read as theo)", "No statement on which schema fired", "0m8."],
        commands: [
            { typed: run, output: captures_json_1.default.runBefore, latencyFrames: exports.latency.runBefore, holdFrames: 6.6 * beats_1.FPS },
            { typed: "echo $?", output: `${captures_json_1.default.exits.runBefore}\n`, latencyFrames: exports.latency.echo, holdFrames: 1.8 * beats_1.FPS },
        ],
    },
    {
        title: "Speak to Theo's pains",
        type: { fontPx: 27, linePx: 38, cols: 64 },
        caption: "He can't tell which schema fired. Now the page says.",
        highlight: ["names its schema", "schema: house"],
        commands: [{ typed: "git diff docs/one-reader.md", output: captures_json_1.default.diff, latencyFrames: exports.latency.diff, holdFrames: 3.6 * beats_1.FPS }],
    },
    {
        title: "Run it again",
        type: { fontPx: 25, linePx: 35, cols: 69 },
        caption: "Passes, read as theo. Exit 0. Waits shown 3.5x faster.",
        highlight: ["(read as theo)", "0m8."],
        commands: [
            { typed: run, output: captures_json_1.default.runAfter, latencyFrames: exports.latency.runAfter, holdFrames: 2.6 * beats_1.FPS },
            { typed: "echo $?", output: `${captures_json_1.default.exits.runAfter}\n`, latencyFrames: exports.latency.echo, holdFrames: 2.4 * beats_1.FPS },
        ],
    },
];
exports.beatDurations = exports.beats.map((b) => (0, beats_1.timeline)(b, exports.TYPING_MS).duration);
exports.totalFrames = exports.beatDurations.reduce((a, b) => a + b, 0);
