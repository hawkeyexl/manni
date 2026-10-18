"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.totalFrames = exports.beatDurations = exports.beats = exports.latency = exports.TYPING_MS = exports.FPS = void 0;
const captures_json_1 = __importDefault(require("./captures.json"));
const beats_1 = require("../beats");
Object.defineProperty(exports, "FPS", { enumerable: true, get: function () { return beats_1.FPS; } });
// Typing speed for this video (design.md: 35-70 ms). Near the quick end,
// because three of the five typed lines are over 40 characters.
exports.TYPING_MS = 38;
// Measured wall-clock latency, from media/capture-test/latency.txt:
//   fail     7.765 s
//   github   8.013 s
//   pass     7.802 s
// Almost all of it is Doc Detective starting up. Three 8 s waits would be
// more than half the video, so the replay shortens the wait between Enter and
// the output, **all three by the same factor, 1/4**. design.md allows
// compressing static wait only, and requires the real elapsed time on screen:
// bash's own `time` output is in frame, unedited, for every run. Typing and
// output are 1x.
const COMPRESS = 4;
exports.latency = {
    fail: Math.round((7.765 / COMPRESS) * beats_1.FPS), // 58 frames, 1.94 s
    github: Math.round((8.013 / COMPRESS) * beats_1.FPS), // 60 frames, 2.00 s
    pass: Math.round((7.802 / COMPRESS) * beats_1.FPS), // 59 frames, 1.95 s
    cat: 2,
    sed: 2,
    echo: 1,
};
const run = "time manni test run fail.md --no-progress";
const github = "time manni test run fail.md -f github --no-progress";
exports.beats = [
    {
        title: "A page that tests itself",
        caption: "fail.md carries an inline Doc Detective test. Its step runs exit 1 and expects 0.",
        highlight: ['"exit 1"'],
        commands: [
            { typed: "cat fail.md", output: captures_json_1.default["cat fail.md"], latencyFrames: exports.latency.cat, holdFrames: 4.6 * beats_1.FPS },
        ],
    },
    {
        title: "Run the page",
        caption: "manni test run names the file, line 4 and Doc Detective's reason. Exit 1.",
        highlight: ["FAIL", "1 failed"],
        commands: [
            { typed: run, output: captures_json_1.default.fail, latencyFrames: exports.latency.fail, holdFrames: 4.4 * beats_1.FPS },
            { typed: "echo $?", output: `${captures_json_1.default.exits.fail}\n`, latencyFrames: exports.latency.echo, holdFrames: 2.4 * beats_1.FPS },
        ],
    },
    {
        title: "Annotations for CI",
        caption: "With -f github, the same failure is an annotation on fail.md, line 4.",
        highlight: ["::error"],
        commands: [
            { typed: github, output: captures_json_1.default.github, latencyFrames: exports.latency.github, holdFrames: 4.4 * beats_1.FPS },
        ],
    },
    {
        title: "Fix the page, rerun",
        caption: "Correct line 4 and rerun. One test passed, exit 0.",
        highlight: ["s/exit 1/exit 0/", "1 passed"],
        commands: [
            { typed: "sed -i 's/exit 1/exit 0/' fail.md", output: "", latencyFrames: exports.latency.sed, holdFrames: 0.6 * beats_1.FPS },
            { typed: run, output: captures_json_1.default.pass, latencyFrames: exports.latency.pass, holdFrames: 3.0 * beats_1.FPS },
            { typed: "echo $?", output: `${captures_json_1.default.exits.pass}\n`, latencyFrames: exports.latency.echo, holdFrames: 3.2 * beats_1.FPS },
        ],
    },
];
exports.beatDurations = exports.beats.map((b) => (0, beats_1.timeline)(b, exports.TYPING_MS).duration);
exports.totalFrames = exports.beatDurations.reduce((a, b) => a + b, 0);
