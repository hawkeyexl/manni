// Turn the real captures in media/capture-term/ into JSON the composition imports.
// Nothing here edits output: bytes in, bytes out (CRLF normalised to LF only).
// vale.ans is the screen pty-screen.mjs drew from the pseudo-terminal bytes.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const capture = join(here, "..", "..", "capture-term");
const read = (name) => readFileSync(join(capture, name), "utf8").replace(/\r\n/g, "\n");

const out = {
  "cat glossary": read("cat-glossary.txt"),
  "cat guide": read("cat-guide.txt"),
  "write vale": read("write-vale.ans"),
  "cat pal": read("cat-pal.txt"),
  vale: read("vale.ans"),
  "write markdown": read("write-md.ans"),
  "cat page": read("cat-page.txt"),
  exits: {
    writeVale: read("write-vale.exit").trim(),
    vale: read("vale-plain.exit").trim(),
    writeMarkdown: read("write-md.exit").trim(),
  },
};

mkdirSync(join(here, "..", "src", "term"), { recursive: true });
writeFileSync(join(here, "..", "src", "term", "captures.json"), JSON.stringify(out, null, 2));
console.log("wrote src/term/captures.json", Object.keys(out));
