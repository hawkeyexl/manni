/**
 * Session-store discovery: find Claude Code trace files for a project (or all
 * projects) under the user's home directory. MOOSE_TRACEVALS_HOME overrides the
 * home dir so tests and CI can point at a fixture tree.
 */
import { open, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface TraceListing {
  /** Absolute path of the trace file. */
  file: string;
  mtimeMs: number;
  sizeBytes: number;
  sessionId?: string;
  /** The cwd recorded in the session, when readable. */
  project?: string;
  /** First non-sidechain user prompt, for identification in lists. */
  firstPrompt?: string;
}

export interface DiscoverOptions {
  /** Project directory to scope to (its session-store slug is scanned). */
  project?: string;
  /** Scan every project directory in the store. */
  allProjects?: boolean;
  /** Maximum entries returned, applied after newest-first sorting. */
  limit?: number;
  env?: Record<string, string | undefined>;
}

/** Claude Code's project-slug rule: every non-alphanumeric character → `-`. */
export function slugFor(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}

export function homeDir(
  env: Record<string, string | undefined> = process.env,
): string {
  const override = env.MOOSE_TRACEVALS_HOME;
  if (override) return resolve(override);
  return homedir();
}

export async function discoverTraces(
  options: DiscoverOptions = {},
): Promise<TraceListing[]> {
  const home = homeDir(options.env);
  const store = join(home, ".claude", "projects");

  let projectDirs: string[];
  if (options.allProjects) {
    try {
      const entries = await readdir(store, { withFileTypes: true });
      projectDirs = entries
        .filter((e) => e.isDirectory())
        .map((e) => join(store, e.name));
    } catch {
      return [];
    }
  } else {
    const project = options.project ?? process.cwd();
    projectDirs = [join(store, slugFor(project))];
  }

  const listings: TraceListing[] = [];
  for (const dir of projectDirs) {
    let names: string[];
    try {
      names = (await readdir(dir)).filter((n) => n.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const name of names) {
      const file = join(dir, name);
      try {
        const info = await stat(file);
        listings.push({
          file,
          mtimeMs: info.mtimeMs,
          sizeBytes: info.size,
          ...(await summarizeTrace(file)),
        });
      } catch {
        continue;
      }
    }
  }

  listings.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return options.limit !== undefined
    ? listings.slice(0, options.limit)
    : listings;
}

/** Bytes read from the head of a session file when summarizing for a list. */
const SUMMARY_WINDOW = 256 * 1024;

/** Read only the first `bytes` of a file — session files run to many MB. */
async function readHead(file: string, bytes: number): Promise<string | null> {
  let handle;
  try {
    handle = await open(file, "r");
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.toString("utf-8", 0, bytesRead);
  } catch {
    return null;
  } finally {
    await handle?.close();
  }
}

async function summarizeTrace(
  file: string,
): Promise<Pick<TraceListing, "sessionId" | "project" | "firstPrompt">> {
  const content = await readHead(file, SUMMARY_WINDOW);
  if (content === null) return {};

  const summary: Pick<TraceListing, "sessionId" | "project" | "firstPrompt"> =
    {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let rec: Record<string, unknown>;
    try {
      rec = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (summary.sessionId === undefined) {
      const id = rec.sessionId ?? rec.session_id;
      if (typeof id === "string") summary.sessionId = id;
    }
    if (summary.project === undefined && typeof rec.cwd === "string") {
      summary.project = rec.cwd;
    }
    if (
      summary.firstPrompt === undefined &&
      rec.type === "user" &&
      rec.isSidechain !== true
    ) {
      const message = rec.message as Record<string, unknown> | undefined;
      const content = message?.content;
      if (typeof content === "string" && !content.startsWith("<command-")) {
        summary.firstPrompt = content.split("\n")[0]?.slice(0, 200);
      }
    }
    if (summary.sessionId && summary.project && summary.firstPrompt) break;
  }
  return summary;
}
