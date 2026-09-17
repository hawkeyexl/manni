/**
 * Readers for term lists held in a text format's body: Markdown and MDX
 * definition lists, AsciiDoc `[glossary]`, and reStructuredText `.. glossary::`.
 */
import type { TermReader } from "../../types.js";
import { asciidocGlossaryReader } from "./asciidoc-glossary.js";
import { markdownDeflistReader } from "./markdown-deflist.js";
import { rstGlossaryReader } from "./rst-glossary.js";

export const TEXT_READERS: readonly TermReader[] = [
  markdownDeflistReader,
  asciidocGlossaryReader,
  rstGlossaryReader,
];
