"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.totalFrames = exports.beatDurations = exports.beats = exports.latency = exports.TYPING_MS = exports.FPS = void 0;
const captures_json_1 = __importDefault(require("./captures.json"));
const beats_1 = require("../beats");
Object.defineProperty(exports, "FPS", { enumerable: true, get: function () { return beats_1.FPS; } });
// Typing speed for this video (design.md: 35-70 ms). Two of the three typed
// lines are 56 characters, so the fast end of the range keeps the whole thing
// inside 40 s without touching a hold.
exports.TYPING_MS = 38;
// Measured wall-clock latency on this machine, in ~/demo
// (media/capture-tracevals/latency.txt: the capture run plus three timing
// runs): session-1 701-731 ms, session-2 705-730 ms. Output never appears
// sooner than measured.
exports.latency = {
    run: Math.round(0.72 * beats_1.FPS),
    cat: 2,
    echo: 1,
};
exports.beats = [
    {
        title: "The rules, and the checks",
        caption: "CLAUDE.md states two house rules. It now carries the evals that encode them.",
        highlight: [
            "- Source edits go through the fix-bug skill.",
            "id: source-edits-use-the-skill",
        ],
        commands: [
            {
                typed: "cat CLAUDE.md",
                output: captures_json_1.default["cat CLAUDE.md"],
                latencyFrames: exports.latency.cat,
                holdFrames: 6.6 * beats_1.FPS,
            },
        ],
    },
    {
        title: "Grade a real session",
        // No hyphenated word may land on a caption line break: the band wraps at
        // the hyphen, and "fix-" / "bug skill." reads as a typo (design.md check 2).
        caption: "It read before editing. It edited src/ without the skill. One eval fails, exit 1.",
        highlight: [
            "FAIL",
            "skill fix-bug was never invoked",
        ],
        commands: [
            {
                typed: "manni tracevals run session-1.jsonl --deterministic-only",
                output: captures_json_1.default["run session-1"],
                latencyFrames: exports.latency.run,
                holdFrames: 5.8 * beats_1.FPS,
            },
            {
                typed: "echo $?",
                output: `${captures_json_1.default.exits.run1}\n`,
                latencyFrames: exports.latency.echo,
                holdFrames: 2.6 * beats_1.FPS,
            },
        ],
    },
    {
        title: "The next session",
        caption: "Same rules, same gate. This session used the skill: both evals pass, exit 0.",
        highlight: ["PASS", "2 pass"],
        commands: [
            {
                typed: "manni tracevals run session-2.jsonl --deterministic-only",
                output: captures_json_1.default["run session-2"],
                latencyFrames: exports.latency.run,
                holdFrames: 5.6 * beats_1.FPS,
            },
            {
                typed: "echo $?",
                output: `${captures_json_1.default.exits.run2}\n`,
                latencyFrames: exports.latency.echo,
                holdFrames: 3.0 * beats_1.FPS,
            },
        ],
    },
];
exports.beatDurations = exports.beats.map((b) => (0, beats_1.timeline)(b, exports.TYPING_MS).duration);
exports.totalFrames = exports.beatDurations.reduce((a, b) => a + b, 0);
