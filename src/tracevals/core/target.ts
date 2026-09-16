/**
 * `target` — which bytes a grader receives.
 *
 * Distinct from `evidence`, which only hints where to look *within* what is
 * graded, and distinct again from the narrowing options individual graders
 * carry. `regex`'s `on: assistant | user | all` picks a **speaker** inside the
 * transcript; `tool-usage`'s `includeSidechains` picks a **scope**. `target`
 * picks the **subject**: the session, its final answer, the files it wrote, or
 * the instruction artifact itself. The three axes compose rather than replace
 * one another.
 *
 * A target that cannot be served is an explicit failure, never a silent
 * substitution: grading the transcript when the author asked for a written
 * file would report a verdict about the wrong bytes, which is worse than no
 * verdict at all.
 */
import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { Trace } from "../trace/types.js";

/** The subject a grader is pointed at. */
export type TraceTarget =
  | "transcript"
  | "last-message"
  | "files"
  | "artifact"
  | { source: "file"; path: string };

export const DEFAULT_TARGET: TraceTarget = "transcript";

export type TargetResult =
  | { ok: true; text: string; label: string }
  | { ok: false; reason: string };

/** Human-readable name for a target, for messages and report lines. */
export function describeTarget(target: TraceTarget | undefined): string {
  const t = target ?? DEFAULT_TARGET;
  return typeof t === "string" ? t : `file ${t.path}`;
}

export interface TargetContext {
  trace: Trace;
  /** The transcript as the judge would otherwise have seen it. */
  renderedTrace: string;
  /** The instruction artifact this eval came from. */
  artifactContent: string;
  /**
   * Root a relative `{source: file}` target resolves against — the run's
   * project root when one was pinned, else the session's own cwd.
   */
  root: string;
}

/** Read what `target` selects for this session. */
export function readTarget(
  target: TraceTarget | undefined,
  ctx: TargetContext,
): TargetResult {
  const t = target ?? DEFAULT_TARGET;
  if (t === "transcript") {
    return { ok: true, text: ctx.renderedTrace, label: "transcript" };
  }
  if (t === "last-message") {
    const last = ctx.trace.assistantTexts.at(-1);
    // An empty final message is a fact about the session, not a failure to
    // read it — a run that ended on a tool call genuinely has no final text.
    return { ok: true, text: last ?? "", label: "last-message" };
  }
  if (t === "files") {
    // Paths only, never contents: "which files did it touch" is a different
    // question from "what is in them", and the second is what a
    // `{source: file}` target is for.
    const paths = [...new Set(ctx.trace.fileAccesses.map((f) => f.path))];
    return { ok: true, text: paths.join("\n"), label: "files" };
  }
  if (t === "artifact") {
    return { ok: true, text: ctx.artifactContent, label: "artifact" };
  }

  if (isAbsolute(t.path)) {
    return {
      ok: false,
      reason: `target file "${t.path}" is an absolute path; name it relative to the project root`,
    };
  }
  const abs = resolve(ctx.root, t.path);
  // `startsWith("..")` alone rejects a legitimate file whose name merely
  // begins with two dots — `..rc`, `..config/x` — so the segment has to end
  // there. `isAbsolute` catches the Windows case where the target is on
  // another drive and `relative` cannot express the step at all.
  const rel = relative(ctx.root, abs);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    return {
      ok: false,
      reason: `target file "${t.path}" resolves outside the project root`,
    };
  }
  try {
    return { ok: true, text: readFileSync(abs, "utf8"), label: `file ${t.path}` };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? "unknown error";
    return { ok: false, reason: `target file "${t.path}" could not be read (${code})` };
  }
}
