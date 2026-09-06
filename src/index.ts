/** Programmatic API. The metadata tool lives under `src/meta/`. */
export * from "./meta/index.js";

// Each sibling tool is a namespace, so its API cannot collide with the
// metadata tool's flat surface above and a consumer can see which tool a
// name belongs to. `import { docevals } from "@hawkeyexl/manni"`.
export * as docevals from "./docevals/index.js";
