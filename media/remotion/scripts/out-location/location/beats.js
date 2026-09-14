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
// seven commands and five beats in under 45 s.
exports.TYPING_MS = 35;
// Measured wall-clock latency on this machine, in media/scratch-location
// (media/capture-location/latency.txt: the capture run plus three timing runs):
// validate 536-558 ms, relocate 571-584 ms, validate after relocate 532-552 ms,
// git diff 37-38 ms. Output never appears sooner than measured.
exports.latency = {
    validate: Math.round(0.56 * beats_1.FPS),
    relocate: Math.round(0.58 * beats_1.FPS),
    validateClean: Math.round(0.55 * beats_1.FPS),
    git: 2,
    cat: 2,
    echo: 1,
};
exports.beats = [
    {
        title: "Maintainer data on the page",
        caption: "owner, stakeholders and review-interval ship with the page. The schema marks them external.",
        highlight: ["owner: platform", "stakeholders: [", "review-interval: 90d", '"external"'],
        commands: [
            { typed: "cat docs/install.md", output: captures_json_1.default["cat page"], latencyFrames: exports.latency.cat, holdFrames: 1.5 * beats_1.FPS },
            { typed: "cat page.schema.json", output: captures_json_1.default["cat schema"], latencyFrames: exports.latency.cat, holdFrames: 3.8 * beats_1.FPS },
        ],
    },
    {
        title: "validate: warn, don't fail",
        caption: "validate flags each misplaced value as location:external. Exit 0, so CI never blocks.",
        highlight: ["[location:external]"],
        commands: [
            { typed: "manni meta validate", output: captures_json_1.default["validate warns"], latencyFrames: exports.latency.validate, holdFrames: 4.2 * beats_1.FPS },
            { typed: "echo $?", output: `${captures_json_1.default.exits.validate1}\n`, latencyFrames: exports.latency.echo, holdFrames: 1.5 * beats_1.FPS },
        ],
    },
    {
        title: "relocate moves them",
        caption: "relocate creates site.metadata.yaml and moves the three values into it, keyed by page.",
        highlight: ["→ site.metadata.yaml"],
        commands: [
            { typed: "manni meta relocate", output: captures_json_1.default.relocate, latencyFrames: exports.latency.relocate, holdFrames: 1.5 * beats_1.FPS },
            { typed: "cat site.metadata.yaml", output: captures_json_1.default["cat manifest"], latencyFrames: exports.latency.cat, holdFrames: 3.5 * beats_1.FPS },
        ],
    },
    {
        title: "The page slims down",
        caption: "The page drops three lines. manni.config.yaml now says the manifest owns those keys.",
        highlight: ["-owner:", "-stakeholders:", "-review-interval:", "externalMetadata:", "file: ./site.metadata.yaml", "keys: [owner"],
        commands: [
            { typed: "git diff -U1", output: captures_json_1.default["git diff -U1"], latencyFrames: exports.latency.git, holdFrames: 5.0 * beats_1.FPS },
        ],
    },
    {
        title: "validate: clean",
        caption: "Same values, now in the manifest. validate is clean: no warnings, exit 0.",
        highlight: ["1 file checked"],
        commands: [
            { typed: "manni meta validate", output: captures_json_1.default["validate clean"], latencyFrames: exports.latency.validateClean, holdFrames: 0.8 * beats_1.FPS },
            { typed: "echo $?", output: `${captures_json_1.default.exits.validate2}\n`, latencyFrames: exports.latency.echo, holdFrames: 3.0 * beats_1.FPS },
        ],
    },
];
exports.beatDurations = exports.beats.map((b) => (0, beats_1.timeline)(b, exports.TYPING_MS).duration);
exports.totalFrames = exports.beatDurations.reduce((a, b) => a + b, 0);
