// A stand-in for a docs framework, so the sample repository has a site to
// build. `node build.mjs` renders each page under docs/ to a plain HTML page
// under dist/, and `node build.mjs serve` serves dist/ on 127.0.0.1:4322.
// Your own site uses Starlight, Docusaurus, MkDocs or another framework, and
// `manni site` runs that framework's commands instead.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve, sep } from "node:path";

if (process.argv[2] === "serve") {
  const root = resolve("dist");
  createServer((req, res) => {
    const path = join(root, decodeURIComponent(new URL(req.url, "http://x").pathname), "index.html");
    // An encoded `..` survives URL parsing; never serve outside dist/.
    if (!path.startsWith(root + sep)) return res.writeHead(403).end("Forbidden");
    if (!existsSync(path)) return res.writeHead(404).end("Not found");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(readFileSync(path));
  }).listen(4322, "127.0.0.1", () => console.log("Serving dist/ on http://127.0.0.1:4322/"));
}

const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function render(markdown) {
  const body = markdown.replace(/^---\n[\s\S]*?\n---\n/, "");
  const title = /^title: (.*)$/m.exec(markdown)?.[1] ?? "Widget";
  const blocks = body.split(/\n{2,}/).map((block) => {
    const text = block.trim();
    if (text === "") return "";
    if (text.startsWith("## ")) return `<h2>${escape(text.slice(3))}</h2>`;
    if (text.startsWith("# ")) return `<h1>${escape(text.slice(2))}</h1>`;
    const links = (s) => escape(s).replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, href) => `<a href="${href.replace(/\.md$/, "/")}">${text}</a>`);
    if (text.startsWith("- ")) return `<ul>${text.split("\n").map((li) => `<li>${links(li.slice(2))}</li>`).join("")}</ul>`;
    return `<p>${links(text)}</p>`;
  });
  return `<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8"><title>${escape(title)}</title></head>\n<body><main>\n${blocks.join("\n")}\n</main></body>\n</html>\n`;
}

for (const file of process.argv[2] === "serve" ? [] : readdirSync("docs", { recursive: true })) {
  if (!file.endsWith(".md")) continue;
  const out = join("dist", file.replace(/(^|[\\/])index\.md$/, "$1index.html").replace(/\.md$/, "/index.html"));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, render(readFileSync(join("docs", file), "utf8")));
}
