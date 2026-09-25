// Turn the real captures in media/vocabularies/capture/ into JSON the composition imports.
// Nothing here edits output. Two normalisations, both the terminal's own
// rendering of bytes the replay does not implement:
//   - CRLF to LF, as every other capture script does.
//   - Tabs to 8-column stops. bash's `time` separates each label from its
//     figure with one tab; a terminal draws it as spaces to the next multiple
//     of 8. src/ansi.ts draws characters, not tab stops, so the expansion
//     happens here, as media/remotion/scripts/captures-a11y.mjs does.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const capture = join(here, "..", "..", "vocabularies", "capture");

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
          // No tab in these captures follows an ANSI escape, so a plain count is exact.
          col += 1;
        }
      }
      return out;
    })
    .join("\n");
}

const read = (name) => expandTabs(readFileSync(join(capture, name), "utf8").replace(/\r\n/g, "\n"));

const out = {
  "b1 cat page": read("b1-cat-page.txt"),
  "b2 validate": read("b2-validate.ans"),
  "b3 fill": read("b3-fill.ans"),
  "b4 head page": read("b4-head-page.txt"),
  "b5 validate": read("b5-validate.ans"),
  headN: read("b4-head-n.txt").trim(),
  exits: {
    b2: read("b2-validate.exit").trim(),
    b3: read("b3-fill.exit").trim(),
    b5: read("b5-validate.exit").trim(),
  },
};

mkdirSync(join(here, "..", "src", "vocabularies"), { recursive: true });
writeFileSync(join(here, "..", "src", "vocabularies", "captures.json"), JSON.stringify(out, null, 2));
console.log("wrote src/vocabularies/captures.json", Object.keys(out));
