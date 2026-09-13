"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.totalFrames = exports.beatDurations = exports.beats = exports.latency = exports.FPS = void 0;
const captures_json_1 = __importDefault(require("./captures.json"));
const beats_1 = require("../beats");
Object.defineProperty(exports, "FPS", { enumerable: true, get: function () { return beats_1.FPS; } });
// Measured wall-clock latency of the real commands on this machine, three runs
// each (media/capture-url, same shell): validate 563-591 ms (includes the fetch),
// token-unset 532-556 ms, --offline 521-547 ms. Output never appears sooner.
exports.latency = {
    validate: Math.round(0.57 * beats_1.FPS),
    tokenUnset: Math.round(0.54 * beats_1.FPS),
    offline: Math.round(0.53 * beats_1.FPS),
    cat: 2,
    echo: 2,
};
exports.beats = [
    {
        title: "file: is a URL now",
        caption: "The manifest lives in another repo. A public one needs no token: a URL and the keys it owns.",
        commands: [
            { typed: "cat manni.config.yaml", output: captures_json_1.default["cat manni.config.yaml (public)"], latencyFrames: exports.latency.cat, holdFrames: 4.2 * beats_1.FPS },
        ],
    },
    {
        title: "validate fetches it",
        caption: "The merged object is checked. billing's bad ticket is reported at the URL, line 6, not in the page.",
        commands: [
            { typed: "manni meta validate", output: captures_json_1.default["manni meta validate"], latencyFrames: exports.latency.validate, holdFrames: 5.0 * beats_1.FPS },
            { typed: "echo $?", output: "1\n", latencyFrames: exports.latency.echo, holdFrames: 2.0 * beats_1.FPS },
        ],
    },
    {
        title: "Private: add tokenEnv",
        caption: "tokenEnv names the variable holding the token. Unset, the run stops with exit 2 and names the variable.",
        commands: [
            { typed: "cat manni.config.yaml", output: captures_json_1.default["cat manni.config.yaml (private)"], latencyFrames: exports.latency.cat, holdFrames: 2.6 * beats_1.FPS },
            { typed: "manni meta validate", output: captures_json_1.default["manni meta validate (token unset)"], latencyFrames: exports.latency.tokenUnset, holdFrames: 3.6 * beats_1.FPS },
            { typed: "echo $?", output: "2\n", latencyFrames: exports.latency.echo, holdFrames: 1.8 * beats_1.FPS },
        ],
    },
    {
        title: "--offline refuses it",
        caption: "A remote manifest is fetched every run, never cached. With no network there is nothing to check, so it stops.",
        commands: [
            { typed: "manni meta validate --offline", output: captures_json_1.default["manni meta validate --offline"], latencyFrames: exports.latency.offline, holdFrames: 3.6 * beats_1.FPS },
        ],
    },
    {
        title: "Exit codes for CI",
        caption: "1 for findings, 2 when the manifest cannot be reached. The message names the variable, never the token.",
        continues: true,
        commands: [
            { typed: "echo $?", output: "2\n", latencyFrames: exports.latency.echo, holdFrames: 4.0 * beats_1.FPS },
        ],
    },
];
exports.beatDurations = exports.beats.map((b) => (0, beats_1.timeline)(b).duration);
exports.totalFrames = exports.beatDurations.reduce((a, b) => a + b, 0);
