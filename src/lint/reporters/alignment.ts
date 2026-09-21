/**
 * The alignment block `--explain` prints under each routed file: which rule
 * claimed which section, and why. It is lint's answer to "why did it say
 * that" for the matcher in `core/match.ts` - proposal 0054's stress test 3
 * names this as the cost of an alignment matcher over a left-to-right one: a
 * tie is invisible unless something prints the pairing it chose.
 *
 * This module recomputes the alignment itself by calling the matcher's own,
 * already-exported `matchSections` - it does not reach into `align()`'s
 * internal step sequence, which is module-private. That has one visible
 * consequence: this file has no way to know the *document position* a missing
 * rule or an unexpected section falls at relative to the other, so a missing
 * rule is placed among the sections that did match using rule order alone
 * (`insertMissing` below), which is exact whenever - as in every template this
 * repository ships - the missing rule is not sandwiched between two unexpected
 * sections with nothing matched between them. `core/match.ts` is read-only
 * from here; exporting the step sequence, if this ever needs to be exact, is a
 * change to that file rather than to this one.
 *
 * The other thing this module cannot get from an export: which key in a
 * page's frontmatter is its title. It assumes `title`, the same key
 * `manni meta`'s own schemas require, and re-reads `tree.frontmatter`
 * directly rather than asking a caller to resolve it, so the assumption lives
 * in exactly one place.
 *
 * **The seam this depends on.** `commands/lint.ts` parses every file and
 * loads its template before `--explain` returns - both already exist at that
 * point in `lintOne` - but neither is currently attached to the
 * `LintFileResult` it returns. `render()` (`reporters/index.ts`) reads them
 * off a result through `ExplainSource`, structurally: a result carrying
 * `tree` and `template` gets an alignment block, and one that does not is
 * printed exactly as before. Wiring `commands/lint.ts` to attach them is
 * outside this chunk's files (`src/lint/commands/lint.ts` is not among them).
 */
import type { DocumentTree, SectionNode } from "../types.js";
import { matchSections, type Match } from "../core/match.js";
import { occurrenceRange, type Rule, type Template } from "../core/template.js";

/** What a caller must attach to a `LintFileResult` for the block to render. */
export interface ExplainSource {
  tree: DocumentTree;
  template: Template;
}

/** One line of the block, before indentation is joined on. */
export interface AlignmentRow {
  depth: number;
  text: string;
}

const LABEL_WIDTH = 22;
const ARROW = "←"; // ←
const ELLIPSIS = "…"; // …
const TIMES = "×"; // ×

function pad(label: string): string {
  return label.length >= LABEL_WIDTH ? `${label} ` : label.padEnd(LABEL_WIDTH + 1);
}

/** A section's title, quoted, or `(no heading)` for one that has none. */
function titleText(title: string | null): string {
  return title === null ? "(no heading)" : `"${title}"`;
}

/**
 * A rule's display name: its `id` where it has one, else a literal string
 * `heading`, else `(any)` for anything else - an array, a `{ pattern }`,
 * `heading: false`, or a bare wildcard. Mirrors the priority `--explain`'s
 * spec states, which is not the same order `missingMessage` in `match.ts`
 * uses for its prose: that picks the heading first because it is read as a
 * sentence, and this picks the id first because it is a column header.
 */
function ruleLabel(rule: Rule): string {
  if (rule.id !== undefined) return rule.id;
  if (typeof rule.heading === "string") return rule.heading;
  return "(any)";
}

/**
 * The page's own heading, and the note explaining where it came from.
 *
 * Mirrors `validator.ts`'s private `pageSection`: a lone top-level heading
 * *is* the page. Most of the time that heading is not literal, though - every
 * parser with both frontmatter and headings (`parsers/metadata.ts`'s
 * `withMetadataTitle`) already synthesizes an H1 from `frontmatter.title` when
 * the body has none, positioned on the frontmatter block itself, precisely so
 * a template written against "the page's title is its outermost rule" does
 * not have to know the difference. By the time a tree reaches here that
 * difference is gone from the section's own fields - so it is recovered the
 * same way `titlePosition` was set: a synthesized heading's position is
 * `tree.frontmatterPosition`, verbatim.
 *
 * `frontmatter.title` is read directly only as a fallback, for a tree a
 * caller built by some other means - the programmatic API accepts one from
 * anywhere - where no such synthesis ran at all.
 */
function pageHeading(tree: DocumentTree): { text: string | null; note: string | null } {
  const [only] = tree.sections;
  if (tree.sections.length === 1 && only && only.level <= 1) {
    const text = only.title || null;
    if (text === null) return { text: null, note: "no heading" };
    const synthesized =
      only.titlePosition !== null &&
      tree.frontmatterPosition !== null &&
      only.titlePosition.start.offset === tree.frontmatterPosition.start.offset &&
      only.titlePosition.end.offset === tree.frontmatterPosition.end.offset;
    return { text, note: synthesized ? "synthesized from frontmatter" : null };
  }
  const raw = tree.frontmatter?.["title"];
  const text = typeof raw === "string" && raw !== "" ? raw : null;
  return { text, note: text === null ? "no heading" : "synthesized from frontmatter" };
}

