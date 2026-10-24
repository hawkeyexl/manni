// Runs manni for a hook that exists only for tracevals, and only for a user
// who turned tracevals on: the plugin's `tracevals` option, or
// MANNI_TRACEVALS_HOOKS=1. Otherwise it exits at once, before any manni
// starts. Its arguments are manni's, as manni.mjs takes them.
import { isMain, run, tracevalsOn } from "./manni.mjs";

if (isMain(import.meta.url) && tracevalsOn()) run(process.argv.slice(2));
