// Clean `dist/` before tsup runs.
//
// This cannot be tsup's own `clean: true`: tsup builds an array config
// concurrently (`Promise.all` over the configs), and the declaration rollup of
// any config with `clean` set deletes **every** `.d.ts` in the shared outDir at
// `buildStart`. With the Node build and the browser-native `dockg/runtime`
// build both writing to `dist/`, that raced away `dist/runtime.d.ts` — the file
// package.json's `./runtime` export names as its `types`. Cleaning once, up
// front, and leaving `clean: false` on both configs removes the race entirely.
import { rmSync } from "node:fs";

rmSync(new URL("../dist", import.meta.url), { recursive: true, force: true });
