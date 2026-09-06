/**
 * Native reading-level check: Flesch-Kincaid grade level of the page prose
 * must not exceed `max-grade`. Vendored (~60 lines) rather than a dependency;
 * English-only — documented limitation.
 */
import type { Finding } from "../../types.js";
import type { Grader } from "./../types.js";
import {
  firstError,
  knownKeys,
  optionalNumber,
  type OptionCheck,
  type Options,
} from "../options.js";

interface ReadingLevelOptions {
  "max-grade"?: number;
}

/** Strip markdown/MDX syntax down to approximate prose. */
export function extractProse(body: string): string {
  return (
    body
      // Fenced code blocks and inline code.
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/`[^`\n]*`/g, " ")
      // MDX/HTML comments, imports/exports, and tags.
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/^(import|export)\s.*$/gm, " ")
      .replace(/<[^>\n]+>/g, " ")
      // Images and links: keep link text.
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      // Headings markers, emphasis, list bullets, tables.
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/[*_~|>]/g, " ")
      .replace(/^\s*[-+]\s+/gm, "")
      .replace(/^\s*\d+\.\s+/gm, "")
  );
}

export function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length === 0) return 0;
  if (w.length <= 3) return 1;
  const stripped = w.replace(/(?:ed|es|e)$/, "");
  const groups = (stripped.length > 0 ? stripped : w).match(/[aeiouy]+/g);
  return Math.max(1, groups?.length ?? 1);
}

/** Flesch-Kincaid grade level for a prose string. Returns null when too short to score. */
export function fleschKincaidGrade(prose: string): number | null {
  const sentences = prose
    .split(/[.!?]+(?:\s|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const words = prose.match(/[A-Za-z][A-Za-z'-]*/g) ?? [];
  if (sentences.length < 3 || words.length < 30) return null;
  const syllables = words.reduce((n, w) => n + countSyllables(w), 0);
  return (
    0.39 * (words.length / sentences.length) +
    11.8 * (syllables / words.length) -
    15.59
  );
}

export const readingLevelGrader: Grader = {
  kind: "tool:reading-level",
  validateOptions(options: Options): OptionCheck {
    return firstError(
      knownKeys(options, ["max-grade"]),
      optionalNumber(options, "max-grade", { min: 1 }),
    );
  },
  mode: "per-file",
  async grade(ctx) {
    const findings: Finding[] = [];
    for (const { plan, eval: ev } of ctx.targets) {
      const maxGrade =
        (ev.options as ReadingLevelOptions)["max-grade"] ?? 10;
      const grade = fleschKincaidGrade(extractProse(plan.page.body));
      if (grade == null) continue; // Too little prose to score meaningfully.
      if (grade > maxGrade) {
        findings.push({
          evalName: ev.name,
          file: plan.page.file,
          ruleId: "reading-level/grade",
          message: `Flesch-Kincaid grade ${grade.toFixed(1)} exceeds max ${maxGrade}`,
          severity: ev.severity,
        });
      }
    }
    return findings;
  },
};