/** The sections a template's `sections:` rules describe - `pageSection`'s subject. */
function pageSections(tree: DocumentTree): SectionNode[] {
  const [only] = tree.sections;
  if (tree.sections.length === 1 && only && only.level <= 1) return only.sections;
  return tree.sections;
}

/**
 * One matched or collapsed run of matches, rendered as a single row.
 *
 * Both call sites build `run` by pushing one already-known `Match` before
 * ever calling this, so it is never empty; the guard below exists to let the
 * checker see that rather than to handle a real empty-run case.
 */
function matchedRow(depth: number, run: Match[]): AlignmentRow {
  const head = run[0];
  if (!head) return { depth, text: `${pad("(empty run)")}${ARROW} (missing)` };
  const rule = head.rule;
  const first = head.section;
  const last = (run[run.length - 1] ?? head).section;
  const label = run.length === 1 ? ruleLabel(rule) : `${ruleLabel(rule)} ${TIMES}${run.length}`;
  // Coercion can only ever land on a run of length 1: `ALIGNMENT_COSTS.coerce`
  // is open only to a required occurrence whose `max` is 1 (`match.ts`'s
  // header explains why), and a rule with `max: 1` can never contribute a
  // second match to a run.
  const coerced = run.length === 1 && head.coerced ? " (coerced)" : "";
  const arrow =
    run.length === 1
      ? `${titleText(first.title || null)}${coerced}`
      : `${titleText(first.title || null)} ${ELLIPSIS} ${titleText(last.title || null)}`;
  return { depth, text: `${pad(label)}${ARROW} ${arrow}` };
}

/**
 * What an absent rule is called.
 *
 * `(missing)` means exactly what produces a `missing_section` finding, so it
 * is reserved for a rule that had to appear. An optional rule that took
 * nothing is `(none)`: absent, and fine. Sharing one word made a page that
 * lints clean print a row saying something was missing from it, which is the
 * opposite of what `--explain` is for.
 */
function absentLabel(rule: Rule): string {
  return occurrenceRange(rule).min > 0 ? "(missing)" : "(none)";
}

/** A rule with nothing to show, or a `repeat` group with nothing at all. */
function missingRows(depth: number, rule: Rule): AlignmentRow[] {
  if (!rule.repeat) {
    return [{ depth, text: `${pad(ruleLabel(rule))}${ARROW} ${absentLabel(rule)}` }];
  }
  // A group's members inherit the group's own occurrence: a member of an
  // optional group is not missing when the whole group never ran.
  const label = absentLabel(rule);
  const rows: AlignmentRow[] = [{ depth, text: pad(rule.id ?? "(repeat)").trimEnd() }];
  for (const member of rule.repeat) {
    rows.push({ depth: depth + 1, text: `${pad(ruleLabel(member))}${ARROW} ${label}` });
  }
  return rows;
}

/**
 * Insert `missing`, each tagged with the index of the rule it is about, among
 * `matched` entries tagged the same way (`null` for one that has no rule -
 * an unexpected section). A missing rule never displaces an unexpected
 * section: only a matched entry's index gates it, so an unexpected section is
 * carried along in whichever position document order already put it in.
 */
function insertMissing(
  matched: { index: number | null; rows: AlignmentRow[] }[],
  missing: { index: number; rows: AlignmentRow[] }[],
): AlignmentRow[] {
  const out: AlignmentRow[] = [];
  let mi = 0;
  for (const entry of matched) {
    while (mi < missing.length) {
      // `mi < missing.length` just guarded this, so `next` is always here;
      // the check only lets the type checker see the invariant the loop
      // bound already established.
      const next = missing[mi];
      if (!next || (entry.index !== null && next.index >= entry.index)) break;
      out.push(...next.rows);
      mi++;
    }
    out.push(...entry.rows);
  }
  while (mi < missing.length) {
    const next = missing[mi];
    if (!next) break;
    out.push(...next.rows);
    mi++;
  }
  return out;
}

/**
 * One level: `rules` against `sections`, and every matched pair's own
 * subsections.
 *
 * A `repeat` member's `Match.rule` is the member itself, never the group
 * (`match.ts`'s `compile` only ever assigns an occurrence to a leaf rule), so
 * a group is never a key in `matches`. `rootOf` recovers "which top-level
 * rule is this a member of" - itself, for a rule with no group - which is
 * what lets a group be judged matched or missing as one thing while still
 * naming which of its members carried the section.
 */
