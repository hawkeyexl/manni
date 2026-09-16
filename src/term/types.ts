/**
 * The term tool's contract (proposal 0052). Every reader produces a `Term`,
 * every writer consumes one, and `check` and `lint` work on a `TermSet`. So a
 * new construct is one reader and one writer, and nothing after reading
 * changes, the same rule `MetadataExtractor` keeps for metadata.
 *
 * A term's record keeps the vocabulary's own kebab-case spelling
 * (`alt-labels`, `scope-note`), because it is the same record a page carries
 * and the one `term list -f json` prints. docevals keeps its eval entries in
 * frontmatter spelling for the same reason.
 */
import type { CollectionConfig } from "../shared/collections.js";
import type { ConfigFile } from "../shared/config-file.js";
import type { Severity } from "../shared/severity.js";
import type { ToolsConfig } from "../shared/tools.js";

// ---------------------------------------------------------------------------
// The record

/** The ten fields of `manni:terminology:1.0.0-proposal.1`, in the order the reference lists them. */
export const TERM_FIELDS = [
  "label",
  "definition",
  "abstract",
  "alt-labels",
  "hidden-labels",
  "broader",
  "narrower",
  "related-terms",
  "see",
  "scope-note",
] as const;
export type TermField = (typeof TERM_FIELDS)[number];

/** The fields that hold a list. The vocabulary accepts a string or a list; a reader always yields a list. */
export const TERM_LIST_FIELDS = [
  "alt-labels",
  "hidden-labels",
  "broader",
  "narrower",
  "related-terms",
] as const satisfies readonly TermField[];
export type TermListField = (typeof TERM_LIST_FIELDS)[number];

/**
 * One term's fields, as the vocabulary names them.
 *
 * Normalized by every reader: a list field is a non-empty array of non-empty
 * strings, or absent. A string field is a non-empty string, or absent. An
 * empty value is never carried, so two sets read from different constructs
 * compare equal when they say the same thing. `definition` is required by the
 * vocabulary but absent here when a construct cannot hold one: an HTML `<dfn>`
 * names a term without defining it.
 */
export interface TermRecord {
  label: string;
  definition?: string;
  abstract?: string;
  "alt-labels"?: string[];
  "hidden-labels"?: string[];
  broader?: string[];
  narrower?: string[];
  "related-terms"?: string[];
  see?: string;
  "scope-note"?: string;
}

/** Every construct a term is read from. Each has exactly one reader. */
export const TERM_CONSTRUCTS = [
  /** The metadata channel of a one-term file, in any of the six formats. */
  "page",
  /** A YAML or JSON file listed under `term.manifests`. */
  "manifest",
  "dita-glossentry",
  "dita-glossgroup",
  "docbook-glossary",
  "html-dl",
  "html-dfn",
  /** Markdown and MDX. */
  "markdown-deflist",
  "asciidoc-glossary",
  "rst-glossary",
] as const;
export type TermConstruct = (typeof TERM_CONSTRUCTS)[number];

/** Where a term was read from, precisely enough to report on it and to write it back. */
export interface TermLocation {
  /** The file as the user would name it: posix, relative to where it was resolved. `<stdin>` for stdin. */
  file: string;
  /** Absolute path. Absent for stdin, which has nowhere to write back to. */
  path?: string;
  construct: TermConstruct;
  /** 1-based line the entry starts on. */
  line: number;
  /**
   * 1-based line of each field the reader could place. A lint finding sits on
   * its field's line; a field with no entry here sits on `line`.
   */
  fieldLines: Partial<Record<TermField, number>>;
  /**
   * The entry's UTF-16 offsets in the file's content, `[start, end)`, for a
   * body construct that is written back in place. Absent for `page` and
   * `manifest`, which are written through their own channel.
   */
  span?: { start: number; end: number };
}

export interface Term {
  /**
   * The term's identity: the record's `id` where it has one, else the
   * construct's own identifier (`<dt id>`, `xml:id`, a DITA topic `@id`), else
   * the GitHub slug of `label`.
   */
  id: string;
  record: TermRecord;
  /** `language` from the file's metadata, when it carries one. */
  language?: string;
  location: TermLocation;
}

// ---------------------------------------------------------------------------
// Reading

/** One loaded file, as every reader sees it. */
export interface TermInput {
  content: string;
  /** As `TermLocation.file`. */
  file: string;
  /** As `TermLocation.path`. */
  path?: string;
  /** The extractor that read the file (`markdown`, `mdx`, `asciidoc`, `rst`, `html`, `xml`), or `manifest`. */
  format: string;
  /** The file's extracted metadata. `{}` for a manifest, which has none. */
  metadata: Record<string, unknown>;
  /** The extractor's JSON-Pointer line lookup for `metadata`. */
  lineFor: (pointer: string) => number | undefined;
}

export interface TermReadResult {
  terms: Term[];
  /**
   * An entry the reader skipped, and why, said once per entry: a `<dt>` with no
   * term text, a glossentry with no `<glossterm>`. Reported as a notice, not a
   * finding, because no rule governs a construct manni could not read.
   */
  notices: string[];
}

/**
 * The read seam for one construct, and its in-place write where it has one.
 * Writability is derived from `apply` being present, as it is for an extractor.
 */
export interface TermReader {
  construct: TermConstruct;
  /** What `term formats` prints for it: `page`, `definition list`, `DITA glossentry`. */
  label: string;
  /** The `TermInput.format` values this construct appears in. */
  formats: readonly string[];
  /**
   * Every entry this construct holds in one file. `{ terms: [], notices: [] }`
   * when the file holds none, which is most files: the loader offers every file
   * of a matching format to every reader. Throws `TermError` only for a file
   * the construct claims and cannot parse.
   */
  read(this: void, input: TermInput): TermReadResult;
  /**
   * Rewrite this construct's entries in `input.content` from `terms`, which are
   * the terms this reader read from the same file, possibly edited. Returns the
   * new content. Absent for a construct that is not written in place.
   */
  apply?(this: void, input: TermInput, terms: readonly Term[]): string;
}

