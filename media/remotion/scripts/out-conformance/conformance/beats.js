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
// Measured wall-clock latency on this machine, in media/scratch-conformance/
// (media/conformance/capture/latency.txt: the capture run plus three timing
// runs): tracevals check 2136-3137 ms cold, the Stop hook 2151-3152 ms. The
// replay uses the median of the four, so nothing is sped up.
exports.latency = {
    check: Math.round(2.54 * beats_1.FPS),
    hook: Math.round(2.53 * beats_1.FPS),
    cat: 2,
    grep: 2,
    echo: 1,
};
const grep = `grep -o '"command": "[^"]*"' breaks.jsonl`;
exports.beats = [
    {
        title: "The rule it ran under",
        caption: "This agent's CLAUDE.md: never git push --force.",
        highlight: ["Never run `git push --force`."],
        commands: [
            { typed: "cat CLAUDE.md", output: captures_json_1.default["cat CLAUDE.md"], latencyFrames: exports.latency.cat, holdFrames: 4.0 * beats_1.FPS },
        ],
    },
    {
        title: "What the agent did",
        caption: "Its last turn ran npm test, then git push --force.",
        continues: true,
        highlight: ["git push --force origin main"],
        commands: [
            { typed: grep, output: captures_json_1.default.grep, latencyFrames: exports.latency.grep, holdFrames: 3.2 * beats_1.FPS },
        ],
    },
    {
        title: "Judge the turn",
        caption: "Each broken rule, under its file. Exit 1.",
        highlight: ["no-force-push", "never-use-innerhtml-in-components"],
        commands: [
            { typed: "manni tracevals check breaks.jsonl --project .", output: captures_json_1.default.check, latencyFrames: exports.latency.check, holdFrames: 5.0 * beats_1.FPS },
            { typed: "echo $?", output: `${captures_json_1.default.exits.check}\n`, latencyFrames: exports.latency.echo, holdFrames: 2.2 * beats_1.FPS },
        ],
    },
    {
        title: "The Stop hook blocks once",
        caption: "As a Stop hook, it sends the agent back to fix it.",
        highlight: ['"decision":"block"'],
        commands: [
            { typed: "cat stop.json", output: captures_json_1.default["cat stop.json"], latencyFrames: exports.latency.cat, holdFrames: 1.6 * beats_1.FPS },
            { typed: "manni check < stop.json", output: captures_json_1.default.hook, latencyFrames: exports.latency.hook, holdFrames: 6.5 * beats_1.FPS },
        ],
    },
];
exports.beatDurations = exports.beats.map((b) => (0, beats_1.timeline)(b, exports.TYPING_MS).duration);
exports.totalFrames = exports.beatDurations.reduce((a, b) => a + b, 0);
