"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.totalFrames = exports.beatDurations = exports.beats = exports.TYPING_MS = exports.FPS = void 0;
const captures_json_1 = __importDefault(require("./captures.json"));
const beats_1 = require("../beats");
Object.defineProperty(exports, "FPS", { enumerable: true, get: function () { return beats_1.FPS; } });
// Typing speed for this video (design.md: 35-70 ms). 40 ms keeps the jq line
// under 3 s.
exports.TYPING_MS = 40;
// Measured wall-clock latency, from media/check-impact/latency.txt:
//   check-red    42461 ms
//   jq           26751 ms (manni check -f json | jq, one pipe)
//   accept        7023 ms
//   check-green  21212 ms
// Every one is a static wait: manni check prints its whole report at the end.
// design.md caps a speed-up at 1.3x and says to cut dead air above it, so each
// wait is cut, and only the wait. A chrome note under the command states the
// real time while the cut wait is on screen. Typing is at 1x.
const s = (sec) => Math.round(sec * beats_1.FPS);
const sec = (key) => (captures_json_1.default.ms[key] / 1000).toFixed(1);
const note = (key, shown) => `[${sec(key)} s run; the wait is cut to ${shown} s]`;
// manni check writes ~2,700 lines at once. A terminal scrolls them past in
// a moment; the replay lands them over 0.8 s so the scroll reads as one.
const DUMP = s(0.8);
// Type size, derived by media/check-impact/cols.mjs over the windows on
// screen: 28 px / 61 columns is the largest size at which every window wraps
// at spaces, splits no token and leaves no one-word last row.
const type = { fontPx: 28, linePx: 39, cols: 61 };
const HEAD = "The pages with findings serve";
const jq = `manni check -f json | jq -r '.impact[] | select(.id == "m1") | .pages[]'`;
exports.beats = [
    {
        title: "One red run",
        type,
        scroll: true,
        caption: "manni check runs every check. 2,696 lines go by.",
        highlight: ["checks over 345 files"],
        commands: [
            {
                typed: "manni check",
                note: note("check-red", 1.5),
                output: captures_json_1.default.checkRed,
                latencyFrames: s(1.5),
                revealFrames: DUMP,
                holdFrames: s(2.2),
            },
        ],
    },
    {
        title: "Who the red run hurts",
        type,
        continues: true,
        scroll: HEAD,
        caption: "Readers ranked worst first. M1 tops the journeys.",
        highlight: [HEAD, "Stand up metadata validation for my repo"],
        commands: [],
        pauseFrames: s(5.4),
    },
    {
        title: "M1's pages, for a script",
        type,
        caption: "The same roll-up in JSON. jq lists M1's six pages.",
        commands: [
            { typed: jq, note: note("jq", 1.5), output: captures_json_1.default.jq, latencyFrames: s(1.5), holdFrames: s(4.6) },
        ],
    },
    {
        title: "Re-mint, then rerun",
        type,
        scroll: HEAD,
        caption: "Re-mint the six pins. 0 failed, and M1 leaves the top.",
        highlight: ["checks over 345 files", HEAD],
        commands: [
            {
                typed: "manni cite update --accept | tail -n 1",
                note: note("accept", 1),
                output: captures_json_1.default.accept,
                latencyFrames: s(1),
                holdFrames: s(1.4),
            },
            {
                typed: "manni check",
                note: note("check-green", 1.5),
                output: captures_json_1.default.checkGreen,
                latencyFrames: s(1.5),
                revealFrames: DUMP,
                holdFrames: s(1.8),
            },
        ],
        pauseFrames: s(4.4),
    },
];
exports.beatDurations = exports.beats.map((b) => (0, beats_1.timeline)(b, exports.TYPING_MS).duration);
exports.totalFrames = exports.beatDurations.reduce((a, b) => a + b, 0);
