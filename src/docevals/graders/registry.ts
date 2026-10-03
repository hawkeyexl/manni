/**
 * Grader registry: maps grader kinds to implementations. Same pattern as
 * the metadata tool's schema registry — a static map, one entry per built-in.
 *
 * Only the deterministic graders have an implementation here. `ai` is graded
 * by the judge stage and `human` by review, so `graderFor` answers
 * `undefined` for both. They are registered kinds all the same:
 * `listGraderKinds` names them, and an eval may name either.
 */
import type { Grader } from "./types.js";
import { commandGrader } from "./command.js";
import { regexGrader } from "./native/regex.js";

const GRADERS = new Map<string, Grader>(
  [commandGrader, regexGrader].map((g) => [g.kind, g]),
);

/** Kinds graded outside this map: `ai` by the judge, `human` by review. */
const UNMAPPED_KINDS: readonly string[] = ["ai", "human"];

/** The built-in kinds, in the order a message lists them. */
const BUILT_IN_ORDER: readonly string[] = ["ai", "command", "human", "tool:regex"];

export function graderFor(kind: string): Grader | undefined {
  return GRADERS.get(kind);
}

/** Every registered kind: the built-ins first, then any registered later. */
export function listGraderKinds(): string[] {
  return [...new Set<string>([...BUILT_IN_ORDER, ...GRADERS.keys()])];
}

/** Whether an eval naming `kind` has anything to grade it. */
export function isRegisteredGrader(kind: string): boolean {
  return UNMAPPED_KINDS.includes(kind) || GRADERS.has(kind);
}

/** Register an additional grader (used by later phases and tests). */
export function registerGrader(grader: Grader): void {
  GRADERS.set(grader.kind, grader);
}
