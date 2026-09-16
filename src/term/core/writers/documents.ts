/**
 * Writers for the seven document formats. The target's shape decides the
 * construct: a directory gets one term page per term (a DITA glossentry topic
 * for DITA), a file gets every term in the format's list construct. DocBook
 * has no one-term construct, so it is written as a file only.
 */
import { join } from "node:path";
import { TermError } from "../../errors.js";
import {
  TERM_FIELDS,
  type Term,
  type TermField,
  type TermRender,
  type TermShape,
  type TermTarget,
  type TermWriteFormat,
  type TermWriter,
} from "../../types.js";
import {
  DITA_HOLDS,
  DOCBOOK_HOLDS,
  LIST_HOLDS,
  asciidocEntry,
  ditaEntry,
  docbookEntry,
  htmlDlEntry,
  markdownEntry,
  rstEntry,
} from "./entries.js";
import { fileOf, reindent, sharedLanguage, xmlAttribute } from "./markup.js";
import { htmlPage, metadataPage, yamlFrontmatter } from "./page.js";
import { droppedFields, requireShape } from "./render-util.js";

/** Characters no file name may hold on any platform manni runs on. */
const UNSAFE_NAME = /[/\\:*?"<>|]/;

interface DocumentSpec {
  format: TermWriteFormat;
  extension: string;
  file: {
    holds: readonly TermField[];
    render: (terms: readonly Term[]) => string;
    /**
     * Whether the file's construct reads an entry only when it has a
     * definition. A Markdown or AsciiDoc list and a `.. glossary::` skip one
     * with none, and a `<dl>` folds its `<dt>`s into the next entry's, so a
     * term with no definition is left out rather than written unreadable.
     */
    needsDefinition: boolean;
  };
  directory?: { holds: readonly TermField[]; render: (term: Term) => string };
}

function pagePaths(terms: readonly Term[], target: TermTarget, extension: string): string[] {
  const seen = new Set<string>();
  return terms.map((term) => {
    if (UNSAFE_NAME.test(term.id) || term.id === "." || term.id === "..") {
      throw new TermError(`the id "${term.id}" cannot name a file. Give the term an id without path characters.`);
    }
    if (seen.has(term.id)) {
      throw new TermError(`two terms have the id "${term.id}", and a directory holds one file per id.`);
    }
    seen.add(term.id);
    return join(target.path, `${term.id}${extension}`);
  });
}

function documentWriter(spec: DocumentSpec): TermWriter {
  const { directory } = spec;
  return {
    format: spec.format,
    shapes: directory === undefined ? ["file"] : ["file", "directory"],
    holds: (shape: TermShape) => (shape === "directory" && directory !== undefined ? directory.holds : spec.file.holds),
    render(terms, target): TermRender {
      if (target.shape === "directory" && directory !== undefined) {
        const paths = pagePaths(terms, target, spec.extension);
        return {
          files: terms.map((term, i) => ({ path: paths[i] ?? "", content: directory.render(term) })),
          removals: [],
          dropped: droppedFields(terms, directory.holds),
          skipped: [],
        };
      }
      requireShape(spec.format, target, "file");
      const written = spec.file.needsDefinition ? terms.filter((t) => t.record.definition !== undefined) : terms;
      return {
        files: [{ path: target.path, content: spec.file.render(written) }],
        removals: [],
        dropped: droppedFields(written, spec.file.holds),
        skipped: terms.filter((t) => !written.includes(t)).map((t) => t.id),
      };
    },
  };
}

/** Entries at indentation zero, a blank line between them, each indented to `indent`. */
function entriesBlock(entries: readonly string[], indent = ""): string[] {
  return entries.flatMap((entry, i) => [
    ...(i === 0 ? [] : [""]),
    `${indent}${reindent(entry, indent, "\n")}`,
  ]);
}

/** Every line of each entry indented, no blank line between: markup keeps its entries adjacent. */
function markupBlock(entries: readonly string[], indent: string): string[] {
  return entries.map((entry) => `${indent}${reindent(entry, indent, "\n")}`);
}

function textPage(format: string): (term: Term) => string {
  return (term) => metadataPage(format, term);
}

/** The frontmatter a many-per-file text document opens with, or none when it would be empty. */
function listFrontmatter(terms: readonly Term[], type: boolean): string[] {
  const metadata: Record<string, unknown> = {};
  if (type) metadata["type"] = "term-set";
  const language = sharedLanguage(terms);
  if (language !== undefined) metadata["language"] = language;
  if (Object.keys(metadata).length === 0) return [];
  return [yamlFrontmatter(metadata).replace(/\n$/, ""), ""];
}

function markdownList(terms: readonly Term[]): string {
  return fileOf([...listFrontmatter(terms, true), ...entriesBlock(terms.map((t) => markdownEntry(t.record)))]);
}

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';

function langAttribute(language: string | undefined): string {
  return language === undefined ? "" : ` xml:lang="${xmlAttribute(language)}"`;
}

export const markdownWriter = documentWriter({
  format: "markdown",
  extension: ".md",
  file: { holds: LIST_HOLDS, render: markdownList, needsDefinition: true },
  directory: { holds: TERM_FIELDS, render: textPage("markdown") },
});

export const mdxWriter = documentWriter({
  format: "mdx",
  extension: ".mdx",
  file: { holds: LIST_HOLDS, render: markdownList, needsDefinition: true },
  directory: { holds: TERM_FIELDS, render: textPage("mdx") },
});

export const asciidocWriter = documentWriter({
  format: "asciidoc",
  extension: ".adoc",
  file: {
    holds: LIST_HOLDS,
    needsDefinition: true,
    render: (terms) =>
      fileOf([...listFrontmatter(terms, false), "[glossary]", ...entriesBlock(terms.map((t) => asciidocEntry(t.record)))]),
  },
  directory: { holds: TERM_FIELDS, render: textPage("asciidoc") },
});

export const rstWriter = documentWriter({
  format: "rst",
  extension: ".rst",
  file: {
    holds: LIST_HOLDS,
    needsDefinition: true,
    render: (terms) =>
      fileOf([
        ...listFrontmatter(terms, false),
        ".. glossary::",
        "",
        ...entriesBlock(
          terms.map((t) => rstEntry(t.record)),
          "   ",
        ),
      ]),
  },
  directory: { holds: TERM_FIELDS, render: textPage("rst") },
});

export const htmlWriter = documentWriter({
  format: "html",
  extension: ".html",
  file: {
    holds: LIST_HOLDS,
    needsDefinition: true,
    render: (terms) => {
      const language = sharedLanguage(terms);
      return fileOf([
        "<!DOCTYPE html>",
        "<html>",
        "  <head>",
        "    <title>Glossary</title>",
        '    <meta name="type" content="term-set">',
        ...(language === undefined ? [] : [`    <meta name="language" content="${xmlAttribute(language)}">`]),
        "  </head>",
        "  <body>",
        "    <dl>",
        ...markupBlock(terms.map(htmlDlEntry), "      "),
        "    </dl>",
        "  </body>",
        "</html>",
      ]);
    },
  },
  directory: { holds: TERM_FIELDS, render: htmlPage },
});

export const ditaWriter = documentWriter({
  format: "dita",
  extension: ".dita",
  file: {
    holds: DITA_HOLDS,
    needsDefinition: false,
    render: (terms) =>
      fileOf([
        XML_DECLARATION,
        '<!DOCTYPE glossgroup PUBLIC "-//OASIS//DTD DITA 2.0 Glossary Group//EN" "glossgroup.dtd">',
        `<glossgroup id="glossary"${langAttribute(sharedLanguage(terms))}>`,
        "  <title>Glossary</title>",
        ...markupBlock(terms.map((t) => ditaEntry(t)), "  "),
        "</glossgroup>",
      ]),
  },
  directory: {
    holds: DITA_HOLDS,
    render: (term) =>
      fileOf([
        XML_DECLARATION,
        '<!DOCTYPE glossentry PUBLIC "-//OASIS//DTD DITA 2.0 Glossary Entry//EN" "glossentry.dtd">',
        ditaEntry(term, term.language),
      ]),
  },
});

export const docbookWriter = documentWriter({
  format: "docbook",
  extension: ".xml",
  file: {
    holds: DOCBOOK_HOLDS,
    needsDefinition: false,
    render: (terms) =>
      fileOf([
        XML_DECLARATION,
        `<glossary xmlns="http://docbook.org/ns/docbook" version="5.0"${langAttribute(sharedLanguage(terms))}>`,
        "  <title>Glossary</title>",
        ...markupBlock(terms.map(docbookEntry), "  "),
        "</glossary>",
      ]),
  },
});

export const DOCUMENT_WRITERS: readonly TermWriter[] = [
  markdownWriter,
  mdxWriter,
  asciidocWriter,
  rstWriter,
  htmlWriter,
  ditaWriter,
  docbookWriter,
];
