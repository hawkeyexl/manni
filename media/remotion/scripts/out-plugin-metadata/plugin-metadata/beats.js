"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.totalFrames = exports.beatDurations = exports.beats = exports.latency = exports.TYPING_MS = exports.FPS = void 0;
const captures_json_1 = __importDefault(require("./captures.json"));
const beats_1 = require("../beats");
Object.defineProperty(exports, "FPS", { enumerable: true, get: function () { return beats_1.FPS; } });
// Typing speed for this video (design.md: 35-70 ms). The fast end: five beats in
// 45 s, and the longest typed line is 60 characters.
exports.TYPING_MS = 36;
// Measured wall-clock latency on this machine, in media/scratch-plugin-metadata/
// (media/plugin-metadata/capture/latency.txt: the capture run plus three timing
// runs). get 298-335 ms, the Read hook 407-500 ms (the timing runs clear the
// hook's memory first, so they include a cold hook), head and cat under 70 ms.
// The MCP server's first line landed 855 ms after Enter and the rest 654 ms
// later (graph.times). The replay uses the slower end of each, so output never
// lands sooner than it did. Nothing is sped up.
exports.latency = {
    head: 2,
    cat: 2,
    get: Math.round(0.32 * beats_1.FPS),
    read: Math.round(0.45 * beats_1.FPS),
    sed: 2,
    graphFirst: Math.round(0.86 * beats_1.FPS),
    graphGap: Math.round((captures_json_1.default.graphGapMs / 1000) * beats_1.FPS),
};
const sed = "sed -i 's/platform-docs/docs-team/' docs/limits.meta.yaml";
const get = "manni meta get --all-fields --no-derived docs/limits.md";
const read = "read-page docs/limits.md";
exports.beats = [
    {
        title: "Fields a Read never shows",
        caption: "owner and eval-suite live in a sidecar. Reading the page alone never shows them.",
        highlight: ["owner:", "eval-suite:"],
        commands: [
            { typed: "head -4 docs/limits.md", output: captures_json_1.default.head, latencyFrames: exports.latency.head, holdFrames: 1.4 * beats_1.FPS },
            { typed: "cat docs/limits.meta.yaml", output: captures_json_1.default.sidecar, latencyFrames: exports.latency.cat, holdFrames: 3.0 * beats_1.FPS },
        ],
    },
    {
        title: "manni meta get --all-fields",
        caption: "The new flag prints every stored field, page and sidecar alike.",
        highlight: ["owner=", "eval-suite="],
        commands: [{ typed: get, output: captures_json_1.default.get, latencyFrames: exports.latency.get, holdFrames: 3.6 * beats_1.FPS }],
    },
    {
        title: "What the Read hook adds",
        caption: "When the agent reads the page, the plugin's hook hands it the metadata, sidecar included.",
        highlight: ['"owner"'],
        commands: [{ typed: read, output: captures_json_1.default.read1, latencyFrames: exports.latency.read, holdFrames: 4.0 * beats_1.FPS }],
    },
    {
        title: "Once, then on change",
        caption: "A second Read adds nothing. Change the sidecar and the next Read says so.",
        continues: true,
        highlight: ["changed since"],
        commands: [
            { typed: read, output: captures_json_1.default.read2, latencyFrames: exports.latency.read, holdFrames: 1.2 * beats_1.FPS },
            { typed: sed, output: "", latencyFrames: exports.latency.sed, holdFrames: 0.3 * beats_1.FPS },
            { typed: read, output: captures_json_1.default.read3, latencyFrames: exports.latency.read, holdFrames: 3.6 * beats_1.FPS },
        ],
    },
    {
        title: "The graph, over MCP",
        caption: "The plugin's MCP server publishes the graph on first use, then answers from it.",
        highlight: ["published the graph", "lookup: docs"],
        commands: [
            {
                typed: 'mcp-call lookup "What is the fetch timeout?"',
                output: captures_json_1.default.graphFirst,
                latencyFrames: exports.latency.graphFirst,
                more: [{ afterFrames: exports.latency.graphGap, output: captures_json_1.default.graphRest }],
                holdFrames: 4.8 * beats_1.FPS,
            },
        ],
    },
];
exports.beatDurations = exports.beats.map((b) => (0, beats_1.timeline)(b, exports.TYPING_MS).duration);
exports.totalFrames = exports.beatDurations.reduce((a, b) => a + b, 0);
