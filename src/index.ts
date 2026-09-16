/** Programmatic API. The metadata tool lives under `src/meta/`. */
export * from "./meta/index.js";
// Each sibling tool is a namespace, so its names cannot collide with the
// metadata tool's flat export or with each other's:
// `import { cite } from "@hawkeyexl/manni"`.
export * as cite from "./cite/index.js";
export * as docevals from "./docevals/index.js";
// The knowledge-graph tool. `./kg/runtime` and `./kg/embed` stay as their own
// package subpaths: those are the browser build, and reaching them through
// this entry point would pull the Node half in with them.
export * as kg from "./kg/index.js";
// The family encryption key's domain (proposal 0045): its command cores and
// the encryption primitives. `import { key } from "@hawkeyexl/manni"`.
export * as key from "./key/index.js";
