/**
 * Where `meta fill` and `graph build` get the termbase from.
 *
 * The layering runs one way: `term` imports `meta`, and nothing under
 * `src/meta` imports `term`. So the `manni` umbrella registers a source here,
 * one that loads the term domain when asked, and `fill` reads it when one is
 * registered. Under the `docmeta` bin, or a library call, nothing registers
 * one, and `fill` offers no term values.
 */

/**
 * One term, as the family outside the term domain reads it: its preferred
 * label and id, and the facts the graph's concept scheme carries. Relations
 * are written as the term wrote them, a label or an id each.
 */
export interface TermLabel {
  label: string;
  id: string;
  /** The term's language tag, when it carries one. */
  language?: string;
  altLabels?: readonly string[];
  hiddenLabels?: readonly string[];
  broader?: readonly string[];
  narrower?: readonly string[];
  related?: readonly string[];
  /** A redirect: this entry's label is another term's, named here. */
  see?: string;
  definition?: string;
  scopeNote?: string;
  /** Where the term was read: the file, absolute, and its line. */
  file?: string;
  line?: number;
}

/** What a run tells the source, so it reads the termbase `term check` reads. */
export interface TermLabelRequest {
  /** The directory config discovery starts from. */
  cwd: string;
  /** `-c/--config`. */
  configPath?: string;
  /** `--no-config`. */
  noConfig?: boolean;
}

/** Loads the termbase's terms for one run. */
export type TermLabelSource = (request: TermLabelRequest) => Promise<readonly TermLabel[]>;

let registered: TermLabelSource | undefined;

/** Register the source, or clear it with `undefined`. The last one registered wins. */
export function registerTermLabelSource(source: TermLabelSource | undefined): void {
  registered = source;
}

/** The registered source, or `undefined` when nothing registered one. */
export function termLabelSource(): TermLabelSource | undefined {
  return registered;
}
