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
// because beat 4 types a 73-character command.
exports.TYPING_MS = 38;
// Measured wall-clock latency, from media/capture-cite-adopts/latency.txt.
// Replayed at 1x: every run is under 1 s, so nothing is compressed.
//   b2-check  624 ms
//   b3-add    695 ms
//   b4-add    744 ms
//   b5-check  568 ms
//   b5-diff    66 ms (git)
exports.latency = {
    b2: Math.round(0.624 * beats_1.FPS),
    b3: Math.round(0.695 * beats_1.FPS),
    b4: Math.round(0.744 * beats_1.FPS),
    b5: Math.round(0.568 * beats_1.FPS),
    git: Math.round(0.066 * beats_1.FPS),
    cat: 2,
};
const page = "docs/design/retry.md";
// A check is typed with `; echo $?`, so its exit code prints under the summary.
const withExit = (output, exit) => `${output}${exit}\n`;
exports.beats = [
    {
        title: "Spec before code",
        caption: "The spec comes first. A marker names two claims that no entry pins yet.",
        highlight: ["cite retry-default", "Failed requests"],
        commands: [{ typed: `cat -n ${page}`, output: captures_json_1.default.b1, latencyFrames: exports.latency.cat, holdFrames: 3.2 * beats_1.FPS }],
    },
    {
        title: "The to-do list",
        caption: "check lists a marker-orphan for each id. Exit 1 is the to-do list.",
        highlight: ["marker-orphan"],
        commands: [
            { typed: `manni cite check ${page}; echo $?`, output: withExit(captures_json_1.default.b2, captures_json_1.default.exits.b2), latencyFrames: exports.latency.b2, holdFrames: 5.0 * beats_1.FPS },
        ],
    },
    {
        title: "Pin the first claim",
        caption: "add adopts the marker. No --marker flag, and the sentence is untouched.",
        highlight: ["adopted the marker"],
        commands: [
            { typed: `manni cite add ${page}:7 lib/limits.ts:2 --id retry-default`, output: captures_json_1.default.b3, latencyFrames: exports.latency.b3, holdFrames: 4.8 * beats_1.FPS },
        ],
    },
    {
        title: "Pin the second claim",
        caption: "The sentence sits at line 16 now. The first entry grew the frontmatter.",
        highlight: ["adopted the marker"],
        commands: [
            { typed: `manni cite add ${page}:16 lib/limits.test.ts:1 --id retry-default-test`, output: captures_json_1.default.b4, latencyFrames: exports.latency.b4, holdFrames: 4.4 * beats_1.FPS },
        ],
    },
    {
        title: "Nothing left to fix",
        caption: "Both rows current, exit 0. The diff holds insertions only, no edits.",
        // 22 px / 78 columns: the check rows are 77 characters, and 66 columns would orphan "current".
        type: { fontPx: 22, linePx: 31, cols: 78 },
        highlight: ["marker :23", "0 findings", "insertions"],
        commands: [
            { typed: `manni cite check ${page}; echo $?`, output: withExit(captures_json_1.default.b5, captures_json_1.default.exits.b5), latencyFrames: exports.latency.b5, holdFrames: 2.4 * beats_1.FPS },
            { typed: `git diff --stat ${page}`, output: captures_json_1.default.b5diff, latencyFrames: exports.latency.git, holdFrames: 3.4 * beats_1.FPS },
        ],
    },
];
exports.beatDurations = exports.beats.map((b) => (0, beats_1.timeline)(b, exports.TYPING_MS).duration);
exports.totalFrames = exports.beatDurations.reduce((a, b) => a + b, 0);
