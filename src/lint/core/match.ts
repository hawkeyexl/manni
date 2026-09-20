/**
 * Decide which rule describes which section, by alignment.
 *
 * A rule list is a regular expression over section predicates, and a document's
 * sibling sections are the string. The matcher compiles the first and aligns
 * the second against it at minimum cost:
 *
 *  1. Each rule contributes one predicate on a heading. `min`/`max` is counted
 *     repetition, and `repeat:` is a parenthesised subexpression.
 *  2. Bounded counts expand into copies; an absent `max` becomes a self-loop.
 *  3. Four edits close the gap between rules and sections: a *match* (the
 *     predicate holds), a *coercion* (a rule claiming one section takes a
 *     section its heading rejects), a *skipped rule* (a required occurrence
 *     consumes nothing) and a *skipped section* (no rule consumes it).
 *  4. Viterbi over a (sections + 1) x states lattice finds the cheapest edit
 *     sequence. Deletions can form zero-consuming cycles, so each column is
 *     closed with Dijkstra rather than a topological sweep; all weights are
 *     non-negative.
 *  5. Skipped rules become `missing_section` (or one `missing_group` for a
 *     `repeat` copy that is absent whole), skipped sections become
 *     `unexpected_section`, and every match is handed to the content rules.
 *
 * The predecessor of this file walked the rules left to right with no
 * backtracking, and each of its eight hand-written behaviours is now a
 * consequence of a weight or a tie-break instead of a special case. The two it
 * could not express are what forced the change: a rule list with counted
 * repetition is not a sequence of one-shot decisions, and a greedy walk has to
 * guess which of two rules wants a section before it has seen the rest.
 *
 * Heading mismatches are deliberately not reported here. This module pairs; the
 * content rules report `heading_error` on the pair it produced. `validator.ts`
 * explains why the two are separate.
 */
import { LintError } from "../types.js";
import type { Finding, Position, SectionNode } from "../types.js";
import { headingMatches, isWildcard, occurrenceRange } from "./template.js";
import type { Rule } from "./template.js";

/* -------------------------------------------------------------------------- *
 * The cost model, which is interface
 * -------------------------------------------------------------------------- */

/**
 * What each edit costs, in the units the alignment minimises.
 *
 * These weights are **interface, not implementation**. They decide which
 * findings a document produces, so changing one changes the report for
 * documents nobody edited - the same class of change as renaming a flag.
 * `test/lint/unit/match.test.ts` pins them, and the templates reference prints
 * them.
 *
 * Skipping an occurrence at or above its rule's `min` is free; only a required
 * occurrence pays `skipRule`.
 *
 * Coercion is open only to a *required* occurrence of a rule whose `max` is 1.
 * Both halves of that earn their place. Without the `max: 1` half a repeating
 * rule adopts any stray section for 1 rather than letting it report as
 * unexpected for 2. Without the "required" half an optional rule does the same
 * thing for the same reason, and there it is plainly wrong: standing aside
 * costs an optional rule nothing, so coercing trades a clean report for a
 * heading error about a section the template never insisted on.
 */
export const ALIGNMENT_COSTS = {
  match: 0,
  coerce: 1,
  skipRule: 2,
  skipSection: 2,
} as const;

/**
 * How equal-cost alignments are settled, in order, after the total cost.
 *
 * Also interface: two of these decide real reports, and all three are stated in
 * words so the docs page and the code cannot drift apart.
 */
export const TIE_BREAKS = [
  "a rule that names its heading beats a wildcard taking the same section",
  "a repeating rule prefers its sections adjacent",
  "earliest rule, then the smallest edit sequence under match < coerce < skip-rule < skip-section",
] as const;

/**
 * Most states a compiled rule list may expand to.
 *
 * Counted repetition is expanded into copies, so `max: 100000` on a rule with
 * five subsections is a hundred thousand copies of five states and a lattice
 * nobody asked for. The cap turns that into a template error naming the file,
 * rather than a lint run that appears to hang.
 */
export const STATE_LIMIT = 2000;

/* -------------------------------------------------------------------------- *
 * What the matcher hands on
 * -------------------------------------------------------------------------- */

/** One rule paired with the section it claimed. */
export interface Match {
  /** The rule itself - a `repeat` group's member, never the group. */
  rule: Rule;
  section: SectionNode;
  /**
   * True when the rule was paired with a section whose heading does not
   * satisfy it, because nothing else could claim that section. Keeps the
   * precise "Expected title X, but found Y" report for the common one-for-one
   * case instead of degrading it into missing + unexpected.
   */
  coerced: boolean;
}

