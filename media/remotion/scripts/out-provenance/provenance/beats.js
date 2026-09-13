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
// eleven commands in under 45 s, the longest 51 characters.
exports.TYPING_MS = 35;
// Measured wall-clock latency on this machine, from media/scratch-provenance
// (media/capture-provenance/latency.txt, plus three timing runs each on a copy):
// derive 682-708 ms, validate 692-757 ms, get 627-666 ms, git diff 43-46 ms,
// git commit 60-63 ms, sed 32 ms. Output never appears sooner than measured.
exports.latency = {
    derive: Math.round(0.71 * beats_1.FPS),
    validate: Math.round(0.76 * beats_1.FPS),
    get: Math.round(0.67 * beats_1.FPS),
    git: 2,
    sed: 1,
    echo: 1,
};
exports.beats = [
    {
        title: "An agent wrote part of it",
        caption: "An agent just wrote these lines. Once they are committed, nothing records which were its.",
        highlight: ["+The limit", "+Bursts", "+A 429"],
        commands: [
            { typed: "git diff", output: captures_json_1.default["git diff"], latencyFrames: exports.latency.git, holdFrames: 3.5 * beats_1.FPS },
        ],
    },
    {
        title: "Stamp before committing",
        caption: "derive pins the uncommitted lines to claude-fable-5: a body range and a hash of their text.",
        highlight: ["provenance  lines 9-12", "- generated-by:", "lines: 6-9", "integrity:"],
        commands: [
            { typed: "MANNI_GENERATED_BY=claude-fable-5 manni meta derive", output: captures_json_1.default["derive uncommitted"], latencyFrames: exports.latency.derive, holdFrames: 1.0 * beats_1.FPS },
            { typed: "head -7 docs/limits.md", output: captures_json_1.default["head -7"], latencyFrames: exports.latency.git, holdFrames: 2.6 * beats_1.FPS },
            { typed: 'git commit -qam "docs: add the limits"', output: "", latencyFrames: exports.latency.git, holdFrames: 0.5 * beats_1.FPS },
        ],
    },
    {
        title: "A person edits one line",
        caption: "A person changes one line inside the agent's range, and commits it.",
        highlight: ["-Bursts of 20", "+Bursts of 50"],
        commands: [
            { typed: "sed -i 's/of 20/of 50/' docs/limits.md", output: "", latencyFrames: exports.latency.sed, holdFrames: 0.2 * beats_1.FPS },
            { typed: "git diff -U0", output: captures_json_1.default["git diff -U0"], latencyFrames: exports.latency.git, holdFrames: 1.8 * beats_1.FPS },
            { typed: 'git commit -qam "docs: raise the burst"', output: "", latencyFrames: exports.latency.git, holdFrames: 0.6 * beats_1.FPS },
        ],
    },
    {
        title: "validate: the pin broke",
        caption: "The pinned text changed since claude-fable-5 wrote it. validate names the range: exit 1.",
        highlight: ["/provenance"],
        commands: [
            { typed: "manni meta validate", output: captures_json_1.default["validate stale"], latencyFrames: exports.latency.validate, holdFrames: 2.6 * beats_1.FPS },
            { typed: "echo $?", output: `${captures_json_1.default.exits.validate1}\n`, latencyFrames: exports.latency.echo, holdFrames: 1.6 * beats_1.FPS },
        ],
    },
    {
        title: "derive re-attributes",
        caption: "The agent keeps its untouched lines. The edited line is attributed to no machine. Exit 0.",
        highlight: ["provenance=lines"],
        commands: [
            { typed: "manni meta derive", output: captures_json_1.default["derive again"], latencyFrames: exports.latency.derive, holdFrames: 0.5 * beats_1.FPS },
            { typed: "manni meta get provenance docs/limits.md", output: captures_json_1.default["get provenance"], latencyFrames: exports.latency.get, holdFrames: 2.0 * beats_1.FPS },
            { typed: "manni meta validate", output: captures_json_1.default["validate clean"], latencyFrames: exports.latency.validate, holdFrames: 0.4 * beats_1.FPS },
            { typed: "echo $?", output: `${captures_json_1.default.exits.validate2}\n`, latencyFrames: exports.latency.echo, holdFrames: 2.5 * beats_1.FPS },
        ],
    },
];
exports.beatDurations = exports.beats.map((b) => (0, beats_1.timeline)(b, exports.TYPING_MS).duration);
exports.totalFrames = exports.beatDurations.reduce((a, b) => a + b, 0);
