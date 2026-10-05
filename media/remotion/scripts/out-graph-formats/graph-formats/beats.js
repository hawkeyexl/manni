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
// the traverse invocation is 102 characters.
exports.TYPING_MS = 35;
// Measured wall-clock latency on this machine, in media/scratch-formats
// (media/graph/capture-formats/latency.txt: the capture run plus three timing runs):
// build --ext 1124-1129 ms, build 1158-1175 ms, stats 993-1005 ms,
// traverse 999-1010 ms. Held to the slowest of each, so output never appears
// sooner than the real command produced it. Nothing is sped up.
exports.latency = {
    buildMd: Math.round(1.13 * beats_1.FPS),
    buildAll: Math.round(1.18 * beats_1.FPS),
    stats: Math.round(1.01 * beats_1.FPS),
    traverse: Math.round(1.01 * beats_1.FPS),
};
const STATS = "manni graph stats --top 6 | head -13";
const IRI = "https://example.com/formats/doc/index.md";
exports.beats = [
    {
        title: "Markdown only",
        caption: "The old Markdown-only walk reads 1 page of 6. Its 8 links into the other formats look broken.",
        highlight: ["Documents:", "Broken internal links"],
        commands: [
            {
                typed: "manni graph build --ext .md,.mdx,.markdown > /dev/null",
                output: captures_json_1.default.buildMd,
                latencyFrames: exports.latency.buildMd,
                holdFrames: 0.4 * beats_1.FPS,
            },
            {
                typed: STATS,
                output: captures_json_1.default.statsMd,
                latencyFrames: exports.latency.stats,
                holdFrames: 5.0 * beats_1.FPS,
            },
        ],
    },
    {
        title: "Every format, no flag",
        caption: "With no --ext, graph build also reads HTML, DITA, AsciiDoc and reStructuredText. 6 pages.",
        highlight: ["Documents:", "guide.html", "topic.dita", "notes.adoc", "ref.rst", "map.ditamap"],
        commands: [
            {
                typed: "manni graph build > /dev/null",
                output: captures_json_1.default.buildAll,
                latencyFrames: exports.latency.buildAll,
                holdFrames: 0.4 * beats_1.FPS,
            },
            {
                typed: STATS,
                output: captures_json_1.default.statsAll,
                latencyFrames: exports.latency.stats,
                holdFrames: 5.0 * beats_1.FPS,
            },
        ],
    },
    {
        title: "Links cross formats",
        caption: "What depends on the Markdown page: HTML, AsciiDoc and RST pages, and a DITA map one hop out.",
        highlight: ["guide.html", "notes.adoc", "ref.rst", "map.ditamap"],
        commands: [
            {
                typed: `manni graph traverse ${IRI} --predicates dcterms:references --impact`,
                output: captures_json_1.default.traverse,
                latencyFrames: exports.latency.traverse,
                holdFrames: 6.0 * beats_1.FPS,
            },
        ],
    },
];
exports.beatDurations = exports.beats.map((b) => (0, beats_1.timeline)(b, exports.TYPING_MS).duration);
exports.totalFrames = exports.beatDurations.reduce((a, b) => a + b, 0);
