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
// because two of the typed lines run past 80 characters.
exports.TYPING_MS = 40;
// Measured wall-clock latency, from media/capture-vector/latency.txt:
//   graph embed     606 ms     (refused before anything is read)
//   vector build    3m21.828s  (268 pages, 3174 vectors, --no-cache: every vector computed)
//   vector search   1536-1790 ms over four runs (model load included)
//
// The build is four times longer than the whole video, so the replay shortens
// the wait between Enter and the output by one factor, 1/100.9, to 2.0 s.
// design.md allows compressing static wait only, and requires the real elapsed
// time on screen: bash's own `time` output is in frame, unedited, and a chrome
// note under the command says the wait was shortened. Typing and output are 1x,
// and the refusal and the search run at their real speed.
const COMPRESS = 100.9;
exports.latency = {
    embed: Math.round(0.606 * beats_1.FPS), // 18 frames, 1x
    build: Math.round((201.828 / COMPRESS) * beats_1.FPS), // 60 frames, 2.00 s
    search: Math.round(1.6 * beats_1.FPS), // 48 frames, 1x
    ls: 2,
    echo: 1,
};
const OUT = "media/scratch-vector/out";
exports.beats = [
    {
        title: "Vectors used to need a graph",
        caption: "It took three graph commands, build, export search and embed. The last one now says where it went.",
        highlight: ["moved to manni vector build"],
        commands: [
            { typed: "manni graph embed", output: captures_json_1.default.embed, latencyFrames: exports.latency.embed, holdFrames: 3.0 * beats_1.FPS },
            { typed: "echo $?", output: `${captures_json_1.default.exits.embed}\n`, latencyFrames: exports.latency.echo, holdFrames: 3.4 * beats_1.FPS },
        ],
    },
    {
        title: "Pages to vectors, one step",
        caption: "The site's 268 pages become 3174 vectors, every one computed fresh. No graph.ttl is written.",
        highlight: ["3174 embedded, 0 from cache", "3m21.828s"],
        commands: [
            {
                typed: `time manni vector build --collection site --no-cache -o ${OUT}`,
                output: captures_json_1.default.build,
                latencyFrames: exports.latency.build,
                holdFrames: 4.6 * beats_1.FPS,
                note: "[201.8 s run; the wait is cut to 2 s]",
            },
            { typed: `ls -1 ${OUT}`, output: captures_json_1.default.ls, latencyFrames: exports.latency.ls, holdFrames: 3.4 * beats_1.FPS },
        ],
    },
    {
        title: "Search by meaning",
        caption: "The top hits are the concept of pinning a fact to a sentence and the page that teaches it.",
        highlight: ["Pin a fact to the sentence"],
        // Search hits are long: a 26 px beat keeps each hit's title whole on one row,
        // and continuation rows hang under the score gutter the CLI prints.
        type: { fontPx: 26, linePx: 36, cols: 66 },
        hang: 8,
        commands: [
            {
                typed: `manni vector search "pin a sentence to its source" --limit 3 -i ${OUT}`,
                output: captures_json_1.default.search,
                latencyFrames: exports.latency.search,
                holdFrames: 4.2 * beats_1.FPS,
            },
        ],
    },
    {
        title: "Same ids as the graph",
        caption: "Every hit is a graph node IRI, so the graph, its chunks and the vectors join on one id.",
        continues: true,
        type: { fontPx: 26, linePx: 36, cols: 66 },
        hang: 8,
        highlight: ["https://hawkeyexl.github.io/manni/id/"],
        commands: [],
        pauseFrames: 4.4 * beats_1.FPS,
    },
];
exports.beatDurations = exports.beats.map((b) => (0, beats_1.timeline)(b, exports.TYPING_MS).duration);
exports.totalFrames = exports.beatDurations.reduce((a, b) => a + b, 0);
