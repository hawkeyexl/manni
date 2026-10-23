// Hands the agent a page's metadata when it reads the page: the fields kept
// in the page and in its sidecars, which a Read of the page alone does not
// show. Each session (and each subagent) is given a page's metadata once, and
// again only when it changes.
//
// PostToolUse on Read: looks the file up with `manni meta get`, and replies
// with additionalContext when the page belongs to a collection and has
// fields. SessionStart after a compaction: forgets what this session was
// given, so the next Read of each page carries its metadata again.
//
// Every other case is silent. It never blocks a Read and never writes to
// stderr, and it exits 0 whatever happens.
//
// Plain ESM with no dependencies: the plugin ships as files, not a package.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, isAbsolute, join, relative, sep } from "node:path";
import { isMain, launch, project } from "./manni.mjs";

/** The extensions `manni meta` reads, lower case. */
export const EXTENSIONS = [
  ".md", ".markdown", ".mdx", ".adoc", ".asciidoc", ".rst",
  ".xml", ".dita", ".ditamap", ".html", ".htm",
];

/** Whether meta reads a file with this path's extension. */
export function isDocument(path) {
  return EXTENSIONS.includes(extname(path).toLowerCase());
}

const sha = (text) => createHash("sha256").update(text).digest("hex");

/** Where one session's hashes live. */
const sessionDir = (sessionId) => join(tmpdir(), "manni", "reads", sha(sessionId));

/** The path with Windows short names and links resolved, or as given. */
function real(path) {
  try {
    return realpathSync.native(path);
  } catch {
    return path;
  }
}

function readStdin() {
  try {
    return JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return undefined;
  }
}

/** The stored hash, or undefined. */
function readMarker(file) {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

function writeMarker(file, hash) {
  mkdirSync(join(file, ".."), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, hash);
  renameSync(temp, file);
}

/** meta get's JSON for `rel`, or undefined on any failure. */
function lookUp(rel) {
  return new Promise((done) => {
    const child = launch(["meta", "get", "--all-fields", "--no-derived", "-f", "json", rel], {
      stdio: ["ignore", "pipe", "ignore"],
      cwd: project,
      windowsHide: true,
    });
    if (child === undefined) return done(undefined);
    let out = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.on("error", () => done(undefined));
    child.on("close", (code) => {
      if (code !== 0) return done(undefined);
      try {
        done(JSON.parse(out));
      } catch {
        done(undefined);
      }
    });
  });
}

async function onRead(envelope) {
  const path = envelope.tool_input?.file_path;
  if (typeof path !== "string" || typeof envelope.session_id !== "string" || !isDocument(path)) return;
  const abs = real(path);
  const rel = relative(real(project), abs);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return;

  const entry = (await lookUp(rel.split(sep).join("/")))?.[0];
  const { file, collections, values } = entry ?? {};
  if (typeof file !== "string" || !Array.isArray(collections) || collections.length === 0) return;
  if (typeof values !== "object" || values === null || Object.keys(values).length === 0) return;

  const json = JSON.stringify(values);
  const hash = sha(json);
  // Claude Code sets `agent_id` on a hook fired inside a subagent, which has a
  // context of its own. The outermost session carries none, so it is "main".
  const marker = join(sessionDir(envelope.session_id), `${sha(envelope.agent_id ?? "main")}-${sha(abs)}`);
  const stored = readMarker(marker);
  if (stored === hash) return;
  writeMarker(marker, hash);
  const lead =
    stored === undefined
      ? `Metadata for ${file}, from the page and its sidecars:`
      : `Metadata for ${file} changed since it was last given here. This replaces it:`;
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: `${lead}\n${json}` } }),
  );
}

async function main() {
  const envelope = readStdin();
  if (typeof envelope !== "object" || envelope === null) return;
  if (envelope.hook_event_name === "SessionStart") {
    if (envelope.source === "compact" && typeof envelope.session_id === "string") {
      rmSync(sessionDir(envelope.session_id), { recursive: true, force: true });
    }
    return;
  }
  if (envelope.hook_event_name === "PostToolUse" && envelope.tool_name === "Read") await onRead(envelope);
}

if (isMain(import.meta.url)) {
  // exitCode rather than exit(), so a reply still in a pipe's buffer is not cut off.
  main()
    .catch(() => undefined)
    .finally(() => {
      process.exitCode = 0;
    });
}
