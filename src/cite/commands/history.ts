/**
 * `manni cite history` (proposal 0092): how long each pin stood stale, and
 * which releases shipped it.
 *
 * The front half is `check`'s (`prepareRun`), so the pages are the ones
 * `check` would read. The walk is `buildTimeline`'s. What is left here is
 * the report: each window's severity under `cite.severity`, its duration in
 * committer time, and the releases inside it. A tag is a release when `HEAD`
 * reaches it, and it shipped a window when its commit contains the opening
 * commit and not the closing one.
 *
 * It never fails on what it finds. It measures, and `check` gates.
 */
import { realpath } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { STDIN_TOKEN } from "../../meta/internal.js";
import { parseDuration } from "../../shared/duration.js";
import { SEVERITIES, type Severity } from "../../shared/severity.js";
import { commitGraph, tagCommits, topLevel } from "../core/git.js";
import { resolveSeverity } from "../core/severity.js";
import { shortCommit } from "../core/spell.js";
import { buildTimeline, repoPath, type TimelinePage, type TimelineWindow } from "../core/timeline.js";
import { CiteError } from "../errors.js";
import type { HistoryOptions, HistoryPage, HistoryRun, StaleWindow, WindowCommit } from "../types.js";
import { prepareRun } from "./check.js";

/** `- ` has no past to walk. */
export const HISTORY_STDIN_REFUSAL =
  "cite history reads each page's past from git, and stdin has none. Name the page's path instead of -.";

export const HISTORY_SHALLOW_REFUSAL =
  "this clone is shallow, so cite history would start at its oldest commit. Fetch the full history with fetch-depth: 0, or git fetch --unshallow.";

/** `<root> is not inside a git repository`, in the verb's words. */
export function notInGitRefusal(root: string): string {
  return `cite history reads git, and ${root} is not inside a git repository.`;
}

/** `<root>` is in a repository with nothing committed. */
export function noCommitsRefusal(root: string): string {
  return `cite history reads git, and ${root} has no commits yet.`;
}

/** Said once when an older commit's config or citation manifests do not load. */
export function unreadNotice(sha: string): string {
  return `history before ${shortCommit(sha)} is unread: its config or citation manifests do not load under this version. Windows open there are marked bounded.`;
}

/** Said once when keyed pins were skipped for want of the key. */
export function encryptedNotice(count: number): string {
  const what = count === 1 ? "1 encrypted citation was" : `${String(count)} encrypted citations were`;
  return `${what} skipped: no encryption key. Set MANNI_ENCRYPTION_KEY or encryptionKey: to include them.`;
}

