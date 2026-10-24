// Turn the real captures in media/capture-tasks/ into JSON the composition imports.
// Nothing here edits output: bytes in, bytes out (CRLF normalised to LF only).
// Each run is split into its progress lines, which the replay lands one at a
// time, and the rest, which lands whole.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const capture = join(here, "..", "..", "capture-tasks");
const read = (name) => readFileSync(join(capture, name), "utf8").replace(/\r\n/g, "\n");

// stderr's progress stream: the "starting" line, then one line per action.
const isProgress = (l) => /^(task|t1) as theo: starting/.test(l) || /^  theo › /.test(l);
function split(text) {
  const lines = text.replace(/\n$/, "").split("\n");
  const n = lines.findIndex((l) => !isProgress(l));
  return { progress: lines.slice(0, n).map((l) => l + "\n"), rest: lines.slice(n).join("\n") + "\n" };
}

// Beats 2-3: the dogfood run, stdout and stderr captured apart. Its stderr ends
// with the judge's provider notice, printed when judging starts, before stdout.
// Beat 4's rerun, after the page fix, has the same shape.
function apart(name) {
  const errLines = read(`raw/${name}.err.txt`).replace(/\n$/, "").split("\n");
  return {
    progress: errLines.filter(isProgress).map((l) => l + "\n"),
    notice: errLines.filter((l) => !isProgress(l)).join("\n") + "\n",
    report: read(`raw/${name}.out.txt`),
  };
}

const out = {
  red: read("red.ans"),
  df1: apart("df1"),
  fix: apart("theo-fix"),
  t1: split(read("t1.ans")),
  exits: { red: read("red.exit").trim(), t1: read("t1.exit").trim() },
};

mkdirSync(join(here, "..", "src", "tasks"), { recursive: true });
writeFileSync(join(here, "..", "src", "tasks", "captures.json"), JSON.stringify(out, null, 2));
console.log("wrote src/tasks/captures.json", Object.keys(out));