export interface MatchResult {
  matches: Match[];
  findings: Finding[];
}

export interface MatchOptions {
  /** Section these are the subsections of, for anchoring a trailing gap. */
  parent?: SectionNode | null;
  /** File the rules came from. Used only to name the state-cap failure. */
  source?: string;
  /** Template within that file. Used only to name the state-cap failure. */
  template?: string;
}

/* -------------------------------------------------------------------------- *
 * Compilation
 * -------------------------------------------------------------------------- */

/**
 * One copy of a `repeat` group, and every leaf occurrence inside it.
 *
 * It exists so an absent copy can report once for the group. A copy whose
 * leaves were *all* skipped is a group that is not there at all, which reads
 * as one finding; a copy that matched some of them is a group that is there and
 * incomplete, whose absent members read better one by one.
 */
interface GroupCopy {
  rule: Rule;
  members: Occurrence[];
}

/** One occurrence of one rule: the chance to consume exactly one section. */
interface Occurrence {
  rule: Rule;
  /** Below the rule's `min`, so skipping it costs rather than being free. */
  required: boolean;
  /** Required and `max: 1`, so it may take a section its heading rejects. */
  coercible: boolean;
  /** Says nothing about its heading, so it loses ties to a rule that does. */
  wildcard: boolean;
  /** Enclosing `repeat` copies, outermost first. */
  groups: GroupCopy[];
}

interface Eps {
  from: number;
  to: number;
  cost: number;
  rank: number;
  /** Set when this edge is a rule being skipped rather than structure. */
  occ: Occurrence | null;
}

interface Automaton {
  states: number;
  start: number;
  accept: number;
  /** The occurrence a state may consume a section through, if any. */
  consume: (Occurrence | null)[];
  /** Where that consumption lands. */
  consumeTo: number[];
  epsOut: Eps[][];
  epsIn: Eps[][];
  /** States strictly inside a repetition, where a skipped section breaks a run. */
  inRepeat: boolean[];
}

/**
 * Edit ranks, used only to settle a tie the costs and the two structural
 * tie-breaks left open. Structural epsilons - entering, repeating and leaving a
 * self-loop - rank with `match`, because they are not edits at all and a path
 * must be free to leave a loop before it starts skipping the rules inside it.
 */
const RANK = {
  match: 0,
  structure: 0,
  coerce: 1,
  skipRule: 2,
  skipSection: 3,
} as const;

const NO_EPS: Eps[] = [];

/**
 * States the rule list expands to, counted without building anything.
 *
 * Checked before compilation so a template with an absurd `max` fails on its
 * own terms rather than by exhausting memory. The two extra states per
 * unbounded rule are its self-loop's entry and exit.
 */
function expandedStates(rules: Rule[]): number {
  let total = 1;
  for (const rule of rules) total += ruleStates(rule);
  return total;
}

function ruleStates(rule: Rule): number {
  let unit = 1;
  if (rule.repeat) {
    unit = 0;
    for (const member of rule.repeat) unit += ruleStates(member);
  }
  const { min, max } = occurrenceRange(rule);
  if (max === null) return unit * (Math.max(min, 0) + 1) + 2;
  return unit * Math.max(0, max);
}

function listAt<T>(lists: T[][], index: number): T[] {
  const list = lists[index];
  if (list) return list;
  const created: T[] = [];
  lists[index] = created;
  return created;
}

/**
 * Compile a rule list into an automaton over section predicates.
 *
 * Bounded repetition is unrolled: `min: 1, max: 3` is three copies, the first
 * required and the rest free to skip. An unbounded `max` is a self-loop after
 * the required copies, which is the only construct here that can consume
 * nothing and return to where it started - hence the Dijkstra in the alignment.
 */
