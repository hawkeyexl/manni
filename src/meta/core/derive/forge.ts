/**
 * The forge source: `reviewed-by` and `last-reviewed` from the pull request
 * or merge request that merged a document's newest body-changing commit.
 *
 * Reached through `gh` or `glab`, never an HTTP client. The facts sit behind
 * two vendors' auth stores and two API grammars, and the vendor CLI is the
 * trust boundary: manni never holds a token, never reads one, never prints
 * one. `gh` is on every GitHub-hosted runner and `glab` is one package
 * install on GitLab's (proposal 0040, decision 7).
 *
 * Two answers are deliberately *not* errors. A commit the forge has no merged
 * change for (an open PR, a direct push, a commit that came in through
 * another repository) is `null`. A commit the forge does not know at all is
 * `null` too. Everything else that goes wrong — a non-zero exit, a timeout,
 * an answer that is not JSON — throws `DocmetaError`, because a half-answer
 * read as "no approvals" would file a stale finding against a document that
 * was in fact reviewed.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { resolve as resolvePath } from "node:path";
import { DocmetaError } from "../../types.js";
import { ForgeCache, cachedClient } from "./cache.js";
import type {
  Approval,
  DerivedValue,
  ForgeClient,
  ForgeIdentity,
  MergedChange,
  SourceStatus,
} from "./types.js";

export type { Approval, ForgeClient, ForgeIdentity, MergedChange } from "./types.js";

/** How a client reaches the binary; tests point `bin` at node and a fake script. */
export interface SpawnOptions {
  /** Defaults to `gh` / `glab`, resolved on PATH. */
  bin?: string;
  /** Arguments placed before the command's own, such as a script for `node`. */
  prefixArgs?: string[];
  cwd: string;
  /** Kill the child after this long. Default 30 s. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Origin → identity

/**
 * The host and project an origin URL names, for the three spellings git
 * writes: `git@host:owner/repo.git`, `https://[user@]host/owner/repo[.git]`,
 * `ssh://git@host[:port]/owner/repo`. The project keeps every path segment,
 * because a GitLab namespace can nest (`group/sub/repo`). Anything else —
 * a local path, a bare host — is `null`.
 */
export function parseOriginUrl(
  url: string,
): { host: string; project: string } | null {
  const trimmed = url.trim();
  if (trimmed === "") return null;

  const scp = /^(?:[^@/:]+@)?([^/:]+):(?!\/\/)(.+)$/.exec(trimmed);
  if (scp) {
    const host = scp[1];
    const path = scp[2];
    if (host === undefined || path === undefined) return null;
    return project(host, path);
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (!/^(https?|ssh|git):$/.test(parsed.protocol)) return null;
  if (parsed.hostname === "") return null;
  return project(parsed.hostname, parsed.pathname);
}

function project(
  host: string,
  path: string,
): { host: string; project: string } | null {
  const segments = path
    .replace(/\.git$/, "")
    .split("/")
    .filter((s) => s !== "");
  if (segments.length < 2) return null;
  return { host, project: segments.join("/") };
}

/**
 * Which CLI to reach a host through. `github.com` is GitHub; a host whose
 * name contains `gitlab` (gitlab.com, gitlab.example.com) is GitLab; every
 * other host is taken for GitHub Enterprise, the common self-hosted case,
 * and reached with `gh --hostname`. A self-managed GitLab on a host that
 * does not say so lands on the wrong CLI, and `status()` then reports `gh`
 * as unauthenticated for it — a visible failure with the fix named, rather
 * than a silent one.
 */
export function identityFromOrigin(host: string, project: string): ForgeIdentity {
  const kind = host !== "github.com" && host.toLowerCase().includes("gitlab")
    ? "gitlab"
    : "github";
  return { kind, host, project };
}

// ---------------------------------------------------------------------------
// Spawning

interface Run {
  /** Exit code; `null` when a signal ended the child. */
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** The binary could not be started at all: nothing on PATH by that name. */
class BinMissing extends Error {}

/** One child, stdout collected, stderr drained and kept for the message. */
function run(bin: string, args: string[], opts: SpawnOptions): Promise<Run> {
  return new Promise((settle, reject) => {
    let done = false;
    const finish = (r: Run): void => {
      if (done) return;
      done = true;
      settle(r);
    };
    const fail = (err: Error): void => {
      if (done) return;
      done = true;
      reject(err);
    };

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(bin, [...(opts.prefixArgs ?? []), ...args], {
        cwd: opts.cwd,
        windowsHide: true,
      });
    } catch (err) {
      fail(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    // Drained *and* kept: a chatty CLI must not stall the pipe, and its last
    // line is what names the failure to the user.
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.stdin.end();

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    // No binary on PATH lands here rather than throwing from spawn().
    child.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      fail(err.code === "ENOENT" ? new BinMissing(err.message) : err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      finish({ code, stdout, stderr, timedOut });
    });
  });
}

/** `gh api --hostname h repos/…`: the command as the user would type it. */
function commandLine(bin: string, args: string[]): string {
  return [bin, ...args].join(" ");
}

function lastLine(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  return lines.at(-1) ?? "";
}

/** The HTTP status a `gh`/`glab` failure line carries, when it carries one. */
function httpStatus(stderr: string): number | null {
  const m = /\b(?:HTTP\s+(\d{3})|(\d{3})\s+Not\s+Found)\b/i.exec(stderr);
  const code = m?.[1] ?? m?.[2];
  return code === undefined ? null : Number(code);
}

/**
 * Whether a failed call is the forge saying "no such thing" — a commit it
 * does not know (404, or GitHub's 422 "No commit found for SHA") — which is
 * an answer, not an error.
 */
function isNotFound(r: Run): boolean {
  const status = httpStatus(r.stderr);
  return status === 404 || status === 422;
}

/**
 * The base for both CLIs: the same spawn, the same failure ladder, the same
 * status vocabulary. Subclasses supply the binary name and the lookups.
 */
abstract class CliClient implements ForgeClient {
  protected abstract readonly tool: "gh" | "glab";

  constructor(
    protected readonly identity: ForgeIdentity | null,
    protected readonly spawnOpts: SpawnOptions,
  ) {}

  detect(): Promise<ForgeIdentity | null> {
    return Promise.resolve(this.identity);
  }

  async status(): Promise<SourceStatus> {
    if (this.identity === null) {
      return { available: false, reason: "no origin remote to derive the forge from" };
    }
    const { host } = this.identity;
    let r: Run;
    try {
      r = await this.run(["auth", "status", "--hostname", host]);
    } catch (err) {
      if (err instanceof BinMissing) {
        return {
          available: false,
          reason: `${this.tool} is not on PATH (origin is ${host}); install ${this.tool} and run ${this.tool} auth login`,
        };
      }
      throw err;
    }
    if (r.timedOut) throw this.timeout(["auth", "status", "--hostname", host]);
    if (r.code !== 0) {
      return {
        available: false,
        reason: `${this.tool} is not authenticated for ${host}; run ${this.tool} auth login`,
      };
    }
    return { available: true };
  }

  async mergedChangeFor(sha: string): Promise<MergedChange | null> {
    if (this.identity === null) return null;
    return this.lookup(this.identity, sha);
  }

  protected abstract lookup(
    identity: ForgeIdentity,
    sha: string,
  ): Promise<MergedChange | null>;

  protected get bin(): string {
    return this.spawnOpts.bin ?? this.tool;
  }

  protected run(args: string[]): Promise<Run> {
    return run(this.bin, args, this.spawnOpts);
  }

  private timeout(args: string[]): DocmetaError {
    const ms = this.spawnOpts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    return new DocmetaError(
      `${commandLine(this.tool, args)} timed out after ${ms}ms`,
    );
  }

  /**
   * Run a call whose stdout is JSON. A not-found answer is `null`; any other
   * failure throws, naming the command the user can re-run by hand. The
   * message quotes the tool's own name rather than `bin`, which under test
   * is `node`.
   */
  protected async json(args: string[]): Promise<unknown> {
    let r: Run;
    try {
      r = await this.run(args);
    } catch (err) {
      if (err instanceof BinMissing) {
        throw new DocmetaError(
          `${commandLine(this.tool, args)} failed: ${this.tool} is not on PATH`,
        );
      }
      throw err;
    }
    const cmd = commandLine(this.tool, args);
    if (r.timedOut) throw this.timeout(args);
    if (r.code !== 0) {
      if (isNotFound(r)) return null;
      const detail = lastLine(r.stderr) || lastLine(r.stdout);
      const exit = r.code === null ? "signal" : `exit ${r.code}`;
      throw new DocmetaError(
        `${cmd} failed (${exit})${detail === "" ? "" : `: ${detail}`}`,
      );
    }
    try {
      return JSON.parse(r.stdout) as unknown;
    } catch {
      throw new DocmetaError(`${cmd} did not return JSON`);
    }
  }
}

// ---------------------------------------------------------------------------
// Answer shapes, read defensively

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function items(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.filter(isRecord) : [];
}

function numberOf(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) ? v : null;
}

function stringOf(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

/** A field that is present and a string, present and null, or absent. */
type Tri = string | null | undefined;

function timestampOf(v: unknown): Tri {
  if (v === undefined) return undefined;
  return stringOf(v);
}

/**
 * `claude[bot]` (REST) and `claude` (GraphQL) are one reviewer. The stripped
 * form is the dedupe key; the value keeps whichever spelling the latest
 * approval carried.
 */
function normalizeLogin(login: string): string {
  return login.replace(/\[bot\]$/, "");
}

/** `APPROVED` only, the latest per reviewer, oldest approval first. */
function latestApprovals(
  reviews: readonly { login: string; state: string; submittedAt: string }[],
): Approval[] {
  const latest = new Map<string, Approval>();
  for (const r of reviews) {
    if (r.state !== "APPROVED") continue;
    const key = normalizeLogin(r.login);
    const seen = latest.get(key);
    if (seen === undefined || r.submittedAt > seen.submittedAt) {
      latest.set(key, { login: r.login, submittedAt: r.submittedAt });
    }
  }
  return byTime([...latest.values()]);
}

function byTime(approvals: readonly Approval[]): Approval[] {
  return [...approvals].sort((a, b) =>
    a.submittedAt < b.submittedAt ? -1 : a.submittedAt > b.submittedAt ? 1 : 0,
  );
}

// ---------------------------------------------------------------------------
// GitHub

/**
 * GitHub through `gh`. Every call carries `--hostname` (or `-R host/project`)
 * so a GHES origin is reached even when `gh`'s default host is github.com.
 *
 * - `gh api --hostname <host> repos/<project>/commits/<sha>/pulls`
 * - if empty: `gh pr list --search <sha> --state merged --json number,mergedAt -R <host>/<project>`
 *   (a squash-merged commit's original sha is only findable through search,
 *   and a commit that came in through another repository is `[]` here, which
 *   is a legitimate non-error)
 * - `gh api --hostname <host> repos/<project>/pulls/<n>` only when the list
 *   item does not say whether it merged
 * - `gh api --hostname <host> repos/<project>/pulls/<n>/reviews?per_page=100`
 */
export class GhClient extends CliClient {
  protected readonly tool = "gh";

  protected async lookup(
    identity: ForgeIdentity,
    sha: string,
  ): Promise<MergedChange | null> {
    const { host, project } = identity;
    const api = (endpoint: string): Promise<unknown> =>
      this.json(["api", "--hostname", host, endpoint]);

    let candidates = items(await api(`repos/${project}/commits/${sha}/pulls`)).map(
      (p) => ({ number: numberOf(p.number), mergedAt: timestampOf(p.merged_at) }),
    );
    if (candidates.length === 0) {
      const found = await this.json([
        "pr", "list", "--search", sha, "--state", "merged",
        "--json", "number,mergedAt", "-R", `${host}/${project}`,
      ]);
      candidates = items(found).map((p) => ({
        number: numberOf(p.number),
        mergedAt: timestampOf(p.mergedAt),
      }));
    }

    for (const c of candidates) {
      if (c.number === null) continue;
      let mergedAt = c.mergedAt;
      if (mergedAt === undefined) {
        const pr = await api(`repos/${project}/pulls/${c.number}`);
        mergedAt = isRecord(pr) ? (stringOf(pr.merged_at) ?? null) : null;
      }
      if (mergedAt === null) continue;

      const reviews = items(await api(`repos/${project}/pulls/${c.number}/reviews?per_page=100`))
        .map((r) => ({
          login: isRecord(r.user) ? stringOf(r.user.login) : null,
          state: stringOf(r.state),
          submittedAt: stringOf(r.submitted_at),
        }))
        .filter(
          (r): r is { login: string; state: string; submittedAt: string } =>
            r.login !== null && r.state !== null && r.submittedAt !== null,
        );
      return { id: c.number, mergedAt, approvals: latestApprovals(reviews) };
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// GitLab

/**
 * GitLab through `glab`. `:fullpath` is substituted by glab from the current
 * repository, which is why the client runs from the checkout.
 *
 * - `glab api --hostname <host> projects/:fullpath/repository/commits/<sha>/merge_requests`
 * - `glab api --hostname <host> projects/:fullpath/merge_requests/<iid>/approvals`
 *
 * GitLab records who approved but not when, so every approval is stamped
 * with the MR's `merged_at`; `deriveFromForge` says so in the evidence.
 */
export class GlabClient extends CliClient {
  protected readonly tool = "glab";

  protected async lookup(
    identity: ForgeIdentity,
    sha: string,
  ): Promise<MergedChange | null> {
    const { host } = identity;
    const api = (endpoint: string): Promise<unknown> =>
      this.json(["api", "--hostname", host, endpoint]);

    const merged = items(
      await api(`projects/:fullpath/repository/commits/${sha}/merge_requests`),
    )
      .map((mr) => ({ iid: numberOf(mr.iid), mergedAt: stringOf(mr.merged_at) }))
      .find(
        (mr): mr is { iid: number; mergedAt: string } =>
          mr.iid !== null && mr.mergedAt !== null,
      );
    if (merged === undefined) return null;

    const answer = await api(`projects/:fullpath/merge_requests/${merged.iid}/approvals`);
    const approvedBy = isRecord(answer) ? items(answer.approved_by) : [];
    const approvals: Approval[] = [];
    const seen = new Set<string>();
    for (const entry of approvedBy) {
      const login = isRecord(entry.user) ? stringOf(entry.user.username) : null;
      if (login === null) continue;
      const key = normalizeLogin(login);
      if (seen.has(key)) continue;
      seen.add(key);
      approvals.push({ login, submittedAt: merged.mergedAt });
    }
    return { id: merged.iid, mergedAt: merged.mergedAt, approvals };
  }
}

// ---------------------------------------------------------------------------
// Assembly

/**
 * The client for the repository at `root`: origin read with
 * `git remote get-url origin`, the CLI chosen by `identityFromOrigin`, the
 * result wrapped in the on-disk cache. No origin (or no git) yields a client
 * whose `status()` says so; nothing throws here, because "no forge" is a
 * source being unavailable, and that is reported where sources are reported.
 */
export async function createForgeClient(
  root: string,
  opts: {
    cwd: string;
    cache: boolean;
    cacheDir: string;
    spawn?: Partial<SpawnOptions>;
  },
): Promise<ForgeClient> {
  const spawnOpts: SpawnOptions = { ...opts.spawn, cwd: opts.spawn?.cwd ?? opts.cwd };
  const origin = await originUrl(root);
  const parsed = origin === null ? null : parseOriginUrl(origin);
  const identity = parsed === null ? null : identityFromOrigin(parsed.host, parsed.project);
  const client =
    identity?.kind === "gitlab"
      ? new GlabClient(identity, spawnOpts)
      : new GhClient(identity, spawnOpts);
  const cache = new ForgeCache(resolvePath(root, opts.cacheDir), opts.cache);
  return cachedClient(client, cache, identity);
}

/** `git remote get-url origin`, or null when there is no origin or no git. */
async function originUrl(root: string): Promise<string | null> {
  try {
    const r = await run("git", ["remote", "get-url", "origin"], { cwd: root });
    if (r.code !== 0 || r.timedOut) return null;
    return stringOf(r.stdout.trim());
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The source

export interface ForgeSourceInput {
  label: string;
  /** The newest body-changing commit; `null` for a working-tree document. */
  sha: string | null;
}

export interface ForgeFacts {
  "reviewed-by": DerivedValue | null;
  "last-reviewed": DerivedValue | null;
}

export interface ForgeSourceResult {
  status: SourceStatus;
  /** By label. Empty when the source is unavailable. */
  records: Map<string, ForgeFacts>;
}

const NOTHING: ForgeFacts = { "reviewed-by": null, "last-reviewed": null };

/**
 * `reviewed-by` is every approver of the merged change, in approval order;
 * `last-reviewed` is the UTC date of the latest approval. A document with no
 * commit, no merged change, or a change nobody approved derives `null` for
 * both. One forge lookup per distinct sha, however many documents share it.
 *
 * An unavailable forge is reported and never called: `status.reason` names
 * the fix, and the caller decides whether that fails the run.
 */
export async function deriveFromForge(
  inputs: readonly ForgeSourceInput[],
  client: ForgeClient,
): Promise<ForgeSourceResult> {
  const records = new Map<string, ForgeFacts>();
  const status = await client.status();
  if (!status.available) return { status, records };

  const identity = await client.detect();
  const kind = identity?.kind ?? "github";
  const bySha = new Map<string, Promise<MergedChange | null>>();
  const changeFor = (sha: string): Promise<MergedChange | null> => {
    let pending = bySha.get(sha);
    if (pending === undefined) {
      pending = client.mergedChangeFor(sha);
      bySha.set(sha, pending);
    }
    return pending;
  };

  for (const input of inputs) {
    if (input.sha === null) {
      records.set(input.label, NOTHING);
      continue;
    }
    const change = await changeFor(input.sha);
    records.set(input.label, factsFrom(change, kind));
  }
  return { status, records };
}

function factsFrom(change: MergedChange | null, kind: ForgeIdentity["kind"]): ForgeFacts {
  if (change === null || change.approvals.length === 0) return NOTHING;
  // Sorted here too: a `ForgeClient` from outside this module makes no
  // ordering promise, and the field order is what the reader sees.
  const ordered = byTime(change.approvals);
  const latest = ordered.at(-1);
  if (latest === undefined) return NOTHING;
  const evidence = kind === "gitlab" ? `gitlab MR !${change.id}` : `github PR #${change.id}`;
  const dateEvidence =
    kind === "gitlab"
      ? `${evidence} (merge date; GitLab records no approval time)`
      : evidence;
  return {
    "reviewed-by": {
      value: ordered.map((a) => a.login),
      source: "forge",
      evidence,
    },
    "last-reviewed": {
      value: utcDate(latest.submittedAt),
      source: "forge",
      evidence: dateEvidence,
    },
  };
}

/** `YYYY-MM-DD` in UTC; the timestamp's own text when it does not parse. */
function utcDate(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  return new Date(ms).toISOString().slice(0, 10);
}
