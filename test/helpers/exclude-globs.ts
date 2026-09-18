/**
 * Exclusion patterns for the a11y tests, named the way each source names them.
 *
 * `ExcludeGlob` carries the string a refusal uses for a pattern, and building
 * that by hand in every case would put the two message shapes in a dozen
 * places. These two builders are the CLI's own labelling, so a test that
 * asserts a message is asserting what a user reads.
 */
import { excludeEntryLabel } from "../../src/a11y/core/config.js";
import type { ExcludeGlob } from "../../src/a11y/core/exclude.js";

/** As a typed `--exclude` supplies them. */
export function flagGlobs(...globs: string[]): ExcludeGlob[] {
  return globs.map((glob) => ({ glob, source: `--exclude "${glob}"` }));
}

/** As `a11y.exclude:` in `file` supplies them, numbered from 0. */
export function configGlobs(file: string, ...globs: string[]): ExcludeGlob[] {
  return globs.map((glob, i) => ({ glob, source: excludeEntryLabel(file, i) }));
}
