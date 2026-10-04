/**
 * manni graph over its own docs section, through the repo-root config.
 *
 * The root `manni.config.yaml` is the one source of truth for the site: its
 * `site` collection declares the `{page}.meta.yaml` manifests that
 * `manni meta validate` reads, and its `graph:` section carries the graph
 * settings. So this build reads each page's metadata exactly as meta does.
 *
 * It builds the graph of docs/src/content/docs/graph/, checks it against the
 * bundled shapes, and then proves the manifests were read. A page's `created`
 * lives in its manifest, never on the page, so a `dcterms:created` triple
 * whose value only the manifest holds can only have come from the manifest.
 * A run that silently stopped reading manifests would still build and check
 * green; this is the assertion that catches it.
 *
 * Usage: npm run docs:check-graph   (needs `npm run build` first)
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

const run = promisify(execFile);
const CLI = "dist/cli.js";
const SECTION = "docs/src/content/docs/graph";
const DOC_PREFIX = "https://example.com/manni-docs/doc/";

/** Run the built CLI, echo its output, and return it. Exits on failure. */
async function cli(args) {
  try {
    const { stdout, stderr } = await run(process.execPath, [CLI, "graph", ...args], {
      maxBuffer: 64 * 1024 * 1024,
    });
    return { stdout, stderr };
  } catch (err) {
    process.stdout.write(err.stdout ?? "");
    process.stderr.write(err.stderr ?? "");
    console.error(`docs:check-graph: manni graph ${args.join(" ")} exited ${err.code ?? 1}`);
    process.exit(typeof err.code === "number" ? err.code : 1);
  }
}

/** The YAML frontmatter block of a page, or "" when it has none. */
function frontmatterOf(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  return match?.[1] ?? "";
}

const build = await cli(["build", SECTION]);
process.stdout.write(build.stdout);
process.stderr.write(build.stderr);

const check = await cli(["check"]);
process.stdout.write(check.stdout);
process.stderr.write(check.stderr);

const query = await cli(["query", "--predicate", "dcterms:created", "-f", "json"]);
const { matches } = JSON.parse(query.stdout);

let fromManifest = 0;
for (const { s, o } of matches) {
  if (!s.startsWith(DOC_PREFIX)) continue;
  const page = s.slice(DOC_PREFIX.length);
  const manifest = page.replace(/\.mdx?$/, ".meta.yaml");
  const onPage = /^created:/m.test(frontmatterOf(await readFile(page, "utf8")));
  const inManifest = await readFile(manifest, "utf8").then(
    (text) => new RegExp(`^  created: ${o.value}\r?$`, "m").test(text),
    () => false,
  );
  if (!onPage && inManifest) fromManifest++;
}

if (fromManifest === 0) {
  console.error(
    "docs:check-graph: no dcterms:created came from a {page}.meta.yaml manifest. " +
      "The graph build is not reading the site's external metadata.",
  );
  process.exit(1);
}
console.log(`${fromManifest} pages carry a created date only their manifest holds`);
