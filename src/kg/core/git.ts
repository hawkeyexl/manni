/**
 * One-pass git history collection for provenance derivation. A single
 * `git log` subprocess covers the whole corpus: per-file creation and
 * last-modification committer dates, author names, and rename chains
 * (followed backward so history accrues to the file's current path).
 * Deterministic per commit — the wall clock never enters the result.
 *
 * Author emails are deliberately not collected into the result (privacy):
 * names only, matching frontmatter author handling.
 */
import { DockgError } from "../types.js";
import { realExec, type ExecFn } from "@hawkeyexl/inference";
import { normalizeDocPath } from "./iri.js";

export interface GitFileHistory {
  /** Committer ISO date of the oldest commit touching the file (or its earlier names). */
  created?: string;
  /** Committer ISO date of the newest commit touching it. */
  modified?: string;
  /** Unique author names, newest contribution first. */
  authors: string[];
  /** Earlier paths of this file, nearest rename first (git -M heuristic; best-effort). */
  renamedFrom: string[];
}

export interface GitHistory {
  /** HEAD committer ISO date — stamps the build activity's prov:endedAtTime. */
  headTime?: string;
  files: Map<string, GitFileHistory>;
}

/** Record line marker: %x01 keeps commit headers unambiguous in the stream. */
const RECORD = "\u0001";
const STATUS_LINE = /^([AMDRC])\d*\t(.+)$/;

/**
 * Undo git's C-style path quoting. Even with core.quotepath=off, paths
 * containing double quotes, backslashes, or control characters arrive as
 * `"docs/a\"b.md"` — quotepath only disables quoting of non-ASCII bytes.
 * Octal escapes are raw UTF-8 bytes, decoded together at the end.
 */
export function unquoteGitPath(path: string): string {
  if (path.length < 2 || !path.startsWith('"') || !path.endsWith('"')) {
    return path;
  }
  const inner = path.slice(1, -1);
  const bytes: number[] = [];
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]!;
    if (ch !== "\\") {
      for (const byte of Buffer.from(ch, "utf8")) bytes.push(byte);
      continue;
    }
    const next = inner[++i];
    if (next === undefined) break;
    if (next >= "0" && next <= "7") {
      let octal = next;
      while (octal.length < 3) {
        const digit = inner[i + 1];
        if (digit === undefined || digit < "0" || digit > "7") break;
        octal += digit;
        i++;
      }
      bytes.push(Number.parseInt(octal, 8));
    } else {
      const map: Record<string, string> = { n: "\n", t: "\t", r: "\r" };
      for (const byte of Buffer.from(map[next] ?? next, "utf8"))
        bytes.push(byte);
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

/**
 * Unset every inherited `GIT_*` variable for the child process.
 *
 * git exports GIT_DIR, GIT_INDEX_FILE, GIT_WORK_TREE and friends to the
 * subprocesses it runs — every hook, and anything spawned from one. Inheriting
 * them makes `git log` read *that* repository instead of `cwd`, so the same
 * inputs would yield a different graph depending on who invoked dockg, and a
 * build outside a repo would silently succeed against an unrelated one. Both
 * break the determinism contract, so the ambient state is dropped wholesale
 * rather than enumerated: git keeps adding variables to this namespace.
 */
function clearedGitEnv(): Record<string, string | undefined> {
  const cleared: Record<string, string | undefined> = {};
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("GIT_")) cleared[key] = undefined;
  }
  return cleared;
}

export async function collectGitHistory(
  cwd: string,
  exec: ExecFn = realExec,
): Promise<GitHistory> {
  const result = await exec(
    [
      "git",
      "-c",
      "core.quotepath=off",
      "log",
      `--format=${RECORD}%H%x09%an%x09%cI`,
      "--name-status",
      "-M",
      // Paths relative to cwd, matching discoverFiles output — without this,
      // git emits repo-root-relative paths and every corpus lookup misses
      // when the build runs in a subdirectory of the repo.
      "--relative",
    ],
    { cwd, timeoutMs: 60000, env: clearedGitEnv() },
  );
  // Messages stay neutral about *why* git provenance was requested; the caller
  // knows whether it was demanded (`provenance.git: true`) or inherited
  // (`"auto"`) and frames the failure as an error or a warning accordingly.
  if (result.spawnError) {
    throw new DockgError(
      `git could not be run: ${result.spawnError} (is git installed and on PATH?)`,
    );
  }
  if (result.timedOut) {
    throw new DockgError(
      "`git log` timed out after 60s — the repo history may be too large for whole-history provenance",
    );
  }
  if (result.code !== 0 || result.stdout.trim() === "") {
    const detail = result.stderr.trim().slice(-300);
    throw new DockgError(
      `git history could not be read (is ${cwd} a git repo with at least one commit?)${detail ? ` — git said: ${detail}` : ""}`,
    );
  }

  const files = new Map<string, GitFileHistory>();
  /** Maps a historical path to the file's current (newest) path. */
  const currentName = new Map<string, string>();
  let headTime: string | undefined;
  let commitAuthor = "";
  let commitTime = "";

  const entry = (path: string): GitFileHistory => {
    let file = files.get(path);
    if (!file) {
      file = { authors: [], renamedFrom: [] };
      files.set(path, file);
    }
    return file;
  };

  /** Register that the commit being parsed touched `path` (as known at that time). */
  const touch = (pathThen: string): GitFileHistory => {
    const path = normalizeDocPath(unquoteGitPath(pathThen));
    const current = currentName.get(path) ?? path;
    const file = entry(current);
    // Walking newest→oldest: first touch wins `modified`, every touch pushes
    // `created` older, authors keep first-appearance (newest) order.
    file.modified ??= commitTime;
    file.created = commitTime;
    if (!file.authors.includes(commitAuthor)) file.authors.push(commitAuthor);
    return file;
  };

  for (const line of result.stdout.split("\n")) {
    if (line.startsWith(RECORD)) {
      const [, author = "", time = ""] = line.slice(1).split("\t");
      commitAuthor = author;
      commitTime = time;
      headTime ??= time;
      continue;
    }
    const match = STATUS_LINE.exec(line);
    if (!match) continue;
    const status = match[1]!;
    const rest = match[2]!;
    if (status === "R" || status === "C") {
      const [oldPath, newPath] = rest.split("\t");
      if (!oldPath || !newPath) continue;
      if (status === "C") {
        // Copies create a new file from an old one; the old file's own history
        // is separate. Record the touch on the copy only.
        touch(newPath);
        continue;
      }
      const file = touch(newPath);
      const normalizedOld = normalizeDocPath(unquoteGitPath(oldPath));
      file.renamedFrom.push(normalizedOld);
      // Older commits refer to the pre-rename path; fold them into this file.
      const normalizedNew = normalizeDocPath(unquoteGitPath(newPath));
      currentName.set(
        normalizedOld,
        currentName.get(normalizedNew) ?? normalizedNew,
      );
    } else {
      touch(rest);
    }
  }

  return { headTime, files };
}
