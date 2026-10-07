"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.totalFrames = exports.beatDurations = exports.beats = exports.latency = exports.TYPING_MS = exports.FPS = void 0;
const captures_json_1 = __importDefault(require("./captures.json"));
const beats_1 = require("../beats");
Object.defineProperty(exports, "FPS", { enumerable: true, get: function () { return beats_1.FPS; } });
// Typing speed for this video (design.md: 35-70 ms).
exports.TYPING_MS = 40;
// Measured wall-clock latency on this machine, in media/scratch-session-rules/
// (media/session-rules/capture/latency.txt: the capture run plus three timing
// runs): tracevals check 401-427 ms cold, the JSON run piped to grep
// 378-393 ms. The replay uses about the median, so nothing is sped up.
exports.latency = {
    check: Math.round(0.41 * beats_1.FPS),
    sources: Math.round(0.38 * beats_1.FPS),
    grep: 2,
    echo: 1,
};
const prompts = `grep human requests.jsonl | grep -o '"content":"[^"]*"'`;
const edits = `grep -o '"Edit","input":{"file_path":"[^"]*"' requests.jsonl`;
const done = `tail -1 requests.jsonl | grep -o '"text":"[^"]*"'`;
const sources = `manni tracevals check requests.jsonl --project . -f json | grep '"path"'`;
exports.beats = [
    {
        title: "What you asked",
        caption: "Two prompts. The second: do not edit src/legacy.ts.",
        highlight: ["Do not edit"],
        commands: [
            { typed: prompts, output: captures_json_1.default.prompts, latencyFrames: exports.latency.grep, holdFrames: 3.6 * beats_1.FPS },
        ],
    },
    {
        title: "The agent said it was done",
        caption: "It edited src/legacy.ts anyway, then said done.",
        continues: true,
        highlight: ['src/legacy.ts"', "Done."],
        commands: [
            { typed: edits, output: captures_json_1.default.edits, latencyFrames: exports.latency.grep, holdFrames: 2.4 * beats_1.FPS },
            { typed: done, output: captures_json_1.default.done, latencyFrames: exports.latency.grep, holdFrames: 3.4 * beats_1.FPS },
        ],
    },
    {
        title: "Hold it to what it was asked",
        caption: "The broken request, under its source: prompt. Exit 1.",
        highlight: ["do-not-edit-src-legacy"],
        commands: [
            { typed: "manni tracevals check requests.jsonl --project .", output: captures_json_1.default.check, latencyFrames: exports.latency.check, holdFrames: 5.0 * beats_1.FPS },
            { typed: "echo $?", output: `${captures_json_1.default.exits.check}\n`, latencyFrames: exports.latency.echo, holdFrames: 2.2 * beats_1.FPS },
        ],
    },
    {
        title: "Every source it was asked by",
        caption: "Prompts, the approved plan, and every spec it touched.",
        highlight: ['"prompt"', '"plan"', "specs/", "openspec/", "docs/plans/"],
        commands: [
            { typed: sources, output: captures_json_1.default.sources, latencyFrames: exports.latency.sources, holdFrames: 6.0 * beats_1.FPS },
        ],
    },
];
exports.beatDurations = exports.beats.map((b) => (0, beats_1.timeline)(b, exports.TYPING_MS).duration);
exports.totalFrames = exports.beatDurations.reduce((a, b) => a + b, 0);
