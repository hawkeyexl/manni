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
// Measured wall-clock latency, from media/capture-strategy/latency.txt.
// Replayed at 1x: every run is under 0.5 s, so nothing is compressed.
//   check-before  406 ms
//   diff           91 ms
//   check-after   398 ms
//   list          406 ms
exports.latency = {
    checkBefore: Math.round(0.406 * beats_1.FPS),
    diff: Math.round(0.091 * beats_1.FPS),
    checkAfter: Math.round(0.398 * beats_1.FPS),
    list: Math.round(0.406 * beats_1.FPS),
    cat: 2,
    echo: 1,
};
// Type size per beat, derived from each beat's own lines by
// media/capture-strategy/cols.mjs. Beat 2 takes the video's 19 px from Root.tsx:
// strategy check's 46-column gutter holds it there. The others need not shrink with it.
exports.beats = [
    {
        title: "A journey filed as a persona",
        type: { fontPx: 32, linePx: 45, cols: 54 },
        caption: "m1 is a journey, but the guide lists it as a persona.",
        highlight: ["type: journey", "personas: [maya]", "personas: [m1]"],
        commands: [
            { typed: "cat strategy/journeys/m1.md", output: captures_json_1.default["cat strategy/journeys/m1.md"], latencyFrames: exports.latency.cat, holdFrames: 2.0 * beats_1.FPS },
            { typed: "cat docs/guide.md", output: captures_json_1.default["cat docs/guide.md"], latencyFrames: exports.latency.cat, holdFrames: 3.4 * beats_1.FPS },
        ],
    },
    {
        title: "manni strategy check",
        caption: "It suggests maya, and finds m2 with no page. Exit 1.",
        highlight: ['"m1" is a journey', "Did you mean its persona", "no page names this journey"],
        commands: [
            { typed: "manni strategy check", output: captures_json_1.default.checkBefore, latencyFrames: exports.latency.checkBefore, holdFrames: 6.2 * beats_1.FPS },
            { typed: "echo $?", output: `${captures_json_1.default.exits.checkBefore}\n`, latencyFrames: exports.latency.echo, holdFrames: 1.8 * beats_1.FPS },
        ],
    },
    {
        title: "Fix the page, and it passes",
        type: { fontPx: 31, linePx: 43, cols: 55 },
        caption: "The guide now names maya, and both journeys. Exit 0.",
        highlight: ["+personas: [maya]", "+journeys: [m1, m2]", "no findings"],
        commands: [
            { typed: "git diff docs/guide.md", output: captures_json_1.default.diff, latencyFrames: exports.latency.diff, holdFrames: 3.0 * beats_1.FPS },
            { typed: "manni strategy check", output: captures_json_1.default.checkAfter, latencyFrames: exports.latency.checkAfter, holdFrames: 1.6 * beats_1.FPS },
            { typed: "echo $?", output: `${captures_json_1.default.exits.checkAfter}\n`, latencyFrames: exports.latency.echo, holdFrames: 1.8 * beats_1.FPS },
        ],
    },
    {
        title: "manni strategy list",
        type: { fontPx: 24, linePx: 34, cols: 72 },
        caption: "Each record, and how many pages name it. m2 has one.",
        highlight: ["    m2 "],
        commands: [
            { typed: "manni strategy list", output: captures_json_1.default.list, latencyFrames: exports.latency.list, holdFrames: 4.8 * beats_1.FPS },
        ],
    },
];
exports.beatDurations = exports.beats.map((b) => (0, beats_1.timeline)(b, exports.TYPING_MS).duration);
exports.totalFrames = exports.beatDurations.reduce((a, b) => a + b, 0);
