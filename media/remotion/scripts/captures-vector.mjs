// Turn the real captures in media/capture-vector/ into JSON the composition imports.
// Nothing here edits output. Two normalisations, both the terminal's own
// rendering of bytes the replay does not implement:
//   - CRLF to LF, as every other capture script does.
//   - Tabs to the terminal's own 8-column stops. bash's `time` separates the
//     label from the figure with one tab, and a terminal draws it as the run of
//     spaces that reaches the next multiple of 8 (as captures-a11y.mjs does).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const capture = join(here, "..", "..", "capture-vector");

/** What a terminal does with a tab: advance to the next multiple of 8. */
const expandTabs = (text) =>
  text
    .split("\n")
    .map((line) => {
      let out = "";
      for (const ch of line) out += ch === "\t" ? " ".repeat(8 - (out.replace(/\x1b\[[0-9;]*m/g, "").length % 8)) : ch;
      return out;
    })
    .join("\n");

const read = (name) => expandTabs(readFileSync(join(capture, name), "utf8").replace(/\r\n/g, "\n"));

const out = {
  embed: read("embed.ans"),
  build: read("build.ans"),
  ls: read("ls.txt"),
  search: read("search.ans"),
  exits: {
    embed: read("embed.exit").trim(),
    build: read("build.exit").trim(),
    search: read("search.exit").trim(),
  },
};

mkdirSync(join(here, "..", "src", "vector"), { recursive: true });
writeFileSync(join(here, "..", "src", "vector", "captures.json"), JSON.stringify(out, null, 2));
console.log("wrote src/vector/captures.json", Object.keys(out));
