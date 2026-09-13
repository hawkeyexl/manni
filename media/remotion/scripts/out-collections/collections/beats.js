"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.totalFrames = exports.beatDurations = exports.beats = exports.latency = exports.FPS = void 0;
const captures_json_1 = __importDefault(require("./captures.json"));
const beats_1 = require("../beats");
Object.defineProperty(exports, "FPS", { enumerable: true, get: function () { return beats_1.FPS; } });
/**
 * Measured wall-clock latency of the real commands on this machine
 * (media/scratch-collections, same shell). Output never appears sooner.
 *
 *   meta validate (refused by the moved key)  543 / 568 / 569 ms
 *   meta validate (the collection)            613 / 597 / 608 ms
 *   a11y check --collection guides            2564 / 1620 / 1588 / 2531 ms
 *
 * The a11y figure is bimodal: a cold Chromium launch costs about a second more
 * than a warm one. 2.0 s is the middle of the four measured runs, and the range
 * is disclosed in media/collections-1x1.script.md rather than trimmed away.
 */
exports.latency = {
    refused: Math.round(0.55 * beats_1.FPS),
    validate: Math.round(0.61 * beats_1.FPS),
    a11y: Math.round(2.0 * beats_1.FPS),
    cat: 2,
    echo: 2,
};
const a11yCmd = "manni a11y check --collection guides --no-progress";
exports.beats = [
    {
        title: "One set, named twice",
        caption: "One document set, spelled twice: a glob under meta:, a URL under a11y:. Move the docs and one goes stale.",
        highlight: ['- "guides/**/*.md"', "- http://127.0.0.1:4321/"],
        commands: [
            {
                typed: "cat manni.config.yaml",
                output: captures_json_1.default["cat manni.config.yaml (old)"],
                latencyFrames: exports.latency.cat,
                holdFrames: 3.6 * beats_1.FPS,
            },
        ],
    },
    {
        title: "0.3.0 refuses it",
        caption: "Exit 2, and the message names where the key went: a top-level collections: list.",
        continues: true,
        highlight: ["is no longer a meta key"],
        commands: [
            {
                typed: "manni meta validate",
                output: captures_json_1.default["manni meta validate (refused)"],
                latencyFrames: exports.latency.refused,
                holdFrames: 4.4 * beats_1.FPS,
            },
            { typed: "echo $?", output: "2\n", latencyFrames: exports.latency.echo, holdFrames: 2.2 * beats_1.FPS },
        ],
    },
    {
        title: "Declared once",
        caption: "One collection: the paths, and the url those pages are published at. No tool owns it.",
        highlight: ["collections:", "url: http://127.0.0.1:4321/"],
        commands: [
            {
                typed: "cat manni.config.yaml",
                output: captures_json_1.default["cat manni.config.yaml (new)"],
                latencyFrames: exports.latency.cat,
                holdFrames: 4.8 * beats_1.FPS,
            },
        ],
    },
    {
        title: "meta reads it",
        caption: "A bare validate checks the collection's files. Nothing typed on the command line.",
        highlight: ["guides/auth.md", "guides/install.md"],
        commands: [
            {
                typed: "manni meta validate",
                output: captures_json_1.default["manni meta validate"],
                latencyFrames: exports.latency.validate,
                holdFrames: 3.4 * beats_1.FPS,
            },
        ],
    },
    {
        title: "a11y reads it too",
        caption: "--collection guides seeds the crawl from that same url:. No URL typed, no second key.",
        continues: true,
        highlight: ["127.0.0.1:4321/"],
        commands: [
            {
                typed: a11yCmd,
                output: captures_json_1.default["manni a11y check --collection guides"],
                latencyFrames: exports.latency.a11y,
                holdFrames: 5.6 * beats_1.FPS,
            },
        ],
    },
];
exports.beatDurations = exports.beats.map((b) => (0, beats_1.timeline)(b).duration);
exports.totalFrames = exports.beatDurations.reduce((a, b) => a + b, 0);
