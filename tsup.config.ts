import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    cli: "src/cli.ts",
    docmeta: "src/docmeta.ts",
    index: "src/index.ts",
    // The tracevals programmatic API, reachable as `@hawkeyexl/manni/tracevals`.
    // A grader plugin registers into the registry this entry shares with the
    // CLI chunk, which is what makes a side-effect plugin work (ADR 01017).
    tracevals: "src/tracevals/index.ts",
  },
  format: ["esm"],
  target: "node24",
  platform: "node",
  // tsup strips `node:` prefixes by default (old-Node compat). `node:sqlite`
  // is a prefix-only builtin — `import("sqlite")` is a package that does not
  // exist — so the strip breaks `query` at runtime while raw esbuild output
  // is fine. Engines are >= 24; nothing needs the strip.
  removeNodeProtocol: false,
  clean: true,
  dts: true,
  sourcemap: true,
  // JSON schemas are imported via resolveJsonModule; bundle them in.
  banner: {
    js: "#!/usr/bin/env node",
  },
});
