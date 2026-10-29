/**
 * manni graph over its own docs section, through the repo-root config.
 *
 * The root `manni.config.yaml` is the one source of truth for the site. Its
 * `site` collection reads the metadata directory, one `metadata/<id>.yaml`
 * manifest per page, as `manni meta validate` does. Its `graph:` section
 * carries the graph settings. So this build reads each page's metadata
 * exactly as meta does.
 *
 * It builds the graph of docs/src/content/docs/graph/, checks it against the
 * bundled shapes, and then proves the manifests were read. A page's `created`
 * lives in its manifest, never on the page, so a `dcterms:created` triple
 * whose value only the manifest holds can only have come from the manifest.
 * A run that silently stopped reading manifests would still build and check
 * green; this is the assertion that catches it.
 *
 * Then the other direction (proposal 0110). `created` is a field its schema
 * marks external, so a `--no-authoring` build of the same section must hold
 * none of those manifest-only dates.
 *
 * Usage: npm run docs:check-graph   (needs `npm run build` first)
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { parse } from "yaml";

const run = promisify(execFile);
const CLI = "dist/cli.js";
const SECTION = "docs/src/content/docs/graph";
// From the config, not a copy of it: document nodes hang off `graph.baseIri`,
// normalized as the graph config does (a trailing `/` unless it ends `/` or `:`).
const { graph } = parse(await readFile("manni.config.yaml", "utf8"));
const base = /[/:]$/.test(graph.baseIri) ? graph.baseIri : `${graph.baseIri}/`;
const DOC_PREFIX = `${base}doc/`;

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

/** How many pages of the graph at `graphArgs` carry a `created` only their manifest holds. */
async function manifestOnlyCreated(graphArgs) {
  const query = await cli(["query", ...graphArgs, "--predicate", "dcterms:created", "-f", "json"]);
  const { matches } = JSON.parse(query.stdout);
  let count = 0;
  for (const { s, o } of matches) {
    if (!s.startsWith(DOC_PREFIX)) continue;
    const page = s.slice(DOC_PREFIX.length);
    const frontmatter = frontmatterOf(await readFile(page, "utf8"));
    const onPage = /^created:/m.test(frontmatter);
    // A page's manifest is found by its id, as meta finds it (proposal 0126).
    const id = parse(frontmatter)?.id;
    if (typeof id !== "string") continue;
    const inManifest = await readFile(`metadata/${id}.yaml`, "utf8").then(
      (text) => new RegExp(`^  created: ${o.value}\r?$`, "m").test(text),
      () => false,
    );
    if (!onPage && inManifest) count++;
  }
  return count;
}

const fromManifest = await manifestOnlyCreated([]);

if (fromManifest === 0) {
  console.error(
    "docs:check-graph: no dcterms:created came from a metadata/<id>.yaml manifest. " +
      "The graph build is not reading the site's external metadata.",
  );
  process.exit(1);
}
console.log(`${fromManifest} pages carry a created date only their manifest holds`);

const USER_FACING = ".manni/graph/no-authoring/graph.ttl";
const userFacing = await cli(["build", SECTION, "--no-authoring", "-o", USER_FACING]);
process.stdout.write(userFacing.stdout);
process.stderr.write(userFacing.stderr);
const leaked = await manifestOnlyCreated(["-g", USER_FACING]);
if (leaked > 0) {
  console.error(
    `docs:check-graph: a --no-authoring build still carries ${leaked} created dates only a manifest holds. ` +
      "Values a schema marks external are reaching a graph built without author-facing content.",
  );
  process.exit(1);
}
console.log("the --no-authoring build carries no created date a manifest holds");
