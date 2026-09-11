import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // vitest's default is 5000ms, and this suite does not fit inside it on a
    // Windows runner. Much of `cli.integration.test.ts` spawns the built bin
    // as a subprocess, and the query tests write and reopen SQLite databases
    // in a temp directory. Both are dominated by process and filesystem cost
    // rather than by anything the test computes, and both are several times
    // slower on Windows than on Linux, where the slowest of them already runs
    // at ~2.9s. The margin left at 5000ms was not enough, and what it produced
    // was not one stuck test but a rotating cast of them: two failures on one
    // run, a different one on the next, all of them passing everywhere else.
    // 20s is chosen to sit well clear of that ceiling while still failing a
    // genuinely hung test in a bounded time, rather than holding a job open
    // for the runner's own timeout.
    testTimeout: 20_000,
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
