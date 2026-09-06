/**
 * Imports cleanly and registers nothing — the quiet failure the loader has to
 * make loud. Left unwarned, every eval naming the expected grader would report
 * `unknown grader kind`, which reads like a typo in the artifact.
 */
export const note = "no grader is registered here";
