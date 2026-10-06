"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.totalFrames = exports.beatDurations = exports.beats = exports.latency = exports.TYPING_MS = exports.FPS = void 0;
const captures_json_1 = __importDefault(require("./captures.json"));
const beats_1 = require("../beats");
Object.defineProperty(exports, "FPS", { enumerable: true, get: function () { return beats_1.FPS; } });
// Typing speed for this video (design.md: 35-70 ms). The fast end, because
// the fix in beat 4 is a 58-character sed line and the video has four beats.
exports.TYPING_MS = 38;
// Measured wall-clock latency on this machine, in media/scratch-family-check/
// (media/family-check/capture/latency.txt: the capture run plus three timing
// runs): status 1159-1190 ms, check 1274-1314 ms, the hook run 1160-1193 ms.
// The replay uses the median of the four, so output never lands at the fast
// end of what was measured. Nothing is sped up.
exports.latency = {
    status: Math.round(1.17 * beats_1.FPS),
    check: Math.round(1.29 * beats_1.FPS),
    hook: Math.round(1.18 * beats_1.FPS),
    sed: 2,
    cat: 2,
    echo: 1,
};
const sed = "sed -i '2a description: Timeouts and retries.' docs/limits.md";
exports.beats = [
    {
        title: "What this repo set up",
        caption: "manni status reads the config and the pages. Two checks are in play here.",
        highlight: ["in play"],
        commands: [
            { typed: "manni status", output: captures_json_1.default.status, latencyFrames: exports.latency.status, holdFrames: 4.6 * beats_1.FPS },
        ],
    },
    {
        title: "One command runs them",
        caption: "A page has no description, so exit 1. What was never set up is skipped.",
        highlight: ["must have required property 'description'", "skipped  "],
        commands: [
            { typed: "manni check", output: captures_json_1.default.check1, latencyFrames: exports.latency.check, holdFrames: 4.4 * beats_1.FPS },
            { typed: "echo $?", output: `${captures_json_1.default.exits.check1}\n`, latencyFrames: exports.latency.echo, holdFrames: 2.0 * beats_1.FPS },
        ],
    },
    {
        title: "The same check, as a hook",
        caption: "Claude Code sends this after an agent's edit. Exit 2 blocks the agent.",
        highlight: ["Fix them before you continue."],
        commands: [
            { typed: "cat hook-edit.json", output: captures_json_1.default["cat hook-edit.json"], latencyFrames: exports.latency.cat, holdFrames: 1.4 * beats_1.FPS },
            { typed: "manni check < hook-edit.json", output: captures_json_1.default.hook, latencyFrames: exports.latency.hook, holdFrames: 4.0 * beats_1.FPS },
            { typed: "echo $?", output: `${captures_json_1.default.exits.hook}\n`, latencyFrames: exports.latency.echo, holdFrames: 2.0 * beats_1.FPS },
        ],
    },
    {
        title: "Fix the page, pass the gate",
        caption: "Add the field. Every check in play passes, exit 0.",
        highlight: ["0 failed"],
        commands: [
            { typed: sed, output: "", latencyFrames: exports.latency.sed, holdFrames: 0.3 * beats_1.FPS },
            { typed: "manni check", output: captures_json_1.default.check2, latencyFrames: exports.latency.check, holdFrames: 2.8 * beats_1.FPS },
            { typed: "echo $?", output: `${captures_json_1.default.exits.check2}\n`, latencyFrames: exports.latency.echo, holdFrames: 3.0 * beats_1.FPS },
        ],
    },
];
exports.beatDurations = exports.beats.map((b) => (0, beats_1.timeline)(b, exports.TYPING_MS).duration);
exports.totalFrames = exports.beatDurations.reduce((a, b) => a + b, 0);