// ---------------------------------------------------------------------------
// Writing

/** Every `term write -f` value. */
export const TERM_WRITE_FORMATS = [
  "markdown",
  "mdx",
  "asciidoc",
  "rst",
  "html",
  "dita",
  "docbook",
  "tbx",
  "skos",
  "csv",
  "json",
  "vale",
] as const;
export type TermWriteFormat = (typeof TERM_WRITE_FORMATS)[number];

/** The path decides the shape: a directory gets one file per term, a file gets every term. */
export type TermShape = "file" | "directory";

export interface TermTarget {
  /** Absolute. */
  path: string;
  shape: TermShape;
}

export interface TermRenderContext {
  /**
   * The files already under the target, absolute path to content. A writer that
   * owns a directory reads it: the Vale writer finds its own marked files to
   * remove, and refuses to replace a file it did not write.
   */
  existing: ReadonlyMap<string, string>;
}

export interface RenderedFile {
  /** Absolute. */
  path: string;
  content: string;
}

export interface DroppedField {
  id: string;
  field: TermField;
}

export interface TermRender {
  files: RenderedFile[];
  /** Absolute paths the render owns and no longer produces. */
  removals: string[];
  /** Fields the target construct cannot hold, per term written. */
  dropped: DroppedField[];
  /**
   * Ids of the terms left out, in set order, because the target construct's
   * reader could not read them back: a definition list entry with no
   * definition. `[]` when every term was written.
   */
  skipped: string[];
}

/**
 * The render seam for one `-f` value. Pure: it computes files and never touches
 * the disk, so `--dry-run` and `--check` run the same code as a write.
 */
export interface TermWriter {
  format: TermWriteFormat;
  /** The shapes this format is written in. `tbx` is a file only; `vale` is a directory only. */
  shapes: readonly TermShape[];
  /** The fields a render in `shape` keeps. Everything else lands in `dropped`. */
  holds(this: void, shape: TermShape): readonly TermField[];
  /** Throws `TermError` for a target it refuses, such as a Vale style it did not write. */
  render(this: void, terms: readonly Term[], target: TermTarget, context: TermRenderContext): TermRender;
}

// ---------------------------------------------------------------------------
// The set

/** A page's claim that it is about a term: one value of `concepts:` or `kg.concepts`. */
export interface TermReference {
  file: string;
  line?: number;
  label: string;
}

export interface TermSet {
  terms: Term[];
  /** Every `concepts:` and `kg.concepts` value in every file the run loaded. */
  references: TermReference[];
  /** Readers' notices, in load order. */
  notices: string[];
}

// ---------------------------------------------------------------------------
// Findings

/** Every rule `term check` reports, stated once. The default severities derive from this order. */
export const TERM_RULES = [
  "undefined-term",
  "duplicate-id",
  "label-collision",
  "alt-label-collision",
  "dangling-reference",
  "broader-cycle",
  "see-not-empty",
  "asymmetric-hierarchy",
  "abstract-too-long",
  "unused-term",
] as const;
export type TermRule = (typeof TERM_RULES)[number];

/** A rule's level: the family scale plus `off`, which drops the rule's findings. */
export type TermSeverity = Severity | "off";

/** Vale's own severity scale, kept beside the family's on a lint finding. */
export type ValeSeverity = "error" | "warning" | "suggestion";

export interface TermFinding {
  /** `manni:term/<rule>` from `check`; `manni:term/prose/<Style.Rule>` from `lint`. */
  ruleId: string;
  severity: Severity;
  message: string;
  file: string;
  line?: number;
  /** The entry the finding is about, when it is about one. */
  id?: string;
  /** Set on a `check` finding. */
  rule?: TermRule;
  /** Set on a `lint` finding: the tool that raised it. */
  tool?: "vale";
  /** Set on a `lint` finding: the tool's own rule name, `Direct.Length`. */
  check?: string;
  /** Set on a `lint` finding: the tool's own severity, before the fold. */
  toolSeverity?: ValeSeverity;
  /** Set on a `lint` finding: which field the prose came from. */
  field?: TermField;
}

// ---------------------------------------------------------------------------
// Config

/** The `term:` section. Every key is optional; a docset with none needs no section. */
export interface TermConfig {
  manifests?: string[];
  abstractMaxLength?: number;
  baseline?: string;
  severity?: Partial<Record<TermRule, TermSeverity>>;
  allowEmpty?: boolean;
  respectGitignore?: boolean;
}

export interface LoadedTermConfig {
  config: TermConfig;
  path: string;
  dir: string;
  /** The file as the user would name it, for messages. */
  source: string;
  collections: CollectionConfig[];
  tools: ToolsConfig;
}

/** What every command core resolves before touching a file. */
export interface TermRun {
  config: TermConfig | null;
  /** The positional inputs, or the selected collections' `paths:` in declaration order. */
  inputs: string[];
  /** Directory `inputs` resolve from: cwd for positional inputs, the config directory for collections. */
  base: string;
  collections: CollectionConfig[];
  fromCollections: boolean;
  /** Absolute manifest paths, resolved against the config directory. */
  manifests: string[];
  /** The family `tools:`. `{}` when no config governs the run. */
  tools: ToolsConfig;
  configDir?: string;
  configPath?: string;
  configSource?: string;
  configFile?: ConfigFile;
}
