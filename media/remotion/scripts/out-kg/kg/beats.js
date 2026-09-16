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
// the traverse invocation is 108 characters, and at 45 ms it alone would eat
// five seconds of a forty-five second budget.
exports.TYPING_MS = 35;
// Measured wall-clock latency on this machine, in C:\kgdemo
// (media/kg/capture/latency.txt: the capture run plus three timing runs):
// build 823-864 ms, traverse 757-793 ms, query 754-794 ms, stats --check
// 754-855 ms, grep 27-29 ms. Held to the slowest of each, so output never
// appears sooner than the real command produced it.
exports.latency = {
    build: Math.round(0.86 * beats_1.FPS),
    traverse: Math.round(0.79 * beats_1.FPS),
    query: Math.round(0.79 * beats_1.FPS),
    statsCheck: Math.round(0.86 * beats_1.FPS),
    grep: 2,
};
const IRI = "https://acme.dev/doc/docs/configuration.md";
exports.beats = [
    {
        title: "Two pages mention it",
        caption: "grep finds the pages that name configuration.md. It cannot find the pages that depend on those.",
        highlight: ["docs/getting-started.md", "docs/windows-notes.md"],
        commands: [
            {
                typed: "grep -rl configuration.md docs/",
                output: captures_json_1.default.grep,
                latencyFrames: exports.latency.grep,
                holdFrames: 3.4 * beats_1.FPS,
            },
        ],
    },
    {
        title: "manni kg finds three",
        caption: "harvest.md is reached through windows-notes.md. Two hops out, where grep never looked.",
        highlight: ["harvest.md", "3 nodes"],
        commands: [
            {
                typed: "manni kg build docs/",
                output: captures_json_1.default.build,
                latencyFrames: exports.latency.build,
                holdFrames: 1.9 * beats_1.FPS,
            },
            {
                typed: `manni kg traverse ${IRI} --predicates dcterms:references --impact -d 2`,
                output: captures_json_1.default.traverse,
                latencyFrames: exports.latency.traverse,
                holdFrames: 5.0 * beats_1.FPS,
            },
        ],
    },
    {
        title: "The build fails on it",
        caption: "The same graph carries every dead link, and stats --check exits 1. CI has something to fail on.",
        highlight: ["missing.md", "1"],
        commands: [
            {
                typed: "manni kg query --p kg:brokenLink",
                output: captures_json_1.default.query,
                latencyFrames: exports.latency.query,
                holdFrames: 3.2 * beats_1.FPS,
            },
            {
                typed: "manni kg stats --check > /dev/null; echo $?",
                output: `${captures_json_1.default.exits.statsCheck}\n`,
                latencyFrames: exports.latency.statsCheck,
                holdFrames: 3.6 * beats_1.FPS,
            },
        ],
    },
];
exports.beatDurations = exports.beats.map((b) => (0, beats_1.timeline)(b, exports.TYPING_MS).duration);
exports.totalFrames = exports.beatDurations.reduce((a, b) => a + b, 0);
