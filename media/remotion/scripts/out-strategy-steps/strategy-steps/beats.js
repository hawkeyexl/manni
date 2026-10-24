"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.totalFrames = exports.beatDurations = exports.beats = exports.latency = exports.TYPING_MS = exports.FPS = void 0;
const captures_json_1 = __importDefault(require("./captures.json"));
const beats_1 = require("../beats");
Object.defineProperty(exports, "FPS", { enumerable: true, get: function () { return beats_1.FPS; } });
// Typing speed for this video (design.md: 35-70 ms). Every command is short,
// so the shared 45 ms default.
exports.TYPING_MS = 45;
// Measured wall-clock latency, from media/capture-strategy-steps/latency.txt.
// Replayed at 1x: every run is under 0.7 s, so nothing is compressed.
//   check-before  611 ms
//   diff           98 ms
//   get           597 ms
exports.latency = {
    checkBefore: Math.round(0.611 * beats_1.FPS),
    diff: Math.round(0.098 * beats_1.FPS),
    get: Math.round(0.597 * beats_1.FPS),
    cat: 2,
    echo: 1,
};
// Type size per beat, derived from each beat's own lines by
// media/capture-strategy-steps/cols.mjs. Beat 2 takes the video's 19 px from
// Root.tsx and wraps under strategy check's 46-column gutter (hang). The others
// take the largest size at which none of their lines wraps.
exports.beats = [
    {
        title: "A journey lists its steps",
        type: { fontPx: 32, linePx: 45, cols: 54 },
        caption: "A journey lists the pages it walks through, in order.",
        highlight: ["steps:", "doc: docs/reference.md", "exists: false"],
        commands: [
            { typed: "cat strategy/journeys/m1.md", output: captures_json_1.default["cat strategy/journeys/m1.md"], latencyFrames: exports.latency.cat, holdFrames: 5.0 * beats_1.FPS },
        ],
    },
    {
        title: "manni strategy check",
        hang: 46,
        caption: "Step 3's page skips m1. Step 4 is unwritten. Exit 0.",
        highlight: ['does not name "m1"', "names a page that does not exist"],
        commands: [
            { typed: "manni strategy check", output: captures_json_1.default.checkBefore, latencyFrames: exports.latency.checkBefore, holdFrames: 7.0 * beats_1.FPS },
            { typed: "echo $?", output: `${captures_json_1.default.exits.checkBefore}\n`, latencyFrames: exports.latency.echo, holdFrames: 1.8 * beats_1.FPS },
        ],
    },
    {
        title: "The page joins the journey",
        type: { fontPx: 32, linePx: 45, cols: 54 },
        caption: "The reference page names m1, its persona and audience.",
        highlight: ["+journeys: [m1]"],
        commands: [
            { typed: "git diff docs/reference.md", output: captures_json_1.default.diff, latencyFrames: exports.latency.diff, holdFrames: 4.2 * beats_1.FPS },
        ],
    },
    {
        title: "manni strategy get m1",
        type: { fontPx: 24, linePx: 34, cols: 72 },
        caption: "Coverage, in order: 3 of 4 served, 1 unwritten.",
        highlight: ["3 of 4 served", "unwritten"],
        commands: [
            { typed: "manni strategy get m1", output: captures_json_1.default.get, latencyFrames: exports.latency.get, holdFrames: 6.4 * beats_1.FPS },
        ],
    },
];
exports.beatDurations = exports.beats.map((b) => (0, beats_1.timeline)(b, exports.TYPING_MS).duration);
exports.totalFrames = exports.beatDurations.reduce((a, b) => a + b, 0);
