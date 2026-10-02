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
// seven commands and five beats inside 45 s.
exports.TYPING_MS = 35;
// Measured wall-clock latency on this machine, in media/scratch-lint
// (media/capture-lint/latency.txt: the capture run plus three timing runs):
// lint structure 742-815 ms, templates infer to stdout 702-787 ms, and
// templates infer -o 714-804 ms. Output never appears sooner than measured.
exports.latency = {
    lint: Math.round(0.78 * beats_1.FPS),
    inferStdout: Math.round(0.75 * beats_1.FPS),
    inferWrite: Math.round(0.76 * beats_1.FPS),
    sed: 2,
    cat: 2,
    echo: 1,
};
const LINT = "manni lint structure docs/rotate-key.md";
exports.beats = [
    {
        title: "A page with no template",
        caption: "This page is already the shape you want. Nothing in the repo describes that shape.",
        highlight: ["## Overview", "## Before you start", "## Rotate the key", "## See also"],
        commands: [
            { typed: "cat docs/rotate-key.md", output: captures_json_1.default["cat page"], latencyFrames: exports.latency.cat, holdFrames: 4.0 * beats_1.FPS },
        ],
    },
    {
        title: "Writing one by hand",
        caption: "A half-written template makes every real section unexpected. Three findings, exit 1.",
        highlight: ["unexpected-section"],
        commands: [
            { typed: "cat templates.yaml", output: captures_json_1.default["cat stub"], latencyFrames: exports.latency.cat, holdFrames: 1.4 * beats_1.FPS },
            { typed: LINT, output: captures_json_1.default["lint wall"], latencyFrames: exports.latency.lint, holdFrames: 3.8 * beats_1.FPS },
        ],
    },
    {
        title: "Infer it from the page",
        caption: "manni lint templates infer reads the page and writes the template that describes it.",
        highlight: ["- heading: ", "codeBlocks:"],
        commands: [
            {
                typed: "manni lint templates infer docs/rotate-key.md",
                output: captures_json_1.default["infer stdout"],
                latencyFrames: exports.latency.inferStdout,
                holdFrames: 4.0 * beats_1.FPS,
            },
        ],
    },
    {
        title: "Save it, and it passes",
        caption: "Save it over the stub, and the same lint command passes.",
        highlight: ["Wrote template", "1 passed, 0 failed"],
        commands: [
            {
                typed: "manni lint templates infer docs/rotate-key.md -o templates.yaml --force",
                output: captures_json_1.default["infer write"],
                latencyFrames: exports.latency.inferWrite,
                holdFrames: 1.1 * beats_1.FPS,
            },
            { typed: LINT, output: captures_json_1.default["lint pass"], latencyFrames: exports.latency.lint, holdFrames: 3.0 * beats_1.FPS },
        ],
    },
    {
        title: "Break the page",
        caption: "Delete the required See also section: one finding, anchored at line 23, exit 1.",
        highlight: ["missing-section", "0 passed, 1 failed"],
        commands: [
            { typed: "sed -i '/^## See also/,$d' docs/rotate-key.md", output: "", latencyFrames: exports.latency.sed, holdFrames: 0.3 * beats_1.FPS },
            { typed: LINT, output: captures_json_1.default["lint broken"], latencyFrames: exports.latency.lint, holdFrames: 2.2 * beats_1.FPS },
            { typed: "echo $?", output: `${captures_json_1.default.exits.lintBroken}\n`, latencyFrames: exports.latency.echo, holdFrames: 2.2 * beats_1.FPS },
        ],
    },
];
exports.beatDurations = exports.beats.map((b) => (0, beats_1.timeline)(b, exports.TYPING_MS).duration);
exports.totalFrames = exports.beatDurations.reduce((a, b) => a + b, 0);
