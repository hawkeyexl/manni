"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.totalFrames = exports.beatDurations = exports.typingFrames = exports.beats = exports.latency = exports.IDLE_START_FRAMES = exports.ENTER_PAUSE_FRAMES = exports.TYPING_MS = exports.FPS = void 0;
exports.timeline = timeline;
const captures_json_1 = __importDefault(require("./captures.json"));
exports.FPS = 30;
// Timing (design.md "Capture geometry": TypingSpeed 35–70 ms).
exports.TYPING_MS = 45;
exports.ENTER_PAUSE_FRAMES = 14; // finger on Enter, ~0.47 s
exports.IDLE_START_FRAMES = 12; // a bare prompt before typing begins
// Measured wall-clock latency of the real commands on this machine, three runs
// each: validate 331–362 ms, query 297–313 ms. Output never appears sooner.
exports.latency = {
    validate: Math.round((0.35 * exports.FPS)),
    query: Math.round((0.30 * exports.FPS)),
    cat: 2,
    echo: 2,
};
const q = `manni meta query "UPDATE docs SET jira = 'PLAT-1' WHERE _path = 'docs/auth.md'"`;
exports.beats = [
    {
        title: "A public page",
        caption: "The public page carries a title and nothing else. Its ticket and source file must not ship with it.",
        commands: [
            { typed: "cat docs/auth.md", output: captures_json_1.default["cat docs/auth.md"], latencyFrames: exports.latency.cat, holdFrames: 4.2 * exports.FPS },
        ],
    },
    {
        title: "The sidecar",
        caption: "A private manifest supplies source and jira per page. Two lines of config declare which keys it owns.",
        commands: [
            { typed: "cat docs-meta.yaml", output: captures_json_1.default["cat docs-meta.yaml"], latencyFrames: exports.latency.cat, holdFrames: 2.8 * exports.FPS },
            { typed: "cat manni.config.yaml", output: captures_json_1.default["cat manni.config.yaml"], latencyFrames: exports.latency.cat, holdFrames: 4.0 * exports.FPS },
        ],
    },
    {
        title: "validate sees one object",
        caption: "auth passes on the merged values. billing's bad ticket is reported at docs-meta.yaml:6, not in the page.",
        commands: [
            { typed: "manni meta validate", output: captures_json_1.default["manni meta validate"], latencyFrames: exports.latency.validate, holdFrames: 5.2 * exports.FPS },
            { typed: "echo $?", output: "1\n", latencyFrames: exports.latency.echo, holdFrames: 2.4 * exports.FPS },
        ],
    },
    {
        title: "The page stays clean",
        caption: "query refuses to write a sidecar-owned key into the public file.",
        commands: [
            { typed: q, output: captures_json_1.default["manni meta query"], latencyFrames: exports.latency.query, holdFrames: 4.0 * exports.FPS },
        ],
    },
    {
        title: "Exit codes for CI",
        caption: "1 for findings, 2 for the refusal. Nothing private reaches the public repo.",
        continues: true,
        commands: [
            { typed: "echo $?", output: "2\n", latencyFrames: exports.latency.echo, holdFrames: 4.6 * exports.FPS },
        ],
    },
];
// ---- Timeline ---------------------------------------------------------------
const typingFrames = (typed) => Math.ceil((typed.length * exports.TYPING_MS * exports.FPS) / 1000);
exports.typingFrames = typingFrames;
function timeline(beat) {
    let t = beat.continues ? 4 : exports.IDLE_START_FRAMES;
    const commands = beat.commands.map((c) => {
        const typeStart = t;
        const enterAt = typeStart + (0, exports.typingFrames)(c.typed) + exports.ENTER_PAUSE_FRAMES;
        const outputAt = enterAt + c.latencyFrames;
        const end = outputAt + c.holdFrames;
        t = end;
        return { ...c, typeStart, enterAt, outputAt, end };
    });
    return { commands, duration: Math.round(t) };
}
exports.beatDurations = exports.beats.map((b) => timeline(b).duration);
exports.totalFrames = exports.beatDurations.reduce((a, b) => a + b, 0);
