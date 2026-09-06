/**
 * `target` — which bytes a grader receives.
 *
 * Distinct from `evidence`, which only hints where to look *within* what is
 * graded. `evidence` is prose for the judge; `target` decides what the judge
 * (or a deterministic grader) is handed in the first place, which is why
 * deterministic graders honour it too and why it is named `target` rather than
 * `focus` — a regex grader has no focus.
 *
 * A target that cannot be served is an explicit failure, never a silent
 * substitution: grading the page body when the author asked for a companion
 * file would report a verdict about the wrong bytes, which is worse than no
 * verdict at all (ADR 01022).
 */
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import type { ResolvedPagePlan } from "./resolve.js";

/** The `body` | `raw` | `frontmatter` | companion-file selector. */
export type EvalTarget =
  | "body"
  | "raw"
  | "frontmatter"
  | { source: "file"; path: string };

export const DEFAULT_TARGET: EvalTarget = "body";

export type TargetResult =
  | { ok: true; text: string; label: string }
  | { ok: false; reason: string };

/** Human-readable name for a target, for messages and report lines. */
export function describeTarget(target: EvalTarget | undefined): string {
  const t = target ?? DEFAULT_TARGET;
  return typeof t === "string" ? t : `file ${t.path}`;
}

/**
 * Read what `target` selects for `plan`.
 *
 * A companion path is resolved against the page's own directory and must stay
 * inside it. An absolute path or one that climbs out is refused by name rather
 * than read: a page is content, and content naming an arbitrary path on the
 * machine that runs the eval is the same class of hazard as a frontmatter
 * command.
 */
export function readTarget(
  target: EvalTarget | undefined,
  plan: ResolvedPagePlan,
): TargetResult {
  const t = target ?? DEFAULT_TARGET;
  if (t === "body") return { ok: true, text: plan.page.body, label: "body" };
  if (t === "raw") return { ok: true, text: plan.page.content, label: "raw" };
  if (t === "frontmatter") {
    const data = plan.page.frontmatter.data as unknown;
    // An empty or absent frontmatter block yields "{}\n" from the YAML
    // stringifier, which reads as "there was nothing" rather than as a bug.
    return {
      ok: true,
      text: stringifyYaml(data ?? {}),
      label: "frontmatter",
    };
  }

  const pageDir = dirname(plan.page.absPath);
  if (isAbsolute(t.path)) {
    return {
      ok: false,
      reason: `target file "${t.path}" is an absolute path; name it relative to the page`,
    };
  }
  const abs = resolve(pageDir, t.path);
  const rel = relative(pageDir, abs);
  // The segment has to *end* at the dots. `startsWith("..")` alone rejects a
  // legitimate sibling whose name merely begins with them — `..notes.ts`,
  // `..rc` — which is a refusal the author cannot act on, since the file is
  // inside the root and named exactly what they wrote. `isAbsolute` covers the
  // Windows case where the target sits on another drive and `relative` cannot
  // express the step at all.
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    return {
      ok: false,
      reason: `target file "${t.path}" resolves outside the page's directory`,
    };
  }
  try {
    return { ok: true, text: readFileSync(abs, "utf8"), label: `file ${t.path}` };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? "unknown error";
    return { ok: false, reason: `target file "${t.path}" could not be read (${code})` };
  }
}
