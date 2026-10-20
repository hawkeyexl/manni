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
// because the 4.13.0 command is 95 characters.
exports.TYPING_MS = 38;
// Measured wall-clock latency, from media/capture-findings/latency.txt.
// Replayed at 1x: every run is under 1.5 s, so nothing is compressed.
//   before  1403 ms (npx resolving the locally installed 4.13.0, then the run)
//   after    338 ms
//   show     286 ms
//   cite     399 ms
exports.latency = {
    before: Math.round(1.403 * beats_1.FPS),
    after: Math.round(0.338 * beats_1.FPS),
    show: Math.round(0.286 * beats_1.FPS),
    cite: Math.round(0.399 * beats_1.FPS),
    cat: 2,
    echo: 1,
};
const args = "meta validate dcmi-bad-date.md -s dcmi:elements:1.1 --no-config";
exports.beats = [
    {
        title: "Before, in 4.13.0",
        caption: "June 5th is not a date. 4.13.0 shows a pattern and a wrapper line.",
        highlight: ['"else" schema'],
        commands: [
            { typed: "cat dcmi-bad-date.md", output: captures_json_1.default["cat dcmi-bad-date.md"], latencyFrames: exports.latency.cat, holdFrames: 1.4 * beats_1.FPS },
            { typed: `npx -y @hawkeyexl/manni@4.13.0 ${args}`, output: captures_json_1.default.before, latencyFrames: exports.latency.before, holdFrames: 4.4 * beats_1.FPS },
        ],
    },
    {
        title: "Now it says what to do",
        caption: "One finding. It names the rule, says what date is for and links a guide.",
        highlight: ["dcmi:elements:1.1 date:", "Guide:"],
        commands: [
            { typed: `manni ${args}`, output: captures_json_1.default.after, latencyFrames: exports.latency.after, holdFrames: 5.6 * beats_1.FPS },
            { typed: "echo $?", output: `${captures_json_1.default.exits.after}\n`, latencyFrames: exports.latency.echo, holdFrames: 1.8 * beats_1.FPS },
        ],
    },
    {
        title: "Start from a skeleton",
        caption: "schemas show -f markdown prints frontmatter to start from, every key explained.",
        highlight: ["# Guide:", "title:", "description:"],
        commands: [
            { typed: "manni meta schemas show manni:core:1.0.0 -f markdown", output: captures_json_1.default.show, latencyFrames: exports.latency.show, holdFrames: 5.0 * beats_1.FPS },
        ],
    },
    {
        title: "Across the family",
        caption: "cite names its rule too, and the command to run once you have checked.",
        highlight: ["Check the sentence", "source-changed:", "Guide:"],
        commands: [
            { typed: "manni cite check pages/source-changed.md", output: captures_json_1.default.cite, latencyFrames: exports.latency.cite, holdFrames: 6.0 * beats_1.FPS },
        ],
    },
];
exports.beatDurations = exports.beats.map((b) => (0, beats_1.timeline)(b, exports.TYPING_MS).duration);
exports.totalFrames = exports.beatDurations.reduce((a, b) => a + b, 0);