function compile(rules: Rule[]): Automaton {
  const consume: (Occurrence | null)[] = [];
  const consumeTo: number[] = [];
  const epsOut: Eps[][] = [];
  const epsIn: Eps[][] = [];
  const inRepeat: boolean[] = [];

  const newState = (): number => {
    consume.push(null);
    consumeTo.push(-1);
    epsOut.push([]);
    epsIn.push([]);
    inRepeat.push(false);
    return consume.length - 1;
  };

  const eps = (
    from: number,
    to: number,
    cost: number,
    rank: number,
    occ: Occurrence | null,
  ): void => {
    const edge: Eps = { from, to, cost, rank, occ };
    listAt(epsOut, from).push(edge);
    listAt(epsIn, to).push(edge);
  };

  const leaf = (from: number, occ: Occurrence): number => {
    const to = newState();
    consume[from] = occ;
    consumeTo[from] = to;
    // Skipping the occurrence: free when the rule can do without it.
    eps(from, to, occ.required ? ALIGNMENT_COSTS.skipRule : 0, RANK.skipRule, occ);
    return to;
  };

  /** One copy of a rule's unit: its members, or the rule's own occurrence. */
  const buildCopy = (
    rule: Rule,
    from: number,
    groups: GroupCopy[],
    required: boolean,
  ): number => {
    if (rule.repeat) {
      const copy: GroupCopy = { rule, members: [] };
      const nested = [...groups, copy];
      let cursor = from;
      for (const member of rule.repeat) {
        cursor = buildRule(member, cursor, nested, required);
      }
      return cursor;
    }
    const { max } = occurrenceRange(rule);
    const occ: Occurrence = {
      rule,
      required,
      coercible: required && max === 1,
      wildcard: isWildcard(rule),
      groups,
    };
    for (const group of groups) group.members.push(occ);
    return leaf(from, occ);
  };

  function buildRule(
    rule: Rule,
    from: number,
    groups: GroupCopy[],
    context: boolean,
  ): number {
    const { min, max } = occurrenceRange(rule);
    // `max` below `min` is refused by the loader where both are written; a bare
    // `max: 0` still reaches here against the default `min: 1`, and means none.
    const floor = max === null ? Math.max(min, 0) : Math.min(Math.max(min, 0), max);
    const copies = max === null ? floor : Math.max(0, max);
    const first = consume.length;

    let cursor = from;
    for (let copy = 0; copy < copies; copy++) {
      cursor = buildCopy(rule, cursor, groups, context && copy < floor);
    }

    let end = cursor;
    if (max === null) {
      const loop = newState();
      eps(cursor, loop, 0, RANK.structure, null);
      const back = buildCopy(rule, loop, groups, false);
      eps(back, loop, 0, RANK.structure, null);
      end = newState();
      eps(loop, end, 0, RANK.structure, null);
    }

    // A skipped section inside a repetition breaks the run it is inside, which
    // tie-break 2 charges for. The repetition's own boundaries are not inside
    // it: a section skipped before the first copy or after the last one sits
    // beside the run rather than in the middle of it.
    if (copies > 1 || max === null) {
      for (let state = first; state < consume.length; state++) {
        if (state !== end) inRepeat[state] = true;
      }
    }
    return end;
  }

  const start = newState();
  let cursor = start;
  for (const rule of rules) cursor = buildRule(rule, cursor, [], true);

  return {
    states: consume.length,
    start,
    accept: cursor,
    consume,
    consumeTo,
    epsOut,
    epsIn,
    inRepeat,
  };
}

/**
 * Compiled rule lists, keyed by the array the template holds.
 *
 * A template is loaded once and applied to every page of its doctype, and every
 * level of every page re-enters this module. The automaton is immutable once
 * built, so one compilation serves them all.
 */
const compiled = new WeakMap<Rule[], Automaton>();

function automatonFor(rules: Rule[], options: MatchOptions): Automaton {
  const hit = compiled.get(rules);
  if (hit) return hit;

  const states = expandedStates(rules);
  if (states > STATE_LIMIT) {
    const source = options.source ?? "template";
    const name = options.template ?? "the rule list";
    throw new LintError(
      `${source}: ${name} expands to ${states} states; the limit is ${STATE_LIMIT}. ` +
        `Cap a max, or split the template.`,
    );
  }

  const built = compile(rules);
  compiled.set(rules, built);
  return built;
}

/* -------------------------------------------------------------------------- *
 * Alignment
 * -------------------------------------------------------------------------- */

type StepKind = "match" | "coerce" | "skip-rule" | "skip-section";

/** One candidate edge out of a lattice node, during the forward walk. */
interface Move {
  kind: StepKind;
  /** State it lands in. */
  to: number;
  /** Section index it lands in - the same one unless a section was consumed. */
  column: number;
  occ: Occurrence | null;
  /** This edge plus the cheapest completion from where it lands. */
  total: number;
  rank: number;
}

interface Step {
  kind: StepKind;
  /** Section consumed, or where the cursor stood when a rule was skipped. */
  index: number;
  occ: Occurrence | null;
}

