"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.totalFrames = exports.beatDurations = exports.beats = exports.latency = exports.TYPING_MS = exports.FPS = void 0;
const captures_json_1 = __importDefault(require("./captures.json"));
const beats_1 = require("../beats");
Object.defineProperty(exports, "FPS", { enumerable: true, get: function () { return beats_1.FPS; } });
// Typing speed for this video (design.md: 35-70 ms). The fast end: the typed lines
// carry this repository's real page paths, 63-73 characters each.
exports.TYPING_MS = 35;
// Measured wall-clock latency on this machine, from the repo root
// (media/plugin-records/capture/latency.txt). A VirtualBox VM held the CPU at
// 100% throughout, so runs varied widely: get 1.6-8.9 s, the Read hook on the
// stale-windows page 1.7-16.6 s, on the cite CLI reference 1.7-10.3 s. head took
// 638 ms, wc 649 ms and tail 536 ms. Each replayed latency is at least one
// measured run of that command (get 1763 ms, read 1889 ms and big read 2167 ms
// are timing runs), so output never lands sooner than it did. Nothing else is
// sped up. The script discloses the range.
exports.latency = {
    head: Math.round(0.64 * beats_1.FPS),
    get: Math.round(1.8 * beats_1.FPS),
    read: Math.round(1.9 * beats_1.FPS),
    big: Math.round(2.2 * beats_1.FPS),
    wc: Math.round(0.65 * beats_1.FPS),
    tail: Math.round(0.54 * beats_1.FPS),
};
const stale = "docs/src/content/docs/cite/ci/stale-windows.mdx";
const big = "docs/src/content/docs/cite/reference/cli.mdx";
// Per-beat type, derived by media/plugin-records/capture/cols.mjs from each beat's own
// longest line and row count (see plugin-records-1x1.script.md).
const type = (fontPx) => ({ fontPx, linePx: Math.round(fontPx * 1.4), cols: Math.floor(1040 / (0.6 * fontPx)) });
exports.beats = [
    {
        title: "Ids, and nothing more",
        caption: "The page's sidecar names its personas by id. Nothing in it says who devin or maya is.",
        highlight: ["personas:", "- devin", "- maya"],
        type: type(27),
        commands: [
            {
                typed: "head -4 docs/src/content/docs/cite/ci/stale-windows.meta.yaml",
                output: captures_json_1.default.head,
                latencyFrames: exports.latency.head,
                holdFrames: 3.4 * beats_1.FPS,
            },
        ],
    },
    {
        title: "manni meta get personas",
        caption: "meta get now prints a record line for each persona, with the file to read. No new flag.",
        highlight: ["record persona"],
        type: type(25),
        commands: [{ typed: `manni meta get personas ${stale}`, output: captures_json_1.default.get, latencyFrames: exports.latency.get, holdFrames: 4.4 * beats_1.FPS }],
    },
    {
        title: "What a Read hands the agent",
        caption: "Key fields first, then one short line per record. The agent gets references, not the records.",
        highlight: ["docs/content-strategy/"],
        type: type(23),
        commands: [
            { typed: `read-page ${stale} | cut -c -500`, output: captures_json_1.default.read, latencyFrames: exports.latency.read, holdFrames: 5.6 * beats_1.FPS },
        ],
    },
    {
        title: "A huge page fits the limit",
        caption: "The reply, 3,311 characters, stays under Claude Code's limit of 10,000 and names what it left out.",
        highlight: ["3311", "This leaves out"],
        type: type(30),
        commands: [
            { typed: `read-page ${big} > /tmp/reply.txt`, output: captures_json_1.default.big, latencyFrames: exports.latency.big, holdFrames: 0.4 * beats_1.FPS },
            { typed: "wc -c /tmp/reply.txt", output: captures_json_1.default.wc, latencyFrames: exports.latency.wc, holdFrames: 1.2 * beats_1.FPS },
            { typed: "tail -1 /tmp/reply.txt", output: captures_json_1.default.tail, latencyFrames: exports.latency.tail, holdFrames: 5.0 * beats_1.FPS },
        ],
    },
];
exports.beatDurations = exports.beats.map((b) => (0, beats_1.timeline)(b, exports.TYPING_MS).duration);
exports.totalFrames = exports.beatDurations.reduce((a, b) => a + b, 0);
