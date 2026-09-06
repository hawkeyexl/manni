/**
 * Reading, locating, and comparing session manifests (ADR 01024).
 *
 * The consuming half. Deliberately free of any dependency on
 * `artifacts/discover.ts`: `artifacts/resolve.ts` imports this module, and
 * discovery imports resolution, so producing and consuming a manifest have to
 * live in separate files or the two would form a cycle. Building one is
 * `capture/build.ts`.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import {
  MANIFEST_VERSION,
  type ContentCheck,
  type SessionManifest,
} from "./types.js";

export function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/** sha256 of a file's bytes, or null when it cannot be read. */
export async function hashFile(path: string): Promise<string | null> {
  try {
    // The bytes, not the decoded string: the digest has to mean "this file",
    // and a decode-then-re-encode would quietly normalize a BOM.
    return sha256Hex(await readFile(path));
  } catch {
    return null;
  }
}

/** `path` relative to `root`, POSIX-separated, or null when it escapes. */
export function relPosix(root: string, path: string): string | null {
  const rel = relative(resolve(root), resolve(path));
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return null;
  return rel.split(sep).join("/");
}

/**
 * A session id is a filename here, so it may not carry path syntax. Claude Code
 * writes UUIDs; a hand-passed `--session-id` is the case this guards, and a
 * `../` in one would write the manifest outside the directory it was aimed at.
 */
export function safeSessionId(sessionId: string): string {
  const cleaned = sessionId.replace(/[^A-Za-z0-9._-]/g, "-").replace(/^\.+/, "");
  return cleaned.length > 0 ? cleaned.slice(0, 128) : "session";
}

export function manifestPathFor(dir: string, sessionId: string): string {
  return join(dir, `${safeSessionId(sessionId)}.json`);
}

/** The `<trace>.manifest.json` sibling — a manifest placed beside its trace. */
export function siblingManifestPath(tracePath: string): string {
  const ext = extname(tracePath);
  const stem = ext === "" ? tracePath : tracePath.slice(0, -ext.length);
  return `${stem}.manifest.json`;
}

// ── Persisting ───────────────────────────────────────────────────

export async function writeManifest(
  path: string,
  manifest: SessionManifest,
): Promise<void> {
  await mkdir(dirname(resolve(path)), { recursive: true });
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
}

/**
 * Every member `run` actually consumes, checked one by one.
 *
 * A partial read is the dangerous failure here, not a loud one. An artifact
 * entry with no `path` puts `undefined` in the comparison map's key, and one
 * whose `sha256` is not a string puts a value no real digest can equal — so a
 * half-read manifest reports **`mismatch`**, "this artifact changed since the
 * session", which is the most alarming thing this feature can say and would be
 * said off nothing but the file's own corruption. A manifest is optional
 * evidence, so anything malformed has to read as *no* evidence.
 */
function isManifestArtifact(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.path === "string" &&
    entry.path.length > 0 &&
    typeof entry.sha256 === "string" &&
    entry.sha256.length > 0 &&
    typeof entry.name === "string" &&
    typeof entry.type === "string" &&
    typeof entry.bytes === "number"
  );
}

/**
 * Read one manifest, or null. Absent, unreadable, unparseable, the wrong shape,
 * or written by a newer format version all produce null: consuming a manifest
 * is optional evidence-gathering, so every failure has to degrade to "no
 * evidence" rather than to a crash or, worse, to a partial read (ADR 01003).
 */
export async function readManifest(
  path: string,
): Promise<SessionManifest | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record.version !== "number" || record.version > MANIFEST_VERSION) {
    return null;
  }
  if (typeof record.sessionId !== "string") return null;
  // `capturedAt` is printed in the report and `root` is a base the join is
  // keyed on; both are consumed, so neither may be half-there.
  if (typeof record.capturedAt !== "string") return null;
  if (typeof record.root !== "string") return null;
  if (!Array.isArray(record.artifacts)) return null;
  if (!record.artifacts.every(isManifestArtifact)) return null;
  return parsed as SessionManifest;
}

export interface FindManifestOptions {
  tracePath: string;
  /** The trace's own session id, when it recorded one. */
  sessionId?: string;
  /** Project root; the canonical manifest lives under it. */
  projectDir: string;
  /** Directory manifests are written to, relative to the project root. */
  captureDir: string;
  /** An explicitly named manifest, which is used without searching. */
  explicit?: string;
  /**
   * Called for each candidate that was readable but refused, with why. A
   * refusal that leaves no trace is indistinguishable from never having
   * captured anything, which is the wrong thing for a reader to conclude.
   */
  onRefused?: (path: string, reason: string) => void;
}

export interface FoundManifest {
  path: string;
  manifest: SessionManifest;
}

