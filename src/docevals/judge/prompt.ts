/**
 * Judge prompt construction. The system prompt sets a binary rubric with an
 * explicit `partial` escape valve; the user content carries the assertion,
 * evidence hint, pass/fail example anchors, and the page body with
 * frontmatter and MDX noise stripped.
 *
 * PROMPT_VERSION is part of every cache key — bump it whenever the prompt
 * changes so stale cached verdicts never survive a prompt revision.
 */
import type { ResolvedEval } from "../core/resolve.js";
import { partLabel } from "../core/split.js";

export const PROMPT_VERSION = 3;

export const JUDGE_SYSTEM_PROMPT = [
  "You are a meticulous technical documentation judge. You evaluate whether a",
  "documentation page satisfies a specific assertion.",
  "",
  "Rules:",
  "- Judge ONLY the stated assertion against the supplied page content. Do not",
  "  invent requirements the assertion does not state.",
  '- "match" is "pass" only when the assertion is fully satisfied by the page.',
  '- Use "partial" when the page partially satisfies the assertion.',
  '- Use "fail" when the page does not satisfy the assertion.',
  "- Quote the specific page text you relied on in \"observed\". If the page",
  "  lacks relevant content, say so explicitly.",
  "- Be conservative with confidence: reserve values above 0.9 for verdicts a",
  "  careful human reviewer would certainly agree with.",
  "Respond with a JSON object matching the provided schema.",
].join("\n");

/**
 * Strip MDX imports/exports and comments; keep JSX text content and markdown.
 * Fence-aware: lines inside ``` / ~~~ code blocks are page content the judge
 * must see verbatim (a code sample's `import` line is evidence, not MDX noise).
 */
export function cleanBody(body: string): string {
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of body.split("\n")) {
    const open = /^(\s*)(```+|~~~+)/.exec(line);
    if (fence) {
      out.push(line);
      if (open && open[2]!.startsWith(fence)) fence = null;
      continue;
    }
    if (open) {
      fence = open[2]!;
      out.push(line);
      continue;
    }
    out.push(
      line
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/^(import|export)\s.*$/, ""),
    );
  }
  // Comments spanning multiple lines are left in place — stray comment text
  // is harmless noise, whereas a post-join strip would reach into fences.
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function buildUserContent(
  ev: ResolvedEval,
  body: string,
  targetLabel = "body",
): string {
  const parts: string[] = [
    `# Assertion`,
    ev.assertion ?? "",
  ];
  if (ev.evidence) {
    parts.push("", `# Where to look`, ev.evidence);
  }
  if (ev.examples?.pass || ev.examples?.fail) {
    parts.push("", "# Anchors");
    // Anchors widened to lists with the docmeta vocabulary. Interpolating
    // the array would join it with commas and present several distinct
    // examples to the judge as one run-on sentence.
    for (const anchor of ev.examples.pass ?? []) {
      parts.push(`A passing page: ${anchor}`);
    }
    for (const anchor of ev.examples.fail ?? []) {
      parts.push(`A failing page: ${anchor}`);
    }
  }
  // Name what the judge is looking at. Told only "page content" while being
  // handed a frontmatter block or a companion file, a judge reasons about the
  // wrong thing and says so confidently.
  //
  // Only the page body carries MDX noise worth stripping. Running `cleanBody`
  // over a companion source file would delete its `import`/`export` lines —
  // the judge would then be asked whether code exports something it can no
  // longer see.
  const isBody = targetLabel === "body";
  parts.push(
    "",
    isBody ? "# Page content" : `# Page content (${targetLabel})`,
    "",
    isBody ? cleanBody(body) : body,
  );
  return parts.join("\n");
}

/**
 * Gathering evidence from one part of a page too long to judge in one call.
 *
 * Why a two-stage shape rather than judging each part and merging verdicts:
 * merging is unsound. "The page documents the --force flag" is satisfied if
 * *any* part documents it; "the page never promises unreleased features" is
 * violated if *any* part promises one. One needs OR across parts, the other
 * AND, and nothing in an assertion's text reliably says which — so a merge
 * rule has to guess, and guesses wrong quietly.
 *
 * Gathering evidence sidesteps the quantifier entirely. Each part contributes
 * what it saw; one judge then answers the original question against the whole
 * collection, exactly as it would have with the page in front of it. The
 * verdict contract is unchanged — still one `JudgeVerdict` per run — so
 * consensus, zones, the response cache, human review and `calibrate` need to
 * know nothing about any of this.
 */
export const EVIDENCE_SYSTEM_PROMPT = [
  "You are gathering evidence from one part of a documentation page so that a",
  "judge can later evaluate an assertion about the whole page.",
  "",
  "Rules:",
  "- Do NOT decide whether the assertion holds. You are seeing one part; the",
  "  part that settles it may be elsewhere.",
  "- Quote page text verbatim. Quote anything that supports the assertion and",
  "  anything that contradicts it.",
  "- Quote only what bears on this assertion. An empty list is the right",
  "  answer for a part that says nothing about it.",
  "Respond with a JSON object matching the provided schema.",
].join("\n");

export const EVIDENCE_SCHEMA = {
  type: "object",
  required: ["supports", "contradicts"],
  properties: {
    supports: { type: "array", items: { type: "string" } },
    contradicts: { type: "array", items: { type: "string" } },
  },
  additionalProperties: false,
} as const;

export interface PartEvidence {
  supports: string[];
  contradicts: string[];
}

export function buildEvidenceUser(
  ev: ResolvedEval,
  chunk: string,
  part: { index: number; total: number },
): string {
  return [
    "# Assertion (do not judge it — only gather evidence)",
    ev.assertion ?? "",
    ...(ev.evidence ? ["", "# Where to look", ev.evidence] : []),
    "",
    `# Page content (${partLabel(part.index, part.total)})`,
    "",
    chunk,
  ].join("\n");
}

/**
 * Render gathered evidence as the "page content" a judge sees.
 *
 * The judge is told plainly that it is reading extracts rather than the page,
 * because a judge that believes it saw everything will happily report that
 * something is absent when it was merely in a part that contributed nothing.
 */
export function renderEvidence(parts: PartEvidence[], total: number): string {
  const supports = parts.flatMap((p) => p.supports);
  const contradicts = parts.flatMap((p) => p.contradicts);
  const lines = [
    `The page was too long to read in one pass, so it was read in ${String(total)} parts`,
    "and the passages bearing on this assertion were collected below. Judge the",
    "assertion against this evidence. Absence of a quotation is weak evidence of",
    "absence in the page: parts that bore on nothing contributed nothing.",
    "",
    "## Passages supporting the assertion",
    ...(supports.length > 0 ? supports.map((q) => `- ${q}`) : ["(none)"]),
    "",
    "## Passages contradicting the assertion",
    ...(contradicts.length > 0 ? contradicts.map((q) => `- ${q}`) : ["(none)"]),
  ];
  return lines.join("\n");
}
