"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.totalFrames = exports.beatDurations = exports.beats = exports.latency = exports.TYPING_MS = exports.FPS = void 0;
const captures_json_1 = __importDefault(require("./captures.json"));
const beats_1 = require("../beats");
Object.defineProperty(exports, "FPS", { enumerable: true, get: function () { return beats_1.FPS; } });
// Typing speed for this video (design.md: 35-70 ms). The quick end of the range:
// nine commands and five beats in under 45 s.
exports.TYPING_MS = 35;
// Measured wall-clock latency on this machine, run in C:\concepts
// (media/capture-concepts/latency.txt: the capture run plus three timing runs):
// term check 375-416 ms (both runs), term fill --offline 1864-1902 ms,
// graph build 708-722 ms, graph fill 7333-7381 ms, graph check 604-637 ms.
// Output never appears sooner than measured, with one disclosed exception.
//
// graph fill runs a 3B model on CPU for 7.35 s, a sixth of the video. The
// replay shortens that wait, and only that wait, by 1/3.5 to 2.1 s. design.md
// allows compressing static wait and requires the real elapsed time on screen:
// bash's own `time` line is in frame, unedited. Typing and output stay 1x.
const COMPRESS = 3.5;
exports.latency = {
    check: Math.round(0.4 * beats_1.FPS),
    termFill: Math.round(1.9 * beats_1.FPS),
    build: Math.round(0.72 * beats_1.FPS),
    graphFill: Math.round((7.35 / COMPRESS) * beats_1.FPS),
    graphCheck: Math.round(0.63 * beats_1.FPS),
    grep: 2,
    sed: 2,
};
// `; echo $?` prints the exit code the capture recorded for that run.
const withExit = (name) => `${captures_json_1.default[name]}${captures_json_1.default.exits[name]}\n`;
exports.beats = [
    {
        title: "Concepts nobody defined",
        caption: "Pages name concepts freely. Retry and Quota have no term page, so term check fails: exit 1.",
        highlight: ["undefined-term"],
        commands: [
            { typed: "grep concepts: docs/*.md", output: captures_json_1.default.grep, latencyFrames: exports.latency.grep, holdFrames: 1.3 * beats_1.FPS },
            { typed: "manni term check; echo $?", output: withExit("check before"), latencyFrames: exports.latency.check, holdFrames: 3.6 * beats_1.FPS },
        ],
    },
    {
        title: "term fill --offline",
        caption: "--offline sends nothing off the machine. With no local model, term fill writes a stub per concept.",
        highlight: ["created "],
        commands: [
            { typed: "manni term fill --offline", output: captures_json_1.default.fill, latencyFrames: exports.latency.termFill, holdFrames: 3.4 * beats_1.FPS },
        ],
    },
    {
        title: "What is left to write",
        caption: "No undefined terms left. check now names the two definitions a person, or a model, still writes.",
        highlight: ["missing-definition"],
        commands: [
            { typed: "manni term check; echo $?", output: withExit("check after"), latencyFrames: exports.latency.check, holdFrames: 3.4 * beats_1.FPS },
        ],
    },
    {
        title: "Questions pinned to answers",
        caption: "3 concepts, all from the termbase. A local model pins each page's question to its answer's lines.",
        highlight: ["3 from the termbase", "re-pinned", "paired", "real"],
        commands: [
            { typed: "manni graph build", output: captures_json_1.default.build, latencyFrames: exports.latency.build, holdFrames: 1.0 * beats_1.FPS },
            {
                typed: "time manni graph fill docs/*.md --fields sample-questions --offline",
                output: captures_json_1.default["graph fill"],
                latencyFrames: exports.latency.graphFill,
                holdFrames: 4.0 * beats_1.FPS,
            },
        ],
    },
    {
        title: "The answer changed",
        caption: "Edit the pinned line, and graph check flags the question: its answer is no longer there.",
        highlight: ["no longer hold", "1 changed"],
        commands: [
            { typed: "sed -i 's/one gigabyte/two gigabytes/' docs/limits.md", output: "", latencyFrames: exports.latency.sed, holdFrames: 0.5 * beats_1.FPS },
            { typed: "manni graph check; echo $?", output: withExit("graph check"), latencyFrames: exports.latency.graphCheck, holdFrames: 4.8 * beats_1.FPS },
        ],
    },
];
exports.beatDurations = exports.beats.map((b) => (0, beats_1.timeline)(b, exports.TYPING_MS).duration);
exports.totalFrames = exports.beatDurations.reduce((a, b) => a + b, 0);
