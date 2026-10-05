// Turn the real captures in media/capture-site/ into JSON the composition imports.
// No output byte is edited. Three normalisations, each one the terminal's own
// rendering of bytes the replay does not implement, plus one disclosed cut:
//   - CRLF to LF.
//   - Tabs to the terminal's 8-column stops (`ls -C` and bash's `time`).
//   - Carriage return and erase-line: keep what follows the last `\r`.
//   - The cut. `manni site preview` prints 295 lines; 281 of them are astro's
//     build log. Lines 5 to 285 of preview.ans are replaced by ONE marker line,
//     which src/ansi.ts draws as chrome (accent, italic), never as output. It
//     states how many lines went and how long they took, measured from
//     preview.stamped. Every other line is kept, in order, with its colour.
//
// preview.stamped holds the millisecond each line arrived after Enter. The
// chunks below carry those stamps, so beats.ts can place each chunk at its
// real offset (the build wait is the one thing compressed; see beats.ts).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const capture = join(here, "..", "..", "capture-site");

function expandTabs(text) {
  return text
    .split("\n")
    .map((line) => {
      let out = "";
      let col = 0;
      for (const ch of line) {
        if (ch === "\t") {
          const n = 8 - (col % 8);
          out += " ".repeat(n);
          col += n;
        } else {
          out += ch;
          col += 1; // no tab follows an escape in these captures
        }
      }
      return out;
    })
    .join("\n");
}

function applyErase(text) {
  return text
    .split("\n")
    .map((line) => {
      const i = line.lastIndexOf("\r");
      return (i === -1 ? line : line.slice(i + 1)).replace(/\x1b\[[0-9]*K/g, "");
    })
    .join("\n");
}

const norm = (s) => expandTabs(applyErase(s.replace(/\r\n/g, "\n")));
const read = (name) => norm(readFileSync(join(capture, name), "utf8"));

// preview.stamped: "<ms>\t<line>" per line, in arrival order.
const stamped = readFileSync(join(capture, "preview.stamped"), "utf8")
  .replace(/\r\n/g, "\n")
  .replace(/\n$/, "")
  .split("\n")
  .map((l) => {
    const tab = l.indexOf("\t");
    return { ms: Number(l.slice(0, tab)), text: norm(l.slice(tab + 1)) };
  });

// 1-based, inclusive: the build log between `> astro build` and astro's own
// "N page(s) built in" line, which stays in frame as the build's real time.
const CUT_FROM = 5;
const CUT_TO = stamped.findIndex((l) => /page\(s\) built in/.test(l.text)); // 0-based index of that line = last cut line, 1-based
if (CUT_TO < CUT_FROM) throw new Error("cut bounds not found");
const cutLines = CUT_TO - CUT_FROM + 1;
const cutStart = stamped[CUT_FROM - 2].ms; // the last kept line before the cut
const cutEnd = stamped[CUT_TO].ms; // the first kept line after it
const cutSeconds = ((cutEnd - cutStart) / 1000).toFixed(1);

const kept = (from, to) => stamped.slice(from - 1, to).map((l) => l.text).join("\n") + "\n";
const at = (n) => stamped[n - 1].ms;
// The Local URL is the last line the preview printed while it ran. The stamp
// file goes on to hold the line npm printed when capture.sh stopped the server,
// after every capture; that line is not part of the video.
const plain = (t) => t.replace(/\x1b\[[0-9;]*m/g, "");
const last = stamped.findIndex((l) => /Local .*4321/.test(plain(l.text))) + 1;
const ready = stamped.findIndex((l) => /ready in/.test(plain(l.text))) + 1;
if (ready === 0 || last === 0) throw new Error("ready or Local line not found");

const preview = {
  // [first line, last line] (1-based) and the ms the chunk landed at.
  chunks: [
    { ms: at(1), output: kept(1, 1) }, // manni's first announce
    { ms: at(4), output: kept(2, 4) }, // npm's own header for the build script
    {
      ms: at(CUT_FROM),
      output: `@@cut@@... ${cutLines} lines of astro build output cut (${cutSeconds} s) ...\n`,
    },
    { ms: at(CUT_TO + 3), output: kept(CUT_TO + 1, CUT_TO + 3) }, // built-in, Complete!, manni's second announce
    { ms: at(ready - 1), output: kept(CUT_TO + 4, ready - 1) }, // npm header, the deprecation notice
    { ms: at(last), output: kept(ready, last) }, // astro ready, Local URL
  ],
  cutLines,
  cutSeconds: Number(cutSeconds),
  totalLines: last,
  readyMs: at(last),
};

const out = {
  ls: read("ls.ans"),
  gitGrep: read("git-grep.ans"),
  preview,
  hugo: read("hugo.ans"),
  a11y: read("a11y.ans"),
  exits: { hugo: read("hugo.exit").trim(), a11y: read("a11y.exit").trim() },
};

mkdirSync(join(here, "..", "src", "site"), { recursive: true });
writeFileSync(join(here, "..", "src", "site", "captures.json"), JSON.stringify(out, null, 2));
console.log("wrote src/site/captures.json");
console.log(preview.chunks.map((c) => `${c.ms}ms ${JSON.stringify(c.output.slice(0, 60))}`).join("\n"));
