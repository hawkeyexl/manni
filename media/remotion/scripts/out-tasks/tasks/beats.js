"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.totalFrames = exports.beatDurations = exports.beats = exports.latency = exports.TYPING_MS = exports.FPS = void 0;
const captures_json_1 = __importDefault(require("./captures.json"));
const beats_1 = require("../beats");
Object.defineProperty(exports, "FPS", { enumerable: true, get: function () { return beats_1.FPS; } });
// Typing speed for this video (design.md: 35-70 ms).
exports.TYPING_MS = 38;
// Waits. design.md lets the static wait be compressed, never typing or output,
// and asks for the real elapsed time on screen.
//
// Beats 2-3 replay the dogfood run media/capture-tasks/raw/df1.*. It took about
// 12.6 min (media/capture-tasks/df1-timing.txt): 28 s of Claude Code, which the
// report prints itself ("7 turns · 0m 28s"), then about 12 min of judging,
// which beat 2's caption states. The replay lands the six actions 0.5 s apart
// (28 s -> 3 s). Beat 2 ends on the judging wait. The report lands on beat 3's
// first frame, already scrolled to the account.
//
// Beat 4 replays raw/theo-fix.*, the same task rerun after the page fix, with
// the current build. Its 37 s of Claude Code is in its report ("7 turns ·
// 0m 37s"). Its judging time was not recorded; the replay shortens that wait to
// 1.5 s, as it does every other.
//
// Beat 5 is media/capture-tasks/t1.ans, under bash's `time`: real 5m9.767s,
// in frame, unedited. Its 50 s of actions land 0.4 s apart and the report
// 1.5 s after the last one.
exports.latency = {
    validate: Math.round(0.909 * beats_1.FPS), // real, 1x
    start: 9, // Enter to "starting in a fresh copy"
    action: 15, // one synthetic-user action, beat 2
    actionFix: 10, // one synthetic-user action, beat 4
    actionT1: 12, // one synthetic-user action, beat 5
    judge: 45, // judging, compressed
    echo: 1,
};
const task = "manni test tasks docs/src/content/docs/meta/fix/index.mdx --persona theo --workspace test/test/fixtures/tasks/red-pr --task \"The docs check on my pull request fails with: docs/install.md (root) must have required property 'description' (line 1) [manni:core:1.0.0]. Make it pass.\"";
const t1 = "time manni test tasks --journey t1 --provider claude-cli";
const df1 = captures_json_1.default.df1;
const fix = captures_json_1.default.fix;
const t1Run = captures_json_1.default.t1;
// Beat 5's report lands after the Enter, the first line, each action and the judge.
const t1ReportAt = 12 + Math.ceil((t1.length * exports.TYPING_MS * beats_1.FPS) / 1000) + 14 + exports.latency.start +
    (t1Run.progress.length - 1) * exports.latency.actionT1 + exports.latency.judge;
const t1Hold = 2.6 * beats_1.FPS; // reading the seven PASS rows before the view scrolls
exports.beats = [
    {
        title: "A red docs check",
        caption: "Theo's pull request is red: install.md has no description. Will the fix page get him through?",
        highlight: ["must have required property"],
        commands: [
            { typed: "time manni meta validate", output: captures_json_1.default.red, latencyFrames: exports.latency.validate, holdFrames: 2.6 * beats_1.FPS },
            { typed: "echo $?", output: `${captures_json_1.default.exits.red}
`, latencyFrames: exports.latency.echo, holdFrames: 1.6 * beats_1.FPS },
        ],
    },
    {
        title: "Hand Theo the task",
        caption: "Claude Code plays Theo in a fresh copy of his repo. Real run: 28 s, then 12 min of judging.",
        highlight: ["theo › "],
        commands: [
            {
                typed: task,
                paste: true,
                output: df1.progress[0],
                latencyFrames: exports.latency.start,
                more: [
                    ...df1.progress.slice(1).map((output) => ({ afterFrames: exports.latency.action, output })),
                    { afterFrames: exports.latency.action, output: df1.notice },
                    // Lands on the beat's last frame + 1, so beat 2 never draws the report.
                    { afterFrames: exports.latency.judge, output: df1.report },
                ],
                holdFrames: 0,
            },
        ],
    },
    {
        title: "Where Theo got stuck",
        caption: "His account flags a docs bug: the error said (line 1), but the page said missing fields have no line number.",
        continues: true,
        commands: [],
        highlight: ["My error said `(line 1)`", "no line number. For a second"],
        // Opens on the account, then eases down to its last line, which keeps the
        // run's other rows above or below the frame.
        scroll: [
            { at: -15, toRow: "  Account" },
            { at: 1.6 * beats_1.FPS, toRow: "didn't read it because I didn't need it for the fix.", bottom: true },
        ],
        pauseFrames: 6.8 * beats_1.FPS,
    },
    {
        title: "Same task, fixed page",
        caption: "A write-in task is judged on completion and adherence: Theo did it, by the docs, within his constraints.",
        highlight: ["PASS "],
        commands: [
            {
                typed: task,
                paste: true,
                output: fix.progress[0],
                latencyFrames: exports.latency.start,
                more: [
                    ...fix.progress.slice(1).map((output) => ({ afterFrames: exports.latency.actionFix, output })),
                    { afterFrames: exports.latency.actionFix, output: fix.notice },
                    { afterFrames: exports.latency.judge, output: fix.report },
                ],
                holdFrames: 3.8 * beats_1.FPS,
            },
        ],
    },
    {
        title: "Kept as golden journey T1",
        caption: "After the docs fix, the task runs as journey t1: seven evals pass, exit 0.",
        highlight: ["PASS ", "1 run: 1 passed"],
        scroll: [{ at: t1ReportAt + t1Hold, toRow: "  trace     " }],
        commands: [
            {
                typed: t1,
                output: t1Run.progress[0],
                latencyFrames: exports.latency.start,
                more: [
                    ...t1Run.progress.slice(1).map((output) => ({ afterFrames: exports.latency.actionT1, output })),
                    { afterFrames: exports.latency.judge, output: t1Run.rest },
                ],
                holdFrames: t1Hold + 15 + 0.8 * beats_1.FPS,
            },
            { typed: "echo $?", output: `${captures_json_1.default.exits.t1}
`, latencyFrames: exports.latency.echo, holdFrames: 2.6 * beats_1.FPS },
        ],
    },
];
exports.beatDurations = exports.beats.map((b) => (0, beats_1.timeline)(b, exports.TYPING_MS).duration);
exports.totalFrames = exports.beatDurations.reduce((a, b) => a + b, 0);