/** Epoch seconds as ISO 8601 in UTC, to the second. */
function isoOf(seconds: number): string {
  return new Date(seconds * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

const toPosix = (path: string): string => path.split(sep).join("/");

export async function runHistory(opts: HistoryOptions): Promise<HistoryRun> {
  const within =
    opts.newerThan === undefined
      ? undefined
      : parseDuration(opts.newerThan, (message) => new CiteError(message)) / 1000;
  if (opts.inputs.includes(STDIN_TOKEN)) throw new CiteError(HISTORY_STDIN_REFUSAL);

  // `resolve: false` only quiets the notice about a missing git root, which
  // the refusal below says better.
  const prepared = await prepareRun({ ...opts, checkSources: true }, "read", "read", { resolve: false });
  const { run, files } = prepared;
  const top = await topLevel(run.root);
  if (top === null) throw new CiteError(notInGitRefusal(run.root));
  if ((await prepared.git.head()) === null) throw new CiteError(noCommitsRefusal(run.root));
  if (await prepared.git.shallow?.()) throw new CiteError(HISTORY_SHALLOW_REFUSAL);

  const realTop = await realpath(top);
  const base = await realpath(run.base);
  const pages: TimelinePage[] = await Promise.all(
    files.map(async (file) => ({ label: file, path: repoPath(realTop, await realpath(resolve(run.base, file))) })),
  );
  const timeline = await buildTimeline({
    top: realTop,
    root: await realpath(run.root),
    pages,
    ...(run.configPath === undefined ? {} : { config: repoPath(realTop, await realpath(run.configPath)) }),
    base: repoPath(realTop, base),
    ...(run.key === undefined ? {} : { key: run.key }),
    ...(prepared.forced === undefined ? {} : { format: prepared.forced.name }),
    ...(within === undefined ? {} : { within }),
  });
  const { commits, start } = timeline;
  const head = commits[commits.length - 1];
  // The guard above proved HEAD exists, and the first-parent walk from it holds at least HEAD.
  if (head === undefined) throw new Error("history walk returned no commits for an existing HEAD");

  if (timeline.unread) opts.onNotice?.(unreadNotice((commits[start] ?? head).sha));
  if (timeline.encrypted > 0) opts.onNotice?.(encryptedNotice(timeline.encrypted));

  const releasesOf = await releaseFinder(realTop);
  const severity = resolveSeverity(run.config?.severity);
  const at = (i: number): WindowCommit => {
    const commit = commits[i] ?? head;
    return { commit: commit.sha, date: isoOf(commit.time), subject: commit.subject };
  };
  /** A repository path, spelled as the run spells its pages. */
  const label = (path: string): string => toPosix(relative(base, join(realTop, path)));

  const staleWindow = (window: TimelineWindow, level: Severity): StaleWindow => {
    const opened = commits[window.opened] ?? head;
    const closed = window.closed === undefined ? undefined : (commits[window.closed.at] ?? head);
    const home = pages.find((page) => page.label === window.page);
    if (home === undefined) throw new Error(`window for unknown page: ${window.page}`);
    const now = label(home.path);
    return {
      id: window.id,
      source: window.source,
      rule: window.rule,
      severity: level,
      opened: { ...at(window.opened), bounded: window.bounded },
      closed: window.closed === undefined ? null : { ...at(window.closed.at), by: window.closed.by },
      seconds: (closed ?? head).time - opened.time,
      releases: releasesOf(opened.sha, closed?.sha),
      formerly: [...new Set(window.paths.map(label))].filter((path) => path !== now),
    };
  };

  const byPage = new Map<string, StaleWindow[]>(files.map((file) => [file, []]));
  const ordered = [...timeline.windows].sort((a, b) => a.opened - b.opened || a.index - b.index);
  for (const window of ordered) {
    const level = severity[window.rule];
    if (level === "off") continue;
    byPage.get(window.page)?.push(staleWindow(window, level));
  }

  const out: HistoryPage[] = [...byPage.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([file, windows]) => ({ file, windows }));
  const all = out.flatMap((page) => page.windows);
  const bySeverity = Object.fromEntries(SEVERITIES.map((s) => [s, 0])) as Record<Severity, number>;
  for (const window of all) bySeverity[window.severity] += 1;
  const shipped = new Set(all.flatMap((window) => window.releases));
  const first = commits[start] ?? head;

  return {
    summary: {
      head: head.sha,
      walked: { commits: commits.length - start, from: isoOf(first.time), to: isoOf(head.time) },
      files: files.length,
      citations: timeline.citations,
      windows: all.length,
      open: all.filter((window) => window.closed === null).length,
      staleSeconds: all.reduce((sum, window) => sum + window.seconds, 0),
      bySeverity,
      releases: releasesOf.order([...shipped]),
      skipped: { encrypted: timeline.encrypted },
    },
    pages: out,
  };
}

/**
 * The releases a window shipped in: the tags `HEAD` reaches whose commit
 * contains the opening commit and not the closing one, oldest first. The
 * ancestry is read once, as `HEAD`'s whole graph, and each tag's ancestors
 * are gathered the first time a window asks.
 */
async function releaseFinder(
  top: string,
): Promise<((opened: string, closed: string | undefined) => string[]) & { order: (names: string[]) => string[] }> {
  const graph = await commitGraph(top);
  const tags = (await tagCommits(top)).filter((tag) => graph.has(tag.commit));
  const ancestry = new Map<string, Set<string>>();
  const ancestorsOf = (commit: string): Set<string> => {
    const held = ancestry.get(commit);
    if (held !== undefined) return held;
    const seen = new Set<string>();
    const stack = [commit];
    for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
      if (seen.has(next)) continue;
      seen.add(next);
      stack.push(...(graph.get(next)?.parents ?? []));
    }
    ancestry.set(commit, seen);
    return seen;
  };
  const time = (name: string): number => graph.get(tags.find((tag) => tag.name === name)?.commit ?? "")?.time ?? 0;
  const order = (names: string[]): string[] =>
    [...names].sort((a, b) => time(a) - time(b) || (a < b ? -1 : a > b ? 1 : 0));
  const find = (opened: string, closed: string | undefined): string[] =>
    order(
      tags
        .filter((tag) => {
          const contains = ancestorsOf(tag.commit);
          return contains.has(opened) && (closed === undefined || !contains.has(closed));
        })
        .map((tag) => tag.name),
    );
  return Object.assign(find, { order });
}
