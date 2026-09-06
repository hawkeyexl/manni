import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // The kg tool's real-model tests need network and model weights, which
    // this suite must never do (kg ADR 01025). Extend, not replace: a bare
    // list drops vitest's defaults (node_modules, dist, .git), so anything
    // vendored under test/ would start being collected.
    exclude: [...configDefaults.exclude, "test/kg/real/**"],
    environment: "node",
    // Vitest's 5s default is sized for in-process unit tests. Much of the kg
    // suite is integration tests that spawn `dist/cli.js`, and process spawn
    // on Windows costs multiples of what it costs on Linux — two of them in
    // one test (a determinism gate builds twice, by definition) is enough to
    // blow 5s on a loaded runner. 30s still surfaces a genuine hang promptly.
    testTimeout: 30_000,
    env: {
      // The inference library installs node-llama-cpp on demand into
      // ~/.hawkeyexl-inference/runtime when a local provider is constructed
      // without it. Any non-empty value refuses that. Without this, a test
      // that reached the local provider by accident would download from the
      // network — the one thing the default suite must never do.
      INFERENCE_NO_AUTO_INSTALL: "1",
    },
    coverage: {
      provider: "v8",
      // `text` for the CI log, `lcov` for anything that wants to ingest it.
      // `html` is deliberately absent: nothing here serves it, and it is the
      // slowest reporter to write.
      reporter: ["text", "lcov"],
      // Naming the sources explicitly is the whole point. Left to the default,
      // coverage reports only files some test already imported — so a module
      // with no test at all is not 0%, it is *absent*, and the summary reads
      // better the less of the codebase it covers. `include` makes an untested
      // file show up as the zero it is.
      include: ["src/**/*.ts"],
      // JSON Schema documents, not code. They are `resolveJsonModule` imports
      // with no statements to cover, and counting them would move the number
      // without anyone having tested anything.
      exclude: ["src/meta/schemas/**"],
      // No thresholds yet, on purpose. A gate invented before the first real
      // measurement either sits so low it never fires or so high it fails the
      // build on day one; the number this produces is what a later ratchet
      // should be set just below.
    },
  },
});
