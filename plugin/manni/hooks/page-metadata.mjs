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
// A page whose fields name strategy records, by `get`'s `records`, gets more:
// its key fields first, one `<type> <id> <file>` reference per record, and a
// reply kept under Claude Code's limit by leaving out whole non-key fields,
// largest first, with a closing line naming them. Every other page gets the
// stored fields in page order, as they are.
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
  ".xml", ".dita", ".ditamap", ".html", ".htm", ".flsnp",
];

/**
 * The fields a reply for a page that names a record never leaves out, and
 * lists first. Pinned by test/plugin.test.ts to the union of three sources,
 * since the plugin cannot import manni:
 * - the newest manni:core vocabulary's properties: what the page is;
 * - the newest manni:lifecycle vocabulary's properties: whether it is current;
 * - RECORD_FIELDS in src/shared/reference-fields.ts: whom it serves.
 */
export const KEY_FIELDS = [
  "title", "description", "id", "type", "keywords", "language",
  "lifecycle", "replaced-by", "supersedes", "remove-by",
  "audiences", "personas", "journeys", "audience",
];

/** Claude Code's cap on one additionalContext string, as the reply's `.length`. */
export const LIMIT = 10_000;

const REFERENCES_LEAD =
  "The page names these records. Read a record's file for its details, or run manni strategy get <id>, which also lists the pages that name it:";

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

  const first = `Metadata for ${file}, from the page and its sidecars:`;
  const changed = `Metadata for ${file} changed since it was last given here. This replaces it:`;
  // A page that names no record gets 0103's reply: every field, in page order.
  const records = referencesOf(entry.records);
  const body = records.length === 0 ? JSON.stringify(values) : packed(file, values, records, changed);
  const hash = sha(body);
  // Claude Code sets `agent_id` on a hook fired inside a subagent, which has a
  // context of its own. The outermost session carries none, so it is "main".
  const marker = join(sessionDir(envelope.session_id), `${sha(envelope.agent_id ?? "main")}-${sha(abs)}`);
  const stored = readMarker(marker);
  if (stored === hash) return;
  writeMarker(marker, hash);
  const lead = stored === undefined ? first : changed;
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: `${lead}\n${body}` } }),
  );
}

/** The `<type> <id> <file>` line of each well-formed reference `get` gave. */
function referencesOf(records) {
  if (!Array.isArray(records)) return [];
  return records
    .filter((r) => [r?.type, r?.id, r?.file].every((part) => typeof part === "string"))
    .map((r) => `${r.type} ${r.id} ${r.file}`);
}

/** `a`, `a and b`, `a, b and c`. */
function prose(items) {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/**
 * The reply after its lead, for a page that names records: the page JSON with
 * key fields first, the references, and a closing line when a field was left
 * out. While the reply under the longer lead passes LIMIT, the largest
 * remaining non-key field leaves, a tie going to the later field. A key field
 * and a reference never leave, and a value is never cut.
 */
function packed(file, values, records, longestLead) {
  const fields = Object.keys(values);
  const order = [...fields.filter((f) => KEY_FIELDS.includes(f)), ...fields.filter((f) => !KEY_FIELDS.includes(f))];
  const left = [];
  const build = () => {
    const kept = Object.fromEntries(order.filter((f) => !left.includes(f)).map((f) => [f, values[f]]));
    const lines = [JSON.stringify(kept), REFERENCES_LEAD, ...records];
    if (left.length > 0) {
      const out = fields.filter((f) => left.includes(f));
      lines.push(
        `This leaves out ${prose(out)} to stay under Claude Code's limit of 10,000 characters. manni meta get ${out.join(",")} --no-derived ${file} prints them.`,
      );
    }
    return lines.join("\n");
  };
  let body = build();
  while (`${longestLead}\n${body}`.length > LIMIT) {
    const size = (f) => JSON.stringify({ [f]: values[f] }).length;
    const candidates = order.filter((f) => !KEY_FIELDS.includes(f) && !left.includes(f));
    if (candidates.length === 0) break;
    // reduce keeps the later field on a tie.
    left.push(candidates.reduce((a, b) => (size(b) >= size(a) ? b : a)));
    body = build();
  }
  return body;
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
