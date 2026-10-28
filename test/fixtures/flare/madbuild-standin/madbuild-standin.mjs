/**
 * A stand-in for MadCap Flare's madbuild, for manni's tests and demos. It is
 * not Flare and does not render Flare output: it copies each topic as written
 * and writes a Default.htm linking them, so `manni site build` and
 * `manni site preview` have something to run and serve where Flare is not
 * installed. Plain Node, no dependencies, never shipped in the package.
 *
 *   madbuild -project <file.flprj> -target <name>
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { dirname, join } from "node:path";

const USAGE = "usage: madbuild -project <file.flprj> -target <name>";
const args = process.argv.slice(2);
const project = args[0] === "-project" ? args[1] : undefined;
const target = args[2] === "-target" ? args[3] : undefined;
if (args.length !== 4 || project === undefined || target === undefined || !existsSync(project)) {
  process.stderr.write(`${USAGE}\n`);
  process.exit(1);
}

const root = dirname(project);
const content = join(root, "Content");
const topics = existsSync(content)
  ? readdirSync(content, { recursive: true, encoding: "utf8" })
      .filter((name) => name.toLowerCase().endsWith(".htm"))
      .map((name) => join("Content", name))
      .sort()
  : [];

const user = process.env.USERNAME ?? userInfo().username;
const outRel = `Output/${user}/${target}`;
const out = join(root, outRel);
for (const topic of topics) {
  mkdirSync(dirname(join(out, topic)), { recursive: true });
  copyFileSync(join(root, topic), join(out, topic));
}

const escape = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const links = topics.map((topic) => {
  const href = escape(topic.split("\\").join("/"));
  return `      <li><a href="${href}">${href}</a></li>`;
});
mkdirSync(out, { recursive: true });
writeFileSync(
  join(out, "Default.htm"),
  [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<html xmlns="http://www.w3.org/1999/xhtml">',
    "  <head><title>Stand-in build</title></head>",
    "  <body>",
    "    <h1>Stand-in build</h1>",
    "    <ul>",
    ...links,
    "    </ul>",
    "  </body>",
    "</html>",
    "",
  ].join("\n"),
  "utf8",
);
process.stdout.write(`stand-in madbuild: built ${target} into ${outRel}\n`);
