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
// Measured wall-clock latency on this machine, in media/scratch-system-prompt/
// (media/system-prompt/capture/latency.txt: the capture run plus three timing
// runs): the default-prompt check 396-412 ms cold, the custom one 382-405 ms
// after it. The replay uses about the median, so nothing is sped up.
exports.latency = {
    check: Math.round(0.4 * beats_1.FPS),
    grep: 2,
    echo: 1,
};
const prompt = `grep -o '"systemPrompt":[^]]*' system-prompt.jsonl | head -1`;
const done = `tail -1 system-prompt.jsonl | grep -o '"text":"[^"]*"'`;
const custom = `grep -o '"systemPrompt":[^]]*' system-prompt-custom.jsonl | head -1`;
exports.beats = [
    {
        title: "The prompt it ran under",
        caption: "It bans an unshown Tests pass. The agent claims one.",
        highlight: ["Never say", '"text":"Tests pass'],
        commands: [
            { typed: prompt, output: captures_json_1.default.prompt, latencyFrames: exports.latency.grep, holdFrames: 3.0 * beats_1.FPS },
            { typed: done, output: captures_json_1.default.done, latencyFrames: exports.latency.grep, holdFrames: 3.0 * beats_1.FPS },
        ],
    },
    {
        title: "Claude Code's default prompt",
        caption: "Its break is reported with !, not blocked. Exit 0.",
        highlight: ["never-say-tests-pass-without", "None broken"],
        commands: [
            { typed: "manni tracevals check system-prompt.jsonl --project .", output: captures_json_1.default.default, latencyFrames: exports.latency.check, holdFrames: 5.0 * beats_1.FPS },
            { typed: "echo $?", output: `${captures_json_1.default.exits.default}\n`, latencyFrames: exports.latency.echo, holdFrames: 2.4 * beats_1.FPS },
        ],
    },
    {
        title: "A prompt you wrote",
        caption: "No default marker. Its break blocks with ✖. Exit 1.",
        highlight: ["never-say-tests-pass-without", "1 broken"],
        commands: [
            { typed: custom, output: captures_json_1.default.custom, latencyFrames: exports.latency.grep, holdFrames: 2.2 * beats_1.FPS },
            { typed: "manni tracevals check system-prompt-custom.jsonl --project .", output: captures_json_1.default.customCheck, latencyFrames: exports.latency.check, holdFrames: 5.0 * beats_1.FPS },
            { typed: "echo $?", output: `${captures_json_1.default.exits.custom}\n`, latencyFrames: exports.latency.echo, holdFrames: 2.6 * beats_1.FPS },
        ],
    },
];
exports.beatDurations = exports.beats.map((b) => (0, beats_1.timeline)(b, exports.TYPING_MS).duration);
exports.totalFrames = exports.beatDurations.reduce((a, b) => a + b, 0);
