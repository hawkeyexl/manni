/**
 * `sequence:` - the ordered runs of content a section (or an element's or
 * list item's own content) must hold.
 *
 * Content arrives flat and in document order, so consecutive nodes of the
 * same kind are first grouped into runs: `[p, p, code, table]` becomes three
 * runs (paragraph, codeBlock, table). Those runs are then matched
 * positionally against the template's sequence, and each run is handed to
 * `checkContainsIn` for its one set key.
 *
 * v1 reported a length mismatch and an order mismatch as two finding types,
 * `sequence_length_error` and `sequence_order_error`. v2 collapses both into
 * one `content_order_error`: the message states the full expected and actual
 * kind lists, which communicates a length difference as plainly as an order
 * one, and a template widening from three kinds to nine does not need a
 * matching widening of finding types. The bail-on-mismatch behavior stays -
 * once the runs are the wrong shape, per-run findings are noise about
 * content the author has not arranged yet.
 */

import type { ContentKind, ContentNode, Finding, Position, SectionNode } from "../types.js";
import { BLOCK_KINDS, sectionContext, type BlockKind, type BlockRule, type RuleContext } from "./index.js";
import { checkContainsIn } from "./contains.js";

/** A maximal stretch of consecutive content nodes sharing one kind. */
export interface ContentRun {
  kind: ContentKind;
  nodes: ContentNode[];
  /** First node's start through last node's end. */
  position: Position;
}

/** Groups consecutive same-kind nodes into runs, preserving document order. */
export function groupRuns(content: ContentNode[]): ContentRun[] {
  const runs: ContentRun[] = [];

  for (const node of content) {
    const current = runs[runs.length - 1];
    if (current && current.kind === node.kind) {
      current.nodes.push(node);
      current.position = {
        start: current.position.start,
        end: node.position.end,
      };
    } else {
      runs.push({
        kind: node.kind,
        nodes: [node],
        position: { start: node.position.start, end: node.position.end },
      });
    }
  }

  return runs;
}

/** The content kind a block-rule key names, e.g. `codeBlocks` -> `codeBlock`. */
const KIND_OF_BLOCK: Record<BlockKind, ContentKind> = {
  paragraphs: "paragraph",
  codeBlocks: "codeBlock",
  lists: "list",
  tables: "table",
  admonitions: "admonition",
  images: "image",
  blockquotes: "blockquote",
  definitionLists: "definitionList",
  elements: "element",
};

/** The short noun a `content_order_error` message uses for one kind. */
function sequenceLabel(kind: ContentKind): string {
  switch (kind) {
    case "paragraph":
      return "paragraph";
    case "codeBlock":
      return "code";
    case "list":
      return "list";
    case "table":
      return "table";
    case "admonition":
      return "admonition";
    case "image":
      return "image";
    case "blockquote":
      return "blockquote";
    case "definitionList":
      return "definition list";
    case "element":
      return "element";
    default:
      // tableRow/tableCell/definitionItem/listItem never appear as a top-level
      // ContentNode.kind; groupRuns only ever sees the nine kinds above.
      return kind;
  }
}

/** The one key set on a `sequence:` entry, or `null` for a malformed one. */
function keyOf(entry: BlockRule): BlockKind | null {
  for (const kind of BLOCK_KINDS) {
    if (entry[kind] !== undefined) return kind;
  }
  return null;
}

/** Checks a section's own content against a `sequence:` rule. */
export function checkSequence(
  section: SectionNode,
  rule: BlockRule[] | undefined,
): Finding[] {
  return checkSequenceIn(section.children, rule, sectionContext(section));
}

/**
 * The reusable core: checks any ordered content list against a `sequence:`
 * rule - a section's content, a list item's `children`, or an element's own
 * `children`.
 */
export function checkSequenceIn(
  content: ContentNode[],
  rule: BlockRule[] | undefined,
  ctx: RuleContext,
): Finding[] {
  if (!rule) return [];

  const runs = groupRuns(content);
  const expectedKinds = rule.map((entry) => {
    const key = keyOf(entry);
    return key ? KIND_OF_BLOCK[key] : null;
  });
  const actualKinds = runs.map((run) => run.kind);

  const matches =
    expectedKinds.length === actualKinds.length &&
    expectedKinds.every((kind, index) => kind === actualKinds[index]);

  if (!matches) {
    const expected = expectedKinds.map((kind) => (kind ? sequenceLabel(kind) : "?"));
    const found = actualKinds.length > 0 ? actualKinds.map(sequenceLabel) : ["nothing"];
    return [
      {
        type: "content_order_error",
        heading: ctx.heading,
        message: `Expected ${expected.join(" then ")}, but found ${found.join(" then ")}`,
        position: ctx.position,
        severity: "error",
      },
    ];
  }

  const findings: Finding[] = [];
  runs.forEach((run, index) => {
    const entry = rule[index];
    if (!entry) return;
    const runCtx: RuleContext = { heading: ctx.heading, position: run.position };
    // A run holds one kind, so `checkContainsIn` sees exactly the nodes in
    // this stretch, not the section's other content of the same kind - the
    // entry has only that one key set, so every other dispatch is a no-op.
    findings.push(...checkContainsIn(run.nodes, entry, runCtx));
  });

  return findings;
}
