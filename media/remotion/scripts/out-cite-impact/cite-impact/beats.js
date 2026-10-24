"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.totalFrames = exports.beatDurations = exports.beats = exports.latency = exports.TYPING_MS = exports.FPS = void 0;
const captures_json_1 = __importDefault(require("./captures.json"));
const beats_1 = require("../beats");
Object.defineProperty(exports, "FPS", { enumerable: true, get: function () { return beats_1.FPS; } });
// Typing speed for this video (design.md: 35-70 ms). The shared 45 ms default.
exports.TYPING_MS = 45;
// Measured wall-clock latency, from media/cite-impact/latency.txt.
// Replayed at 1x: every run is under 0.75 s, so nothing is compressed.
//   check-before  503 ms
//   diff           82 ms
//   github        657 ms
//   pretty        700 ms
exports.latency = {
    checkBefore: Math.round(0.503 * beats_1.FPS),
    diff: Math.round(0.082 * beats_1.FPS),
    github: Math.round(0.657 * beats_1.FPS),
    pretty: Math.round(0.7 * beats_1.FPS),
    cat: 2,
    echo: 1,
};
// Type size per beat, derived from each beat's own lines by
// media/cite-impact/cols.mjs. Beats 1 and 2 hold the series' 32 px with no
// wrap. Beat 3's annotation is one 448-character line: 22 px / 78 columns is
// the largest size that wraps it at spaces with no split token and no
// one-word last row. Beat 4 takes 22 px too, the largest size whose two
// wrapped guidance lines leave no one-word row.
exports.beats = [
    {
        title: "The page names its readers",
        type: { fontPx: 32, linePx: 45, cols: 54 },
        caption: "The guide's sidecar names persona maya and journey m5.",
        highlight: ["personas: [maya]", "journeys: [m5]"],
        commands: [
            { typed: "cat pages/guide.meta.yaml", output: captures_json_1.default["cat pages/guide.meta.yaml"], latencyFrames: exports.latency.cat, holdFrames: 2.2 * beats_1.FPS },
            { typed: "manni cite check", output: captures_json_1.default.checkBefore, latencyFrames: exports.latency.checkBefore, holdFrames: 2.5 * beats_1.FPS },
        ],
    },
    {
        title: "One source line changes",
        type: { fontPx: 32, linePx: 45, cols: 54 },
        caption: "Both pages pin this line, so both pins go stale.",
        highlight: ["TIMEOUT_SECONDS = 10", "TIMEOUT_SECONDS = 30"],
        commands: [
            { typed: "git diff src/value.ts", output: captures_json_1.default.diff, latencyFrames: exports.latency.diff, holdFrames: 3.2 * beats_1.FPS },
        ],
    },
    {
        title: "manni cite check -f github",
        type: { fontPx: 22, linePx: 31, cols: 78 },
        caption: "The annotation now names maya and m5. Exit 1.",
        highlight: ["Serves maya"],
        commands: [
            { typed: "manni cite check -f github pages/guide.md", output: captures_json_1.default.github, latencyFrames: exports.latency.github, holdFrames: 6.0 * beats_1.FPS },
            { typed: "echo $?", output: `${captures_json_1.default.exits.github}\n`, latencyFrames: exports.latency.echo, holdFrames: 1.6 * beats_1.FPS },
        ],
    },
    {
        title: "Who the findings reach",
        type: { fontPx: 22, linePx: 31, cols: 78 },
        caption: "Findings rolled up by persona and journey.",
        highlight: ["The pages with findings serve", "Maya, Documentation Engineer", "Pin a claim", "Keep citations"],
        commands: [
            { typed: "manni cite check -q", output: captures_json_1.default.pretty, latencyFrames: exports.latency.pretty, holdFrames: 5.8 * beats_1.FPS },
        ],
    },
];
exports.beatDurations = exports.beats.map((b) => (0, beats_1.timeline)(b, exports.TYPING_MS).duration);
exports.totalFrames = exports.beatDurations.reduce((a, b) => a + b, 0);
