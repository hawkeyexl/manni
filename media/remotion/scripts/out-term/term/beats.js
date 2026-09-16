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
// seven commands and four beats in under 45 s.
exports.TYPING_MS = 35;
// Measured wall-clock latency on this machine, in media/scratch-term
// (media/capture-term/latency.txt: the capture run plus three timing runs):
// term write -f vale 533-548 ms, vale 120-126 ms, term write -f markdown
// 481-512 ms. Output never appears sooner than measured.
exports.latency = {
    writeVale: Math.round(0.55 * beats_1.FPS),
    vale: Math.round(0.13 * beats_1.FPS),
    writeMarkdown: Math.round(0.52 * beats_1.FPS),
    sed: 2,
    cat: 2,
    echo: 1,
};
exports.beats = [
    {
        title: "One glossary, one guide",
        caption: "The glossary defines progressive lens, its acronym and a retired name. The guide gets all three wrong.",
        highlight: ["alt-labels: [PAL]", "hidden-labels:", "about a PAL", "no-line bifocal hides", "Progressive Lens"],
        commands: [
            { typed: "cat glossary.yaml", output: captures_json_1.default["cat glossary"], latencyFrames: exports.latency.cat, holdFrames: 1.4 * beats_1.FPS },
            { typed: "cat docs/fitting.md", output: captures_json_1.default["cat guide"], latencyFrames: exports.latency.cat, holdFrames: 4.2 * beats_1.FPS },
        ],
    },
    {
        title: "Glossary to Vale style",
        caption: "manni term write -f vale turns the terms into Vale rules, one per kind of mistake.",
        highlight: ["Lowercase.yml", "Deprecated.yml", "PAL.yml ", "first:", "second:"],
        commands: [
            { typed: "manni term write -f vale", output: captures_json_1.default["write vale"], latencyFrames: exports.latency.writeVale, holdFrames: 2.4 * beats_1.FPS },
            { typed: "cat styles/Terms/PAL.yml", output: captures_json_1.default["cat pal"], latencyFrames: exports.latency.cat, holdFrames: 3.6 * beats_1.FPS },
        ],
    },
    {
        title: "Vale catches all three",
        caption: "Add Terms to .vale.ini as the notice says. Vale flags the acronym, the old name and the casing: exit 1.",
        highlight: ["Terms.PAL", "Terms.Deprecated", "Terms.Lowercase"],
        commands: [
            { typed: "sed -i 's/= Vale$/= Vale, Terms/' .vale.ini", output: "", latencyFrames: exports.latency.sed, holdFrames: 0.3 * beats_1.FPS },
            { typed: "vale docs/fitting.md", output: captures_json_1.default.vale, latencyFrames: exports.latency.vale, holdFrames: 3.4 * beats_1.FPS },
            { typed: "echo $?", output: `${captures_json_1.default.exits.vale}\n`, latencyFrames: exports.latency.echo, holdFrames: 2.6 * beats_1.FPS },
        ],
    },
    {
        title: "Same terms, new format",
        caption: "The same glossary, rendered as Markdown: one page per term, every field kept.",
        highlight: ["one file each", "  - PAL", "  - no-line bifocal"],
        commands: [
            { typed: "manni term write -f markdown -o docs/terms/", output: captures_json_1.default["write markdown"], latencyFrames: exports.latency.writeMarkdown, holdFrames: 1.2 * beats_1.FPS },
            { typed: "cat docs/terms/progressive-lens.md", output: captures_json_1.default["cat page"], latencyFrames: exports.latency.cat, holdFrames: 4.0 * beats_1.FPS },
        ],
    },
];
exports.beatDurations = exports.beats.map((b) => (0, beats_1.timeline)(b, exports.TYPING_MS).duration);
exports.totalFrames = exports.beatDurations.reduce((a, b) => a + b, 0);