/** A section's heading, or `null` when it has none of its own. */
function titleOf(section: SectionNode): string | null {
  return section.titlePosition === null ? null : section.title;
}

/** Binary heap over (cost, state), smallest cost first. */
class Heap {
  private readonly costs: number[] = [];
  private readonly items: number[] = [];

  get size(): number {
    return this.items.length;
  }

  push(cost: number, item: number): void {
    this.costs.push(cost);
    this.items.push(item);
    let child = this.items.length - 1;
    while (child > 0) {
      const parent = (child - 1) >> 1;
      if ((this.costs[parent] ?? 0) <= (this.costs[child] ?? 0)) break;
      this.swap(parent, child);
      child = parent;
    }
  }

  pop(): { cost: number; item: number } {
    const cost = this.costs[0] ?? 0;
    const item = this.items[0] ?? 0;
    const lastCost = this.costs.pop();
    const lastItem = this.items.pop();
    if (this.items.length > 0 && lastCost !== undefined && lastItem !== undefined) {
      this.costs[0] = lastCost;
      this.items[0] = lastItem;
      let parent = 0;
      for (;;) {
        const left = parent * 2 + 1;
        const right = left + 1;
        let smallest = parent;
        if (left < this.items.length && (this.costs[left] ?? 0) < (this.costs[smallest] ?? 0)) {
          smallest = left;
        }
        if (right < this.items.length && (this.costs[right] ?? 0) < (this.costs[smallest] ?? 0)) {
          smallest = right;
        }
        if (smallest === parent) break;
        this.swap(parent, smallest);
        parent = smallest;
      }
    }
    return { cost, item };
  }

  private swap(a: number, b: number): void {
    const cost = this.costs[a] ?? 0;
    const item = this.items[a] ?? 0;
    this.costs[a] = this.costs[b] ?? 0;
    this.items[a] = this.items[b] ?? 0;
    this.costs[b] = cost;
    this.items[b] = item;
  }
}

/**
 * The cheapest edit sequence turning the rule list into the section list.
 *
 * Costs are packed into one integer so the lattice can be a typed array:
 * `((primary * radix) + wildcards) * radix + brokenRuns`, compared as one
 * number, which is lexicographic because no component can reach the radix.
 *
 * The lattice is filled backwards, from the end of the document to the start,
 * and the path is then walked forwards. That order is what makes tie-break 3
 * expressible: with the cost of every remaining suffix already known, the walk
 * can take the lowest-ranked optimal edit at each step, which is exactly
 * "earliest rule, then the smallest edit sequence".
 */
