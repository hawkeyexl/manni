/**
 * Grader registry: maps grader kinds to implementations. Same pattern as
 * docmeta's schema registry — a static map, one entry per built-in.
 */
import type { Grader } from "./types.js";
import { commandGrader } from "./command.js";
import { markdownlintGrader } from "./tools/markdownlint.js";
import { remarkGrader } from "./tools/remark.js";
import { docmetaGrader } from "./tools/docmeta.js";
import { valeGrader } from "./tools/vale.js";
import { docStructureLintGrader } from "./tools/doc-structure-lint.js";
import { docDetectiveGrader } from "./tools/doc-detective.js";
import { freshnessGrader } from "./native/freshness.js";
import { readingLevelGrader } from "./native/reading-level.js";
import { differentiationGrader } from "./native/differentiation.js";
import { regexGrader } from "./native/regex.js";
import { fileExistsGrader } from "./native/file-exists.js";

const GRADERS = new Map<string, Grader>(
  [
    commandGrader,
    markdownlintGrader,
    remarkGrader,
    docmetaGrader,
    valeGrader,
    docStructureLintGrader,
    docDetectiveGrader,
    freshnessGrader,
    readingLevelGrader,
    differentiationGrader,
    regexGrader,
    fileExistsGrader,
  ].map((g) => [g.kind, g]),
);

export function graderFor(kind: string): Grader | undefined {
  return GRADERS.get(kind);
}

export function listGraderKinds(): string[] {
  return [...GRADERS.keys()];
}

/** Register an additional grader (used by later phases and tests). */
export function registerGrader(grader: Grader): void {
  GRADERS.set(grader.kind, grader);
}
