"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.totalFrames = exports.beatDurations = exports.beats = exports.latency = exports.TYPING_MS = exports.FPS = void 0;
const captures_json_1 = __importDefault(require("./captures.json"));
const beats_1 = require("../beats");
Object.defineProperty(exports, "FPS", { enumerable: true, get: function () { return beats_1.FPS; } });
// Typing speed for this video (design.md: 35-70 ms). Near the quick end,
// because beat 1 types two 57-character commands.
exports.TYPING_MS = 38;
// Measured wall-clock latency, from media/capture-repos/latency.txt.
// Replayed at 1x: every run is under 1 s, so nothing is compressed.
//   b1-api    518 ms
//   b1-sdk    546 ms
//   b3-check  517 ms
//   b4-log     53 ms (git)
//   b5-check  768 ms
exports.latency = {
    b1api: Math.round(0.518 * beats_1.FPS),
    b1sdk: Math.round(0.546 * beats_1.FPS),
    b3: Math.round(0.517 * beats_1.FPS),
    git: Math.round(0.053 * beats_1.FPS),
    b5: Math.round(0.768 * beats_1.FPS),
    cat: 2,
};
// Each check is typed with `; echo $?`, so its exit code prints under the summary.
const check = "manni cite check pages/limits.md";
const withExit = (output, exit) => `${output}${exit}\n`;
exports.beats = [
    {
        title: "One root per run",
        caption: "The page cites api and sdk. Either --root fails the other pin, exit 1.",
        highlight: [":2 missing"],
        commands: [
            {
                typed: `${check} --root ../api; echo $?`,
                output: withExit(captures_json_1.default.b1api, captures_json_1.default.exits.b1api),
                latencyFrames: exports.latency.b1api,
                holdFrames: 3.4 * beats_1.FPS,
            },
            {
                typed: `${check} --root ../sdk; echo $?`,
                output: withExit(captures_json_1.default.b1sdk, captures_json_1.default.exits.b1sdk),
                latencyFrames: exports.latency.b1sdk,
                holdFrames: 4.6 * beats_1.FPS,
            },
        ],
    },
    {
        title: "Name each checkout",
        caption: "One key in manni.config.yaml. cite.repos names each checkout.",
        highlight: ["api: ../api", "sdk: ../sdk"],
        commands: [{ typed: "cat manni.config.yaml", output: captures_json_1.default.config, latencyFrames: exports.latency.cat, holdFrames: 3.6 * beats_1.FPS }],
    },
    {
        title: "One run, both pins",
        caption: "Each pin resolves in its own checkout, printed as api: and sdk:. Exit 0.",
        highlight: ["api:lib/limits.ts:2", "sdk:src/client.ts:2"],
        commands: [
            { typed: `${check}; echo $?`, output: withExit(captures_json_1.default.b3, captures_json_1.default.exits.b3), latencyFrames: exports.latency.b3, holdFrames: 4.6 * beats_1.FPS },
        ],
    },
    {
        title: "The SDK changes",
        caption: "A commit in sdk moves the pinned line from 3 attempts to 5.",
        highlight: ["attempts"],
        commands: [
            { typed: "git -C ../sdk log -1 -p --oneline -U0", output: captures_json_1.default.b4, latencyFrames: exports.latency.git, holdFrames: 4.0 * beats_1.FPS },
        ],
    },
    {
        title: "The stale sentence",
        caption: "Only retries reports, in sdk, with the commit it changed since. Exit 1.",
        highlight: ["changed since", "Check the sentence"],
        commands: [
            { typed: `${check}; echo $?`, output: withExit(captures_json_1.default.b5, captures_json_1.default.exits.b5), latencyFrames: exports.latency.b5, holdFrames: 6.4 * beats_1.FPS },
        ],
    },
];
exports.beatDurations = exports.beats.map((b) => (0, beats_1.timeline)(b, exports.TYPING_MS).duration);
exports.totalFrames = exports.beatDurations.reduce((a, b) => a + b, 0);
