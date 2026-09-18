// Turn the real captures in media/capture-a11y/ into JSON the composition imports.
// Nothing here edits output. Three normalisations, every one of them the
// terminal's own rendering of bytes the replay does not implement:
//   - CRLF to LF, as every other capture script does.
//   - Tabs to the terminal's own 8-column stops. bash's `time` separates the
//     label from the figure with one tab, and a terminal draws it as the run of
//     spaces that reaches the next multiple of 8. The replay draws characters,
//     not tab stops, so the expansion happens here.
//   - Carriage return and erase-line. The progress spinner ends each line with
//     `\r\x1b[2K` before the next thing is drawn, so a terminal shows only what
//     follows the last `\r`. src/ansi.ts parses SGR and nothing else, so the
//     erase is applied here instead, the way media/capture-term/pty-screen.mjs
//     applies ConPTY's cursor moves. No visible character is added or removed.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const capture = join(here, "..", "..", "capture-a11y");

/** What a terminal does with a tab: advance to the next multiple of 8. */
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
          // ANSI escapes take no columns; none of these captures put a tab
          // after one, so a plain count is exact here.
          col += 1;
        }
      }
      return out;
    })
    .join("\n");
}

/** What a terminal does with `\r` and an erase-line: keep what was drawn last. */
function applyErase(text) {
  return text
    .split("\n")
    .map((line) => {
      const i = line.lastIndexOf("\r");
      const drawn = i === -1 ? line : line.slice(i + 1);
      return drawn.replace(/\x1b\[[0-9]*K/g, "");
    })
    .join("\n");
}

const read = (name) => expandTabs(applyErase(readFileSync(join(capture, name), "utf8").replace(/\r\n/g, "\n")));

const out = {
  full: read("full.ans"),
  excluded: read("excluded.ans"),
  "seed-clash": read("seed-clash.ans"),
  exits: {
    full: read("full.exit").trim(),
    excluded: read("excluded.exit").trim(),
    seedClash: read("seed-clash.exit").trim(),
  },
};

mkdirSync(join(here, "..", "src", "a11y"), { recursive: true });
writeFileSync(join(here, "..", "src", "a11y", "captures.json"), JSON.stringify(out, null, 2));
console.log("wrote src/a11y/captures.json", Object.keys(out));
