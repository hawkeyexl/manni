/**
 * Readers for term lists held in a text format's body: Markdown and MDX
 * definition lists, AsciiDoc `[glossary]`, and reStructuredText `.. glossary::`.
 */
import type { TermReader } from "../../types.js";

export const TEXT_READERS: readonly TermReader[] = [];
