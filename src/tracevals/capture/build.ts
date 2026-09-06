/**
 * Building a session manifest (ADR 01024) — the producing half.
 *
 * Separate from `capture/manifest.ts` because this side reaches for
 * `discoverArtifacts`, which imports `artifacts/resolve.ts`, which consumes a
 * manifest. Producing and consuming therefore cannot share a module.
 */
import { spawn } from "node:child_process";
import { hostname, platform, userInfo } from "node:os";
import { resolve } from "node:path";
import { discoverArtifacts } from "../artifacts/discover.js";
import { makeRedactor, type Redactor } from "../judge/redact.js";
import { hashFile, relPosix, sha256Hex } from "./manifest.js";
import {
  MANIFEST_VERSION,
  type ManifestArtifact,
  type ManifestGit,
  type SessionManifest,
} from "./types.js";

export interface BuildManifestOptions {
  sessionId: string;
  /** Project root to scan, and the base every artifact path is relative to. */
  root: string;
  hookEvent?: string;
  reason?: string;
  transcriptPath?: string;
  /** The resolved config section, recorded as provenance. */
  config?: unknown;
  /** `judge.redact` sources, applied to the manifest's free text (ADR 01020). */
  redact?: readonly string[];
  version?: string;
  /** Test seam: `false` skips shelling out to git. */
  git?: ManifestGit | false;
}

/**
 * Hash every instruction artifact the project holds, at the commit it holds
 * them at.
 *
 * The population is `discoverArtifacts`' — the same one `fill` authors against
 * — so capture and authoring never disagree about what an instruction artifact
 * is. That scope is **project-only** by its own design note, so a user-level or
 * plugin artifact is simply absent from the manifest, and its hash check at run
 * time degrades to the mtime heuristic rather than to a wrong answer.
 *
 * **Redaction covers the free text and never a join key.** `root`,
 * `transcriptPath`, `git.branch`, `reason` and the recorded `config` go through
 * the `judge.redact` redactor; `sessionId`, an artifact's `name` and `path`,
 * and every `sha256` do not. A redactor applied to a join key would turn an
 * exact check into a silent `skipped` — the one failure mode this whole feature
 * exists to remove — and those keys are the project's own vocabulary and its
 * repository-relative paths, not somewhere a credential lives. A secret in an
 * artifact path is a problem to fix in the path, the same call ADR 01020 makes
 * about a secret in a `SKILL.md`.
 */
export async function buildManifest(
  options: BuildManifestOptions,
): Promise<SessionManifest> {
  const root = resolve(options.root);
  const redact = makeRedactor(options.redact ?? []);

  const discovered = await discoverArtifacts({ root });
  const artifacts: ManifestArtifact[] = [];
  for (const found of discovered.artifacts) {
    const rel = relPosix(root, found.artifact.path);
    if (rel === null) continue;
    const digest = await hashFile(found.artifact.path);
    // An artifact that cannot be read is one the manifest says nothing about,
    // which degrades to the mtime heuristic at run time. Never a crash.
    if (digest === null) continue;
    artifacts.push({
      name: found.artifact.name,
      type: found.artifact.type,
      path: rel,
      sha256: digest,
      bytes: Buffer.byteLength(found.artifact.content, "utf-8"),
    });
  }
  // Stable order, so two captures of an unchanged tree produce the same bytes.
  artifacts.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const git =
    options.git === false ? undefined : (options.git ?? (await readGit(root)));

  return {
    version: MANIFEST_VERSION,
    sessionId: options.sessionId,
    capturedAt: new Date().toISOString(),
    hookEvent: options.hookEvent ?? "manual",
    ...(options.reason !== undefined ? { reason: redact(options.reason) } : {}),
    ...(options.transcriptPath !== undefined
      ? { transcriptPath: redact(options.transcriptPath) }
      : {}),
    root: redact(root),
    ...(git !== undefined
      ? {
          git: {
            sha: git.sha,
            ...(git.branch !== undefined ? { branch: redact(git.branch) } : {}),
            dirty: git.dirty,
          },
        }
      : {}),
    device: { id: deviceId(), platform: platform() },
    tool: { name: "manni-tracevals", version: options.version ?? "unknown" },
    artifacts,
    config: redactDeep(options.config ?? {}, redact),
  };
}

/**
 * A stable, opaque per-machine id. Not the hostname: "was this captured here?"
 * is the whole question, and answering it does not require shipping the name of
 * the machine into a file that travels with the repository.
 */
export function deviceId(): string {
  let user = "";
  try {
    user = userInfo().username;
  } catch {
    // A container with no passwd entry throws; the digest is still stable.
  }
  return sha256Hex(`${hostname()} ${user} ${platform()}`).slice(0, 16);
}

/**
 * Redact every string in a JSON-shaped value. Used for the recorded config
 * only — never for a join key.
 */
export function redactDeep(value: unknown, redact: Redactor): unknown {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, redact));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, member] of Object.entries(value)) {
      out[key] = redactDeep(member, redact);
    }
    return out;
  }
  return value;
}

/**
 * What `git` says about `root`, or nothing. Every failure mode — git absent,
 * not a repository, a timeout — degrades to an absent block, because a manifest
 * without a SHA is still a manifest with hashes in it.
 */
export async function readGit(root: string): Promise<ManifestGit | undefined> {
  const sha = await git(["rev-parse", "HEAD"], root);
  if (sha === null || !/^[0-9a-f]{40}$/.test(sha)) return undefined;
  const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"], root);
  const status = await git(
    ["status", "--porcelain", "--untracked-files=no"],
    root,
  );
  return {
    sha,
    // Detached HEAD reports the literal "HEAD", which is not a branch name.
    ...(branch !== null && branch !== "HEAD" ? { branch } : {}),
    dirty: status !== null && status.length > 0,
  };
}

/** One `git` invocation, argv-only and bounded — the shape ADR 01011 uses. */
function git(
  args: string[],
  cwd: string,
  timeoutMs = 5000,
): Promise<string | null> {
  return new Promise((settle) => {
    let done = false;
    let child;
    try {
      // shell:false — nothing here is ever parsed as shell syntax.
      child = spawn("git", args, { cwd, shell: false, windowsHide: true });
    } catch {
      settle(null);
      return;
    }
    // `finish` is declared below the timer because it clears it; the timer
    // callback only runs after both exist.
    const timer = setTimeout(() => {
      child.kill();
      finish(null);
    }, timeoutMs);
    const finish = (value: string | null): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      settle(value);
    };
    let out = "";
    child.stdout?.on("data", (d: Buffer) => {
      out += d.toString("utf-8");
    });
    child.stderr?.resume();
    child.on("error", () => { finish(null); });
    child.on("close", (code) => { finish(code === 0 ? out.trim() : null); });
  });
}
