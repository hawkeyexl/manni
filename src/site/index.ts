/**
 * The site domain's programmatic API, exported from the package as the `site`
 * namespace: `import { site } from "@hawkeyexl/manni"`. The annotate command
 * core (proposal 0095), its report and its renderer. The rehype plugin is its
 * own package subpath, `@hawkeyexl/manni/site/rehype`, because it runs inside
 * a framework's build and imports nothing.
 */
export { SiteError } from "./errors.js";
export { ANNOTATE_FORMATS, renderAnnotate, runAnnotate } from "./commands/annotate.js";
export type { AnnotateFormat, AnnotateNote, AnnotateOptions, AnnotateReport } from "./commands/annotate.js";
