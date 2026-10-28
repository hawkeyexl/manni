/**
 * What the judge reads for an HTML or XML page's body (proposal 0125,
 * decision 21): the page's text, with its tags dropped.
 *
 * The page's `body` stays its source, because deterministic graders count
 * the file's lines in it. A model reads markup as noise, so the judge is
 * handed the text lint's parser finds instead. A Flare topic is parsed with
 * its project, so variables, snippets and conditions read as the target
 * builds them. The text is assembled the way `manni graph`'s search index
 * assembles a non-Markdown document's: each block's plain text, a blank line
 * between. Markdown and MDX never come here, so their prompts and cache keys
 * are what they were.
 */
import { extname } from "node:path";
import { parserForExtension } from "../../lint/parsers/index.js";
import { plainText } from "../../lint/parsers/sectionize.js";
import type { SectionNode } from "../../lint/types.js";
import type { FlareRun } from "../../shared/flare/index.js";
import type { PageFile } from "../core/discover.js";

/** The page's text: each section's title and blocks, in document order. */
export async function pageText(page: PageFile, flare: FlareRun): Promise<string> {
  const parser = parserForExtension(extname(page.absPath));
  if (parser === undefined) return page.body;
  const tree = await parser.parse(page.content, page.absPath, { absPath: page.absPath, flare });
  return sectionsText(tree.sections).join("\n\n");
}

function sectionsText(sections: readonly SectionNode[]): string[] {
  return sections.flatMap((s) => [
    // A title made from the page's metadata is not in its body.
    ...(s.synthetic || s.title.trim() === "" ? [] : [s.title.trim()]),
    ...plainText(s.children),
    ...sectionsText(s.sections),
  ]);
}