function alignLevel(
  rules: Rule[] | undefined,
  sections: SectionNode[],
  parent: SectionNode | null,
  depth: number,
): AlignmentRow[] {
  // `undefined` is the template saying nothing about this level - silence,
  // not "no sections allowed" - so there is nothing to align and nothing to
  // print. `matchSections` draws the same line; this mirrors it rather than
  // passing `[]` through, which would turn silence into every section here
  // reading as unexpected.
  if (rules === undefined) return [];

  const { matches } = matchSections(sections, rules, { parent });
  const ruleIndex = new Map<Rule, number>(rules.map((r, i) => [r, i]));
  const rootOf = new Map<Rule, Rule>();
  for (const rule of rules) {
    if (rule.repeat) for (const member of rule.repeat) rootOf.set(member, rule);
    else rootOf.set(rule, rule);
  }
  const rootOfRule = (rule: Rule): Rule => rootOf.get(rule) ?? rule;
  const matchedRoots = new Set(matches.map((m) => rootOfRule(m.rule)));
  const bySection = new Map<SectionNode, Match>(matches.map((m) => [m.section, m]));

  const matched: { index: number | null; rows: AlignmentRow[] }[] = [];
  let i = 0;
  while (i < sections.length) {
    // `i < sections.length` just guarded this; `section` always exists.
    const section = sections[i];
    if (!section) break;
    const match = bySection.get(section);
    if (!match) {
      matched.push({
        index: null,
        rows: [{ depth, text: `(unexpected) ${titleText(section.title || null)}` }],
      });
      i++;
      continue;
    }

    const root = rootOfRule(match.rule);
    if (root.repeat) {
      // Every section, in this run, that belongs to this same group - by
      // whichever member took it, not necessarily the same one twice.
      const taken: Match[] = [];
      while (i < sections.length) {
        const here = sections[i];
        if (!here) break;
        const next = bySection.get(here);
        if (!next || rootOfRule(next.rule) !== root) break;
        taken.push(next);
        i++;
      }
      const rows: AlignmentRow[] = [{ depth, text: pad(root.id ?? "(repeat)").trimEnd() }];
      let run: Match[] = [];
      const flushMember = (): void => {
        if (run.length === 0) return;
        rows.push(matchedRow(depth + 1, run));
        for (const m of run) {
          rows.push(...alignLevel(m.rule.sections, m.section.sections, m.section, depth + 2));
        }
        run = [];
      };
      for (const m of taken) {
        const first = run[0];
        if (first && first.rule !== m.rule) flushMember();
        run.push(m);
      }
      flushMember();
      // A member this occurrence never reached prints missing beside the
      // members it did, the same information `missingRows` gives a group with
      // nothing at all.
      const takenMembers = new Set(taken.map((m) => m.rule));
      for (const member of root.repeat) {
        if (takenMembers.has(member)) continue;
        rows.push({ depth: depth + 1, text: `${pad(ruleLabel(member))}${ARROW} (missing)` });
      }
      matched.push({ index: ruleIndex.get(root) ?? null, rows });
      continue;
    }

    // A plain rule: gather the run of consecutive sections it claimed.
    const run: Match[] = [match];
    i++;
    while (i < sections.length) {
      const here = sections[i];
      if (!here) break;
      const next = bySection.get(here);
      if (!next || next.rule !== match.rule) break;
      run.push(next);
      i++;
    }
    const rows = [matchedRow(depth, run)];
    for (const m of run) {
      rows.push(...alignLevel(m.rule.sections, m.section.sections, m.section, depth + 1));
    }
    matched.push({ index: ruleIndex.get(match.rule) ?? null, rows });
  }

  const missing = rules
    .filter((rule) => !matchedRoots.has(rule))
    .map((rule) => {
      const index = ruleIndex.get(rule);
      if (index === undefined) {
        // `ruleIndex` is built from this exact `rules` array above, so every
        // rule reached here (it came from filtering `rules` itself) has an
        // entry; this is unreachable.
        throw new Error("alignLevel: rule missing from its own index");
      }
      return { index, rows: missingRows(depth, rule) };
    });

  return insertMissing(matched, missing);
}

/** The full alignment block for one file: the page row, then its sections. */
export function explainAlignment(tree: DocumentTree, template: Template): AlignmentRow[] {
  const heading = pageHeading(tree);
  const arrow =
    heading.text !== null
      ? `${titleText(heading.text)}${heading.note ? ` (${heading.note})` : ""}`
      : `(${heading.note ?? "no heading"})`;
  const rows: AlignmentRow[] = [{ depth: 0, text: `${pad("(page)")}${ARROW} ${arrow}` }];
  rows.push(...alignLevel(template.sections, pageSections(tree), null, 1));
  return rows;
}

/** `AlignmentRow[]` as the indented text `renderExplain` prints, two spaces per depth. */
export function formatAlignment(rows: AlignmentRow[]): string[] {
  return rows.map((row) => `${"  ".repeat(row.depth)}${row.text}`);
}
