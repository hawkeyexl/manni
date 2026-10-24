"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.totalFrames = exports.beatDurations = exports.beats = exports.latency = exports.TYPING_MS = exports.FPS = void 0;
const captures_json_1 = __importDefault(require("./captures.json"));
const beats_1 = require("../beats");
Object.defineProperty(exports, "FPS", { enumerable: true, get: function () { return beats_1.FPS; } });
// Typing speed for this video (design.md: 35-70 ms). The cite add line is 92
// characters, so the floor of the range.
exports.TYPING_MS = 35;
// Measured wall-clock latency, from media/evidence-pins/capture/latency.txt.
// Replayed at 1x: every run is under 0.7 s, so nothing is compressed.
//   add             489 ms
//   check-current   405 ms
//   diff-persona     58 ms
//   check-moved     417 ms
//   update          428 ms
//   diff-note        57 ms
//   check-changed   660 ms
exports.latency = {
    add: Math.round(0.489 * beats_1.FPS),
    checkCurrent: Math.round(0.405 * beats_1.FPS),
    diffPersona: Math.round(0.058 * beats_1.FPS),
    checkMoved: Math.round(0.417 * beats_1.FPS),
    update: Math.round(0.428 * beats_1.FPS),
    diffNote: Math.round(0.057 * beats_1.FPS),
    checkChanged: Math.round(0.66 * beats_1.FPS),
    cat: 2,
    echo: 1,
};
const THEO = "records/personas/theo.md";
const NOTE = "research/contributor.md";
// Type size per beat, derived from each beat's own lines by
// media/evidence-pins/capture/cols.mjs. Beat 4 takes the video's 19 px from Root.tsx:
// its moved pin row is 87 characters, and every larger size leaves one word
// alone on a row. The others need not shrink with it.
exports.beats = [
    {
        title: "A persona's pains",
        type: { fontPx: 27, linePx: 38, cols: 64 },
        caption: "A persona makes claims. What do they rest on?",
        highlight: ["pains:", "  - Error messages are terse"],
        commands: [{ typed: `cat ${THEO}`, output: captures_json_1.default.catPersona, latencyFrames: exports.latency.cat, holdFrames: 2.3 * beats_1.FPS }],
    },
    {
        title: "manni cite add",
        type: { fontPx: 29, linePx: 41, cols: 59 },
        caption: "Pin the first pain to line 3 of an interview note.",
        highlight: ["added terse-messages"],
        commands: [
            {
                typed: `manni cite add ${THEO}#/pains/0 ${NOTE}:3 --id terse-messages`,
                output: captures_json_1.default.add,
                latencyFrames: exports.latency.add,
                holdFrames: 3.1 * beats_1.FPS,
            },
        ],
    },
    {
        title: "manni cite check",
        type: { fontPx: 26, linePx: 36, cols: 66 },
        caption: "The pain and its evidence both read current.",
        highlight: ["#/pains/0 current"],
        commands: [
            { typed: `manni cite check ${THEO}`, output: captures_json_1.default["check-current"], latencyFrames: exports.latency.checkCurrent, holdFrames: 2.2 * beats_1.FPS },
        ],
    },
    {
        title: "The pains reorder",
        caption: "The pin follows the moved value. update rewrites it.",
        highlight: ["#/pains/0 moved -> #/pains/1", "claim #/pains/0 -> #/pains/1"],
        commands: [
            { typed: `git diff -U1 ${THEO}`, output: captures_json_1.default["diff-persona"], latencyFrames: exports.latency.diffPersona, holdFrames: 1.2 * beats_1.FPS },
            { typed: `manni cite check ${THEO}`, output: captures_json_1.default["check-moved"], latencyFrames: exports.latency.checkMoved, holdFrames: 2.3 * beats_1.FPS },
            { typed: `manni cite update ${THEO}`, output: captures_json_1.default.update, latencyFrames: exports.latency.update, holdFrames: 1.8 * beats_1.FPS },
        ],
    },
    {
        title: "The evidence changes",
        type: { fontPx: 23, linePx: 32, cols: 75 },
        caption: "The evidence changed, so the check fails. Exit 1.",
        highlight: ["+- The error named", "changed since", "manni:cite source-changed"],
        commands: [
            { typed: `git diff ${NOTE}`, output: captures_json_1.default["diff-note"], latencyFrames: exports.latency.diffNote, holdFrames: 1.3 * beats_1.FPS },
            { typed: `manni cite check ${THEO}`, output: captures_json_1.default["check-changed"], latencyFrames: exports.latency.checkChanged, holdFrames: 2.4 * beats_1.FPS },
            { typed: "echo $?", output: `${captures_json_1.default.exits["check-changed"]}\n`, latencyFrames: exports.latency.echo, holdFrames: 1.6 * beats_1.FPS },
        ],
    },
];
exports.beatDurations = exports.beats.map((b) => (0, beats_1.timeline)(b, exports.TYPING_MS).duration);
exports.totalFrames = exports.beatDurations.reduce((a, b) => a + b, 0);
