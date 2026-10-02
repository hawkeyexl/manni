/**
 * Fold a flat list of fragments into a nested section tree.
 *
 * Every format arrives here as an ordered list of `Fragment`s - a heading, or
 * a piece of content - and leaves as `SectionNode[]`. Keeping the fold in one
 * place is what makes a new format one `toFragments` function rather than a
 * second copy of the nesting, position, and slug logic.
 *
 * Named `Fragment` rather than `Block`, deliberately: "block" is the
 * block-level content vocabulary (`ContentKind`'s `table`, `blockquote`, and
 * so on), and this internal pipeline type never leaves `src/lint/parsers/`.
 *
 * Two position rules are deliberate:
 *
 *  - A section ends where the *next section at its level or shallower* begins,
 *    not at its own last child. A finding about a section therefore spans the
 *    trailing blank lines a reader would consider part of it, and adjacent
 *    sections tile the document with no gaps.
 *  - Content appearing before any heading becomes an implicit lead section at
 *    `level: 0`, so a headless document (frontmatter, prose, then `## ...`)
 *    still has somewhere to hang its content and its later headings nest under
 *    it rather than being dropped.
 */
import GithubSlugger from "github-slugger";
import type { ContentNode, Position, SectionNode } from "../types.js";

export interface HeadingFragment {
  type: "heading";
  /** 1-6. */
  level: number;
  title: string;
  position: Position;
}

export interface ContentFragment {
  type: "content";
  node: ContentNode;
}

export type Fragment = HeadingFragment | ContentFragment;

/** Mutable while open; frozen into a `SectionNode` on close. */
interface OpenSection {
  node: SectionNode;
  /** End of the last block seen, the fallback when nothing follows. */
  lastEnd: Position["end"];
}

/**
 * @param fragments Document fragments in source order, frontmatter excluded.
 * @param docEnd    End of the document, used to close the final sections.
 */
export function sectionize(fragments: Fragment[], docEnd: Position["end"]): SectionNode[] {
  const slugger = new GithubSlugger();
  const roots: SectionNode[] = [];
  const stack: OpenSection[] = [];

  /** Close every open section at `level` or deeper, ending it at `end`. */
  const closeTo = (level: number, end: Position["end"]): void => {
    let top = stack.at(-1);
    while (top !== undefined && top.node.level >= level) {
      stack.pop();
      top.node.position.end = { ...end };
      top = stack.at(-1);
    }
  };

  /** Pushes `node` onto the stack and hands back the section it opened. */
  const push = (node: SectionNode): OpenSection => {
    const parent = stack[stack.length - 1];
    if (parent) {
      node.parentSlug = parent.node.slug;
      node.order = parent.node.sections.length + 1;
      parent.node.sections.push(node);
    } else {
      node.parentSlug = null;
      node.order = roots.length + 1;
      roots.push(node);
    }
    const open: OpenSection = { node, lastEnd: node.position.end };
    stack.push(open);
    return open;
  };

  /**
   * The implicit lead section. `level: 0` is below every real heading, so the
   * headings that follow nest inside it instead of closing it.
   */
  const openLead = (start: Position["start"]): OpenSection =>
    push({
      slug: slugger.slug("(lead)"),
      title: "",
      level: 0,
      order: 0,
      parentSlug: null,
      titlePosition: null,
      position: { start: { ...start }, end: { ...start } },
      children: [],
      sections: [],
    });

  for (const fragment of fragments) {
    if (fragment.type === "heading") {
      closeTo(fragment.level, fragment.position.start);
      push({
        slug: slugger.slug(fragment.title),
        title: fragment.title,
        level: fragment.level,
        order: 0,
        parentSlug: null,
        titlePosition: { ...fragment.position },
        position: { start: { ...fragment.position.start }, end: { ...fragment.position.end } },
        children: [],
        sections: [],
      });
      continue;
    }

    const current = stack.at(-1) ?? openLead(fragment.node.position.start);
    current.node.children.push(fragment.node);
    current.lastEnd = fragment.node.position.end;
    // Every enclosing section grows with its descendants, so a parent's span
    // always covers its children even before it is closed.
    for (const open of stack) open.node.position.end = { ...fragment.node.position.end };
  }

  closeTo(0, docEnd);
  return roots;
}