function align(sections: SectionNode[], nfa: Automaton): Step[] {
  const n = sections.length;
  const states = nfa.states;
  const radix = 2 * (n + states) + 2;
  const weigh = (primary: number, wildcards: number, brokenRuns: number): number =>
    (primary * radix + wildcards) * radix + brokenRuns;

  const SKIP_SECTION = weigh(ALIGNMENT_COSTS.skipSection, 0, 0);
  const SKIP_SECTION_IN_RUN = weigh(ALIGNMENT_COSTS.skipSection, 0, 1);
  const MATCH = weigh(ALIGNMENT_COSTS.match, 0, 0);
  const MATCH_WILDCARD = weigh(ALIGNMENT_COSTS.match, 1, 0);
  const COERCE = weigh(ALIGNMENT_COSTS.coerce, 0, 0);

  /** What a state's consuming edge costs against one section, or null. */
  const consumeCost = (
    state: number,
    index: number,
  ): { cost: number; rank: number; to: number; occ: Occurrence } | null => {
    const occ = nfa.consume[state];
    const section = sections[index];
    const to = nfa.consumeTo[state];
    if (!occ || !section || to === undefined || to < 0) return null;
    if (headingMatches(occ.rule.heading, titleOf(section))) {
      const cost = occ.wildcard ? MATCH_WILDCARD : MATCH;
      return { cost, rank: RANK.match, to, occ };
    }
    if (occ.coercible) return { cost: COERCE, rank: RANK.coerce, to, occ };
    return null;
  };

  const skipSectionCost = (state: number): number =>
    nfa.inRepeat[state] === true ? SKIP_SECTION_IN_RUN : SKIP_SECTION;

  // dist[i * states + s]: cheapest way from (section i, state s) to the end.
  const dist = new Float64Array((n + 1) * states).fill(Infinity);
  const distAt = (slot: number): number => dist[slot] ?? Infinity;

  for (let index = n; index >= 0; index--) {
    const base = index * states;
    const next = base + states;
    const heap = new Heap();

    for (let state = 0; state < states; state++) {
      let best = Infinity;
      if (index === n) {
        if (state === nfa.accept) best = 0;
      } else {
        const step = consumeCost(state, index);
        if (step) best = step.cost + distAt(next + step.to);
        const skipped = skipSectionCost(state) + distAt(next + state);
        if (skipped < best) best = skipped;
      }
      dist[base + state] = best;
      if (best < Infinity) heap.push(best, state);
    }

    // Close the column under epsilon edges. They can form zero-consuming
    // cycles - a `repeat` with `min: 0` and no `max` - so this is Dijkstra on
    // the reversed epsilon graph rather than a sweep in state order.
    const done = new Uint8Array(states);
    while (heap.size > 0) {
      const { cost, item } = heap.pop();
      if (done[item] === 1 || cost > distAt(base + item)) continue;
      done[item] = 1;
      for (const edge of nfa.epsIn[item] ?? NO_EPS) {
        const candidate = cost + edge.cost;
        if (candidate < distAt(base + edge.from)) {
          dist[base + edge.from] = candidate;
          heap.push(candidate, edge.from);
        }
      }
    }
  }

  if (distAt(nfa.start) === Infinity) {
    // Every state has a skip-section edge and every occurrence a skip edge, so
    // the accept state is always reachable. Reaching this would be a
    // construction bug, not a template the user can fix.
    throw new LintError("internal: no alignment exists for this rule list.");
  }

  const steps: Step[] = [];
  let index = 0;
  let state = nfa.start;
  let seen = new Set<number>([state]);

  while (!(index === n && state === nfa.accept)) {
    const moves: Move[] = [];

    const offer = (
      cost: number,
      rank: number,
      to: number,
      column: number,
      kind: StepKind,
      occ: Occurrence | null,
    ): void => {
      const total = cost + distAt(column * states + to);
      if (total === Infinity) return;
      moves.push({ kind, to, column, occ, total, rank });
    };

    if (index < n) {
      const step = consumeCost(state, index);
      if (step) {
        offer(
          step.cost,
          step.rank,
          step.to,
          index + 1,
          step.rank === RANK.coerce ? "coerce" : "match",
          step.occ,
        );
      }
      offer(skipSectionCost(state), RANK.skipSection, state, index + 1, "skip-section", null);
    }
    for (const edge of nfa.epsOut[state] ?? NO_EPS) {
      if (seen.has(edge.to)) continue;
      offer(edge.cost, edge.rank, edge.to, index, "skip-rule", edge.occ);
    }

    // Cheapest first; then the lowest-ranked edit, which is tie-break 3; then
    // the earliest state, so the walk is reproducible to the edge.
    let move: Move | undefined;
    for (const candidate of moves) {
      if (
        move === undefined ||
        candidate.total < move.total ||
        (candidate.total === move.total && candidate.rank < move.rank) ||
        (candidate.total === move.total &&
          candidate.rank === move.rank &&
          candidate.to < move.to)
      ) {
        move = candidate;
      }
    }
    if (move === undefined) {
      throw new LintError("internal: the alignment could not be reconstructed.");
    }

    if (move.kind !== "skip-rule" || move.occ !== null) {
      steps.push({ kind: move.kind, index, occ: move.occ });
    }
    if (move.column !== index) {
      index = move.column;
      seen = new Set<number>();
    }
    state = move.to;
    seen.add(state);
  }

  return steps;
}

/* -------------------------------------------------------------------------- *
 * Findings
 * -------------------------------------------------------------------------- */

function collapse(point: Position["end"]): Position {
  return { start: { ...point }, end: { ...point } };
}

/**
 * Where a finding about the cursor position lands.
 *
 * A gap in the middle of a document anchors on the section standing where the
 * missing one should be. A gap at the *end* has no such section, and anchoring
 * on the parent - which is what the previous matcher did - spans the parent's
 * whole subtree, so the finding starts at the parent's heading and sorts to the
 * top of a report about the bottom of the file. It anchors at the parent's end
 * instead, which is where the section would have gone.
 */
