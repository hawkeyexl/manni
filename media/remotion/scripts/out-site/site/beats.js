"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.totalFrames = exports.beatDurations = exports.beats = exports.latency = exports.TYPING_MS = exports.FPS = void 0;
const captures_json_1 = __importDefault(require("./captures.json"));
const beats_1 = require("../beats");
Object.defineProperty(exports, "FPS", { enumerable: true, get: function () { return beats_1.FPS; } });
// site-preview-1x1. Typing speed for this video (design.md: 35-70 ms).
exports.TYPING_MS = 40;
const f = (ms) => Math.round((ms / 1000) * beats_1.FPS);
// Measured wall-clock latency, from media/capture-site/latency.txt and the
// per-line stamps in media/capture-site/preview.stamped (ms after Enter):
//   preview   first announce 1151 ms, npm header 1403 ms, build log 1420 ms,
//             "built in" + second announce 17522 ms, Local URL 17638 ms
//   hugo      1161 ms (exit 2)
//   a11y      5m7.493s over 238 pages (exit 0)
//
// Two waits are compressed, and only those, with the real time on screen:
//  - The astro build, 16.1 s, is shown for 1.2 s. Its 282 lines are cut to one
//    chrome marker that states the count and the 16.1 s, and astro's own
//    "239 page(s) built in 11.98s" line stays in frame.
//  - The crawl, 307.5 s, is shown for 2.0 s. bash's `time` output is in frame,
//    unedited, so the viewer reads 5m7.493s.
// Every other offset is the real one at 1x.
const [announce1, npmBuild, cut, built, npmPreview, ready] = captures_json_1.default.preview.chunks;
const BUILD_SHOWN_FRAMES = Math.round(1.2 * beats_1.FPS);
exports.latency = {
    ls: 2,
    grep: 4,
    preview: f(announce1.ms),
    hugo: f(1161),
    a11y: Math.round(2.0 * beats_1.FPS),
    echo: 1,
};
const grep = 'git grep -h "npx astro" main -- .github';
const hugo = "manni site build test/fixtures/site/hugo";
const a11y = "time manni a11y check -q --no-progress";
exports.beats = [
    {
        title: "Which command serves it?",
        caption: "An Astro site. On main, CI typed the serve command by hand: astro preview, a host, a port.",
        highlight: ["npx astro preview"],
        commands: [
            { typed: "ls docs", output: captures_json_1.default.ls, latencyFrames: exports.latency.ls, holdFrames: 1.2 * beats_1.FPS },
            { typed: grep, output: captures_json_1.default.gitGrep, latencyFrames: exports.latency.grep, holdFrames: 3.4 * beats_1.FPS },
        ],
    },
    {
        title: "manni site preview",
        caption: "It detects Starlight, builds, then serves on the host and port in the site's url: config.",
        highlight: ["manni: Starlight", "Local"],
        commands: [
            {
                typed: "manni site preview",
                output: announce1.output,
                latencyFrames: exports.latency.preview,
                more: [
                    { afterFrames: f(npmBuild.ms - announce1.ms), output: npmBuild.output },
                    { afterFrames: Math.max(1, f(cut.ms - npmBuild.ms)), output: cut.output },
                    { afterFrames: BUILD_SHOWN_FRAMES, output: built.output },
                    { afterFrames: f(npmPreview.ms - built.ms), output: npmPreview.output },
                    { afterFrames: Math.max(1, f(ready.ms - npmPreview.ms)), output: ready.output },
                ],
                holdFrames: 4.6 * beats_1.FPS,
                running: true,
            },
        ],
    },
    {
        title: "Not only Astro",
        caption: "In a second terminal: Hugo is one of 13 frameworks it detects. Not installed here, and it says so.",
        highlight: ["manni: Hugo"],
        commands: [{ typed: hugo, output: captures_json_1.default.hugo, latencyFrames: exports.latency.hugo, holdFrames: 3.4 * beats_1.FPS }],
    },
    {
        title: "a11y finds the server",
        caption: "No URL typed. a11y check reads the same url: and crawls the running site. 238 pages, exit 0.",
        continues: true,
        highlight: ["0 violations on 0 of 238", "5m7.493s"],
        commands: [
            { typed: a11y, output: captures_json_1.default.a11y, latencyFrames: exports.latency.a11y, holdFrames: 2.8 * beats_1.FPS },
            { typed: "echo $?", output: `${captures_json_1.default.exits.a11y}\n`, latencyFrames: exports.latency.echo, holdFrames: 3.2 * beats_1.FPS },
        ],
    },
];
exports.beatDurations = exports.beats.map((b) => (0, beats_1.timeline)(b, exports.TYPING_MS).duration);
exports.totalFrames = exports.beatDurations.reduce((a, b) => a + b, 0);
