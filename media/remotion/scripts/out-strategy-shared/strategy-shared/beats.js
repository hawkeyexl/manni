"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.totalFrames = exports.beatDurations = exports.beats = exports.latency = exports.TYPING_MS = exports.FPS = void 0;
const captures_json_1 = __importDefault(require("./captures.json"));
const beats_1 = require("../beats");
Object.defineProperty(exports, "FPS", { enumerable: true, get: function () { return beats_1.FPS; } });
// Typing speed for this video (design.md: 35-70 ms). The fast end: beat 3 types
// an 89-character loop.
exports.TYPING_MS = 35;
// Measured wall-clock latency on this machine, run inside the two scratch
// checkouts (media/strategy-shared/capture/latency.txt: the capture run plus
// three timing runs of each command but git rm, which ran once). check with
// the copy 694-812 ms, git rm 72 ms, check
// without it 577-632 ms, both lists 2247-2535 ms, the join 123-160 ms. Each
// replay is the fastest measured run, rounded up to a whole frame, so output
// never lands sooner than it did. Nothing is compressed.
const at = (ms) => Math.ceil((ms / 1000) * beats_1.FPS);
exports.latency = {
    checkCopy: at(694),
    rm: at(72),
    checkBorrowed: at(577),
    cd: 2,
    lists: at(2247),
    join: at(123),
    echo: 1,
};
const lists = "for r in manni manni-plugin; do (cd $r && manni strategy list -f json > ../$r.json); done";
// Per-beat type, derived by media/strategy-shared/capture/cols.mjs from each beat's
// own lines (see strategy-shared-1x1.script.md). Beat 1 wraps under strategy
// check's 46-column gutter (hang), and its borrowed path and Guide URL break once
// each, after a "/".
const type = (fontPx) => ({ fontPx, linePx: Math.round(fontPx * 1.4), cols: Math.floor(1040 / (0.6 * fontPx)) });
exports.beats = [
    {
        title: "A kept copy of Maya",
        caption: "Two Mayas. The check names the copy.",
        hang: 46,
        highlight: ["strategy/personas/maya.md:3", "Remove this copy"],
        type: type(20),
        commands: [
            { typed: "manni strategy check", output: captures_json_1.default.checkCopy, latencyFrames: exports.latency.checkCopy, holdFrames: 5.0 * beats_1.FPS },
            { typed: "echo $?", output: `${captures_json_1.default.exits.checkCopy}\n`, latencyFrames: exports.latency.echo, holdFrames: 2.0 * beats_1.FPS },
        ],
    },
    {
        title: "Remove the copy",
        caption: "One Maya, read from manni.",
        highlight: ["(85 borrowed)"],
        type: type(32),
        commands: [
            { typed: "git rm strategy/personas/maya.md", output: captures_json_1.default.rm, latencyFrames: exports.latency.rm, holdFrames: 0.8 * beats_1.FPS },
            { typed: "manni strategy check", output: captures_json_1.default.checkBorrowed, latencyFrames: exports.latency.checkBorrowed, holdFrames: 3.2 * beats_1.FPS },
            { typed: "echo $?", output: `${captures_json_1.default.exits.checkBorrowed}\n`, latencyFrames: exports.latency.echo, holdFrames: 2.0 * beats_1.FPS },
        ],
    },
    {
        title: "Pages per journey, per repo",
        caption: "Coverage across products, as data.",
        highlight: ['{"id":'],
        type: type(32),
        commands: [
            { typed: "cd ..", output: "", latencyFrames: exports.latency.cd, holdFrames: 0.3 * beats_1.FPS },
            { typed: lists, output: captures_json_1.default.lists, latencyFrames: exports.latency.lists, holdFrames: 0.5 * beats_1.FPS },
            // 254 characters, too long to type inside the beat, so it lands whole, as a paste.
            // node -e stands in for the docs' jq, which the capture machine does not have.
            { typed: captures_json_1.default.joinTyped, output: captures_json_1.default.join, latencyFrames: exports.latency.join, holdFrames: 4.5 * beats_1.FPS, paste: true },
        ],
    },
];
exports.beatDurations = exports.beats.map((b) => (0, beats_1.timeline)(b, exports.TYPING_MS).duration);
exports.totalFrames = exports.beatDurations.reduce((a, b) => a + b, 0);