function anchor(
  index: number,
  sections: SectionNode[],
  parent: SectionNode | null,
): { heading: string | null; position: Position } {
  const section = sections[index];
  if (section) {
    return { heading: section.title || null, position: section.position };
  }
  if (parent) {
    return { heading: parent.title || null, position: collapse(parent.position.end) };
  }
  const last = sections[sections.length - 1];
  if (last) return { heading: null, position: collapse(last.position.end) };
  return { heading: null, position: collapse({ line: 1, column: 1, offset: 0 }) };
}

/** How a rule's heading reads inside a longer sentence. */
function describeHeading(rule: Rule): string {
  const heading = rule.heading;
  if (typeof heading === "string") return `"${heading}"`;
  if (Array.isArray(heading)) return heading.map((text) => `"${text}"`).join(", ");
  if (heading === false) return "a section with no heading";
  if (heading !== undefined) return `/${heading.pattern}/`;
  return rule.id === undefined ? "any section" : `"${rule.id}"`;
}

/**
 * What an absent occurrence is called.
 *
 * A rule names itself by its heading where it has one, because that is the text
 * the reader will type into the document. A wildcard has only its `id`, which
 * is why one is worth writing.
 */
function missingMessage(rule: Rule): string {
  const heading = rule.heading;
  if (typeof heading === "string") return `Missing section "${heading}"`;
  if (Array.isArray(heading)) {
    return `Missing one of ${heading.map((text) => `"${text}"`).join(", ")}`;
  }
  if (heading === false) return "Missing section without a heading";
  if (heading !== undefined) return `Missing section matching /${heading.pattern}/`;
  return rule.id === undefined ? "Missing section" : `Missing section "${rule.id}"`;
}

function missingGroupMessage(copy: GroupCopy): string {
  const members = (copy.rule.repeat ?? []).map(describeHeading).join(" followed by ");
  const name = copy.rule.id === undefined ? "" : ` "${copy.rule.id}"`;
  return `Missing group${name}: expected ${members}`;
}

function unexpectedMessage(section: SectionNode): string {
  const what =
    section.titlePosition === null
      ? "Unexpected section without a heading"
      : `Unexpected section "${section.title}"`;
  return `${what}. Add a trailing rule with min: 0 to allow sections the template does not describe.`;
}

/* -------------------------------------------------------------------------- *
 * The entry point
 * -------------------------------------------------------------------------- */

/**
 * Align `sections` against `rules` and say what is missing, what is extra, and
 * which rule describes which section.
 *
 * `rules` being absent means the template says nothing about this level, which
 * is silence rather than "no sections allowed". An empty list is the other
 * thing: a rule list that describes no sections, so every section is
 * unexpected.
 */
export function matchSections(
  sections: SectionNode[],
  rules: Rule[] | undefined,
  options: MatchOptions = {},
): MatchResult {
  const matches: Match[] = [];
  const findings: Finding[] = [];
  if (!rules) return { matches, findings };

  const parent = options.parent ?? null;
  const nfa = automatonFor(rules, options);
  const steps = align(sections, nfa);

  const taken = new Set<Occurrence>();
  for (const step of steps) {
    if ((step.kind === "match" || step.kind === "coerce") && step.occ) {
      taken.add(step.occ);
    }
  }

  /** The outermost enclosing `repeat` copy that is absent whole, if any. */
  const absentGroup = (occ: Occurrence): GroupCopy | null => {
    for (const group of occ.groups) {
      if (group.members.every((member) => !taken.has(member))) return group;
    }
    return null;
  };

  const reported = new Set<GroupCopy>();

  for (const step of steps) {
    const section = sections[step.index];
    if ((step.kind === "match" || step.kind === "coerce") && step.occ && section) {
      matches.push({
        rule: step.occ.rule,
        section,
        coerced: step.kind === "coerce",
      });
      continue;
    }

    if (step.kind === "skip-section" && section) {
      findings.push({
        type: "unexpected_section",
        heading: section.title || null,
        message: unexpectedMessage(section),
        position: section.position,
        severity: "error",
      });
      continue;
    }

    if (step.kind !== "skip-rule" || !step.occ || !step.occ.required) continue;

    const where = anchor(step.index, sections, parent);
    const group = absentGroup(step.occ);
    if (group) {
      if (reported.has(group)) continue;
      reported.add(group);
      findings.push({
        type: "missing_group",
        heading: where.heading,
        message: missingGroupMessage(group),
        position: where.position,
        severity: "error",
      });
      continue;
    }

    findings.push({
      type: "missing_section",
      heading: where.heading,
      message: missingMessage(step.occ.rule),
      position: where.position,
      severity: "error",
    });
  }

  return { matches, findings };
}
