/**
 * The session manifest: what the project's instruction artifacts said, and
 * which commit they said it at, **when the session started** (ADR 01024).
 *
 * ADR 01016 established that the availability roster — what the session was
 * offered — is recoverable from the transcript itself, retroactively and on any
 * machine. Two things are not: the artifact **bodies** and the **git SHA**. The
 * transcript injects skill instructions into the model's context without ever
 * recording their text, so "the SKILL.md says X now; did it say X then?" has no
 * answer inside the trace. ADR 01021 answers it with mtime, which is a
 * heuristic that a `git checkout` defeats wholesale.
 *
 * A manifest closes that gap by recording, at session start, a sha256 per
 * instruction artifact. `run` then compares — and a mismatch is exact where
 * mtime was a guess.
 *
 * **A manifest is a claim, not proof.** It is written by the capturing device
 * and travels with the repository, so it is evidence *about that device*. It
 * never reaches an eval outcome, never moves the exit code, and never turns a
 * `skipped` into a `pass`; the only thing it may quiet is the mtime warning,
 * whose own question it answers exactly.
 *
 * Types and constants only, with no dependency of its own beyond
 * `ArtifactType` — `artifacts/resolve.ts` consumes a manifest and
 * `capture/build.ts` produces one from `artifacts/discover.ts`, so anything
 * shared has to sit below both or the two would import each other.
 */
import type { ArtifactType } from "../artifacts/types.js";

/**
 * Manifest format version. Bumped when the *shape* changes incompatibly; a
 * manifest from a higher version is ignored rather than half-read, because a
 * partial read of an evidence file is worse than no evidence.
 */
export const MANIFEST_VERSION = 1;

/** Default directory, under the state directory the judge cache already uses. */
export const DEFAULT_CAPTURE_DIR = ".manni/tracevals/sessions";

export interface ManifestArtifact {
  /** Reference name, spelled as the coverage table spells it. */
  name: string;
  type: ArtifactType;
  /**
   * Path relative to `root`, with POSIX separators — never absolute, so the
   * manifest still joins after the repository is checked out somewhere else.
   */
  path: string;
  /** Lowercase hex sha256 of the file's bytes at capture time. */
  sha256: string;
  bytes: number;
}

/** What `git` could answer about the project at capture time. */
export interface ManifestGit {
  /** The commit the session ran against. */
  sha: string;
  branch?: string;
  /** Tracked files differed from the commit, so `sha` alone is incomplete. */
  dirty: boolean;
}

export interface SessionManifest {
  version: number;
  sessionId: string;
  /** When `capture` ran, ISO-8601. */
  capturedAt: string;
  /** The hook that supplied the payload, or `manual` for a direct run. */
  hookEvent: string;
  /** How the session started or why it ended, when the payload said so. */
  reason?: string;
  /** Where the session file will be written. A correlation key, never read. */
  transcriptPath?: string;
  /** Project root the artifact paths are relative to. */
  root: string;
  git?: ManifestGit;
  /**
   * Which machine captured this. An opaque digest rather than the hostname:
   * the question a reader has is "same machine or not", and that does not need
   * the name of the machine to answer.
   */
  device: { id: string; platform: string };
  tool: { name: string; version: string };
  artifacts: ManifestArtifact[];
  /** The resolved `tracevals:` section, redacted. Recorded, not consumed. */
  config: unknown;
}

export type ContentCheckStatus = "match" | "mismatch" | "skipped";

/**
 * Whether an artifact still says what the manifest recorded. Three-valued on
 * purpose: `skipped` is not a shade of `match`, and collapsing them would let
 * an absent manifest read as a clean bill of health.
 */
export interface ContentCheck {
  status: ContentCheckStatus;
  /** Why no comparison was possible. Present only on `skipped`. */
  reason?: string;
  /** The digest recorded at capture time. */
  expected?: string;
  /** The digest of the file as it is now. */
  actual?: string;
}

/** The manifest `run` consulted, summarised for the report. */
export interface ManifestReport {
  /** Where it was read from. */
  path: string;
  sessionId: string;
  capturedAt: string;
  /** The commit the session ran against, when git could answer. */
  gitSha?: string;
  /** Coverage rows the manifest could speak to, and what it said. */
  matched: number;
  changed: number;
  /** Rows it had nothing to say about; those keep the mtime heuristic. */
  unrecorded: number;
}
