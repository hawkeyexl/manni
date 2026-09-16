/**
 * Imports cleanly, then throws from inside `register()`.
 *
 * Distinct from `broken.mjs`, which throws while the module body evaluates and
 * so never reaches the registrar: that one exercises the "could not load"
 * catch, this one the "threw while registering" catch. ADR 01017 documents
 * both as separate failure modes, and without this fixture the second was
 * unreachable from the suite.
 */
export function register() {
  throw new Error("this plugin fails while registering");
}
