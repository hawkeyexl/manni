/**
 * Native differentiation check (the book's ch10 example): related pages —
 * e.g. per-endpoint or per-action reference docs — must be sufficiently
 * distinct from each other. Similarity is cosine similarity over word
 * frequencies of the cleaned page prose; pages above `maxSimilarity` against
 * any sibling in scope fail. Runs once per eval-configuration group so evals
 * with different scopes/thresholds compare independently.
 */
import picomatch from "picomatch";
import type { Finding } from "../../types.js";
import { groupTargetsByEval, type Grader, type GraderTarget } from "../types.js";
import { extractProse } from "./reading-level.js";
import {
  firstError,
  knownKeys,
  optionalNumber,
  optionalString,
  type OptionCheck,
  type Options,
} from "../options.js";

interface DifferentiationOptions {
  scope?: string;
  "max-similarity"?: number;
}

export function wordFrequencies(text: string): Map<string, number> {
  const freq = new Map<string, number>();
  for (const word of text.toLowerCase().match(/[a-z][a-z'-]*/g) ?? []) {
    freq.set(word, (freq.get(word) ?? 0) + 1);
  }
  return freq;
}

function magnitude(freq: Map<string, number>): number {
  let sum = 0;
  for (const count of freq.values()) sum += count * count;
  return Math.sqrt(sum);
}

export function cosineSimilarity(
  a: Map<string, number>,
  b: Map<string, number>,
  normA = magnitude(a),
  normB = magnitude(b),
): number {
  if (a.size === 0 || b.size === 0) return 0;
  let dot = 0;
  for (const [word, count] of a) {
    const other = b.get(word);
    if (other) dot += count * other;
  }
  return dot / (normA * normB);
}

function gradeGroup(targets: GraderTarget[]): Finding[] {
  const findings: Finding[] = [];
  const first = targets[0]!;
  const opts = first.eval.options as DifferentiationOptions;
  const maxSimilarity = opts["max-similarity"] ?? 0.85;
  const inScope = opts.scope ? picomatch(opts.scope) : () => true;

  const scoped = targets.filter((t) => inScope(t.plan.page.file));
  if (scoped.length < 2) return [];

  // Frequencies and norms computed once per page, not per pair.
  const vectors = scoped.map((t) => {
    const freq = wordFrequencies(extractProse(t.plan.page.body));
    return { target: t, freq, norm: magnitude(freq) };
  });

  for (let i = 0; i < vectors.length; i++) {
    let worst = { similarity: 0, other: "" };
    for (let j = 0; j < vectors.length; j++) {
      if (i === j) continue;
      const similarity = cosineSimilarity(
        vectors[i]!.freq,
        vectors[j]!.freq,
        vectors[i]!.norm,
        vectors[j]!.norm,
      );
      if (similarity > worst.similarity) {
        worst = { similarity, other: vectors[j]!.target.plan.page.file };
      }
    }
    if (worst.similarity > maxSimilarity) {
      const { target } = vectors[i]!;
      findings.push({
        evalName: target.eval.name,
        file: target.plan.page.file,
        ruleId: "differentiation/similar",
        message: `Content is ${(worst.similarity * 100).toFixed(0)}% similar to ${worst.other} (max ${(maxSimilarity * 100).toFixed(0)}%) — describe what makes this page's subject unique`,
        severity: target.eval.severity,
      });
    }
  }
  return findings;
}

export const differentiationGrader: Grader = {
  kind: "tool:differentiation",
  validateOptions(options: Options): OptionCheck {
    return firstError(
      knownKeys(options, ["scope", "max-similarity"]),
      optionalString(options, "scope"),
      optionalNumber(options, "max-similarity", { min: 0, max: 1 }),
    );
  },
  mode: "corpus",
  async grade(ctx) {
    const findings: Finding[] = [];
    for (const group of groupTargetsByEval(ctx.targets)) {
      findings.push(...gradeGroup(group));
    }
    return findings;
  },
};
