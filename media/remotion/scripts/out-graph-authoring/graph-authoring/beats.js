"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.totalFrames = exports.beatDurations = exports.beats = exports.latency = exports.TYPING_MS = exports.FPS = void 0;
const captures_json_1 = __importDefault(require("./captures.json"));
const beats_1 = require("../beats");
Object.defineProperty(exports, "FPS", { enumerable: true, get: function () { return beats_1.FPS; } });
// Typing speed for this video (design.md: 35-70 ms). The fast end: the traverse
// line carries a full journey IRI and is 152 characters.
exports.TYPING_MS = 35;
// Measured wall-clock latency on this machine, from the repo root
// (media/capture-graph-authoring/latency.txt): the default publish 11.7 s, the
// reader-only publish 9.1 s, traverse 751 ms, query 656 ms. The plugin's server
// printed its first line at 842 ms, then worked 8.7 s before the next, and 2.2 s
// before the one after. design.md allows compressing static wait only, and
// requires the real elapsed time on screen. Every wait over a second is replayed
// at 1/5, the same factor throughout. bash's own `time` output is in frame for
// both publishes, and the server prints "published the graph in 11.0s" itself.
// Typing and output are 1x.
const COMPRESS = 5;
const wait = (ms) => Math.round(((ms > 1000 ? ms / COMPRESS : ms) / 1000) * beats_1.FPS);
exports.latency = {
    internal: wait(11707), // 70 frames, 2.34 s
    traverse: wait(751),
    readers: wait(9133), // 55 frames, 1.83 s
    query: wait(656),
};
// The server's lines, each landing after the gap capture.sh measured before it.
const [first, ...later] = captures_json_1.default.server;
const serverMore = later.map((l, i) => ({ afterFrames: Math.max(1, wait(l.ms - captures_json_1.default.server[i].ms)), output: `${l.line}\n` }));
const d11 = "https://hawkeyexl.github.io/manni/id/strategy/journey/d11";
// Per-beat type, derived by media/capture-graph-authoring/cols.mjs from each beat's own
// longest line and row count (see graph-authoring-1x1.script.md).
const type = (fontPx) => ({ fontPx, linePx: Math.round(fontPx * 1.4), cols: Math.floor(1040 / (0.6 * fontPx)) });
exports.beats = [
    {
        title: "Records in the graph",
        caption: "The default build types this repository's 82 strategy records as audiences, personas and journeys.",
        highlight: ["82 strategy records"],
        type: type(21),
        commands: [
            { typed: "time manni graph publish -o .manni/graph/internal", output: captures_json_1.default.internal, latencyFrames: exports.latency.internal, holdFrames: 3.6 * beats_1.FPS },
        ],
    },
    {
        title: "Which pages serve D11?",
        caption: "Walk back from journey D11 along dcterms:isPartOf. Its four pages are the ones strategy get lists.",
        highlight: ["/id/doc/docs/"],
        type: type(25),
        commands: [
            {
                typed: `manni graph traverse -g .manni/graph/internal/graph.ttl ${d11} --reverse --predicates dcterms:isPartOf`,
                output: captures_json_1.default.traverse,
                latencyFrames: exports.latency.traverse,
                holdFrames: 4.2 * beats_1.FPS,
            },
        ],
    },
    {
        title: "A graph for readers",
        caption: "--no-authoring leaves out the records and the author-facing fields. Not one created date is left.",
        highlight: ["262 pages, 21021 triples", "No matches."],
        type: type(23),
        commands: [
            {
                typed: "time manni graph publish --collection site --no-authoring -o .manni/graph/readers",
                output: captures_json_1.default.readers,
                latencyFrames: exports.latency.readers,
                holdFrames: 1.5 * beats_1.FPS,
            },
            {
                typed: "manni graph query -g .manni/graph/readers/graph.ttl --predicate dcterms:created",
                output: captures_json_1.default.query,
                latencyFrames: exports.latency.query,
                holdFrames: 3.6 * beats_1.FPS,
            },
        ],
    },
    {
        title: "The plugin's own directory",
        caption: "The plugin's server publishes into its own data directory, outside the repository.",
        highlight: ["Temp/manni/graph/"],
        type: type(23),
        commands: [
            {
                typed: "node plugin/manni/hooks/graph-server.mjs < /dev/null",
                output: `${first.line}\n`,
                latencyFrames: wait(first.ms),
                more: serverMore,
                holdFrames: 4.6 * beats_1.FPS,
            },
        ],
    },
];
exports.beatDurations = exports.beats.map((b) => (0, beats_1.timeline)(b, exports.TYPING_MS).duration);
exports.totalFrames = exports.beatDurations.reduce((a, b) => a + b, 0);
