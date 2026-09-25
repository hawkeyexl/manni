"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.totalFrames = exports.beatDurations = exports.beats = exports.latency = exports.FILL_REPLAY_S = exports.FILL_REAL_S = exports.TYPING_MS = exports.FPS = void 0;
const captures_json_1 = __importDefault(require("./captures.json"));
const beats_1 = require("../beats");
Object.defineProperty(exports, "FPS", { enumerable: true, get: function () { return beats_1.FPS; } });
// Typing speed for this video (design.md: 35-70 ms).
exports.TYPING_MS = 40;
// Measured wall-clock latency on this machine, in the demo directory
// (media/vocabularies/capture/latency.txt: the capture run plus three timing
// runs). validate before fill 584-656 ms, validate after fill 589-604 ms.
// The replay uses 0.60 s for both, the median of the eight runs.
//
// fill took 22.919 s (bash's `time`, in frame). design.md allows compressing
// static wait only, with the real time disclosed. The replay shortens the gap
// between Enter and fill's output to 2.0 s, a factor of 1/11.5. Typing and
// output run at 1x, and the `real 0m22.919s` line is on screen unedited.
exports.FILL_REAL_S = 22.919;
exports.FILL_REPLAY_S = 2.0;
exports.latency = {
    validate: Math.round(0.6 * beats_1.FPS),
    fill: Math.round(exports.FILL_REPLAY_S * beats_1.FPS),
    cat: 2,
    head: 2,
    echo: 1,
};
const FIELDS = "description,audiences,lifecycle";
exports.beats = [
    {
        title: "A page, no description",
        caption: "A guide with a type and a title, and no description. No config, no schema named.",
        highlight: ["title: Fitting progressive lenses"],
        commands: [
            { typed: "cat page.md", output: captures_json_1.default["b1 cat page"], latencyFrames: exports.latency.cat, holdFrames: 4.2 * beats_1.FPS },
        ],
    },
    {
        title: "The default set checks it",
        caption: "A bare validate now applies manni:core:1.0.0, which requires a description: exit 1.",
        highlight: ["'description'"],
        commands: [
            { typed: "manni meta validate page.md", output: captures_json_1.default["b2 validate"], latencyFrames: exports.latency.validate, holdFrames: 2.2 * beats_1.FPS },
            { typed: "echo $?", output: `${captures_json_1.default.exits.b2}\n`, latencyFrames: exports.latency.echo, holdFrames: 3.2 * beats_1.FPS },
        ],
    },
    {
        title: "fill proposes the fields",
        caption: "fill infers the description, plus audiences and lifecycle. It took 23 s; the wait is shortened.",
        highlight: ["/description  A", "/audiences  [", "/lifecycle  draft", "real "],
        commands: [
            {
                typed: `time manni meta fill page.md --fields ${FIELDS}`,
                output: captures_json_1.default["b3 fill"],
                latencyFrames: exports.latency.fill,
                holdFrames: 5.2 * beats_1.FPS,
            },
        ],
    },
    {
        title: "Written to the page",
        caption: "The three values are frontmatter now. The lines below them record which model wrote them.",
        highlight: ["description:", "audiences:", "  - ", "lifecycle:"],
        commands: [
            { typed: `head -n ${captures_json_1.default.headN} page.md`, output: captures_json_1.default["b4 head page"], latencyFrames: exports.latency.head, holdFrames: 4.4 * beats_1.FPS },
        ],
    },
    {
        title: "Valid: exit 0",
        caption: "The same bare validate passes: exit 0. The warning is ai-context asking for a sidecar.",
        highlight: ["1 passed"],
        commands: [
            { typed: "manni meta validate page.md", output: captures_json_1.default["b5 validate"], latencyFrames: exports.latency.validate, holdFrames: 2.6 * beats_1.FPS },
            { typed: "echo $?", output: `${captures_json_1.default.exits.b5}\n`, latencyFrames: exports.latency.echo, holdFrames: 3.6 * beats_1.FPS },
        ],
    },
];
exports.beatDurations = exports.beats.map((b) => (0, beats_1.timeline)(b, exports.TYPING_MS).duration);
exports.totalFrames = exports.beatDurations.reduce((a, b) => a + b, 0);
