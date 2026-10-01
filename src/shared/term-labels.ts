/**
 * Where `meta fill` gets the termbase's labels from.
 *
 * The layering runs one way: `term` imports `meta`, and nothing under
 * `src/meta` imports `term`. So the term domain registers a source here when
 * its module loads, and `fill` reads it when one is registered. Under the
 * `manni` bin the umbrella loads the term domain, so a source is there. Under
 * the `docmeta` bin, or a library call that loads no term module, there is
 * none, and `fill` offers no term values.
 */

/** One term: its preferred label, and its id. */
export interface TermLabel {
  label: string;
  id: string;
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
