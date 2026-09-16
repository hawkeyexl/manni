/** Programmatic API. The metadata tool lives under `src/meta/`. */
export * from "./meta/index.js";
// Each sibling tool is a namespace, so its names cannot collide with the
// metadata tool's flat export or with each other's:
// `import { cite } from "@hawkeyexl/manni"`.
export * as cite from "./cite/index.js";
// The lint domain (proposal 0049): its command cores, the template registry,
// the parsers and the reporters. `import { lint } from "@hawkeyexl/manni"`.
export * as lint from "./lint/index.js";
// The family encryption key's domain (proposal 0045): its command cores and
// the encryption primitives. `import { key } from "@hawkeyexl/manni"`.
export * as key from "./key/index.js";