/**
 * Find the manifest for a trace, most-specific location first.
 *
 * 1. `<trace>.manifest.json` — someone put it there deliberately, which is a
 *    stronger statement of intent than any convention.
 * 2. `<trace dir>/<captureDir>/<session-id>.json` — a trace copied out of the
 *    session store together with the state directory.
 * 3. `<projectDir>/<captureDir>/<session-id>.json` — where `capture` writes.
 *
 * **A manifest that cannot be shown to belong to this trace is refused**, not
 * used. It is evidence about some other session, and letting it stand in here
 * would be the one way a manifest could produce a confidently wrong answer.
 *
 * Two ways that can happen, and the trace's own id decides which:
 *
 * - The ids **disagree** — refused outright, however the manifest was reached.
 * - The trace records **no id at all**. A Claude Code session file whose
 *   records predate `sessionId`, or a `claude -p` stream-json transcript
 *   captured without its `system`/`init` record, both parse fine and both
 *   arrive here with nothing to check against. A manifest found *by
 *   convention* beside such a trace is refused, because convention is not
 *   provenance and the file could describe any session on the machine.
 *
 * An **explicitly named** `--manifest` is the exception to that second case,
 * and only that one. Naming a file is the caller's own assertion that it
 * belongs to this trace — the assertion the ADR already treats as
 * load-bearing when it makes an unusable named manifest an error rather than a
 * shrug — and it is the only assertion available for a trace format that
 * records no id. Refusing it would leave `--manifest` structurally unusable
 * there while buying no safety a discovered manifest does not already get.
 */
export async function findManifest(
  options: FindManifestOptions,
): Promise<FoundManifest | null> {
  const explicit = options.explicit !== undefined;
  const candidates: string[] = [];
  if (options.explicit !== undefined) {
    candidates.push(options.explicit);
  } else {
    candidates.push(siblingManifestPath(options.tracePath));
    if (options.sessionId !== undefined) {
      candidates.push(
        manifestPathFor(
          resolve(dirname(options.tracePath), options.captureDir),
          options.sessionId,
        ),
        manifestPathFor(
          resolve(options.projectDir, options.captureDir),
          options.sessionId,
        ),
      );
    }
  }

  for (const path of candidates) {
    const manifest = await readManifest(path);
    if (manifest === null) continue;
    const refusal = refuse(manifest, options.sessionId, explicit);
    if (refusal !== null) {
      options.onRefused?.(path, refusal);
      continue;
    }
    return { path, manifest };
  }
  return null;
}

/** Why this manifest cannot be trusted for this trace, or null if it can. */
function refuse(
  manifest: SessionManifest,
  sessionId: string | undefined,
  explicit: boolean,
): string | null {
  if (sessionId === undefined) {
    if (explicit) return null;
    return (
      `the trace records no session id, so a manifest found by convention ` +
      `cannot be verified as belonging to it (it records "${manifest.sessionId}"). ` +
      `Pass --manifest to use it anyway.`
    );
  }
  if (manifest.sessionId !== sessionId) {
    return `it was recorded for a different session ("${manifest.sessionId}", not "${sessionId}")`;
  }
  return null;
}

// ── Comparing ────────────────────────────────────────────────────

/**
 * Compare the files one coverage row covers against what the manifest recorded.
 *
 * `actual` maps each covered file's project-relative POSIX path to its current
 * sha256. A row usually covers one file; project rules aggregate several, which
 * is why the outcome is decided over a set:
 *
 * - **any** recorded file whose digest differs → `mismatch`. One changed file
 *   makes the row's instructions different, whatever the others say.
 * - **every** covered file recorded and equal → `match`.
 * - otherwise → `skipped`, naming what the manifest could not speak to. A
 *   partial answer is not a clean one.
 */
export function checkContent(
  manifest: SessionManifest,
  actual: ReadonlyMap<string, string>,
): ContentCheck {
  const recorded = new Map(manifest.artifacts.map((a) => [a.path, a.sha256]));
  const missing: string[] = [];
  let matched = 0;
  /**
   * The first agreeing pair, captured where both halves are in hand. `expected`
   * means "what the manifest claimed" in every branch, so it has to be read off
   * the manifest in every branch — going back to `actual` afterwards would
   * report the file twice, and on a match the two are equal, so nothing would
   * ever catch it.
   */
  let agreed: { expected: string; actual: string } | undefined;

  for (const [path, digest] of actual) {
    const expected = recorded.get(path);
    if (expected === undefined) {
      missing.push(path);
      continue;
    }
    if (expected !== digest) {
      return { status: "mismatch", expected, actual: digest };
    }
    agreed ??= { expected, actual: digest };
    matched += 1;
  }

  if (matched === 0) {
    return {
      status: "skipped",
      reason:
        actual.size === 0
          ? "no file to compare"
          : "not recorded in the session manifest",
    };
  }
  if (missing.length > 0) {
    return {
      status: "skipped",
      reason: `not recorded in the session manifest: ${missing.join(", ")}`,
    };
  }
  // Digests only for a row covering one file: an aggregated project-rules row
  // has no single pair to report, and picking one of several would be a claim
  // about the row that is not true of it.
  return {
    status: "match",
    ...(actual.size === 1 && agreed !== undefined ? agreed : {}),
  };
}

export * from "./types.js";
