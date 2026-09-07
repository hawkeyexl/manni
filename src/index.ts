/** Programmatic API. The metadata tool lives under `src/meta/`. */
export * from "./meta/index.js";
// Each sibling tool is a namespace, so its names cannot collide with the
// metadata tool's flat export or with each other's:
// `import { cite } from "@hawkeyexl/manni"`.
export * as cite from "./cite/index.js";
