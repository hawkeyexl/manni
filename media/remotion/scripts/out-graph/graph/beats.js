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
// twelve commands in three beats, under 45 s.
exports.TYPING_MS = 35;
// Measured wall-clock latency on this machine, in the demo repository
// (media/graph/capture/latency.txt: the capture run plus three timing runs).
// term check with graph: 604-941 ms, term check with kg: 588-781 ms,
// meta validate 607-834 ms. The replay uses the median of the four runs, so
// output never lands at the fast end of what was measured.
exports.latency = {
    termCheckGraph: Math.round(0.77 * beats_1.FPS),
    termCheckKg: Math.round(0.68 * beats_1.FPS),
    validate: Math.round(0.81 * beats_1.FPS),
    sed: 2,
    cat: 2,
    echo: 1,
};
exports.beats = [
    {
        title: "graph: names the term",
        caption: "The guide's graph: block names progressive lens in concepts. manni term check resolves it: exit 0.",
        highlight: ["label: progressive lens", "concepts: [progressive lens]", "1 reference"],
        commands: [
            { typed: "cat docs/terms/progressive-lens.md", output: captures_json_1.default["b1 cat term"], latencyFrames: exports.latency.cat, holdFrames: 1.2 * beats_1.FPS },
            { typed: "cat docs/fitting.md", output: captures_json_1.default["b1 cat guide"], latencyFrames: exports.latency.cat, holdFrames: 1.4 * beats_1.FPS },
            { typed: "manni term check", output: captures_json_1.default["b1 term check"], latencyFrames: exports.latency.termCheckGraph, holdFrames: 1.8 * beats_1.FPS },
            { typed: "echo $?", output: `${captures_json_1.default.exits.b1}\n`, latencyFrames: exports.latency.echo, holdFrames: 3.0 * beats_1.FPS },
        ],
    },
    {
        title: "kg: no longer counts",
        caption: "manni term no longer reads kg.concepts. The term is now unused: a notice, so still exit 0.",
        highlight: ["kg:", "unused-term"],
        commands: [
            { typed: "sed -i 's/^graph:/kg:/' docs/fitting.md", output: "", latencyFrames: exports.latency.sed, holdFrames: 0.4 * beats_1.FPS },
            { typed: "cat docs/fitting.md", output: captures_json_1.default["b2 cat guide"], latencyFrames: exports.latency.cat, holdFrames: 1.4 * beats_1.FPS },
            { typed: "manni term check", output: captures_json_1.default["b2 term check"], latencyFrames: exports.latency.termCheckKg, holdFrames: 2.4 * beats_1.FPS },
            { typed: "echo $?", output: `${captures_json_1.default.exits.b2}\n`, latencyFrames: exports.latency.echo, holdFrames: 3.0 * beats_1.FPS },
        ],
    },
    {
        title: "The block is closed",
        caption: "The draft manni:graph:1.0.0-proposal.1 closes the block, so a typo inside it fails: exit 1.",
        highlight: ["concept: [", "additional property"],
        commands: [
            { typed: "sed -i 's/^kg:/graph:/; s/concepts:/concept:/' docs/fitting.md", output: "", latencyFrames: exports.latency.sed, holdFrames: 0.4 * beats_1.FPS },
            { typed: "cat docs/fitting.md", output: captures_json_1.default["b3 cat guide"], latencyFrames: exports.latency.cat, holdFrames: 1.4 * beats_1.FPS },
            { typed: "manni meta validate -s graph-1.0.0-proposal.1.json docs/fitting.md", output: captures_json_1.default["b3 validate"], latencyFrames: exports.latency.validate, holdFrames: 2.6 * beats_1.FPS },
            { typed: "echo $?", output: `${captures_json_1.default.exits.b3}\n`, latencyFrames: exports.latency.echo, holdFrames: 3.0 * beats_1.FPS },
        ],
    },
];
exports.beatDurations = exports.beats.map((b) => (0, beats_1.timeline)(b, exports.TYPING_MS).duration);
exports.totalFrames = exports.beatDurations.reduce((a, b) => a + b, 0);
